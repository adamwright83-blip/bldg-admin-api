import {
  defaultAuthorityForGoldlineAction,
  type CanonicalGoldlineAction,
  type GoldlineActionKind,
  type GoldlineActionStatus,
  type GoldlineAuthority,
} from "./goldlineActionContract";
import type { GoldlineEventClassification, GoldlineProvenanceClass } from "./goldlineWorld";

/** Slice 1 — smallest shared truth claim Claire can reason over. */
export type TruthClaim = {
  id: string;
  subject: string;
  factType: string;
  value: string | number | boolean | null;
  sourceType: string;
  sourceRef: string;
  occurredAt: string | null;
  effectiveAt: string | null;
  recordedAt: string;
  confidence: "high" | "medium" | "low" | "unknown";
  authorityClass: GoldlineProvenanceClass | "operator_attested" | "authoritative_evidence";
  supersededBy: string | null;
};

/** Slice 2 — consequential event, distinct from a plan. */
export type OperationalEvent = {
  id: string;
  classification: GoldlineEventClassification;
  whatHappened: string;
  actor: string | null;
  target: string | null;
  timestamp: string;
  result: "planned" | "proposed" | "approved" | "attempted" | "failed" | "completed";
  sourceType: string;
  sourceRef: string;
};

export type EvidenceRecord = {
  id: string;
  source: string;
  reference: string;
  supports: string;
  verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED";
};

export type ActionDetailState = "COMPLETE" | "NEEDS_DETAILS";
export type ActionScheduleKind = "EXACT_TIME" | "DAY" | "FLEXIBLE_WINDOW" | "UNSCHEDULED";
export type ActionLifecycle =
  | "planned"
  | "proposed"
  | "approved"
  | "attempted"
  | "failed"
  | "completed"
  | "cancelled"
  | "superseded";

export type ClaireAction = CanonicalGoldlineAction & {
  detailState: ActionDetailState;
  missingDetails: string[];
  detailNote: string | null;
  scheduleKind: ActionScheduleKind;
  scheduleLabel: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  reversible: boolean;
  riskClass: "low" | "moderate" | "high" | "irreversible";
  createdAt: string | null;
  updatedAt: string | null;
  lifecycle: ActionLifecycle;
};

export type UnifiedWorkCategory =
  | "hard_obligation"
  | "safety_money_blocker"
  | "overdue_commitment"
  | "macro_goal_work"
  | "follow_up"
  | "optional_improvement";

export type StalenessBand = "fresh" | "due_today" | "overdue" | "very_old" | "closed";

export type UnifiedWorkItem = {
  id: string;
  source: string;
  category: UnifiedWorkCategory;
  title: string;
  status: string;
  alreadyExists: boolean;
  scheduledAt: string | null;
  ageDays: number | null;
  overdueDays: number | null;
  lastMeaningfulActivityAt: string | null;
  staleness: StalenessBand;
  relationToMacroGoal: "direct" | "supporting" | "unclear" | "unrelated";
  permissionLevel: GoldlineAuthority;
  detailState: ActionDetailState;
  missingDetails: string[];
  sourceRef: string;
};

export type PictureCompleteness = {
  sufficient: boolean;
  reason:
    | "ok"
    | "technical_test_only"
    | "stale_only"
    | "sparse"
    | "goal_without_work";
  summary: string;
};

export type WorkClassificationV1 =
  | "new_work"
  | "existing_work"
  | "update_existing_work"
  | "edit_existing_work"
  | "cancel_existing_work"
  | "complete_existing_work"
  | "fyi_context"
  | "uncertain"
  | "not_work";

export type AmbiguityAssessment = {
  kind: "none" | "non_critical" | "critical";
  missingDetails: string[];
  blocksExecution: boolean;
};

export type ParsedSchedule = {
  kind: ActionScheduleKind;
  label: string | null;
  start: string | null;
  end: string | null;
};

const TECHNICAL_TITLE =
  /\b(codex|e2e|fixture|safe to archive|test archive|browser fixture)\b/i;

