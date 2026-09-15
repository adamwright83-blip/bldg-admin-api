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
  const temporary = /\b(just today|only today|for today|until (?:payroll|this) is (?:finished|done)|skip .* today)\b/i.test(text);
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
  today: string
): { rules: DoctrineRules; permanence: "temporary" | "durable"; speak: string } | { permanence: "ambiguous"; speak: string } | null {
  const kind = classifyDoctrineUtterance(utterance);
  if (kind === "not_doctrine") return null;
  if (kind === "ambiguous") {
    return { permanence: "ambiguous", speak: "Is that just for today, or a standing rule from now on?" };
  }
  const lower = utterance.toLowerCase();
  let next = { ...rules };
  if (/\bdon't give me sales|no sales|skip sales\b/.test(lower) && kind === "temporary") {
    next.skipSalesUntil = today;
    next.skipSalesReason = utterance.trim();
    return {
      rules: next,
      permanence: "temporary",
      speak: "Just today I'll hold sales work until payroll is finished. That doesn't change the standing rule.",
    };
  }
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
}): string {
  const lines: string[] = [];
  if (input.warnings[0]) lines.push(input.warnings[0]);
  if (input.overload.kind === "impossible") lines.push(input.overload.speak);
  else if (input.overload.kind === "warn") lines.push(input.overload.speak);
  const todaySales = input.skipSales ? [] : input.sales;
  const todayRecovery = input.recoveries.filter(item => item.status === "scheduled" || item.status === "draft_prepared");
  if (todayRecovery[0]) {
    lines.push(`${todayRecovery[0].title} is on the line because ${todayRecovery[0].why}`);
  }
  if (todaySales[0]) {
    lines.push(`Sales that must survive the operations day: ${todaySales[0].title}. ${todaySales[0].why}`);
  }
  if (!lines.length) return "Nothing on the board needs you before you start operating. I'll keep watch.";
  return lines.slice(0, 5).join(" ");
}

export function whyPushingSales(skipSales: boolean): string {
  if (skipSales) return "You asked me to hold sales until payroll is finished today. That's temporary.";
  return "Operations will eat the day if I wait for an empty afternoon. Standing order: sales has to survive the operations day.";
}
