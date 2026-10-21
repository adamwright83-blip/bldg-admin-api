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

/**
 * The grant could not be turned into executable work, and NOTHING was attempted.
 * Production call 2026-10-13 (session 62df3040, conversation 28727517): a grant was
 * minted for "I think I should call Dana after Louise." and for "You haven't been
 * doing your job, Claire.", the scope resolved to no work, the adapter threw, and the
 * caller spoke "I couldn't verify that action completed" three times — once in reply
 * to "Yes.". A refusal before any write is not an execution failure and must never be
 * spoken as one.
 */
export class BrainV2GrantNotExecutableError extends Error {
  readonly actionClass: ExecutiveActionGrant["actionClass"];
  constructor(message: string, grant: ExecutiveActionGrant) {
    super(message);
    this.name = "BrainV2GrantNotExecutableError";
    this.actionClass = grant.actionClass;
  }
}

/** A write WAS attempted and did not complete. `attempted` says what, in Claire's words. */
export class BrainV2ExecutionFailedError extends Error {
  readonly attempted: string;
  constructor(attempted: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : "Brain V2 grant execution failed");
    this.name = "BrainV2ExecutionFailedError";
    this.attempted = attempted;
    if (cause instanceof Error) (this as { cause?: unknown }).cause = cause;
  }
}

function quoteTitles(titles: readonly string[]): string {
  const clean = titles.map(title => title.trim()).filter(Boolean);
  if (!clean.length) return "";
  if (clean.length === 1) return `"${clean[0]}"`;
  return `${clean.slice(0, -1).map(title => `"${title}"`).join(", ")} and "${clean[clean.length - 1]}"`;
}

/** What executing this grant would attempt, phrased for the operator. */
export function describeAttemptedGrant(
  grant: ExecutiveActionGrant,
  state?: { pendingBriefing?: { parsed?: { items?: unknown[] } | null } | null } | null
): string {
  if (grant.actionClass === "commit_briefing") {
    const items = state?.pendingBriefing?.parsed?.items ?? [];
    const titles = items.map(item => (item as { title?: string }).title ?? "").filter(Boolean);
    const named = quoteTitles(titles);
    return named ? `saving ${named} to the Day Line` : "saving the pending Day Line items";
  }
  const named = quoteTitles(grant.scope.titles ?? []);
  if (grant.actionClass === "commit_day_line") return named ? `saving ${named} to the Day Line` : "saving that to the Day Line";
  if (grant.actionClass === "propose_day_line") return named ? `lining up ${named} for the Day Line` : "lining that up for the Day Line";
  return `running ${grant.actionClass}`;
}

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

function parseGrantWork(input: {
  grant: ExecutiveActionGrant;
  timeZone: string;
  now: Date;
}): ParsedBriefing {
  const titles = input.grant.scope.titles?.filter(Boolean) ?? [];
  if (!titles.length) {
    throw new BrainV2GrantNotExecutableError("Brain V2 Day Line grant is missing bounded work scope", input.grant);
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
    throw new BrainV2GrantNotExecutableError(
      "Brain V2 Day Line grant scope did not resolve to executable work",
      input.grant
    );
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
  attempted: string;
}): Promise<ClaireTurnResult> {
  const dates = [...new Set(input.parsed.items.map(item => item.businessDate))];
  let result: Awaited<ReturnType<typeof commitBriefing>>;
  try {
    const existing = await loadExistingWork({
      tenantId: input.tenantId,
      dayDirectorActorId: input.dayDirectorActorId,
      dates,
    });
    const reconciled = reconcileBriefing(input.parsed, existing, null);
    result = await commitBriefing(reconciled, {
      tenantId: input.tenantId,
      dayDirectorActorId: input.dayDirectorActorId,
      operatorUserId: input.operatorUserId,
      conversationKey: input.conversationKey,
      vehicleId: input.operatorUserId,
    });
  } catch (error) {
    // The write was attempted. The failure line must say what Claire tried.
    throw new BrainV2ExecutionFailedError(input.attempted, error);
  }
  const speak = speakBriefingCommit(result, input.today);
  const wrote = hasAuthoritativeCommit(result);

  // Work the title gate refused stays pending: Claire asked one question and still holds it.
  const clarifying = Boolean(result.needsClarification?.length);
  const settled = (wrote || result.failed.length === 0) && !(clarifying && !wrote);
  if (settled && !clarifying) {
    input.state.pendingBriefing = null;
  }

  return {
    speak,
    receiptBackedCommit: settled ? speak : undefined,
    kind: settled ? "briefing_saved" : "answered",
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
  if (isClaireRoleFeedback(input.grant.sourceTurnAssembledText)) {
    throw new BrainV2GrantNotExecutableError("Claire role feedback cannot authorize Day Line mutation", input.grant);
  }
  const now = input.now ?? new Date();
  const clock = briefingClock(now, input.timeZone);

  if (input.grant.actionClass === "commit_briefing") {
    if (
      input.grant.scope.identity !== "pending-briefing"
    ) {
      throw new BrainV2GrantNotExecutableError(
        "Brain V2 briefing grant does not match pending briefing authority",
        input.grant
      );
    }
    const pending = input.state.pendingBriefing?.parsed;
    if (!pending?.items?.length) {
      throw new BrainV2GrantNotExecutableError(
        "Brain V2 briefing grant has no pending briefing to execute",
        input.grant
      );
    }
    return commitParsed({
      parsed: pending,
      state: input.state,
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      dayDirectorActorId: input.dayDirectorActorId,
      conversationKey: input.conversationKey,
      today: clock.today,
      attempted: describeAttemptedGrant(input.grant, input.state),
    });
  }

  if (
    input.grant.actionClass !== "propose_day_line" &&
    input.grant.actionClass !== "commit_day_line"
  ) {
    throw new BrainV2GrantNotExecutableError(
      `Brain V2 legacy adapter refuses unsupported action class: ${input.grant.actionClass}`,
      input.grant
    );
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
    attempted: describeAttemptedGrant(input.grant, input.state),
  });
}

/**
 * Spoken ONLY after a write was actually attempted and did not complete. It names what
 * was attempted; a caller that cannot say what was attempted has no business speaking
 * this line (a grant refused before any write is not a failed action).
 */
export function brainV2ExecutionFailureResult(input: {
  assembledUtterance: string;
  attempted: string;
}): ClaireTurnResult {
  const attempted = input.attempted.trim() || "that";
  return {
    speak: `I tried ${attempted} and couldn't verify it completed, so I won't retry it through another path.`,
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