export function lifecycleFromGoldlineStatus(
  status: GoldlineActionStatus
): ActionLifecycle {
  switch (status) {
    case "available":
      return "planned";
    case "proposed":
      return "proposed";
    case "approved":
      return "approved";
    case "executing":
      return "attempted";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

export function wrapClaireAction(
  action: CanonicalGoldlineAction,
  extras: Partial<
    Pick<
      ClaireAction,
      | "detailState"
      | "missingDetails"
      | "detailNote"
      | "scheduleKind"
      | "scheduleLabel"
      | "scheduleStart"
      | "scheduleEnd"
      | "reversible"
      | "riskClass"
      | "createdAt"
      | "updatedAt"
    >
  > = {}
): ClaireAction {
  const detailState = extras.detailState ?? "COMPLETE";
  return {
    ...action,
    detailState,
    missingDetails: extras.missingDetails ?? [],
    detailNote: extras.detailNote ?? null,
    scheduleKind: extras.scheduleKind ?? "UNSCHEDULED",
    scheduleLabel: extras.scheduleLabel ?? null,
    scheduleStart: extras.scheduleStart ?? null,
    scheduleEnd: extras.scheduleEnd ?? null,
    reversible: extras.reversible ?? action.authority !== "HUMAN_EXECUTION",
    riskClass:
      extras.riskClass ??
      (action.authority === "HUMAN_EXECUTION"
        ? "high"
        : action.authority === "APPROVAL_REQUIRED"
          ? "moderate"
          : "low"),
    createdAt: extras.createdAt ?? null,
    updatedAt: extras.updatedAt ?? null,
    lifecycle: lifecycleFromGoldlineStatus(action.status),
  };
}

export function permissionSpeak(
  authority: GoldlineAuthority,
  detailState: ActionDetailState = "COMPLETE"
): string {
  if (authority === "HUMAN_EXECUTION") return "That one needs you physically.";
  if (authority === "APPROVAL_REQUIRED" && detailState === "NEEDS_DETAILS") {
    return "I can add that and flag the missing details.";
  }
  if (authority === "APPROVAL_REQUIRED") {
    return "I can prepare that, but you'll need to approve it.";
  }
  if (authority === "AUTO_INFORM") return "I can do that and I'll tell you when it's done.";
  return "I can do that.";
}

export function defaultPermissionForWorkKind(
  kind: "pickup" | "delivery" | "commercial_visit" | "commercial_call" | "follow_up" | "field_commitment" | "research" | "message"
): GoldlineAuthority {
  const map: Record<typeof kind, GoldlineActionKind> = {
    pickup: "PICKUP",
    delivery: "DELIVERY",
    commercial_visit: "VISIT",
    commercial_call: "CALL",
    follow_up: "FOLLOW_UP",
    field_commitment: "FOLLOW_UP",
    research: "REVIEW",
    message: "FOLLOW_UP",
  };
  return defaultAuthorityForGoldlineAction(map[kind]);
}

export function deriveStaleness(input: {
  now: Date;
  scheduledAt: string | null;
  createdAt: string | null;
  status: string;
  urgency?: string | null;
}): { ageDays: number | null; overdueDays: number | null; band: StalenessBand } {
  if (["completed", "cancelled", "closed", "superseded"].includes(input.status)) {
    return { ageDays: ageDays(input.now, input.createdAt ?? input.scheduledAt), overdueDays: null, band: "closed" };
  }
  const anchor = input.createdAt ?? input.scheduledAt;
  const age = ageDays(input.now, anchor);
  if (input.urgency === "overdue" || (input.scheduledAt && new Date(input.scheduledAt).getTime() < input.now.getTime() - 12 * 60 * 60 * 1000)) {
    const overdue = ageDays(input.now, input.scheduledAt ?? anchor) ?? 0;
    return { ageDays: age, overdueDays: overdue, band: overdue >= 14 ? "very_old" : "overdue" };
  }
  if (age != null && age >= 14) return { ageDays: age, overdueDays: age, band: "very_old" };
  if (isSameBusinessDay(input.now, input.scheduledAt)) {
    return { ageDays: age, overdueDays: null, band: "due_today" };
  }
  return { ageDays: age, overdueDays: null, band: "fresh" };
}

function ageDays(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

function isSameBusinessDay(now: Date, iso: string | null): boolean {
  if (!iso) return false;
  const a = now.toISOString().slice(0, 10);
  const b = new Date(iso).toISOString().slice(0, 10);
  return a === b;
}

export function isTechnicalTestTitle(title: string): boolean {
  return TECHNICAL_TITLE.test(title);
}

export function assessPictureCompleteness(input: {
  items: Array<{ title: string; staleness: StalenessBand; category: UnifiedWorkCategory }>;
  campaignRemaining: number;
  macroGoalKnown: boolean;
  hasScheduledRouteWork?: boolean;
}): PictureCompleteness {
  const live = input.items.filter(item => item.staleness !== "closed");
  if (live.length === 0) {
    if (input.hasScheduledRouteWork) {
      return { sufficient: true, reason: "ok", summary: "Scheduled route work is on the board." };
    }
    if (input.macroGoalKnown && input.campaignRemaining === 0) {
      return {
        sufficient: false,
        reason: "goal_without_work",
        summary: "The goal is known, but I don't see enough current work to treat this as the whole picture.",
      };
    }
    return { sufficient: true, reason: "ok", summary: "No current work items." };
  }
  if (live.length > 0 && live.every(item => isTechnicalTestTitle(item.title))) {
    return {
      sufficient: false,
      reason: "technical_test_only",
      summary: "I only see a technical test. That obviously isn't the whole workday. Catch me up.",
    };
  }
  const nonTest = live.filter(item => !isTechnicalTestTitle(item.title));
  if (
    nonTest.length > 0 &&
    nonTest.every(item => item.staleness === "very_old" || item.staleness === "overdue") &&
    input.macroGoalKnown
  ) {
    return {
      sufficient: false,
      reason: "stale_only",
      summary: "These are old enough that I don't want to pretend they automatically define today's plan. What else is moving?",
    };
  }
  if (live.length === 1 && input.campaignRemaining === 0 && input.macroGoalKnown) {
    return {
      sufficient: false,
      reason: "sparse",
      summary: "I only see one current item. That may not be the whole picture.",
    };
  }
  return { sufficient: true, reason: "ok", summary: "Current work is enough to talk from." };
}

export function prioritizeCategory(
  item: Pick<UnifiedWorkItem, "category" | "staleness" | "permissionLevel">
): number {
  const base: Record<UnifiedWorkCategory, number> = {
    hard_obligation: 1,
    safety_money_blocker: 2,
    overdue_commitment: 3,
    macro_goal_work: 4,
    follow_up: 5,
    optional_improvement: 6,
  };
  let rank = base[item.category];
  if (item.staleness === "very_old") rank = Math.min(rank, 3);
  return rank;
}

export function parseScheduleFromUtterance(
  utterance: string,
  now: Date,
  timeZone = "America/Los_Angeles"
): ParsedSchedule {
  const text = utterance.toLowerCase();
  if (/\b(whenever i can|when i can|no rush|unscheduled)\b/.test(text)) {
    return { kind: "UNSCHEDULED", label: "whenever", start: null, end: null };
  }
  const exact = text.match(
    /\b(?:tomorrow|today)?\s*(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/
  );
  if (exact) {
    return {
      kind: "EXACT_TIME",
      label: exact[0].trim(),
      start: null,
      end: null,
    };
  }
  if (/\b(this week|sometime this week|later this week|when convenient this week|not tonight)\b/.test(text)) {
    return remainderOfWeekWindow(now, timeZone);
  }
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/.test(text) && !/\bat\b/.test(text)) {
    const day = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|today)\b/)?.[1] ?? "day";
    return { kind: "DAY", label: day, start: null, end: null };
  }
  return { kind: "UNSCHEDULED", label: null, start: null, end: null };
}

function remainderOfWeekWindow(now: Date, timeZone: string): ParsedSchedule {
  const local = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const weekday = local.find(part => part.type === "weekday")?.value ?? "Mon";
  const remaining = { Sun: 0, Sat: 1, Fri: 2, Thu: 3, Wed: 4, Tue: 5, Mon: 6 }[weekday] ?? 6;
  return {
    kind: "FLEXIBLE_WINDOW",
    label: remaining <= 1 ? "remainder of this week" : "this week",
    start: now.toISOString(),
    end: new Date(now.getTime() + remaining * 86_400_000).toISOString(),
  };
}

export function assessAmbiguity(utterance: string): AmbiguityAssessment {
  const text = utterance.toLowerCase();
  const sendMoney = /\b(send|wire|pay|transfer)\b/.test(text) && /\b(money|cash|dollars|payment|\$)\b/.test(text);
  const recipientVague = /\b(her|him|them|that person|the guy|the lady)\b/.test(text) && !/\b(to\s+[a-z]{3,})\b/.test(text);
  const amountVague = sendMoney && !/(\$\s*\d|\d+\s*(dollars|bucks)|amount)/.test(text);
  if (sendMoney && (recipientVague || amountVague)) {
    const missing: string[] = [];
    if (recipientVague) missing.push("recipient");
    if (amountVague) missing.push("amount");
    return { kind: "critical", missingDetails: missing, blocksExecution: true };
  }
  const actionable =
    /\b(research|look into|evaluate|compare|need to|have to|add|remind|follow up|call|visit|email)\b/.test(
      text
    );
  if (!actionable) return { kind: "none", missingDetails: [], blocksExecution: false };
  const missing: string[] = [];
  if (/\bresearch|look into|evaluate|compare\b/.test(text) && !/\b(criteria|because|to decide|so we can)\b/.test(text)) {
    missing.push("comparison criteria");
  }
  if (!/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|this week|at \d)\b/.test(text)) {
    missing.push("desired timing");
  }
  if (missing.length) {
    return { kind: "non_critical", missingDetails: missing, blocksExecution: false };
  }
  return { kind: "none", missingDetails: [], blocksExecution: false };
}

