import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCTRINE,
  applyAttestedOutreach,
  applyDoctrineUtterance,
  avoidanceSpeak,
  chooseDeadTimeWork,
  classifyDoctrineUtterance,
  draftDoesNotComplete,
  explainWhyOnToday,
  gumballWarning,
  interruptForSalesFollowUp,
  isDormantEligible,
  isRelationshipCooling,
  SALES_HOLD_SCOPES,
  applySalesHoldInstruction,
  parseSalesHoldInstruction,
  salesHeldOn,
  salesHoldCovers,
  salesHoldOf,
  morningChiefOfStaffBrief,
  overloadJudgment,
  prioritizeRecoveries,
  proposeRecoveryObligation,
  protectAgainstPromiseConflict,
  salesFollowUpObligation,
  scheduleRecoveryDays,
  softwareDriftSpeak,
  supersedeIfReordered,
  whyPushingSales,
  type CustomerEvidence,
  type DayItem,
  type ProactiveObligation,
  type SalesFollowUpEvidence,
} from "./claireProactive";

function sophie(overrides: Partial<CustomerEvidence> = {}): CustomerEvidence {
  return {
    identityKey: "sophie",
    displayName: "Sophie Nguyen",
    paidOrderCount: 6,
    lastPaidOn: "2026-07-31",
    daysSinceLastPaid: 46,
    expectedCadenceDays: 14,
    openOrderCount: 0,
    lastOutreachOn: null,
    attestedOutreachOn: null,
    ...overrides,
  };
}

function recovery(overrides: Partial<ProactiveObligation> = {}): ProactiveObligation {
  return proposeRecoveryObligation(sophie(), "2026-09-16", "She crossed the recovery threshold yesterday. She has six prior orders and there isn't already an unresolved outreach attempt.", "Sophie, it's Adam from Laundry Butler. We haven't seen you since your wash and fold order on Jul 31 and wanted to check in—did everything go well?");
}

describe("Adam doctrine — dormant recovery", () => {
  it("1. crossing the threshold creates a Day Line recovery with a Rook draft, without asking", () => {
    const check = isDormantEligible(sophie(), DEFAULT_DOCTRINE, "2026-09-16", []);
    expect(check.eligible).toBe(true);
    const item = proposeRecoveryObligation(sophie(), "2026-09-16", check.why, "Sophie, it's Adam from Laundry Butler.");
    expect(item.title).toBe("Text Sophie");
    expect(item.status).toBe("draft_prepared");
    expect(item.draft?.sent).toBe(false);
    expect(explainWhyOnToday(item)).toMatch(/six prior orders|6 prior orders/i);
  });

  it("2. remaining dormant does not spawn duplicate daily tasks", () => {
    const existing = [recovery()];
    expect(isDormantEligible(sophie({ daysSinceLastPaid: 51 }), DEFAULT_DOCTRINE, "2026-09-21", existing).eligible).toBe(false);
  });

  it("3. an overloaded threshold day still schedules the obligation later the same week", () => {
    const placed = scheduleRecoveryDays({
      today: "2026-09-16",
      customers: [sophie(), sophie({ identityKey: "carol", displayName: "Carol Horky", paidOrderCount: 5 })],
      rules: DEFAULT_DOCTRINE,
      dayLoads: {},
      overloadedToday: true,
    });
    expect(placed.every(item => item.dueDate >= "2026-09-16")).toBe(true);
    expect(placed.some(item => item.dueDate > "2026-09-16")).toBe(true);
    expect(placed).toHaveLength(2);
  });

  it("4. a new paid order supersedes unfinished recovery and keeps history", () => {
    const closed = supersedeIfReordered(recovery(), "2026-09-15");
    expect(closed.status).toBe("superseded");
    expect(closed.historyIntact).toBe(true);
    expect(closed.why).toMatch(/ordered again/);
  });

  it("5. preparing a Rook draft does not mark outreach complete", () => {
    expect(draftDoesNotComplete(recovery())).toBe(true);
  });

  it("6. a promised customer window beats a recovery text", () => {
    const conflict = protectAgainstPromiseConflict(
      { id: "text", title: "Text Sophie", protection: "flexible", windowStart: "09:00", windowEnd: "10:00" },
      [{ id: "john", title: "Pickup John 9–10 AM", protection: "customer_promise", windowStart: "09:00", windowEnd: "10:00" }]
    );
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.speak).toMatch(/promised customer window/);
  });
});

