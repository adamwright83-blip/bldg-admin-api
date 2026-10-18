/**
 * Adam's operating doctrine — the judgment layer that turns Goldline's
 * existing records into proactive work. Numbers and eligibility come from
 * paid-order / account / Day Line evidence. This file does not invent them.
 */

export const ADAM_DOCTRINE_ORDERS = [
  "protect_promises",
  "protect_attention",
  "keep_operations_functioning",
  "watch_customer_relationships",
  "automatic_growth_work",
  "keep_sales_alive",
  "notice_before_asked",
  "prepare_before_interrupt",
  "escalate_avoidance",
  "use_flexible_time",
  "software_is_not_the_business",
] as const;

export type DoctrineRules = {
  dormantQuietDays: number;
  minPriorOrders: number;
  maxRecoveryPerDay: number;
  outreachCooldownDays: number;
  avoidanceConfrontAfter: number;
  softwareMorningPromptCap: number;
  skipSalesUntil: string | null;
  skipSalesReason: string | null;
  /** What the hold covers. Absent or empty while held means all sales work. */
  skipSalesScope?: SalesHoldScope[] | null;
  /** When the operator last lifted a hold ("resume sales"), for the record. */
  salesHoldLiftedAt?: string | null;
};

export const DEFAULT_DOCTRINE: DoctrineRules = {
  dormantQuietDays: 45,
  minPriorOrders: 2,
  maxRecoveryPerDay: 2,
  outreachCooldownDays: 14,
  avoidanceConfrontAfter: 3,
  softwareMorningPromptCap: 3,
  skipSalesUntil: null,
  skipSalesReason: null,
};

export type Protection = "customer_promise" | "flexible";

export type DayItem = {
  id: string;
  title: string;
  protection: Protection;
  minutes?: number;
  windowStart?: string;
  windowEnd?: string;
};

export type CustomerEvidence = {
  identityKey: string;
  displayName: string;
  paidOrderCount: number;
  lastPaidOn: string;
  daysSinceLastPaid: number;
  expectedCadenceDays: number | null;
  openOrderCount: number;
  lastOutreachOn: string | null;
  attestedOutreachOn: string | null;
};

export type ObligationStatus =
  | "scheduled"
  | "draft_prepared"
  | "awaiting_result"
  | "superseded"
  | "completed"
  | "cancelled";

export type ObligationKind = "dormant_recovery" | "sales_follow_up" | "data_health";

export type ProactiveObligation = {
  id: string;
  kind: ObligationKind;
  subjectKey: string;
  subjectName: string;
  status: ObligationStatus;
  dueDate: string;
  title: string;
  why: string;
  draft: { message: string; sent: false } | null;
  historyIntact: true;
  moveCount: number;
};

export type SalesFollowUpEvidence = {
  accountKey: string;
  accountName: string;
  dueDate: string;
  nextStep: string;
  lastOutcome: string | null;
  history: string[];
};

export type FreshnessEvidence = {
  gumballImportedToday: boolean;
  lastSuccessAt: string | null;
  cleanCloudThrough: string | null;
  today: string;
  failedAttemptToday: boolean;
  unknownFailures: boolean;
};

export type SoftwareSignals = {
  morningBuildPrompts: number;
  businessGrowthDoneToday: boolean;
  opsBlockedByDefect: boolean;
};

export type DeadTimeOption = {
  id: string;
  title: string;
  kind: "campaign" | "nearby_sales" | "ops_cleanup";
  real: true;
  useful: true;
  feasible: boolean;
};

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

export function mergeDoctrine(base: DoctrineRules, patch: Partial<DoctrineRules>): DoctrineRules {
  return { ...base, ...patch };
}

