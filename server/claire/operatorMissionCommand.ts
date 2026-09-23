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
 *   (or one token of length >= 5 when the larger set has at most three),
 *   and the larger title does not add a work-action verb.
 *   Command scaffolding (create/make/set/consider/today/mission/...) is not a token.
 *   "Publish the Instagram ad" and "Create and publish one static-image Instagram ad"
 *   share the action publish and stay one commitment.
 *   "Publish the Instagram ad and call Dana" adds call, so it is a different mission.
 * - A genuinely different token set creates a new commitment, designates it
 *   primary, and demotes the previous primary. Demotion does not complete it.
 *
 * Referential commands ("make this a mission", "make that today's mission",
 * "turn that into a mission", and the close make/set/turn + this/that variants)
 * do not contain a title. The referent is one work statement already in the
 * live turn, in this order:
 * - the words in the assembled thought before the command (pending fragment
 *   included);
 * - otherwise the immediately previous operator utterance.
 * "this" and "that" do not choose between items. Two coordinated work titles,
 * or no concrete work statement, clarify and do not write. The day's task
 * list, WeeklyIntent, and any older stop are not candidates.
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
export const OPERATOR_MISSION_CLARIFY_ABSENT_SPEAK = "What should today's mission be?";
export const OPERATOR_MISSION_CLARIFY_AMBIGUOUS_SPEAK = "Which one should be today's mission?";

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
  dropping: "drop",
};

/** Verbs that make a statement executable work. Create stays scaffolding for equivalence. */
const WORK_ACTION_VERBS = new Set([
  "call",
  "publish",
  "create",
  "drop",
  "send",
  "visit",
  "finish",
  "post",
  "write",
  "draft",
  "email",
  "design",
  "book",
  "schedule",
  "pitch",
  "deliver",
  "pick",
  "follow",
  "confirm",
  "review",
  "prepare",
  "build",
  "launch",
  "ship",
  "print",
  "file",
  "text",
  "meet",
  "walk",
  "update",
]);

