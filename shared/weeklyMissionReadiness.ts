/**
 * Weekly Mission Readiness V1 — pure contracts.
 *
 * Product law: docs/goldline/GOLDLINE_WEEKLY_MISSION_READINESS.md
 * Week status is derived. Nothing here writes business truth.
 */

export const WEEKLY_MISSION_READINESS_VERSION = "v1";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isValidYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export const READINESS_KINDS = ["physical", "document", "information", "approval", "location"] as const;
export type ReadinessKind = (typeof READINESS_KINDS)[number];
export type ReadinessStatus = "open" | "ready" | "blocked";
export type WeekStatus = "UNPLANNED" | "IN_PROGRESS" | "LOCKED";
export type WeeklySessionPhase = "interview" | "proposal" | "awaiting_confirmation";
export type WeeklyAct = "ASK" | "PROPOSE" | "REVISE" | "AWAIT_CONFIRMATION" | "CANCEL";
export type RemnantDisposition = "primary" | "stand_down";
export type PrimarySource = "existing_work" | "operator_stated" | "claire_recommended";

/**
 * JOYSTICK execution type for one weekly primary.
 * Absent or null is unknown. Never defaulted to mission.
 */
export const WEEKLY_EXECUTION_TYPES = ["mission", "challenge", "hybrid_objective"] as const;
export type WeeklyExecutionType = (typeof WEEKLY_EXECUTION_TYPES)[number];

export function isWeeklyExecutionType(value: unknown): value is WeeklyExecutionType {
  return typeof value === "string" && (WEEKLY_EXECUTION_TYPES as readonly string[]).includes(value);
}

/** Growth-candidate contract used only to read title and objective. Id and motion are not evidence. */
export type WeeklyExecutionCandidateContract = {
  id: string;
  title: string;
  objective: string;
  motion?: string | null;
};

export const MAX_READINESS_PER_DAY = 4;
export const WEEKLY_QUESTION_PROPOSE_AT = 6;
export const WEEKLY_QUESTION_HARD_STOP = 8;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type WeekdayName = (typeof WEEKDAY_NAMES)[number];

export type WeeklyProvenance = {
  reader: string;
  sourceType: string;
  sourceIds: string[];
  quote: string | null;
};

export type WeeklyFixedConstraint = {
  sourceRef: string;
  title: string;
  businessDate: string;
  scheduleLabel: string;
};

export type MissionReadinessRequirement = {
  text: string;
  kind: ReadinessKind;
  neededForDate: string;
  completeByDate: string;
  status: ReadinessStatus;
};

export type WeeklyPrimary = {
  text: string;
  source: PrimarySource;
  existingCommitmentId: string | null;
  /** Absent or null means unknown. Never inferred from the word "mission". */
  executionType?: WeeklyExecutionType | null;
};

export type WeeklyDayDraft = {
  businessDate: string;
  weekday: WeekdayName;
  /** Only the current weekday may stand down. Future days stay primary. */
  disposition: RemnantDisposition;
  primary: WeeklyPrimary | null;
  fixedConstraints: WeeklyFixedConstraint[];
  readinessRequirements: MissionReadinessRequirement[];
  uncertainty: string | null;
};

export type WeeklyDraft = {
  weekStart: string;
  days: WeeklyDayDraft[];
};

/** Private planning state. Not business truth, not the proposed week, not committed. */
export type WeeklyUncertaintyStatus = "open" | "resolved" | "killed";

export type WeeklyUncertainty = {
  id: string;
  text: string;
  businessDate: string | null;
  status: WeeklyUncertaintyStatus;
  /** Dossier fact ids. Absent when the gap has no source. */
  sourceRefs?: string[];
};

export type WeeklyInternalHypothesis = {
  summary: string;
  uncertainties: WeeklyUncertainty[];
};

export function emptyWeeklyHypothesis(): WeeklyInternalHypothesis {
  return { summary: "", uncertainties: [] };
}

export type RemainingWeekHorizon = {
  businessDate: string;
  weekday: WeekdayName;
  localTime: string;
  localMinutes: number;
  weekStart: string;
  /** Today through Friday when today is a weekday. Saturday and Sunday are empty. */
  remainingDates: string[];
  /**
   * Today is a remnant of the week whenever it is still a weekday.
   * Local time is passed through. No clock hour removes today from remainingDates.
   */
  todayIsRemnant: boolean;
};

export type DossierFactClass =
  | "day_director_commitment"
  | "pickup"
  | "dropoff"
  | "job"
  | "fixed_window"
  | "external_promise"
  | "follow_up"
  | "sales_work"
  | "known_prep"
  | "recurrence_rule"
  | "campaign"
  | "macro_goal"
  | "growth_work";

