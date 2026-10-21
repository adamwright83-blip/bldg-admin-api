import { isClaireRoleFeedback } from "../../../../shared/claireRoleFeedback";
import type { ExecutiveActionGrant } from "../contracts/grants";
import type { ClaireTurnResult, ClaireTurnState } from "../../turn/claireTurn";
import {
  commitBriefing,
  loadExistingWork,
  reconcileBriefing,
  speakBriefingCommit,
} from "../../briefing/briefingCommit";
import { parseBriefingDeterministically } from "../../briefing/deterministicBriefing";
import { briefingClock } from "../../briefing/briefingTiming";
import { speakBriefingSummary } from "../../briefing/speakBriefing";
import type { ParsedBriefing } from "../../briefing/briefingTypes";

type GrantBoundState = Pick<ClaireTurnState, "pendingBriefing">;

const TOKEN_STOP = new Set([
  "the",
  "a",
  "an",
  "to",
  "on",
  "for",
  "my",
  "your",
  "day",
  "line",
  "today",
  "tomorrow",
  "have",
  "has",
  "lives",
  "in",
  "and",
  "also",
  "with",
  "at",
  "of",
  "from",
]);

function tokens(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, " ")
        .split(/\s+/)
        .filter(token => token.length >= 2 && !TOKEN_STOP.has(token))
    ),
  ];
}

function titleMatchesScope(itemTitle: string, scopeTitle: string): boolean {
  const left = tokens(itemTitle);
  const right = tokens(scopeTitle);
  if (!left.length || !right.length) return false;
  const shared = left.filter(token => right.includes(token)).length;
  return shared >= Math.min(2, left.length, right.length);
}

/**
 * A move Claire proposed from the standing goal policy (a lead plan) has no
 * operator sentence to parse: the work is exactly the grant's titles, on the
 * grant's business date. It becomes a PENDING briefing only; the operator's own
 * "yes" is what commits it, through the same `commit_briefing` lifecycle.
 */
function planSourcedWork(grant: ExecutiveActionGrant, today: string): ParsedBriefing {
  const titles = grant.scope.titles?.map(title => title.trim()).filter(Boolean) ?? [];
  if (!titles.length) throw new Error("Brain V2 lead-plan grant is missing bounded work scope");
  const businessDate = grant.scope.businessDate ?? today;
  return {
    items: titles.map(title => ({
      kind: "new_work" as const,
      title,
      quote: title,
      businessDate,
      timing: { kind: "none" as const },
      quantity: null,
      people: [],
      place: null,
      needs: null,
      existing: null,
    })),
    context: [],
    questions: [],
    unparsed: [],
    source: "deterministic",
  };
}

function parseGrantWork(input: {
  grant: ExecutiveActionGrant;
  timeZone: string;
  now: Date;
}): ParsedBriefing {
  const titles = input.grant.scope.titles?.filter(Boolean) ?? [];
  if (!titles.length) {
    throw new Error("Brain V2 Day Line grant is missing bounded work scope");
  }
  if (input.grant.authorityBasis === "standing_goal_policy") {
    return planSourcedWork(input.grant, briefingClock(input.now, input.timeZone).today);
  }

  const parsed = parseBriefingDeterministically(
    input.grant.sourceTurnAssembledText,
    briefingClock(input.now, input.timeZone)
  );
  const items = parsed.items.filter(
    item =>
      (item.kind === "new_work" || item.kind === "completed") &&
      titles.some(title => titleMatchesScope(item.title, title))
  );
  if (!items.length) {
    throw new Error("Brain V2 Day Line grant scope did not resolve to executable work");
  }

  return { ...parsed, items };
}

function hasAuthoritativeCommit(result: Awaited<ReturnType<typeof commitBriefing>>): boolean {
  return Boolean(
    result.commitmentIds.length ||
      result.receipts.length ||
      result.added.length ||
      result.completed.length
  );
}