export function classifyIntentHeuristics(utterance: string): WorkClassificationV1 | null {
  const text = utterance.toLowerCase();
  if (
    /\b(remove|take .{0,80} off|take (?:it |them |that )?(?:off|out)|get rid|not pursuing|don't want to (?:move forward|pursue)|do not want to (?:move forward|pursue)|off my day)\b/.test(
      text
    )
  ) {
    return "cancel_existing_work";
  }
  if (
    /\b(change|rename|make (?:it|that) say|edit)\b/.test(text) &&
    !/\b(move|reschedule|change when|push (?:it|them)|this week instead|not tonight)\b/.test(text)
  ) {
    return "edit_existing_work";
  }
  if (/\b(mark (?:it |that )?(?:done|complete)|completed that)\b/.test(text)) {
    return "complete_existing_work";
  }
  if (/\b(move|reschedule|change when|push (?:it|them)|this week instead|not tonight)\b/.test(text)) {
    return "update_existing_work";
  }
  if (
    /\b(russell (?:is|was) frustrated|i've been thinking|just so you know|fyi|for what it's worth)\b/.test(
      text
    ) &&
    !/\b(add|need to|have to|remind|research|visit|call)\b/.test(text)
  ) {
    return "fyi_context";
  }
  if (
    /\b(i need to (?:research|look into)|add research)\b/.test(text) &&
    !/\b(three|remaining|already have|still have)\b/.test(text)
  ) {
    return "new_work";
  }
  return null;
}

