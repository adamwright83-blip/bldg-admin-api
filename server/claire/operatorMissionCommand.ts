/**
 * Live V1 operator mission command.
 *
 * One action adapter around Day Director / Daily Command. It designates today's
 * primary. It does not rewrite WeeklyIntent, create a mission table, call
 * Narrator, or grant Brain V2 production authority.
 *
 * Idempotency: one open operator-mission primary per business date.
 * - Exact retry uses the same operatorMissionKey (content tokens + business date)
 *   and returns the existing commitment.
 * - A restatement is the same mission when its content-token set is a subset of
 *   the stored title's tokens and the smaller set has at least two tokens
 *   (or one token of length >= 5 when the larger set has at most three).
 *   Command scaffolding (create/make/set/consider/today/mission/...) is not a token.
 *   "Publish the Instagram ad" and "Create and publish one static-image Instagram ad"
 *   share {publish, instagram, ad} and stay one commitment.
 * - A genuinely different token set creates a new commitment, designates it
 *   primary, and demotes the previous primary. Demotion does not complete it.
 */

import { createHash } from "node:crypto";
import { AssertionGuard, type MutationReceipt } from "./assertionGuard";
import { acceptProposal, designateDayDirectorPrimary, getDayDirectorState } from "../dayDirector/dayDirectorService";
import { loadDailyCommand, type DailyCommand } from "./dailyCommandContract";
import {
  applyWeeklyIntentToCommand,
  explicitOperatorMissionDisplacement,
  playableToday,
  type DailyCommandWithIntent,
} from "./weeklyMission/dailyCommandIntent";
import { latestWeeklyIntent } from "./weeklyMission/intentStore";
import type { WeeklyIntentRecord } from "../../shared/weeklyMissionReadiness";
import { weekStartMonday } from "../../shared/weeklyMissionReadiness";
import {
  emptyCommandMetadata,
  gameBindingsForCommand,
  type OperatorMissionMetadata,
} from "../../shared/claireWorkdayCommand";
import { compressTitle } from "./briefing/titleContract";
import type { DayDirectorProposal } from "../../shared/dayDirector";

export const OPERATOR_MISSION_CREATED_SPEAK = "Created. That's today's mission.";
export const OPERATOR_MISSION_ALREADY_SPEAK = "That's already today's mission.";
export const OPERATOR_MISSION_UPDATED_SPEAK = "Updated. That's today's mission.";
export const OPERATOR_MISSION_FAILED_SPEAK = "I couldn't set today's mission just now.";

const BANNED_CREATION_SPEECH =
  /\b(?:locked|your week is set|week locked|week is set|done|mission completed|published|ad is live)\b/i;

const STOP_TOKENS = new Set([
  "a",
  "an",
  "the",
  "my",
  "our",
  "today",
  "mission",
  "to",
  "as",
  "for",
  "of",
  "and",
  "one",
  "this",
  "that",
  "i",
  "want",
  "considered",
  "consider",
  "create",
  "creating",
  "make",
  "making",
  "set",
  "setting",
  "please",
  "claire",
  "hey",
]);

const GERUNDS: Record<string, string> = {
  publishing: "publish",
  creating: "create",
  sending: "send",
  visiting: "visit",
  calling: "call",
  finishing: "finish",
  pitching: "pitch",
  posting: "post",
  writing: "write",
  drafting: "draft",
  emailing: "email",
  designing: "design",
  booking: "book",
  scheduling: "schedule",
};