describe("Adam doctrine — sales, cooling, dead time, load", () => {
  const louise: SalesFollowUpEvidence = {
    accountKey: "louise",
    accountName: "The Louise",
    dueDate: "2026-09-17",
    nextStep: "Call Dana Thursday; front desk said she would be back.",
    lastOutcome: "Dana was out. Collateral left at the desk.",
    history: ["Visited August 7. Front desk took the one-pager."],
  };

  it("7. a documented next step becomes an obligation without Adam remembering it", () => {
    const item = salesFollowUpObligation(louise);
    expect(item.title).toBe("Follow up: The Louise");
    expect(item.dueDate).toBe("2026-09-17");
  });

  it("8. cooling requires a real cadence break, not noise", () => {
    expect(isRelationshipCooling(sophie({ daysSinceLastPaid: 15, expectedCadenceDays: 14, paidOrderCount: 6 })).cooling).toBe(false);
    expect(isRelationshipCooling(sophie({ daysSinceLastPaid: 30, expectedCadenceDays: 14, paidOrderCount: 6 })).cooling).toBe(true);
    expect(isRelationshipCooling(sophie({ paidOrderCount: 2, expectedCadenceDays: 14 })).cooling).toBe(false);
  });

  it("9. a 25-minute pocket chooses among real feasible options, not nonsense", () => {
    const pick = chooseDeadTimeWork(
      [
        { id: "a", title: "Colosseum door", kind: "campaign", real: true, useful: true, feasible: true },
        { id: "b", title: "Nearby Maybourne walk-by", kind: "nearby_sales", real: true, useful: true, feasible: true },
        { id: "c", title: "Bag count at Lugo's", kind: "ops_cleanup", real: true, useful: true, feasible: true },
        { id: "d", title: "Invent a quest", kind: "campaign", real: true, useful: true, feasible: false },
      ],
      "2026-09-16:14:10"
    );
    expect(pick && ["a", "b", "c"].includes(pick.id)).toBe(true);
  });

  it("10. ambitious but feasible days warn without dismantling", () => {
    const items: DayItem[] = Array.from({ length: 18 }, (_, index) => ({
      id: `w${index}`,
      title: `Flexible ${index}`,
      protection: "flexible" as const,
      minutes: 30,
    }));
    const judgment = overloadJudgment(items);
    expect(judgment.kind).toBe("warn");
    expect(judgment.speak).toMatch(/lighten it if you want/);
  });

  it("11. overlapping promised windows are impossible, not a suggestion", () => {
    const judgment = overloadJudgment([
      { id: "a", title: "Pickup John 9–10", protection: "customer_promise", windowStart: "09:00", windowEnd: "10:00" },
      { id: "b", title: "Deliver Carol 9:30–10:30", protection: "customer_promise", windowStart: "09:30", windowEnd: "10:30" },
    ]);
    expect(judgment.kind).toBe("impossible");
    expect(judgment.speak).toMatch(/overlap/);
  });
});