export function categoryForKind(
  kind: string,
  staleness: StalenessBand,
  relationToMacroGoal: UnifiedWorkItem["relationToMacroGoal"]
): UnifiedWorkCategory {
  if (kind === "payment_blocker" || kind === "route_exception") return "safety_money_blocker";
  if (kind === "pickup" || kind === "delivery") return "hard_obligation";
  if (staleness === "overdue" || staleness === "very_old") return "overdue_commitment";
  if (kind === "commercial_visit" || kind === "mission_dispatch" || relationToMacroGoal === "direct") {
    return "macro_goal_work";
  }
  if (kind === "follow_up" || kind === "commercial_call") return "follow_up";
  return "optional_improvement";
}

export function relationToActiveCustomerGoal(kind: string): UnifiedWorkItem["relationToMacroGoal"] {
  if (["commercial_visit", "mission_dispatch", "commercial_call"].includes(kind)) return "direct";
  if (["follow_up", "field_commitment"].includes(kind)) return "supporting";
  if (["pickup", "delivery"].includes(kind)) return "unrelated";
  return "unclear";
}

export function speakStaleness(item: Pick<UnifiedWorkItem, "title" | "staleness" | "ageDays">): string | null {
  if (item.staleness === "fresh" || item.staleness === "due_today" || item.staleness === "closed") return null;
  const age = item.ageDays != null ? `, about ${item.ageDays} days old` : "";
  return `${item.title} is pretty dated${age}.`;
}