async function commitParsed(input: {
  parsed: ParsedBriefing;
  state: GrantBoundState;
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  conversationKey: string;
  today: string;
}): Promise<ClaireTurnResult> {
  const dates = [...new Set(input.parsed.items.map(item => item.businessDate))];
  const existing = await loadExistingWork({
    tenantId: input.tenantId,
    dayDirectorActorId: input.dayDirectorActorId,
    dates,
  });
  const reconciled = reconcileBriefing(input.parsed, existing, null);
  const result = await commitBriefing(reconciled, {
    tenantId: input.tenantId,
    dayDirectorActorId: input.dayDirectorActorId,
    operatorUserId: input.operatorUserId,
    conversationKey: input.conversationKey,
    vehicleId: input.operatorUserId,
  });
  const speak = speakBriefingCommit(result, input.today);
  const wrote = hasAuthoritativeCommit(result);

  if (wrote || result.failed.length === 0) {
    input.state.pendingBriefing = null;
  }

  return {
    speak,
    receiptBackedCommit: wrote || result.failed.length === 0 ? speak : undefined,
    kind: wrote || result.failed.length === 0 ? "briefing_saved" : "answered",
    actionIds: result.commitmentIds,
    mutationReceipts: result.receipts,
    assembledUtterance: input.parsed.items.map(item => item.quote).join(" "),
    thoughtCompleteness: "complete",
  };
}

/**
 * Executes only the durable lane named by Brain V2's grant. It does not
 * re-run Claire's semantic router and therefore cannot broaden a Day Line
 * grant into another business mutation.
 */
export async function executeGrantBoundLegacyAdapter(input: {
  grant: ExecutiveActionGrant;
  state: GrantBoundState;
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  conversationKey: string;
  timeZone: string;
  surface: "voice" | "text";
  now?: Date;
}): Promise<ClaireTurnResult> {
  if (isClaireRoleFeedback(input.grant.sourceTurnAssembledText)) throw new Error("Claire role feedback cannot authorize Day Line mutation");
  const now = input.now ?? new Date();
  const clock = briefingClock(now, input.timeZone);

  if (input.grant.actionClass === "commit_briefing") {
    if (
      input.grant.scope.identity !== "pending-briefing"
    ) {
      throw new Error("Brain V2 briefing grant does not match pending briefing authority");
    }
    const pending = input.state.pendingBriefing?.parsed;
    if (!pending?.items?.length) {
      throw new Error("Brain V2 briefing grant has no pending briefing to execute");
    }
    return commitParsed({
      parsed: pending,
      state: input.state,
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      dayDirectorActorId: input.dayDirectorActorId,
      conversationKey: input.conversationKey,
      today: clock.today,
    });
  }

  if (
    input.grant.actionClass !== "propose_day_line" &&
    input.grant.actionClass !== "commit_day_line"
  ) {
    throw new Error(
      `Brain V2 legacy adapter refuses unsupported action class: ${input.grant.actionClass}`
    );
  }

  // A plan Claire authored may only be OFFERED. Committing it needs the operator's yes.
  if (input.grant.authorityBasis === "standing_goal_policy" && input.grant.actionClass !== "propose_day_line") {
    throw new Error("Brain V2 lead-plan authority may propose, never commit");
  }

  const parsed = parseGrantWork({
    grant: input.grant,
    timeZone: input.timeZone,
    now,
  });

  if (input.grant.actionClass === "propose_day_line") {
    input.state.pendingBriefing = {
      parsed,
      createdAt: now.getTime(),
    };
    const summary = speakBriefingSummary({
      parsed,
      today: clock.today,
      surface: input.surface,
    });
    return {
      speak: summary.text,
      kind: "briefing_proposed",
      assembledUtterance: input.grant.sourceTurnAssembledText,
      thoughtCompleteness: "complete",
      actionIds: [],
    };
  }

  return commitParsed({
    parsed,
    state: input.state,
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    dayDirectorActorId: input.dayDirectorActorId,
    conversationKey: input.conversationKey,
    today: clock.today,
  });
}

export function brainV2ExecutionFailureResult(input: {
  assembledUtterance: string;
}): ClaireTurnResult {
  return {
    speak:
      "I couldn't verify that action completed, so I won't retry it through another path.",
    kind: "answered",
    assembledUtterance: input.assembledUtterance,
    thoughtCompleteness: "complete",
    actionIds: [],
  };
}

/** Call-control is presentation only; it must never invoke V1's mutation router. */
export function brainV2CallControlResult(input: {
  candidateSpeak: string;
  assembledUtterance: string;
}): ClaireTurnResult {
  return {
    speak: input.candidateSpeak.trim() || "All right.",
    kind: "answered",
    endCall: true,
    endCallReason: "brain_v2_call_control",
    assembledUtterance: input.assembledUtterance,
    thoughtCompleteness: "complete",
    actionIds: [],
  };
}