describe("Adam doctrine — avoidance, software, gumball, prepare, permanence, morning", () => {
  it("12. one reschedule is not avoidance", () => {
    expect(avoidanceSpeak(1, "The Louise")).toBeNull();
  });

  it("13. repeated unexplained moves escalate to a decision", () => {
    expect(avoidanceSpeak(2, "The Louise")).toMatch(/moved The Louise again/);
    expect(avoidanceSpeak(3, "The Louise")).toMatch(/third time/);
    expect(avoidanceSpeak(4, "The Louise")).toMatch(/Pick one/);
  });

  it("14. several morning build prompts with no growth work get challenged", () => {
    expect(
      softwareDriftSpeak({ morningBuildPrompts: 4, businessGrowthDoneToday: false, opsBlockedByDefect: false }, 3)
    ).toMatch(/fourth build prompt/);
  });

  it("15. a defect blocking fulfillment justifies continued software work", () => {
    expect(
      softwareDriftSpeak({ morningBuildPrompts: 6, businessGrowthDoneToday: false, opsBlockedByDefect: true }, 3)
    ).toMatch(/justified/);
  });

  it("16. stale GUMBALL is brought forward as missing import, not as zero orders", () => {
    const warning = gumballWarning({
      gumballImportedToday: false,
      lastSuccessAt: "2026-09-11T00:03:00.000Z",
      cleanCloudThrough: "2026-09-10",
      today: "2026-09-16",
      failedAttemptToday: false,
      unknownFailures: true,
    });
    expect(warning).toMatch(/Failed attempts weren't logged/);
    expect(warning).not.toMatch(/revenue is \$0/);
  });

  it("17. a due sales follow-up already has identity, history, outcome, and next step", () => {
    const packet = interruptForSalesFollowUp({
      accountKey: "louise",
      accountName: "The Louise",
      dueDate: "2026-09-17",
      nextStep: "Call Dana Thursday.",
      lastOutcome: "Dana was out.",
      history: ["Visited August 7."],
    });
    expect(packet.alreadyPrepared.join(" ")).toMatch(/The Louise/);
    expect(packet.alreadyPrepared.join(" ")).toMatch(/August 7/);
    expect(packet.alreadyPrepared.join(" ")).toMatch(/Dana was out/);
    expect(packet.alreadyPrepared.join(" ")).toMatch(/Call Dana/);
  });

  it("18. a one-day sales hold does not rewrite standing doctrine", () => {
    expect(classifyDoctrineUtterance("Just today, don't give me sales work until payroll is finished.")).toBe("temporary");
    const applied = applyDoctrineUtterance(DEFAULT_DOCTRINE, "Just today, don't give me sales work until payroll is finished.", "2026-09-16");
    expect(applied && "rules" in applied && applied.permanence).toBe("temporary");
    if (applied && "rules" in applied) {
      expect(applied.rules.skipSalesUntil).toBe("2026-09-16");
      expect(applied.rules.avoidanceConfrontAfter).toBe(DEFAULT_DOCTRINE.avoidanceConfrontAfter);
    }
  });

  describe("18b. the operator's one-day sales hold", () => {
    const all = { until: "2026-09-16", scope: [...SALES_HOLD_SCOPES] };

    it("'no sales' holds acquisition, upselling, promotion and win-backs; operations and investigation are never held", () => {
      for (const motion of ["account_acquisition", "territory_expansion", "commercial_follow_up", "alliance", "customer_recovery", "retention", "reputation", "relationship_capital", "digital_presence"])
        expect(salesHoldCovers(all, "2026-09-16", motion), motion).toBe(true);
      for (const motion of ["investigation", "continue_existing", null])
        expect(salesHoldCovers(all, "2026-09-16", motion), String(motion)).toBe(false);
      expect(salesHoldCovers(all, "2026-09-17", "account_acquisition")).toBe(false);
      expect(salesHoldCovers({ until: "2026-09-16", scope: ["acquisition"] }, "2026-09-16", "customer_recovery")).toBe(false);
      // A hold saved before scopes existed holds everything.
      expect(salesHoldOf({ skipSalesUntil: "2026-09-16" })?.scope).toEqual([...SALES_HOLD_SCOPES]);
      expect([salesHeldOn({ skipSalesUntil: "2026-09-16" }, "2026-09-16"), salesHeldOn({ skipSalesUntil: null }, "2026-09-16")]).toEqual([true, false]);
    });

    it.each([
      ["No sales today.", { kind: "hold", scope: [...SALES_HOLD_SCOPES] }],
      ["Just today, don't give me sales work until payroll is finished.", { kind: "hold", scope: [...SALES_HOLD_SCOPES] }],
      ["Hold sales until payroll is done.", { kind: "hold", scope: [...SALES_HOLD_SCOPES] }],
      ["No sales again today.", { kind: "hold", scope: [...SALES_HOLD_SCOPES] }],
      ["No new-customer outreach today.", { kind: "hold", scope: ["acquisition"] }],
      ["Skip win-backs today.", { kind: "hold", scope: ["winback"] }],
      ["No promotions or upselling today.", { kind: "hold", scope: ["upsell", "promotion"] }],
      ["Resume sales now.", { kind: "resume" }],
      ["You can resume sales.", { kind: "resume" }],
      ["Payroll's done, sales are back on.", { kind: "resume" }],
      ["Lift the sales hold.", { kind: "resume" }],
    ])("%s", (utterance, expected) => expect(parseSalesHoldInstruction(utterance)).toEqual(expected));

    it.each([
      "Did we have no sales today?",
      "We had no sales today.",
      "There were no sales today.",
      "Skip the OPUS pickup today.",
      "Skip the pickup today, sales are fine.",
      "No sales from now on.",
      "No sales.",
      "Don't resume sales yet.",
      "End the call, sales later.",
      "Don't skip sales today.",
    ])("not a hold or a release: %s", utterance => expect(parseSalesHoldInstruction(utterance)).toBeNull());

    it("is dated on the day it was said, says only the reason given, and lifting it starts nothing", () => {
      const now = new Date("2026-09-16T18:00:00.000Z");
      const full = applySalesHoldInstruction(DEFAULT_DOCTRINE, { kind: "hold", scope: [...SALES_HOLD_SCOPES] }, { businessDate: "2026-09-16", utterance: "No sales today, payroll.", now });
      expect(full.rules).toMatchObject({ skipSalesUntil: "2026-09-16", skipSalesReason: "No sales today, payroll.", skipSalesScope: null });
      expect(full.speak).toBe('Just today I\'ll hold all sales work until payroll is finished: new-customer outreach, upselling, promotions and win-backs. Customer service and existing orders go ahead. Say "resume sales" when you\'re ready.');
      const narrow = applySalesHoldInstruction(DEFAULT_DOCTRINE, { kind: "hold", scope: ["acquisition"] }, { businessDate: "2026-09-16", utterance: "No new-customer outreach today.", now });
      expect(narrow.rules.skipSalesScope).toEqual(["acquisition"]);
      expect(narrow.speak).toBe('Just today I\'ll hold new-customer outreach. Everything else goes ahead. Say "resume sales" when you\'re ready.');

      const lifted = applySalesHoldInstruction(full.rules, { kind: "resume" }, { businessDate: "2026-09-16", utterance: "Resume sales now.", now });
      expect(lifted).toMatchObject({ changed: true, rules: { skipSalesUntil: null, skipSalesReason: null, skipSalesScope: null, salesHoldLiftedAt: now.toISOString() } });
      expect(lifted.speak).toBe("Sales work is back on. Nothing that was held starts by itself; I'll bring it back as a proposal for your OK.");
      expect(applySalesHoldInstruction(DEFAULT_DOCTRINE, { kind: "resume" }, { businessDate: "2026-09-16", utterance: "Resume sales now.", now }))
        .toMatchObject({ changed: false, speak: "Sales work isn't on hold, so nothing changed." });

      // The doctrine turn takes the same grammar.
      const viaDoctrine = applyDoctrineUtterance(DEFAULT_DOCTRINE, "Just today, no sales.", "2026-09-16", now);
      expect(viaDoctrine && "rules" in viaDoctrine && viaDoctrine.rules.skipSalesUntil).toBe("2026-09-16");
    });
  });

  it("19. permanence language updates standing doctrine", () => {
    expect(classifyDoctrineUtterance("From now on, if I move the same sales task three times, confront me directly.")).toBe("durable");
    const applied = applyDoctrineUtterance(
      DEFAULT_DOCTRINE,
      "From now on, if I move the same sales task three times, confront me directly.",
      "2026-09-16"
    );
    expect(applied && "rules" in applied && applied.rules.avoidanceConfrontAfter).toBe(3);
  });

  it("20. morning briefing is a short chief-of-staff note, not a dump", () => {
    const brief = morningChiefOfStaffBrief({
      recoveries: [recovery()],
      sales: [salesFollowUpObligation({
        accountKey: "louise",
        accountName: "The Louise",
        dueDate: "2026-09-16",
        nextStep: "Call Dana.",
        lastOutcome: "Dana was out.",
        history: ["Visited August 7."],
      })],
      warnings: ["GUMBALL did not run today."],
      overload: { kind: "warn", speak: "This is probably overloaded. I can help lighten it if you want." },
      skipSales: false,
    });
    expect(brief).toMatch(/GUMBALL/);
    expect(brief).toMatch(/Sophie/);
    expect(brief.split(". ").length).toBeLessThan(12);
    expect(whyPushingSales(false)).toMatch(/sales has to survive/);
  });

  it("operator-attested outreach enters cooldown instead of completing by draft", () => {
    const next = applyAttestedOutreach(recovery(), "2026-09-15");
    expect(next.status).toBe("awaiting_result");
    expect(draftDoesNotComplete({ ...next, draft: { message: "hi", sent: false } })).toBe(true);
  });

  it("priority prefers regulars with more orders", () => {
    const ranked = prioritizeRecoveries([
      sophie({ identityKey: "newish", displayName: "Pat", paidOrderCount: 2, expectedCadenceDays: 30 }),
      sophie(),
    ]);
    expect(ranked[0]?.identityKey).toBe("sophie");
  });
});