const FRAMES: Array<{ pattern: RegExp; group: number }> = [
  { pattern: /^create today'?s mission:\s*(.+)$/i, group: 1 },
  { pattern: /^create a mission for today:\s*(.+)$/i, group: 1 },
  { pattern: /^make (.+?) my mission today$/i, group: 1 },
  { pattern: /^make (.+?) today'?s mission$/i, group: 1 },
  { pattern: /^make (.+?) the mission today$/i, group: 1 },
  { pattern: /^set (.+?) as today'?s mission$/i, group: 1 },
  { pattern: /^set today'?s mission to (.+)$/i, group: 1 },
  { pattern: /^i want (.+?) considered as my mission today$/i, group: 1 },
  { pattern: /^consider (.+?) my mission today$/i, group: 1 },
  { pattern: /^consider (.+?) today'?s mission$/i, group: 1 },
];

export type ParsedOperatorMissionCommand = {
  evidenceQuote: string;
  title: string;
  completionCondition: string;
};

export type OperatorMissionVoiceClass =
  | { kind: "execute"; assembled: string }
  | { kind: "hold"; assembled: string }
  | { kind: "flush"; assembled: string }
  | { kind: "passthrough" };

export type OperatorMissionCommandSuccess = {
  ok: true;
  outcome: "created" | "already" | "updated";
  speak: string;
  dayDirectorCommitmentId: string;
  opsTaskId: null;
  actionIds: string[];
  receipts: MutationReceipt[];
  businessDate: string;
  title: string;
  kind: "growth";
  role: "primary";
  status: "open";
  completionCondition: string;
  verification: "operator_reported";
  operatorMissionKey: string;
  sourceCommandRef: string;
  weeklyIntentUnchanged: true;
  weeklyIntentOverrideCode: "operator_replaced_weekly_primary" | null;
  playableTitle: string;
};

export type OperatorMissionCommandFailure = {
  ok: false;
  speak: typeof OPERATOR_MISSION_FAILED_SPEAK;
  actionIds: [];
  receipts: [];
};

export type OperatorMissionCommandResult = OperatorMissionCommandSuccess | OperatorMissionCommandFailure;

type ListedCommitment = {
  id: string;
  title: string;
  kind: "growth" | "prep" | "operations";
  status: "open" | "completed";
  businessDate: string;
  sourceText: string | null;
  commandRole: "primary" | null;
  operatorMission: OperatorMissionMetadata | null;
};

export type OperatorMissionCommandDeps = {
  listToday?: (input: { tenantId: string; actorId: string; businessDate: string }) => Promise<ListedCommitment[]>;
  acceptProposal?: typeof acceptProposal;
  designatePrimary?: typeof designateDayDirectorPrimary;
  loadCommand?: typeof loadDailyCommand;
  latestIntent?: typeof latestWeeklyIntent;
  now?: () => Date;
};

export function normalizeMissionUtterance(utterance: string): string {
  return utterance
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:hey\s+)?claire(?:\s*[:,.-]\s*|\s+)/i, "")
    .trim();
}

export function contentTokens(title: string): string[] {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 2 && !STOP_TOKENS.has(token));
}

/** Bounded restatement match. See the file header for the exact rule. */
export function sameOperatorMission(leftTitle: string, rightTitle: string): boolean {
  const left = contentTokens(leftTitle);
  const right = contentTokens(rightTitle);
  if (!left.length || !right.length) return false;
  const a = new Set(left);
  const b = new Set(right);
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (!big.has(token)) return false;
  }
  if (small.size >= 2) return true;
  const only = [...small][0] ?? "";
  return only.length >= 5 && big.size <= 3;
}

export function operatorMissionKeyFor(businessDate: string, title: string): string {
  const tokens = contentTokens(title).slice().sort().join(" ");
  const hash = createHash("sha256").update(`${businessDate}|${tokens}`).digest("hex").slice(0, 16);
  return `om:${businessDate}:${hash}`;
}

function normalizeMissionClause(clause: string): string | null {
  const cleaned = clause.replace(/\s+/g, " ").trim().replace(/^[,"']+|[,"']+$/g, "").replace(/[.,;:!?]+$/g, "");
  if (!cleaned) return null;
  const parts = cleaned.split(/\s+/);
  const mapped = parts.map((token, index) => {
    const bare = token.toLowerCase().replace(/[.,;:!?]+$/g, "");
    const previous = index > 0 ? parts[index - 1]!.toLowerCase().replace(/[.,;:!?]+$/g, "") : "";
    const leading = index === 0 || previous === "and";
    if (!leading) return token;
    return GERUNDS[bare] ?? token;
  });
  const title = compressTitle(mapped.join(" ")).slice(0, 255).trim();
  if (title.split(/\s+/).filter(Boolean).length < 2) return null;
  return title;
}

/**
 * Deterministic completion text. External systems are not consulted.
 * publish X → "X is published." send X → "X is sent." visit… → "The visit is completed."
 * Anything else stays operator-reported without claiming verification.
 */
export function completionConditionForMission(title: string): string {
  const text = title.trim().replace(/[.]+$/g, "");
  const publish = /^(?:create and )?publish\s+(.+)$/i.exec(text);
  if (publish?.[1]) return `${capitalizeSentence(publish[1].trim())} is published.`;
  const send = /^send\s+(.+)$/i.exec(text);
  if (send?.[1]) return `${capitalizeSentence(send[1].trim())} is sent.`;
  if (/^visit\b/i.test(text)) return "The visit is completed.";
  return `Operator reports completion of: ${text}`;
}

function capitalizeSentence(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function parseExplicitOperatorMissionCommand(utterance: string): ParsedOperatorMissionCommand | null {
  const evidenceQuote = normalizeMissionUtterance(utterance);
  if (!evidenceQuote) return null;
  for (const frame of FRAMES) {
    const match = frame.pattern.exec(evidenceQuote);
    const clause = match?.[frame.group]?.trim();
    if (!clause) continue;
    const title = normalizeMissionClause(clause);
    if (!title) return null;
    return {
      evidenceQuote,
      title,
      completionCondition: completionConditionForMission(title),
    };
  }
  return null;
}

export function isIncompleteOperatorMissionPrefix(utterance: string): boolean {
  if (parseExplicitOperatorMissionCommand(utterance)) return false;
  const text = normalizeMissionUtterance(utterance);
  if (!text || /[?]\s*$/.test(utterance.trim())) return false;
  if (/^create (?:today'?s mission|a mission for today)\s*:?\s*$/i.test(text)) return true;
  if (/^set today'?s mission\s*:?\s*$/i.test(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 24) return false;
  if (/^i want\s+\S+(?:\s+\S+){1,}/i.test(text) && !/\bconsidered as my mission today$/i.test(text)) return true;
  if (/^make\s+\S+(?:\s+\S+){1,}/i.test(text) && !/\b(?:my mission today|today'?s mission|the mission today)$/i.test(text)) {
    return true;
  }
  if (/^set\s+(?!today'?s mission\b)\S+/i.test(text) && !/\bas today'?s mission$/i.test(text)) return true;
  if (/^consider\s+\S+/i.test(text) && !/\b(?:my mission today|today'?s mission)$/i.test(text)) return true;
  return false;
}

export function classifyOperatorMissionVoiceTurn(input: {
  pendingFragment: string | null;
  utterance: string;
  allowFragmentWait: boolean;
  fragmentHolds?: number;
  maxHolds?: number;
}): OperatorMissionVoiceClass {
  const pending = input.pendingFragment?.trim() || null;
  const incoming = input.utterance.trim();
  const assembled = pending ? `${pending} ${incoming}`.trim() : incoming;
  if (!assembled) return { kind: "passthrough" };
  if (parseExplicitOperatorMissionCommand(assembled)) return { kind: "execute", assembled };
  const holds = input.fragmentHolds ?? 0;
  const maxHolds = input.maxHolds ?? 5;
  if (input.allowFragmentWait && isIncompleteOperatorMissionPrefix(assembled) && holds < maxHolds) {
    return { kind: "hold", assembled };
  }
  if (pending && isIncompleteOperatorMissionPrefix(pending)) return { kind: "flush", assembled };
  return { kind: "passthrough" };
}

export function projectPlayableOperatorMission(command: Pick<DailyCommand, "primary"> & { explicitOperatorMission?: OperatorMissionMetadata | null }): {
  title: string | null;
  commitmentId: string | null;
  source: "daily_command";
  opsTaskRequired: false;
} {
  const playable = playableToday({ command, draftTitle: null });
  const commitmentId = command.explicitOperatorMission
    ? command.primary?.provenance.sourceIds.find(id => id && !id.startsWith("weekly-intent:")) ?? null
    : null;
  return {
    title: playable.title,
    commitmentId,
    source: "daily_command",
    opsTaskRequired: false,
  };
}

function failure(): OperatorMissionCommandFailure {
  return { ok: false, speak: OPERATOR_MISSION_FAILED_SPEAK, actionIds: [], receipts: [] };
}

function intentFingerprint(intent: WeeklyIntentRecord | null): string {
  if (!intent) return "none";
  return JSON.stringify({
    id: intent.id,
    tenantId: intent.tenantId,
    operatorId: intent.operatorId,
    weekStart: intent.weekStart,
    revision: intent.revision,
    source: intent.source,
    days: intent.days,
  });
}

function licensedSpeak(
  outcome: "created" | "already" | "updated",
  commitmentId: string,
  receipts: MutationReceipt[],
  nowIso: string
): string | null {
  const claimed = outcome === "updated" ? "updated" : "created";
  const receipt = receipts.find(item => item.claimedState === claimed && item.entityId === commitmentId);
  if (!receipt) return null;
  const verified = AssertionGuard.verifyClaim({
    claimedState: claimed,
    entityRef: commitmentId,
    writeReceipt: { writtenAt: nowIso, entityId: commitmentId, confirmedState: claimed },
    writtenTruthStatus: claimed,
  });
  if (verified !== "verified") return null;
  const speak =
    outcome === "created"
      ? OPERATOR_MISSION_CREATED_SPEAK
      : outcome === "updated"
        ? OPERATOR_MISSION_UPDATED_SPEAK
        : OPERATOR_MISSION_ALREADY_SPEAK;
  if (BANNED_CREATION_SPEECH.test(speak)) return null;
  if (outcome === "created" && !/^Created\./.test(speak)) return null;
  if (outcome === "updated" && !/^Updated\./.test(speak)) return null;
  if (outcome === "already" && /^(?:Created|Updated|Done)\b/.test(speak)) return null;
  return speak;
}

async function defaultListToday(input: {
  tenantId: string;
  actorId: string;
  businessDate: string;
}): Promise<ListedCommitment[]> {
  const state = await getDayDirectorState(input);
  return state.commitments.map(row => ({
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    businessDate: row.businessDate,
    sourceText: row.sourceText ?? null,
    commandRole: row.command?.role === "primary" ? "primary" : null,
    operatorMission: row.operatorMission ?? null,
  }));
}

export async function executeOperatorMissionCommand(
  input: {
    tenantId: string;
    operatorUserId: string;
    dayDirectorActorId: string;
    /** WeeklyIntent owner. Live voice passes the Claire operator id, not a phone or spoken name. */
    weeklyIntentOperatorId?: string;
    businessDate: string;
    utterance: string;
    sourceCommandRef: string;
  },
  deps: OperatorMissionCommandDeps = {}
): Promise<OperatorMissionCommandResult> {
  try {
    const tenantId = input.tenantId.trim();
    const operatorUserId = input.operatorUserId.trim();
    const dayDirectorActorId = input.dayDirectorActorId.trim();
    const businessDate = input.businessDate.trim();
    const sourceCommandRef = input.sourceCommandRef.trim();
    if (!tenantId || !operatorUserId || !dayDirectorActorId || dayDirectorActorId === "unknown") return failure();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) return failure();
    if (!sourceCommandRef) return failure();
    const parsed = parseExplicitOperatorMissionCommand(input.utterance);
    if (!parsed) return failure();

    const now = deps.now?.() ?? new Date();
    const nowIso = now.toISOString();
    const listToday = deps.listToday ?? defaultListToday;
    const accept = deps.acceptProposal ?? acceptProposal;
    const designate = deps.designatePrimary ?? designateDayDirectorPrimary;
    const loadCommand = deps.loadCommand ?? loadDailyCommand;
    const latestIntent = deps.latestIntent ?? latestWeeklyIntent;
    const weekStart = weekStartMonday(businessDate);
    const intentOperatorIds = [
      ...new Set(
        [input.weeklyIntentOperatorId?.trim() || operatorUserId, operatorUserId, dayDirectorActorId].filter(Boolean)
      ),
    ];

    const beforeIntents = await Promise.all(
      intentOperatorIds.map(operatorId => latestIntent({ tenantId, operatorId, weekStart }))
    );
    const beforeFingerprint = beforeIntents.map(intentFingerprint).join("|");

    const existing = await listToday({ tenantId, actorId: dayDirectorActorId, businessDate });
    const openOperatorMissions = existing.filter(row => row.status === "open" && row.operatorMission);
    const equivalent =
      openOperatorMissions.find(row => sameOperatorMission(row.title, parsed.title)) ?? null;
    const hadOtherPrimary = existing.some(
      row => row.status === "open" && row.commandRole === "primary" && row.id !== equivalent?.id
    );

    let commitmentId = equivalent?.id ?? "";
    let title = equivalent?.title ?? parsed.title;
    let completionCondition = equivalent?.operatorMission?.completionCondition ?? parsed.completionCondition;
    let operatorMissionKey = equivalent?.operatorMission?.operatorMissionKey ?? operatorMissionKeyFor(businessDate, title);
    let storedSourceRef = equivalent?.operatorMission?.sourceCommandRef ?? sourceCommandRef;
    let outcome: "created" | "already" | "updated";

    if (equivalent) {
      title = equivalent.title;
      completionCondition = equivalent.operatorMission?.completionCondition || parsed.completionCondition;
      operatorMissionKey = equivalent.operatorMission?.operatorMissionKey || operatorMissionKey;
      storedSourceRef = equivalent.operatorMission?.sourceCommandRef || sourceCommandRef;
      if (equivalent.commandRole !== "primary") {
        await designate({
          tenantId,
          actorId: dayDirectorActorId,
          businessDate,
          commitmentId: equivalent.id,
          nowIso,
          designatedBy: "operator",
        });
        outcome = "updated";
      } else {
        outcome = "already";
      }
    } else {
      const metadata: OperatorMissionMetadata = {
        version: 1,
        source: "operator_explicit",
        scope: "today_only",
        completionCondition: parsed.completionCondition,
        verification: "operator_reported",
        operatorMissionKey,
        requestedAt: nowIso,
        weeklyIntentDisplacement: true,
        sourceCommandRef,
        evidenceQuote: parsed.evidenceQuote,
        businessDate,
      };
      const proposal: DayDirectorProposal = {
        promptKey: `operator-mission:${operatorMissionKey}`,
        title: parsed.title,
        kind: "growth",
        quantity: null,
        sourceText: parsed.evidenceQuote,
        prerequisites: [],
        question: null,
        intelligence: "manual_fallback",
        detailState: "COMPLETE",
        targetBusinessDate: businessDate,
        command: {
          ...emptyCommandMetadata(),
          role: "primary",
          designatedBy: "operator",
          designatedAt: nowIso,
        },
        operatorMission: metadata,
      };
      const stored = await accept({
        tenantId,
        actorId: dayDirectorActorId,
        businessDate,
        proposal,
      });
      if (!stored?.id) return failure();
      commitmentId = stored.id;
      title = stored.title || parsed.title;
      await designate({
        tenantId,
        actorId: dayDirectorActorId,
        businessDate,
        commitmentId,
        nowIso,
        designatedBy: "operator",
      });
      outcome = hadOtherPrimary ? "updated" : "created";
    }

    const afterIntents = await Promise.all(
      intentOperatorIds.map(operatorId => latestIntent({ tenantId, operatorId, weekStart }))
    );
    if (afterIntents.map(intentFingerprint).join("|") !== beforeFingerprint) return failure();

    const loaded = await loadCommand({
      tenantId,
      actorId: dayDirectorActorId,
      dayDirectorActorId,
      operatorUserId,
      businessDate,
    });
    const weeklyDays = beforeIntents.find(intent => intent?.days?.length)?.days ?? null;
    const displacement = explicitOperatorMissionDisplacement(loaded);
    const effective = applyWeeklyIntentToCommand(loaded, weeklyDays, displacement);
    const readbackOk = verifyReadback({
      effective,
      loaded,
      title,
      requestedTitle: parsed.title,
      commitmentId,
      businessDate,
      completionCondition,
    });
    if (!readbackOk) return failure();

    const claimed = outcome === "updated" ? "updated" : "created";
    const receipts: MutationReceipt[] = [
      {
        claimedState: claimed,
        entityId: commitmentId,
        statement:
          outcome === "already"
            ? `Today's mission remains ${title}.`
            : outcome === "updated"
              ? `Today's mission is now ${title}.`
              : `Today's mission is ${title}.`,
      },
    ];
    const speak = licensedSpeak(outcome, commitmentId, receipts, nowIso);
    if (!speak) return failure();
    const playable = projectPlayableOperatorMission(effective);
    if (playable.title !== title || playable.opsTaskRequired) return failure();

    return {
      ok: true,
      outcome,
      speak,
      dayDirectorCommitmentId: commitmentId,
      opsTaskId: null,
      actionIds: [commitmentId],
      receipts,
      businessDate,
      title,
      kind: "growth",
      role: "primary",
      status: "open",
      completionCondition,
      verification: "operator_reported",
      operatorMissionKey,
      sourceCommandRef: storedSourceRef,
      weeklyIntentUnchanged: true,
      weeklyIntentOverrideCode: effective.weeklyIntentOverride?.code === "operator_replaced_weekly_primary"
        ? "operator_replaced_weekly_primary"
        : null,
      playableTitle: playable.title,
    };
  } catch (error) {
    console.error("[Claire] operator mission command failed", error);
    return failure();
  }
}

function verifyReadback(input: {
  effective: DailyCommandWithIntent;
  loaded: DailyCommand;
  title: string;
  requestedTitle: string;
  commitmentId: string;
  businessDate: string;
  completionCondition: string;
}): boolean {
  const primary = input.effective.primary;
  const mission = input.loaded.explicitOperatorMission;
  if (!primary || !mission) return false;
  if (primary.status !== "open") return false;
  if (primary.dayDirectorKind !== "growth") return false;
  if (input.effective.businessDate !== input.businessDate) return false;
  if (primary.title !== input.title) return false;
  if (primary.title !== input.requestedTitle && !sameOperatorMission(primary.title, input.requestedTitle)) return false;
  if (!primary.provenance.sourceIds.includes(input.commitmentId)) return false;
  if (mission.verification !== "operator_reported") return false;
  if (mission.scope !== "today_only" || mission.source !== "operator_explicit") return false;
  if (mission.businessDate !== input.businessDate) return false;
  if (mission.completionCondition !== input.completionCondition) return false;
  if (mission.weeklyIntentDisplacement !== true) return false;
  if (/daily command is running/i.test(mission.evidenceQuote)) return false;
  const binding = gameBindingsForCommand(input.effective).find(row => row.commandItemId === primary.id);
  if (!binding?.eligible || !binding.sourceIds.includes(input.commitmentId)) return false;
  const playable = playableToday({ command: input.effective, draftTitle: "not today's mission" });
  if (playable.title !== primary.title || playable.source !== "daily_command") return false;
  if (input.effective.weeklyIntentOverride && input.effective.weeklyIntentOverride.code === "operator_replaced_weekly_primary") {
    if (/daily command is running/i.test(input.effective.weeklyIntentOverride.reason)) return false;
    if (!input.effective.weeklyIntentOverride.evidenceQuote.trim()) return false;
    if (!input.effective.weeklyIntentOverride.reason.toLowerCase().includes("explicit operator mission command")) return false;
  }
  const weeklyPrimaryWouldDiffer = Boolean(
    input.effective.weeklyIntentOverride == null &&
      input.loaded.primary &&
      input.effective.primary &&
      input.loaded.primary.title !== input.effective.primary.title
  );
  if (weeklyPrimaryWouldDiffer) return false;
  return input.effective.constraints.protectDiscretionary === true;
}