export type WeeklyDossierFact = {
  id: string;
  class: DossierFactClass;
  businessDate: string | null;
  title: string;
  scheduleLabel: string | null;
  weekday: string | null;
  provenance: WeeklyProvenance;
};

export function weekdayIndex(ymd: string): number {
  if (!isValidYmd(ymd)) throw new Error(`Invalid business date: ${ymd}`);
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

export function weekdayName(ymd: string): WeekdayName {
  return WEEKDAY_NAMES[weekdayIndex(ymd)]!;
}

export function isWeekendYmd(ymd: string): boolean {
  const day = weekdayIndex(ymd);
  return day === 0 || day === 6;
}

/** Monday of the business week that contains `ymd`. */
export function weekStartMonday(ymd: string): string {
  const index = weekdayIndex(ymd);
  const delta = index === 0 ? -6 : 1 - index;
  return addDaysYmd(ymd, delta);
}

export function previousBusinessDay(ymd: string): string {
  let cursor = addDaysYmd(ymd, -1);
  while (isWeekendYmd(cursor)) cursor = addDaysYmd(cursor, -1);
  return cursor;
}

export function remainingWeekHorizon(input: { businessDate: string; localTime: string }): RemainingWeekHorizon {
  if (!isValidYmd(input.businessDate)) throw new Error(`Invalid business date: ${input.businessDate}`);
  const match = /^(\d{2}):(\d{2})$/.exec(input.localTime);
  if (!match) throw new Error(`Invalid local time: ${input.localTime}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid local time: ${input.localTime}`);
  const weekday = weekdayName(input.businessDate);
  const weekStart = weekStartMonday(input.businessDate);
  const remainingDates: string[] = [];
  if (!isWeekendYmd(input.businessDate)) {
    let cursor = input.businessDate;
    while (weekdayIndex(cursor) !== 6) {
      remainingDates.push(cursor);
      if (weekdayIndex(cursor) === 5) break;
      cursor = addDaysYmd(cursor, 1);
    }
  }
  return {
    businessDate: input.businessDate,
    weekday,
    localTime: input.localTime,
    localMinutes: hours * 60 + minutes,
    weekStart,
    remainingDates,
    todayIsRemnant: remainingDates[0] === input.businessDate,
  };
}

/**
 * Active interview wins over a previously locked intent.
 * Adjust reopens the same week; the revision stays draft until a new lock.
 * Spec §2 outranks the brief's check-order, which would leave Adjust looking LOCKED
 * and would turn the mode gate off.
 */
export function deriveWeekStatus(input: { activeSession: boolean; lockedIntent: boolean }): WeekStatus {
  if (input.activeSession) return "IN_PROGRESS";
  if (input.lockedIntent) return "LOCKED";
  return "UNPLANNED";
}

export function weeklySessionKey(tenantId: string, operatorId: string, weekStart: string): string {
  return `weekly-planning:${tenantId}:${operatorId}:${weekStart}`;
}

export function weeklySurfaceKey(tenantId: string, operatorId: string, weekStart: string): string {
  return `weekly-planning-surface:${tenantId}:${operatorId}:${weekStart}`;
}

export function emptyDraft(horizon: RemainingWeekHorizon, constraints: WeeklyFixedConstraint[]): WeeklyDraft {
  return {
    weekStart: horizon.weekStart,
    days: horizon.remainingDates.map(businessDate => ({
      businessDate,
      weekday: weekdayName(businessDate),
      disposition: "primary",
      primary: null,
      fixedConstraints: constraints.filter(item => item.businessDate === businessDate),
      readinessRequirements: [],
      uncertainty: null,
    })),
  };
}

export function capReadiness(items: MissionReadinessRequirement[]): MissionReadinessRequirement[] {
  return items.slice(0, MAX_READINESS_PER_DAY);
}

export function isReadinessKind(value: unknown): value is ReadinessKind {
  return typeof value === "string" && (READINESS_KINDS as readonly string[]).includes(value);
}

export function defaultReadiness(input: {
  text: string;
  neededForDate: string;
  kind?: ReadinessKind;
  completeByDate?: string;
  status?: ReadinessStatus;
  /** Challenge objectives do not gain invented physical or location prep. */
  executionType?: WeeklyExecutionType | null;
}): MissionReadinessRequirement {
  const text = input.text.trim();
  if (!text) throw new Error("Readiness text is required");
  return {
    text,
    kind: input.kind ?? groundedReadinessKind(text, input.executionType),
    neededForDate: input.neededForDate,
    completeByDate: input.completeByDate ?? previousBusinessDay(input.neededForDate),
    status: input.status ?? "open",
  };
}

/**
 * A Challenge keeps a physical or location kind only when the requirement text
 * itself names that prep. The fallback kind is information, not a site visit.
 */
export function groundedReadinessKind(text: string, executionType?: WeeklyExecutionType | null): ReadinessKind {
  const kind = inferReadinessKind(text);
  if (executionType !== "challenge") return kind;
  if (kind === "physical" && !explicitPhysicalPrep(text)) return "information";
  if (kind === "location" && !explicitLocationPrep(text)) return "information";
  return kind;
}

function explicitPhysicalPrep(text: string): boolean {
  return /\b(jacket|gas|gasoline|load|loaded|wash|washing|clean|car|uniform|supplies|materials|equipment|bags?|visits?|visiting|on[\s-]?site|door[\s-]?hangers?|pick[\s-]?ups?|deliver(?:y|ies|ed|ing)?)\b/i.test(
    text
  );
}

function explicitLocationPrep(text: string): boolean {
  return /\b(address|location|plant|site|propert(?:y|ies)|on[\s-]?site|visits?|visiting)\b/i.test(text);
}

export function inferReadinessKind(text: string): ReadinessKind {
  const lower = text.toLowerCase();
  if (/\b(print\w*|packet\w*|document\w*|form|pdf)\b/.test(lower)) return "document";
  if (/\bapprov\w*\b|\bsign-?off\b|\bsignature\b/.test(lower)) return "approval";
  if (/\b(address|location|where|plant|site)\b/.test(lower)) return "location";
  if (/\b(confirm|which|who|list|information|info)\b/.test(lower)) return "information";
  return "physical";
}

/**
 * Classify one execution contract.
 * `identifier` and `motion` are accepted and ignored. A growth category, an id
 * containing "mission", or the word "mission" in the contract is not evidence.
 * Insufficient contracts return null (unknown).
 */
export function classifyWeeklyExecutionType(input: {
  contract: string;
  identifier?: string | null;
  motion?: string | null;
}): WeeklyExecutionType | null {
  void input.identifier;
  void input.motion;
  const text = input.contract ?? "";
  const field = hasFieldExecution(text);
  const remote = hasRemoteExecution(text);
  if (field && remote) {
    const exclusive = /\b(?:or|either)\b/i.test(text);
    const required = /\b(?:and|both|plus|then)\b/i.test(text) || /\bas well as\b/i.test(text);
    if (!required || exclusive) return null;
    return "hybrid_objective";
  }
  if (field) return "mission";
  if (remote) return "challenge";
  return null;
}

/**
 * Operator text wins when it names an execution contract.
 * A matching growth candidate contributes title and objective only, and only
 * when the stated text itself does not already classify.
 */
export function resolveWeeklyExecutionType(input: {
  text: string;
  candidates?: readonly WeeklyExecutionCandidateContract[];
}): WeeklyExecutionType | null {
  const direct = classifyWeeklyExecutionType({ contract: input.text });
  if (direct) return direct;
  const needle = input.text.trim().toLowerCase();
  if (!needle) return null;
  const matched = (input.candidates ?? []).find(candidate => {
    const title = candidate.title.trim().toLowerCase();
    const objective = candidate.objective.trim().toLowerCase();
    return needle === title || needle === objective;
  });
  if (!matched) return null;
  return classifyWeeklyExecutionType({
    contract: `${matched.title}. ${matched.objective}`,
    identifier: matched.id,
    motion: matched.motion ?? null,
  });
}

function hasFieldExecution(text: string): boolean {
  if (/\bvisit(?:s|ing|ed)?\b/i.test(text)) return true;
  if (/\bon[\s-]?site\b/i.test(text)) return true;
  if (/\bin[\s-]?person\b/i.test(text)) return true;
  if (/\bdoor[\s-]?hangers?\b/i.test(text)) return true;
  if (/\b(?:property|physical) pitch(?:es|ing)?\b/i.test(text)) return true;
  if (/\bpitch(?:es|ing)?\b(?:\s+\w+){0,8}\s+propert(?:y|ies)\b/i.test(text)) return true;
  if (/\bpropert(?:y|ies)\b(?:\s+\w+){0,8}\s+pitch(?:es|ing)?\b/i.test(text)) return true;
  if (hasPhysicalPickup(text)) return true;
  if (hasPhysicalDelivery(text)) return true;
  return false;
}

function hasPhysicalPickup(text: string): boolean {
  const withoutPhone = text.replace(/\bpick[\s-]?up the phone\b/gi, "");
  if (/\bphysical pick[\s-]?ups?\b/i.test(withoutPhone)) return true;
  if (/\bpick[\s-]?ups?\b/i.test(withoutPhone)) return true;
  return /\bpick up\b/i.test(withoutPhone);
}

function hasPhysicalDelivery(text: string): boolean {
  if (/\bphysical deliver(?:y|ies|ed|ing)?\b/i.test(text)) return true;
  const stripped = text
    .replace(/\bemail deliver(?:y|ies|ed|ing)?\b/gi, "")
    .replace(/\bdeliver(?:y|ies|ed|ing)? (?:the |an |a )?(?:e-?mail|sms|text|message)s?\b/gi, "");
  return /\bdeliver(?:ies|y|ed|ing)?\b/i.test(stripped);
}

function hasRemoteExecution(text: string): boolean {
  const withoutIdiom = text.replace(/\bcall it\b/gi, "");
  if (/\b(?:cold[\s-]?)?calls?\b/i.test(withoutIdiom) || /\bcalling\b/i.test(withoutIdiom)) return true;
  if (/\btexts?\b/i.test(text) || /\btexting\b/i.test(text) || /\bsms\b/i.test(text)) return true;
  if (/\be-?mails?\b/i.test(text)) return true;
  if (/\bpublish(?:ed|ing|es)?\b/i.test(text)) return true;
  if (/\bbrowser\b/i.test(text)) return true;
  if (/\badmin work\b/i.test(text) || /\b(?:in|via|using|through) (?:the )?admin\b/i.test(text)) return true;
  return /\bremote follow[\s-]?ups?\b/i.test(text);
}

const DAY_WORD = "monday|tuesday|wednesday|thursday|friday";

export function normalizeWeeklyUtterance(utterance: string): string {
  return utterance.trim().toLowerCase().replace(/[.!]+$/g, "").replace(/\s+/g, " ");
}

export function isWeeklyLockBind(utterance: string): boolean {
  const text = normalizeWeeklyUtterance(utterance);
  return /^(lock it|lock the week|that's the week|thats the week|that is the week|yes|yeah|yep|looks good|do it)$/.test(text);
}

export function isWeeklyRejection(utterance: string): boolean {
  return /^(no|nope|not yet|don'?t lock|do not lock)\b/.test(normalizeWeeklyUtterance(utterance));
}

export function isWeeklyCancel(utterance: string): boolean {
  return /^(cancel|never mind|nevermind|stop planning|forget the week)\b/.test(normalizeWeeklyUtterance(utterance));
}

export type DayMove = { from: WeekdayName; to: WeekdayName };

export function parseDayMove(utterance: string): DayMove | null {
  const text = normalizeWeeklyUtterance(utterance);
  const not = new RegExp(`\\b(${DAY_WORD})\\b(?:(?!\\b(?:${DAY_WORD})\\b).){0,40}\\bnot\\s+(${DAY_WORD})\\b`, "i").exec(text);
  if (not) {
    return { to: capitalizeDay(not[1]!), from: capitalizeDay(not[2]!) };
  }
  const wont = new RegExp(
    `\\b(${DAY_WORD})\\b(?:(?!\\b(?:${DAY_WORD})\\b).){0,48}\\b(?:won'?t|will not|doesn'?t|does not)\\s+work\\b[\\s\\S]{0,40}\\b(${DAY_WORD})\\b`,
    "i"
  ).exec(text);
  if (wont) return { from: capitalizeDay(wont[1]!), to: capitalizeDay(wont[2]!) };
  return null;
}

function capitalizeDay(value: string): WeekdayName {
  const name = value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
  if (!(WEEKDAY_NAMES as readonly string[]).includes(name)) throw new Error(`Unknown weekday: ${value}`);
  return name as WeekdayName;
}

export function splitReadinessClauses(utterance: string): string[] {
  return utterance
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map(part => part.replace(/^(?:the|a|an)\s+/i, "").trim())
    .filter(part => part.length > 1);
}

export function readinessCompleteByOverride(utterance: string, horizon: RemainingWeekHorizon): string | null {
  const named = new RegExp(`\\b(${DAY_WORD})\\b`, "i").exec(utterance);
  if (!named) return null;
  const target = capitalizeDay(named[1]!);
  const date = horizon.remainingDates.find(day => weekdayName(day) === target) ?? null;
  if (date) return date;
  const weekDates = [0, 1, 2, 3, 4].map(offset => addDaysYmd(horizon.weekStart, offset));
  return weekDates.find(day => weekdayName(day) === target) ?? null;
}

export function proactiveWeeklyLine(horizon: RemainingWeekHorizon): string {
  if (horizon.remainingDates.length === 0) {
    return "The weekday week is already over. I won't invent another one.";
  }
  const rest = horizon.remainingDates.filter(day => day !== horizon.businessDate);
  if (horizon.todayIsRemnant && horizon.localMinutes >= 12 * 60 && rest.length > 0) {
    const tail = rest.map(day => weekdayName(day)).join(", ");
    return `${horizon.weekday}'s mostly gone. We still don't have ${tail}. Ten minutes.`;
  }
  return "The week is still open. Ten minutes and I can put one mission on each remaining day.";
}

export type WeeklyIntentDay = {
  businessDate: string;
  weekday: WeekdayName;
  disposition: RemnantDisposition;
  primary: {
    text: string;
    source: PrimarySource;
    commitmentId: string | null;
    /** Absent or null means unknown. Old locked weeks omit this field. */
    executionType?: WeeklyExecutionType | null;
  } | null;
  fixedConstraints: WeeklyFixedConstraint[];
  readinessRequirements: MissionReadinessRequirement[];
};

/** Thin durable agreement. Not a task database. */
export type WeeklyIntentRecord = {
  id: string;
  tenantId: string;
  operatorId: string;
  weekStart: string;
  revision: number;
  source: "operator_confirmed_proposal";
  lockedAt: string;
  days: WeeklyIntentDay[];
};

const PRIMARY_SOURCES: readonly string[] = ["existing_work", "operator_stated", "claire_recommended"];
const READINESS_STATUS: readonly string[] = ["open", "ready", "blocked"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isWeekdayName(value: unknown): value is WeekdayName {
  return typeof value === "string" && (WEEKDAY_NAMES as readonly string[]).includes(value);
}

function isPrimary(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  if (typeof value.text !== "string" || value.text.trim().length === 0) return false;
  if (typeof value.source !== "string" || !PRIMARY_SOURCES.includes(value.source)) return false;
  if (value.commitmentId !== null && typeof value.commitmentId !== "string") return false;
  if (!isOptionalExecutionType(value.executionType)) return false;
  return true;
}

function isOptionalExecutionType(value: unknown): boolean {
  return value == null || isWeeklyExecutionType(value);
}

function isConstraint(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.sourceRef === "string" &&
    typeof value.title === "string" &&
    typeof value.businessDate === "string" &&
    typeof value.scheduleLabel === "string"
  );
}

function isReadiness(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.text === "string" &&
    typeof value.kind === "string" &&
    (READINESS_KINDS as readonly string[]).includes(value.kind) &&
    typeof value.neededForDate === "string" &&
    typeof value.completeByDate === "string" &&
    typeof value.status === "string" &&
    READINESS_STATUS.includes(value.status)
  );
}

function isIntentDay(value: unknown): value is WeeklyIntentDay {
  if (!isRecord(value)) return false;
  if (typeof value.businessDate !== "string" || !isWeekdayName(value.weekday)) return false;
  if (value.disposition !== "primary" && value.disposition !== "stand_down") return false;
  if (!isPrimary(value.primary)) return false;
  if (!Array.isArray(value.fixedConstraints) || !value.fixedConstraints.every(isConstraint)) return false;
  if (!Array.isArray(value.readinessRequirements) || !value.readinessRequirements.every(isReadiness)) return false;
  return true;
}

/**
 * Locked agreement: operator-confirmed proposal plus a lock timestamp.
 * A proposal, a revision, and "I think this works" do not pass.
 * The old brochure-only shape (source "locked", primary.title) does not pass.
 */
export function isLockedWeeklyIntent(value: unknown): value is WeeklyIntentRecord {
  if (!isRecord(value)) return false;
  if (value.source !== "operator_confirmed_proposal") return false;
  if (typeof value.lockedAt !== "string" || value.lockedAt.length === 0) return false;
  if (typeof value.id !== "string" || typeof value.tenantId !== "string" || typeof value.operatorId !== "string") {
    return false;
  }
  if (typeof value.weekStart !== "string" || typeof value.revision !== "number") return false;
  if (!Array.isArray(value.days) || !value.days.every(isIntentDay)) return false;
  return true;
}

export function dayByName(draft: WeeklyDraft, name: WeekdayName): WeeklyDayDraft | null {
  return draft.days.find(day => day.weekday === name) ?? null;
}

export function cloneDraft(draft: WeeklyDraft): WeeklyDraft {
  return structuredClone(draft);
}