export const CLAIRE_V1_REASONING_POLICY = [
  "Think: goal, reality, plan, gap, bottleneck, blocker, action. Unknown macro goal: ask once. Never invent rates, budgets, CAC, counts. No duplicate work.",
  "Optional gaps: NEEDS_DETAILS. Critical ambiguity (recipient, amount, irreversible send, legal/safety) blocks.",
  "Ignored priority work: ask why, once. Do not diagnose, do not use recovery-program language, and do not give motivational speeches.",
  "Never claim saved, sent, added, changed, scheduled, or completed before the action succeeded.",
].join(" ");

export type ClaireSurface = "mobile" | "desktop" | "phone" | "unknown";

export function claireOperatorKey(tenantId: string, operatorUserId: string): string {
  return `${tenantId}:${operatorUserId}`;
}

export function detectAvoidanceDisclosure(utterance: string): boolean {
  return /\b(i(?:'m| am) avoiding|i don't want to (?:do|deal)|i(?:'m| am) putting (?:it|this) off|scared (?:to|of) fail|ads feel unfamiliar)\b/i.test(
    utterance
  );
}

export type BlockerKind =
  | "missing_information"
  | "missing_decision"
  | "missing_skill"
  | "fear_avoidance"
  | "external_dependency"
  | "strategic_disagreement"
  | "unknown";

export function inferBlockerKind(utterance: string): BlockerKind {
  const text = utterance.toLowerCase();
  if (/\b(don't know how|unfamiliar|never (?:run|done)|don't understand)\b/.test(text)) {
    return "missing_skill";
  }
  if (/\b(scared|afraid|fail|failure|embarrass)\b/.test(text)) return "fear_avoidance";
  if (/\b(waiting on|need (?:them|russell|her|him) to|until they)\b/.test(text)) {
    return "external_dependency";
  }
  if (/\b(can't decide|not sure (?:which|whether)|don't know what to pick)\b/.test(text)) {
    return "missing_decision";
  }
  if (/\b(don't know|missing|no idea what)\b/.test(text)) return "missing_information";
  if (/\b(disagree|wrong goal|that's not the priority)\b/.test(text)) {
    return "strategic_disagreement";
  }
  if (detectAvoidanceDisclosure(utterance)) return "fear_avoidance";
  return "unknown";
}

export function nextBlockerQuestion(kind: BlockerKind): string {
  switch (kind) {
    case "missing_skill":
      return "You don't need to know the whole method tonight. What's the smallest thing you actually need to understand to make a decision?";
    case "fear_avoidance":
      return "What's the part you're actually avoiding — choosing wrong, wasting money, or looking unprepared?";
    case "external_dependency":
      return "Who actually has to move before you can? Is there a reason not to ask them directly?";
    case "missing_decision":
      return "What's the decision that's actually stuck?";
    case "missing_information":
      return "What fact would make this executable?";
    case "strategic_disagreement":
      return "If this isn't the constraint, what is?";
    default:
      return "That sounds important. Why are we talking about it instead of doing it?";
  }
}

export function nextReadinessPrompt(kind: BlockerKind): string {
  switch (kind) {
    case "missing_skill":
      return "The next move is understanding the options well enough to decide, not running the ads tonight.";
    case "fear_avoidance":
      return "I'd be impressed if you did the thing you're currently avoiding. What's the first physical or digital step?";
    default:
      return "What would make you willing and ready to do the next step?";
  }
}

export type ConversationalFieldOutcome = {
  visitOccurred: boolean;
  decisionMakerReached: boolean | null;
  frontDeskInteraction: boolean;
  collateralDelivered: boolean;
  successfulConversation: boolean;
  hearsay: string[];
  attestedFacts: string[];
  followUpLikely: boolean;
  provenance: "operator_attested";
  rawUtterance: string;
};

/**
 * Asking about the past is not the same as reporting a visit. "I went to"
 * inside a history question must not open field-outcome capture.
 */
export function looksLikeKnowledgeSeeking(utterance: string): boolean {
  const text = utterance.trim();
  if (/\?\s*$/.test(text)) return true;
  if (
    /^(?:how|what|what's|whats|who|when|which|where|why|did|does|do we|do i|is|are|was|were|has|have|can you tell|tell me|give me|compare|show me|walk me through|remind me what)\b/i.test(
      text
    )
  ) {
    return true;
  }
  return /\b(?:what happened|what did (?:i|we)|when did i|do i owe|did i (?:tell|say|mention|visit|go)|last time i (?:went|was|visited|went by)|have i (?:been|told|said))\b/i.test(
    text
  );
}

export function extractConversationalFieldOutcome(
  utterance: string
): ConversationalFieldOutcome | null {
  if (looksLikeKnowledgeSeeking(utterance)) return null;
  if (
    !/\b(wasn't there|was not there|nobody (?:was|in)|left the (?:flyer|card)|front desk|dropped off|not in when i|i went (?:by|to))\b/i.test(
      utterance
    )
  ) {
    return null;
  }
  const hearsay: string[] = [];
  const attestedFacts: string[] = ["A field visit was reported."];
  const frontDesk = /\bfront desk\b/i.test(utterance);
  if (frontDesk) attestedFacts.push("A front-desk interaction occurred.");
  const hearsayMatch = utterance.match(
    /\b(?:front desk|they|she|he) said\b[^.!?]{0,120}/i
  );
  if (hearsayMatch) {
    hearsay.push(hearsayMatch[0].trim());
  }
  const collateral = /\b(left the flyer|dropped off|left (?:a )?card|handed (?:them )?the)\b/i.test(
    utterance
  );
  if (collateral) attestedFacts.push("Collateral was reported delivered.");
  const notReached = /\b(wasn't there|was not there|not in|nobody|didn't (?:see|reach|catch))\b/i.test(
    utterance
  );
  if (notReached) attestedFacts.push("The decision-maker was not reached.");
  return {
    visitOccurred: true,
    decisionMakerReached: notReached ? false : null,
    frontDeskInteraction: frontDesk,
    collateralDelivered: collateral,
    successfulConversation: false,
    hearsay,
    attestedFacts,
    followUpLikely: Boolean(hearsay.length || notReached),
    provenance: "operator_attested",
    rawUtterance: utterance,
  };
}

export function speakFieldCaptureReadback(outcome: ConversationalFieldOutcome): string {
  const facts = outcome.attestedFacts.join(" ");
  const hearsay = outcome.hearsay.length
    ? ` I'll keep '${outcome.hearsay[0]}' as hearsay, not a confirmed schedule.`
    : "";
  return `${facts}${hearsay} Say yes if I should save that field outcome, or no to leave it unrecorded.`;
}

export function detectGoalActivityMisalignment(input: {
  macroObjective: string | null;
  currentActivity: string;
}): boolean {
  if (!input.macroObjective) return false;
  const goal = input.macroObjective.toLowerCase();
  const activity = input.currentActivity.toLowerCase();
  if (!/customer|acquisition|sales|visit|follow/.test(activity) && /customer/.test(goal)) {
    return /polish|redesign|refactor|hours on this|working on the (?:site|deck|brand)/.test(
      activity
    );
  }
  return false;
}

export function detectUnnecessarySoloWork(utterance: string): boolean {
  return /\b(i(?:'ll| will).{0,40}myself|don't want to bother|figure it out myself)\b/i.test(
    utterance
  );
}

export function detectVagueBusinessClaim(utterance: string): boolean {
  return /\b(margin|profit|revenue|cac|ltv|balance|we're (?:broke|making money)|costs? are)\b/i.test(
    utterance
  ) && !/\b\d/.test(utterance);
}

export function detectClaireWasWrong(utterance: string): boolean {
  return /\b(you were wrong|that didn't work|that wasn't useful|that recommendation (?:failed|was wrong))\b/i.test(
    utterance
  );
}

export function isPermanentlyPrivateTopicProbe(utterance: string): boolean {
  return /\b(last exchange|what happened between you two|the private (?:part|thing)|tell me the secret about (?:him|her|your ex))\b/i.test(
    utterance
  );
}

export function matchOpenWorkTitle(title: string, utterance: string): boolean {
  const tokens = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length > 3);
  if (!tokens.length) return false;
  const text = utterance.toLowerCase();
  return tokens.filter(token => text.includes(token)).length >= Math.min(2, tokens.length);
}