export function classifyDoctrineUtterance(utterance: string): "temporary" | "durable" | "ambiguous" | "not_doctrine" {
  const text = utterance.trim();
  if (!text) return "not_doctrine";
  const durable = /\b(from now on|going forward|always|never|remember this as a rule)\b/i.test(text);
  const temporary = /\b(just today|only today|for today(?:,|\s+)(?:don't|do not|no|skip|hold)|until (?:payroll|this) is (?:finished|done)|skip .* today)\b/i.test(text);
  if (durable && !temporary) return "durable";
  if (temporary && !durable) return "temporary";
  if (durable && temporary) return "ambiguous";
  if (/\b(don't|do not|never|always) (?:give me|schedule|confront|wait)\b/i.test(text) && /\b(from now|always|never)\b/i.test(text)) {
    return "durable";
  }
  return "not_doctrine";
}

export function applyDoctrineUtterance(
  rules: DoctrineRules,
  utterance: string,
  today: string,
  now: Date = new Date()
): { rules: DoctrineRules; permanence: "temporary" | "durable"; speak: string } | { permanence: "ambiguous"; speak: string } | null {
  const sales = parseSalesHoldInstruction(utterance);
  if (sales) {
    const applied = applySalesHoldInstruction(rules, sales, { businessDate: today, utterance, now });
    return { rules: applied.rules, permanence: "temporary", speak: applied.speak };
  }
  const kind = classifyDoctrineUtterance(utterance);
  if (kind === "not_doctrine") return null;
  if (kind === "ambiguous") {
    return { permanence: "ambiguous", speak: "Is that just for today, or a standing rule from now on?" };
  }
  let next = { ...rules };
  const confront = /\b(?:if i )?move the same .{0,40}(\d+|three|3) times\b/i.exec(utterance);
  if (kind === "durable" && (confront || /\bthree times\b/i.test(utterance))) {
    next.avoidanceConfrontAfter = 3;
    return {
      rules: next,
      permanence: "durable",
      speak: "Standing rule saved: after the same sales task moves three times without a real reason, I'll confront you directly.",
    };
  }
  const waitDays = /\bwait (\d+) days before treating .{0,40}dormant\b/i.exec(utterance);
  if (kind === "durable" && waitDays) {
    next.dormantQuietDays = Number(waitDays[1]);
    return {
      rules: next,
      permanence: "durable",
      speak: `Standing rule saved: wait ${next.dormantQuietDays} days before treating that class of customer as dormant.`,
    };
  }
  const cap = /\bno more than (\d+) recovery texts? in one day\b/i.exec(utterance);
  if (kind === "durable" && cap) {
    next.maxRecoveryPerDay = Number(cap[1]);
    return {
      rules: next,
      permanence: "durable",
      speak: `Standing rule saved: no more than ${next.maxRecoveryPerDay} recovery texts in one day.`,
    };
  }
  return {
    rules: next,
    permanence: kind,
    speak: kind === "durable" ? "I'll treat that as a standing rule." : "I'll treat that as just for today.",
  };
}

export function isDormantEligible(
  customer: CustomerEvidence,
  rules: DoctrineRules,
  today: string,
  existing: readonly ProactiveObligation[]
): { eligible: boolean; why: string } {
  if (customer.openOrderCount > 0) {
    return { eligible: false, why: `${customer.displayName} has an open order, so recovery would be harassment of an active job.` };
  }
  if (customer.paidOrderCount < rules.minPriorOrders) {
    return { eligible: false, why: `${customer.displayName} only has ${customer.paidOrderCount} paid order(s); the recovery threshold needs ${rules.minPriorOrders}.` };
  }
  const quietNeeded = customer.expectedCadenceDays
    ? Math.min(60, Math.max(rules.dormantQuietDays, customer.expectedCadenceDays * 2))
    : rules.dormantQuietDays;
  if (customer.daysSinceLastPaid < quietNeeded) {
    return {
      eligible: false,
      why: `${customer.displayName} last ordered ${customer.daysSinceLastPaid} days ago; the threshold is ${quietNeeded} days.`,
    };
  }
  const open = existing.find(
    item => item.kind === "dormant_recovery" && item.subjectKey === customer.identityKey && (item.status === "scheduled" || item.status === "draft_prepared" || item.status === "awaiting_result")
  );
  if (open) {
    return { eligible: false, why: `${customer.displayName} already has an unresolved recovery obligation.` };
  }
  const lastTouch = customer.attestedOutreachOn ?? customer.lastOutreachOn;
  if (lastTouch) {
    const cooldownUntil = addDays(lastTouch.slice(0, 10), rules.outreachCooldownDays);
    if (cooldownUntil > today) {
      return { eligible: false, why: `There was outreach on ${lastTouch.slice(0, 10)}; cooldown runs through ${cooldownUntil}.` };
    }
  }
  return {
    eligible: true,
    why: `${customer.displayName} crossed the recovery threshold yesterday. ${customer.displayName.split(" ")[0]} has ${customer.paidOrderCount} prior orders and there isn't already an unresolved outreach attempt.`,
  };
}

export function prioritizeRecoveries(customers: readonly CustomerEvidence[]): CustomerEvidence[] {
  return [...customers].sort((a, b) => {
    const cadenceA = a.expectedCadenceDays ?? 99;
    const cadenceB = b.expectedCadenceDays ?? 99;
    if (a.paidOrderCount !== b.paidOrderCount) return b.paidOrderCount - a.paidOrderCount;
    return cadenceA - cadenceB;
  });
}

export function scheduleRecoveryDays(input: {
  today: string;
  customers: readonly CustomerEvidence[];
  rules: DoctrineRules;
  dayLoads: Readonly<Record<string, number>>;
  overloadedToday: boolean;
}): Array<{ customer: CustomerEvidence; dueDate: string }> {
  const ranked = prioritizeRecoveries([...input.customers]);
  const placed: Array<{ customer: CustomerEvidence; dueDate: string }> = [];
  const load = { ...input.dayLoads };
  const countOn = (day: string) => load[`recovery:${day}`] ?? 0;
  for (const customer of ranked) {
    let due = input.today;
    if (input.overloadedToday || countOn(due) >= input.rules.maxRecoveryPerDay) {
      let offset = 1;
      while (countOn(addDays(input.today, offset)) >= input.rules.maxRecoveryPerDay && offset < 14) offset += 1;
      due = addDays(input.today, offset);
    }
    load[`recovery:${due}`] = countOn(due) + 1;
    placed.push({ customer, dueDate: due });
  }
  return placed;
}

export function proposeRecoveryObligation(customer: CustomerEvidence, dueDate: string, why: string, draftMessage: string): ProactiveObligation {
  const first = customer.displayName.split(/\s+/)[0] || customer.displayName;
  return {
    id: `recovery:${customer.identityKey}`,
    kind: "dormant_recovery",
    subjectKey: customer.identityKey,
    subjectName: customer.displayName,
    status: "draft_prepared",
    dueDate,
    title: `Text ${first}`,
    why,
    draft: { message: draftMessage, sent: false },
    historyIntact: true,
    moveCount: 0,
  };
}

export function draftDoesNotComplete(obligation: ProactiveObligation): boolean {
  return obligation.status !== "completed" && obligation.draft?.sent === false;
}

export function applyAttestedOutreach(obligation: ProactiveObligation, on: string): ProactiveObligation {
  return { ...obligation, status: "awaiting_result", why: `${obligation.why} You said you already texted them on ${on}.` };
}

export function supersedeIfReordered(obligation: ProactiveObligation, newPaidOn: string): ProactiveObligation {
  if (obligation.status === "completed" || obligation.status === "cancelled") return obligation;
  return {
    ...obligation,
    status: "superseded",
    draft: obligation.draft,
    why: `${obligation.subjectName.split(" ")[0]} ordered again on ${newPaidOn}, so I cleared the recovery follow-up.`,
    historyIntact: true,
  };
}

export function protectAgainstPromiseConflict(recovery: DayItem, day: readonly DayItem[]): { ok: true } | { ok: false; speak: string } {
  const promises = day.filter(item => item.protection === "customer_promise");
  for (const promise of promises) {
    if (recovery.windowStart && promise.windowStart && recovery.windowStart === promise.windowStart) {
      return {
        ok: false,
        speak: `${promise.title} is a promised customer window. The recovery text moves around that; the customer-facing time does not change.`,
      };
    }
  }
  return { ok: true };
}

export function isRelationshipCooling(customer: CustomerEvidence): { cooling: boolean; why: string } {
  if (!customer.expectedCadenceDays || customer.paidOrderCount < 4) {
    return { cooling: false, why: "Not enough cadence history to treat this as deterioration rather than noise." };
  }
  const threshold = customer.expectedCadenceDays * 1.75;
  if (customer.daysSinceLastPaid >= threshold && customer.daysSinceLastPaid < 90) {
    return {
      cooling: true,
      why: `${customer.displayName} used to order about every ${customer.expectedCadenceDays} days and is now at ${customer.daysSinceLastPaid} days. That's a real change, not a one-day wobble.`,
    };
  }
  return { cooling: false, why: "Variation is still inside their normal cadence." };
}

export function salesFollowUpObligation(evidence: SalesFollowUpEvidence): ProactiveObligation {
  return {
    id: `sales:${evidence.accountKey}:${evidence.dueDate}`,
    kind: "sales_follow_up",
    subjectKey: evidence.accountKey,
    subjectName: evidence.accountName,
    status: "scheduled",
    dueDate: evidence.dueDate,
    title: `Follow up: ${evidence.accountName}`,
    why: evidence.nextStep,
    draft: null,
    historyIntact: true,
    moveCount: 0,
  };
}

export function interruptForSalesFollowUp(evidence: SalesFollowUpEvidence): {
  what: string;
  why: string;
  alreadyPrepared: string[];
  adamMust: string;
} {
  return {
    what: `Follow up with ${evidence.accountName}`,
    why: evidence.nextStep,
    alreadyPrepared: [
      `Account: ${evidence.accountName}`,
      evidence.history[0] ?? "No earlier notes on file.",
      evidence.lastOutcome ? `Last known outcome: ${evidence.lastOutcome}` : "No captured outcome yet.",
      `Expected next step: ${evidence.nextStep}`,
    ],
    adamMust: "Make the contact or tell me a real reason to move it.",
  };
}

export function gumballWarning(evidence: FreshnessEvidence): string | null {
  if (evidence.gumballImportedToday) return null;
  if (evidence.failedAttemptToday) {
    return `GUMBALL failed today. Last successful import was ${evidence.lastSuccessAt ?? "not on file"}. I am not guessing that orders stopped — the import did not complete.`;
  }
  if (evidence.unknownFailures) {
    return `CleanCloud is only current through ${evidence.cleanCloudThrough ?? "an unknown day"}. Failed attempts weren't logged, so I can't tell whether GUMBALL didn't run or failed before reaching Goldline.`;
  }
  if (evidence.lastSuccessAt && evidence.lastSuccessAt.slice(0, 10) < evidence.today) {
    return `GUMBALL did not run today. Last successful import was ${evidence.lastSuccessAt}. No new CleanCloud orders is not the same as an import failure — this is a missing import.`;
  }
  return null;
}

export function overloadJudgment(day: readonly DayItem[]): { kind: "ok" | "warn" | "impossible"; speak: string } {
  const promises = day.filter(item => item.protection === "customer_promise");
  for (let i = 0; i < promises.length; i += 1) {
    for (let j = i + 1; j < promises.length; j += 1) {
      const a = promises[i]!;
      const b = promises[j]!;
      if (a.windowStart && a.windowEnd && b.windowStart && b.windowEnd && a.windowStart < b.windowEnd && b.windowStart < a.windowEnd) {
        return {
          kind: "impossible",
          speak: `These promised windows actually overlap: ${a.title} and ${b.title}. One of those has to be renegotiated with the customer before the day is possible.`,
        };
      }
    }
  }
  const minutes = day.reduce((sum, item) => sum + (item.minutes ?? 30), 0);
  if (minutes >= 9 * 60 && minutes < 14 * 60) {
    return { kind: "warn", speak: "This is probably overloaded. I can help lighten it if you want." };
  }
  return { kind: "ok", speak: "" };
}

export function avoidanceSpeak(moveCount: number, title: string): string | null {
  if (moveCount <= 1) return null;
  if (moveCount === 2) return `You moved ${title} again.`;
  if (moveCount === 3) return `That's the third time ${title} has moved. What's actually blocking it?`;
  return `You keep carrying ${title} forward without doing it. Pick one: do it, deliberately reschedule it for a real reason, or stop calling it a priority.`;
}

export function softwareDriftSpeak(signals: SoftwareSignals, cap: number): string | null {
  if (signals.opsBlockedByDefect) {
    return "A production defect is blocking customer fulfillment, so continued software work is justified. The software window doesn't apply while the operation is down.";
  }
  if (signals.morningBuildPrompts >= cap && !signals.businessGrowthDoneToday) {
    return `This is your ${signals.morningBuildPrompts === 4 ? "fourth" : `${signals.morningBuildPrompts}th`} build prompt this morning. Sales still hasn't happened.`;
  }
  return null;
}

export function chooseDeadTimeWork(options: readonly DeadTimeOption[], seed: string): DeadTimeOption | null {
  const feasible = options.filter(option => option.feasible && option.real && option.useful);
  if (!feasible.length) return null;
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return feasible[hash % feasible.length]!;
}

export function explainWhyOnToday(obligation: ProactiveObligation): string {
  return obligation.why;
}

export function morningChiefOfStaffBrief(input: {
  recoveries: readonly ProactiveObligation[];
  sales: readonly ProactiveObligation[];
  warnings: readonly string[];
  overload: ReturnType<typeof overloadJudgment>;
  skipSales: boolean;
  /** The operator held win-backs today: recovery is not pushed. */
  skipRecovery?: boolean;
}): string {
  const lines: string[] = [];
  if (input.warnings[0]) lines.push(input.warnings[0]);
  if (input.overload.kind === "impossible") lines.push(input.overload.speak);
  else if (input.overload.kind === "warn") lines.push(input.overload.speak);
  const todaySales = input.skipSales ? [] : input.sales;
  const todayRecovery = input.skipRecovery
    ? []
    : input.recoveries.filter(item => item.status === "scheduled" || item.status === "draft_prepared");
  if (todayRecovery[0]) {
    const names = todayRecovery
      .map(item => item.subjectName.trim())
      .filter((name, index, all) => Boolean(name) && all.indexOf(name) === index);
    if (names.length) {
      const naturalNames =
        names.length === 1
          ? names[0]
          : names.length === 2
            ? `${names[0]} and ${names[1]}`
            : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
      lines.push(
        `${names.length} dormant customer${names.length === 1 ? "" : "s"} ready for recovery: ${naturalNames}.`
      );
    } else {
      lines.push(`${todayRecovery[0].title} is on the line because ${todayRecovery[0].why}`);
    }
  }
  if (todaySales[0]) {
    lines.push(`Sales that must survive the operations day: ${todaySales[0].title}. ${todaySales[0].why}`);
  }
  if (!lines.length) return "Nothing on the board needs you before you start operating. I'll keep watch.";
  return lines.slice(0, 5).join(" ");
}

/** The sales activities an operator can hold for a day. */
export const SALES_HOLD_SCOPES = ["acquisition", "upsell", "promotion", "winback"] as const;
export type SalesHoldScope = (typeof SALES_HOLD_SCOPES)[number];

/**
 * The sales activity each growth motion is. "No sales today" holds every one;
 * a narrower instruction ("no new-customer outreach today") holds only what it
 * names. A motion not listed is never held: operations and customer service,
 * existing orders, desk investigation, and continuing work whose kind was never
 * recorded. No motion is typed as upselling yet; an upsell hold applies once
 * one is.
 */
const MOTION_SALES_SCOPE: Readonly<Record<string, SalesHoldScope>> = {
  account_acquisition: "acquisition",
  territory_expansion: "acquisition",
  commercial_follow_up: "acquisition",
  alliance: "acquisition",
  customer_recovery: "winback",
  retention: "winback",
  relationship_capital: "promotion",
  reputation: "promotion",
  digital_presence: "promotion",
};

export function salesScopeOfMotion(motion: string | null | undefined): SalesHoldScope | null {
  return (motion != null && MOTION_SALES_SCOPE[motion]) || null;
}

export type SalesHold = { until: string; scope: readonly SalesHoldScope[] };

/** The hold the operator set, or null. */
export function salesHoldOf(rules: Pick<DoctrineRules, "skipSalesUntil" | "skipSalesScope">): SalesHold | null {
  if (!rules.skipSalesUntil) return null;
  const named = (rules.skipSalesScope ?? []).filter(s => (SALES_HOLD_SCOPES as readonly string[]).includes(s));
  return { until: rules.skipSalesUntil, scope: named.length ? named : [...SALES_HOLD_SCOPES] };
}

/** True when the operator held sales through `businessDate` (inclusive). */
export function salesHeldOn(rules: Pick<DoctrineRules, "skipSalesUntil">, businessDate: string): boolean {
  return rules.skipSalesUntil != null && businessDate <= rules.skipSalesUntil;
}

/** True when the hold covers this kind of work on this business date. */
export function salesHoldCovers(hold: SalesHold | null | undefined, businessDate: string, motion: string | null | undefined): boolean {
  if (!hold || businessDate > hold.until) return false;
  const scope = salesScopeOfMotion(motion);
  return scope != null && hold.scope.includes(scope);
}

const SCOPE_LABEL: Record<SalesHoldScope, string> = {
  acquisition: "new-customer outreach",
  upsell: "upselling",
  promotion: "promotional outreach",
  winback: "win-backs",
};

export function describeSalesHoldScope(scope: readonly SalesHoldScope[]): string {
  if (SALES_HOLD_SCOPES.every(s => scope.includes(s))) return "all sales work";
  const labels = SALES_HOLD_SCOPES.filter(s => scope.includes(s)).map(s => SCOPE_LABEL[s]);
  return labels.length <= 2 ? labels.join(" and ") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

export type SalesHoldInstruction = { kind: "hold"; scope: SalesHoldScope[] } | { kind: "resume" };

const HOLD_VERB = String.raw`(?:no|skip|skipping|hold|holding|pause|pausing|stop|without|don't give me|do not give me|don't do|do not do|don't want|do not want)`;
const SCOPE_WORDS: ReadonlyArray<readonly [SalesHoldScope, string]> = [
  ["acquisition", String.raw`(?:new[- ]customers?|new[- ]customer outreach|prospect(?:s|ing)?|cold[- ]?call(?:s|ing)?|new business|acquisition|pitch(?:es|ing)?)`],
  ["upsell", String.raw`(?:up[- ]?sell(?:s|ing)?|cross[- ]?sell(?:s|ing)?)`],
  ["promotion", String.raw`(?:promos?|promotions?|promotional(?: outreach)?|marketing|campaigns?|door[- ]?hangers?|flyers?|review requests?|referral asks?)`],
  ["winback", String.raw`(?:win[- ]?backs?|winning (?:customers |them )?back|lapsed customers?|dormant customers?|reactivat(?:e|ion|ing)|recovery (?:calls?|texts?|outreach))`],
];
const near = (noun: string) => new RegExp(String.raw`\b${HOLD_VERB}\b[^.!?,;]{0,25}?\b${noun}\b`, "i");

/**
 * The operator's spoken sales hold or its release, or null. A hold lasts the
 * business day it is said ("no sales today"); "sales" holds every activity, a
 * named activity holds only that one. "Resume sales" lifts it. Questions,
 * reports ("we had no sales today") and standing rules are not a hold.
 */
export function parseSalesHoldInstruction(utterance: string): SalesHoldInstruction | null {
  const text = utterance.replace(/[‘’]/g, "'").trim();
  if (!text || /\?\s*$/.test(text)) return null;
  if (/^(?:did|do|does|is|are|was|were|why|how|what|which|any|have|has|had|can|could|should|would)\b/i.test(text)) return null;
  const holdsAllSales = near(String.raw`(?:sales|selling)`).test(text);
  const resume =
    /\b(?:resume|restart|unpause)\b[^.!?;,]{0,20}\b(?:sales|selling)\b/i.test(text) ||
    /\b(?:lift|cancel|drop|remove)\b[^.!?;,]{0,15}\b(?:sales hold|hold on sales|the hold)\b/i.test(text) ||
    /\b(?:sales|selling)\b[^.!?;,]{0,15}\b(?:back on|again|can resume|can restart)\b/i.test(text) ||
    /\byou can (?:resume|restart|do|give me|push|start)\s+(?:the\s+)?sales\b/i.test(text);
  if (resume && !holdsAllSales)
    return /\b(?:don't|do not|not yet|never|no need to)\b[^.!?;,]{0,15}\b(?:resume|restart|unpause|lift|cancel|drop|remove|sales)\b/i.test(text)
      ? null
      : { kind: "resume" };
  if (/\b(?:from now on|going forward|always|never|every day|remember this as a rule)\b/i.test(text)) return null;
  if (!/\b(?:today|tonight|this (?:morning|afternoon|evening)|right now|until (?:payroll|this) is (?:finished|done))\b/i.test(text)) return null;
  if (/\b(?:don't|do not)\s+(?:skip|hold|pause|stop)\b/i.test(text)) return null;
  if (/\b(?:had|have had|made|got|there (?:were|was|are|is))\s+no\b/i.test(text)) return null;
  if (holdsAllSales) return { kind: "hold", scope: [...SALES_HOLD_SCOPES] };
  const named = SCOPE_WORDS.filter(([, noun]) => near(noun).test(text)).map(([scope]) => scope);
  return named.length ? { kind: "hold", scope: named } : null;
}

/**
 * The doctrine after the instruction, and what Claire says. A hold is dated on
 * the business day it was said, in the business's own time zone. Lifting it
 * starts nothing: held work comes back only as a proposal for the operator.
 */
export function applySalesHoldInstruction(
  rules: DoctrineRules,
  instruction: SalesHoldInstruction,
  input: { businessDate: string; utterance: string; now: Date }
): { rules: DoctrineRules; speak: string; changed: boolean } {
  if (instruction.kind === "resume") {
    if (!salesHeldOn(rules, input.businessDate))
      return { rules, speak: "Sales work isn't on hold, so nothing changed.", changed: false };
    return {
      rules: { ...rules, skipSalesUntil: null, skipSalesReason: null, skipSalesScope: null, salesHoldLiftedAt: input.now.toISOString() },
      speak: "Sales work is back on. Nothing that was held starts by itself; I'll bring it back as a proposal for your OK.",
      changed: true,
    };
  }
  const all = SALES_HOLD_SCOPES.every(s => instruction.scope.includes(s));
  const payroll = /\bpayroll\b/i.test(input.utterance) ? " until payroll is finished" : "";
  return {
    rules: {
      ...rules,
      skipSalesUntil: input.businessDate,
      skipSalesReason: input.utterance.trim(),
      skipSalesScope: all ? null : [...instruction.scope],
    },
    speak: all
      ? `Just today I'll hold all sales work${payroll}: new-customer outreach, upselling, promotions and win-backs. Customer service and existing orders go ahead. Say "resume sales" when you're ready.`
      : `Just today I'll hold ${describeSalesHoldScope(instruction.scope)}${payroll}. Everything else goes ahead. Say "resume sales" when you're ready.`,
    changed: true,
  };
}

export function whyPushingSales(skipSales: boolean): string {
  if (skipSales) return "You asked me to hold sales work today. That's temporary; say \"resume sales\" to lift it.";
  return "Operations will eat the day if I wait for an empty afternoon. Standing order: sales has to survive the operations day.";
}