/** Extra verbs that mean a new mission. Create is not one: create-and-publish is still publish. */
const DIFFERENCE_ACTION_VERBS = new Set(
  [...WORK_ACTION_VERBS].filter(verb => verb !== "create")
);

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
  { pattern: /^make (.+?) a mission$/i, group: 1 },
  { pattern: /^turn (.+?) into (?:a mission|today'?s mission)$/i, group: 1 },
];

export type ParsedOperatorMissionCommand = {
  evidenceQuote: string;
  title: string;
  completionCondition: string;
};

export type OperatorMissionVoiceClass =
  | { kind: "execute"; assembled: string; resolvedMissionClause?: string }
  | { kind: "hold"; assembled: string }
  | { kind: "flush"; assembled: string }
  | { kind: "clarify"; assembled: string; speak: string }
  | { kind: "passthrough" };

export type ReferentialMissionResolution =
  | { status: "not_referential" }
  | { status: "resolved"; clause: string; title: string; evidenceQuote: string }
  | { status: "absent"; speak: typeof OPERATOR_MISSION_CLARIFY_ABSENT_SPEAK }
  | { status: "ambiguous"; speak: typeof OPERATOR_MISSION_CLARIFY_AMBIGUOUS_SPEAK };

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

function actionVerbsInTitle(title: string, verbs: Set<string>): Set<string> {
  const found = new Set<string>();
  for (const raw of title.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    const base = GERUNDS[raw] ?? raw;
    if (verbs.has(base)) found.add(base);
  }
  return found;
}

/** Bounded restatement match. See the file header for the exact rule. */
export function sameOperatorMission(leftTitle: string, rightTitle: string): boolean {
  const left = contentTokens(leftTitle);
  const right = contentTokens(rightTitle);
  if (!left.length || !right.length) return false;
  const a = new Set(left);
  const b = new Set(right);
  const [small, big, smallTitle, bigTitle] =
    a.size <= b.size ? [a, b, leftTitle, rightTitle] : [b, a, rightTitle, leftTitle];
  for (const token of small) {
    if (!big.has(token)) return false;
  }
  const smallVerbs = actionVerbsInTitle(smallTitle, DIFFERENCE_ACTION_VERBS);
  const bigVerbs = actionVerbsInTitle(bigTitle, DIFFERENCE_ACTION_VERBS);
  for (const verb of bigVerbs) {
    if (!smallVerbs.has(verb)) return false;
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

const REFERENTIAL_BODY =
  "(?:(?:make|set) (?:this|that) (?:a mission|today'?s mission|the mission(?: today)?|my mission(?: today)?|as today'?s mission|as my mission today)|turn (?:this|that) into (?:a mission|today'?s mission|the mission(?: today)?|my mission today)|set today'?s mission to (?:this|that)|that(?:'s| is) (?:my mission today|today'?s mission))";

const WORK_LEAD =
  /^(?:(?:please|hey|um|uh|so|well|ok|okay|yeah|yes)[,\s]+)*(?:i(?:'d| would)?\s+like\s+to\s+|i\s+want\s+to\s+|i\s+want\s+|i\s+need\s+to\s+|i\s+need\s+|i(?:'m| am)\s+going\s+to\s+|let(?:'s|s)\s+|can\s+you\s+|could\s+you\s+)+/i;

const NON_WORK_TOKENS = new Set([
  "have",
  "got",
  "gotta",
  "need",
  "want",
  "working",
  "work",
  "doing",
  "do",
  "something",
  "stuff",
  "things",
  "thing",
]);

const VERB_ONLY =
  /^(?:create|creating|publish|publishing|send|sending|visit|visiting|call|calling|finish|finishing|make|making|set|setting|turn|turning)$/i;

export function isReferentialMissionCommand(utterance: string): boolean {
  const text = normalizeMissionUtterance(utterance);
  if (!text) return false;
  return new RegExp(`^${REFERENTIAL_BODY}$`, "i").test(text);
}

function referentialParts(assembled: string): { command: string; prefix: string } | null {
  const text = normalizeMissionUtterance(assembled);
  if (!text) return null;
  if (new RegExp(`^${REFERENTIAL_BODY}$`, "i").test(text)) return { command: text, prefix: "" };
  const match = new RegExp(`^(.*\\S)\\s+(${REFERENTIAL_BODY})$`, "i").exec(text);
  if (!match?.[1] || !match[2]) return null;
  const prefix = match[1]
    .trim()
    .replace(/\s+(?:make|set|turn) (?:this|that)(?:\s+into)?(?:\s+(?:a|the|today'?s|my|as))?$/i, "")
    .trim();
  return { command: match[2], prefix };
}

function leadingWorkAction(text: string): boolean {
  const cleaned = normalizeMissionUtterance(text).replace(WORK_LEAD, "").trim();
  const first = cleaned.split(/\s+/)[0] ?? "";
  if (!first) return false;
  if (WORK_ACTION_VERBS.has(GERUNDS[first.toLowerCase()] ?? first.toLowerCase())) return true;
  return /^(?:create|creating)\s+and\s+(?:publish|publishing)\b/i.test(cleaned);
}

/** A copula, passive, or status fact. Not something Claire may turn into a task. */
function isFactualStatement(text: string): boolean {
  const cleaned = normalizeMissionUtterance(text);
  if (!cleaned || leadingWorkAction(cleaned)) return false;
  return /\b(?:is|are|was|were|been|isn't|aren't|wasn't|weren't|hasn't|haven't|hadn't|owes|owed)\b/i.test(cleaned);
}

function isExecutableWorkStatement(text: string): boolean {
  const cleaned = normalizeMissionUtterance(text);
  if (!cleaned || isReferentialMissionCommand(cleaned)) return false;
  if (parseExplicitOperatorMissionCommand(cleaned)) return true;
  if (leadingWorkAction(cleaned)) return true;
  if (isFactualStatement(cleaned)) return false;
  const bare = cleaned.replace(WORK_LEAD, "").trim();
  if (!bare || /\b(?:is|are|was|were|been|has|have|had|hasn't|haven't|owes|owed|did|does|do)\b/i.test(bare)) {
    return false;
  }
  return normalizeMissionClause(bare) !== null;
}

function concreteWorkTitle(text: string): string | null {
  if (!isExecutableWorkStatement(text)) return null;
  const cleaned = normalizeMissionUtterance(text).replace(WORK_LEAD, "").trim();
  if (!cleaned || isReferentialMissionCommand(cleaned)) return null;
  if (/^(?:who|what|when|where|why|how|is|are|do|did|can|could|would|should)\b/i.test(cleaned)) return null;
  const titled = parseExplicitOperatorMissionCommand(cleaned);
  const title = titled?.title ?? normalizeMissionClause(cleaned);
  if (!title) return null;
  const concrete = contentTokens(title).filter(token => !NON_WORK_TOKENS.has(token));
  return concrete.length ? title : null;
}

/** One statement can name two pieces of work. "create and publish …" stays one. */
export function workTitlesInStatement(text: string): string[] {
  const cleaned = normalizeMissionUtterance(text);
  if (!cleaned || isReferentialMissionCommand(cleaned)) return [];
  if (/[?]\s*$/.test(text.trim())) return [];
  const titled = parseExplicitOperatorMissionCommand(cleaned);
  if (titled) return [titled.title];
  if (/^(?:create|creating)\s+and\s+(?:publish|publishing)\b/i.test(cleaned)) {
    const title = concreteWorkTitle(cleaned);
    return title ? [title] : [];
  }
  const parts = cleaned.split(/\s+(?:and|or)\s+/i);
  if (parts.length > 1) {
    const titles = parts
      .filter(part => !VERB_ONLY.test(part.trim()))
      .map(part => concreteWorkTitle(part))
      .filter((title): title is string => Boolean(title));
    if (titles.length >= 2) return titles;
  }
  const one = concreteWorkTitle(cleaned);
  return one ? [one] : [];
}

function referentialEvidence(command: string, clause: string): string {
  const spoken = normalizeMissionUtterance(command);
  const work = normalizeMissionUtterance(clause);
  if (!work || spoken.toLowerCase().includes(work.toLowerCase())) return spoken;
  return `${work}. ${spoken}`;
}

/**
 * Resolves make/set/turn + this/that to the single work statement already in
 * this live turn. Does not consult the task list or the locked week.
 */
export function resolveReferentialMissionCommand(input: {
  assembled: string;
  priorOperatorUtterance?: string | null;
}): ReferentialMissionResolution {
  const parts = referentialParts(input.assembled);
  if (!parts) return { status: "not_referential" };
  const source = parts.prefix.trim() || input.priorOperatorUtterance?.trim() || "";
  if (!source) return { status: "absent", speak: OPERATOR_MISSION_CLARIFY_ABSENT_SPEAK };
  const titles = workTitlesInStatement(source);
  if (titles.length > 1) return { status: "ambiguous", speak: OPERATOR_MISSION_CLARIFY_AMBIGUOUS_SPEAK };
  if (titles.length !== 1) return { status: "absent", speak: OPERATOR_MISSION_CLARIFY_ABSENT_SPEAK };
  return {
    status: "resolved",
    clause: source,
    title: titles[0]!,
    evidenceQuote: referentialEvidence(input.assembled, source),
  };
}

export function isIncompleteOperatorMissionPrefix(utterance: string): boolean {
  if (parseExplicitOperatorMissionCommand(utterance)) return false;
  if (isReferentialMissionCommand(utterance)) return false;
  const text = normalizeMissionUtterance(utterance);
  if (!text || /[?]\s*$/.test(utterance.trim())) return false;
  if (/^create (?:today'?s mission|a mission for today)\s*:?\s*$/i.test(text)) return true;
  if (/^set today'?s mission\s*:?\s*$/i.test(text)) return true;
  if (/^(?:make|set) (?:this|that)(?:\s+(?:a|the|today'?s|my|as))?(?:\s+mission)?$/i.test(text)) return true;
  if (/^turn (?:this|that)(?:\s+into(?:\s+(?:a|today'?s|the|my))?)?$/i.test(text)) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 24) return false;
  if (
    /^i want\s+(?!to\b)(?!you\b)\S+(?:\s+\S+){1,}/i.test(text) &&
    !/\bconsidered as my mission today$/i.test(text)
  ) {
    return true;
  }
  if (
    /^make\s+(?!sure\b)\S+(?:\s+\S+){1,}/i.test(text) &&
    !/\b(?:my mission today|today'?s mission|the mission today|a mission)$/i.test(text)
  ) {
    return true;
  }
  if (/^set\s+(?!today'?s mission\b)\S+/i.test(text) && !/\bas today'?s mission$/i.test(text)) return true;
  if (
    /^consider\s+(?!what\b|whether\b|how\b|if\b|why\b)\S+/i.test(text) &&
    !/\b(?:my mission today|today'?s mission)$/i.test(text)
  ) {
    return true;
  }
  return false;
}

export function classifyOperatorMissionVoiceTurn(input: {
  pendingFragment: string | null;
  utterance: string;
  allowFragmentWait: boolean;
  fragmentHolds?: number;
  maxHolds?: number;
  /** Immediately previous operator line. Not the day's task list. */
  priorOperatorUtterance?: string | null;
}): OperatorMissionVoiceClass {
  const pending = input.pendingFragment?.trim() || null;
  const incoming = input.utterance.trim();
  const assembled = pending ? `${pending} ${incoming}`.trim() : incoming;
  if (!assembled) return { kind: "passthrough" };
  if (parseExplicitOperatorMissionCommand(assembled)) return { kind: "execute", assembled };
  const referential = resolveReferentialMissionCommand({
    assembled,
    priorOperatorUtterance: input.priorOperatorUtterance,
  });
  if (referential.status === "resolved") {
    return { kind: "execute", assembled, resolvedMissionClause: referential.clause };
  }
  if (referential.status === "absent" || referential.status === "ambiguous") {
    return { kind: "clarify", assembled, speak: referential.speak };
  }
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
  if (outcome === "already") {
    if (receipts.length > 0) return null;
    if (BANNED_CREATION_SPEECH.test(OPERATOR_MISSION_ALREADY_SPEAK)) return null;
    if (/^(?:Created|Updated|Done)\b/.test(OPERATOR_MISSION_ALREADY_SPEAK)) return null;
    return OPERATOR_MISSION_ALREADY_SPEAK;
  }
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
  const speak = outcome === "created" ? OPERATOR_MISSION_CREATED_SPEAK : OPERATOR_MISSION_UPDATED_SPEAK;
  if (BANNED_CREATION_SPEECH.test(speak)) return null;
  if (outcome === "created" && !/^Created\./.test(speak)) return null;
  if (outcome === "updated" && !/^Updated\./.test(speak)) return null;
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

function parsedReferentialCommand(
  utterance: string,
  resolvedMissionClause: string | null | undefined
): ParsedOperatorMissionCommand | null {
  if (!referentialParts(utterance)) return null;
  const clause = resolvedMissionClause?.trim() ?? "";
  if (!clause) return null;
  const titles = workTitlesInStatement(clause);
  if (titles.length !== 1) return null;
  const title = titles[0]!;
  return {
    evidenceQuote: referentialEvidence(utterance, clause),
    title,
    completionCondition: completionConditionForMission(title),
  };
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
    /** Work statement resolved from this live turn. Ignored unless the utterance is referential. */
    resolvedMissionClause?: string | null;
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
    const parsed =
      parseExplicitOperatorMissionCommand(input.utterance) ??
      parsedReferentialCommand(input.utterance, input.resolvedMissionClause);
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
    const receipts: MutationReceipt[] =
      outcome === "already"
        ? []
        : [
            {
              claimedState: claimed,
              entityId: commitmentId,
              statement:
                outcome === "updated" ? `Today's mission is now ${title}.` : `Today's mission is ${title}.`,
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
      actionIds: outcome === "already" ? [] : [commitmentId],
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
