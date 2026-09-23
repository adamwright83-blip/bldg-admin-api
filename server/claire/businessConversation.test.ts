import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  emptyLoaders,
  failingLoaders,
  FIXTURE_NOW,
  FIXTURE_TZ,
  fixtureCompleteness,
  fixtureLoaders,
} from "../analytics/businessLedgerFixture";
import { runBusinessQuery, type BusinessQuery } from "../analytics/businessQuery";
import { loadPaidOrderLedger, type LedgerLoaders } from "../analytics/paidOrderLedger";
import {
  answerClaireBusinessTurn,
  CLAIRE_ANALYTICS_SESSION_TTL_MS,
  hasPendingClaireAction,
  looksLikeWorkRequest,
  type ClaireAnalyticsState,
  type ClaireBusinessTurnDeps,
  type ClaireSurface,
} from "./businessConversation";

function claire(options: { loaders?: LedgerLoaders; surface?: ClaireSurface; now?: Date; plan?: ClaireBusinessTurnDeps["plan"]; seenTenants?: string[] } = {}) {
  const state: ClaireAnalyticsState = {};
  let clock = options.now ?? FIXTURE_NOW;
  const deps: Partial<ClaireBusinessTurnDeps> = {
    now: () => clock,
    timeZone: () => FIXTURE_TZ,
    plan: options.plan ?? vi.fn(async () => null),
    // These fixtures model a business whose sources ARE connected; the zero gate needs that proven.
    loadBindings: async () => ({ laundry_butler: { state: "bound" as const, lastSuccessAt: new Date(), coverageRanges: [], latestAttempt: null, isSystemOfRecord: true }, cleancloud: { state: "bound" as const, lastSuccessAt: new Date(), coverageRanges: [{ from: "2020-01-01", to: "2099-12-31", completedAt: new Date(), basis: "economic_event" as const, provenance: "test_fixture" as const }], latestAttempt: null, isSystemOfRecord: false } }),
    runQuery: (tenantId, query) =>
      runBusinessQuery(tenantId, query, {
        loadLedger: input => loadPaidOrderLedger(input, options.loaders ?? fixtureLoaders(options.seenTenants)),
        loadOpenOrders: async () => ({ openTotal: 4, byStatus: {}, awaitingPayment: 1 }),
        loadCompleteness: async () => fixtureCompleteness,
        now: () => clock,
        timeZone: () => FIXTURE_TZ,
      }),
  };
  const ask = async (utterance: string, tenantId = "tenant-1") =>
    answerClaireBusinessTurn({ tenantId, utterance, state, surface: options.surface ?? "voice" }, deps);
  return {
    state,
    deps,
    ask,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

async function say(ask: ReturnType<typeof claire>["ask"], utterance: string): Promise<string> {
  const turn = await ask(utterance);
  if (!turn.handled) throw new Error(`Claire did not treat "${utterance}" as a business question`);
  expectGrounded(turn.speak, turn.facts);
  return turn.speak;
}

/** Every number Claire speaks must come from a value the query result produced. */
function expectGrounded(text: string, facts: string[]) {
  const numbers = text.match(/\$?\d{1,3}(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  for (const number of numbers) {
    expect(facts.some(fact => fact.includes(number)), `ungrounded number "${number}" in: ${text}`).toBe(true);
  }
}

describe("Claire business conversation — revenue thread (A–C)", () => {
  it("answers revenue, the previous period, and which had more orders without restating", async () => {
    const { ask } = claire();
    const first = await say(ask, "What was revenue in the last 30 days?");
    expect(first).toContain("Paid revenue in the last 30 days is $190 across 5 orders.");
    expect(first).toContain("1 Goldline order marked paid without a payment record, worth $70.00");

    const second = await say(ask, "What about the 30 before that?");
    expect(second).toBe("In the 30 days before that, paid revenue was $95.00 across 2 orders.");

    const third = await say(ask, "Which period had more orders?");
    expect(third).toBe(
      "The last 30 days had 5 paid orders and the 30 days before that had 2, so the last 30 days had 3 more."
    );
  });

  it("compares to the previous period when asked directly", async () => {
    const { ask } = claire();
    const text = await say(ask, "How does revenue for the last 30 days compare with the previous 30 days?");
    expect(text).toContain("$190");
    expect(text).toContain("up 100 percent from the 30 days before that, which had $95.00");
  });

  it("carries a service filter into the existing thread", async () => {
    const { ask } = claire();
    await say(ask, "What was revenue in the last 30 days?");
    const text = await say(ask, "What about just wash and fold?");
    expect(text).toContain("paid wash-and-fold revenue");
    expect(text).toContain("$100 across 2 orders");
    expect(text).toContain("1 CleanCloud order worth $30.00 couldn't be classified as laundry or dry cleaning");
  });

  it("explains a change from grounded drivers only", async () => {
    const { ask } = claire();
    const text = await say(ask, "Why is revenue up over the last 30 days?");
    expect(text).toContain("up 100 percent");
    expect(text).toContain("Most of that is order volume: 5 paid orders versus 2.");
  });
});

describe("Claire business conversation — active customers (D–G)", () => {
  it("states the interpretation, then refines window, minimum orders, and lists members", async () => {
    const { ask } = claire();
    expect(await say(ask, "How many active customers do we have?")).toContain(
      "If we count active as at least one paid order in the last 30 days, that's 3 customer identities."
    );
    expect(await say(ask, "No, use 60 days.")).toContain("Using the last 60 days, it's 4.");
    expect(await say(ask, "Only count people who ordered more than once.")).toContain("That leaves 2.");
    expect(await say(ask, "Who are they?")).toBe("They are Ava Stone and Cara Diaz.");
    expect(await say(ask, "What if we only use the last 30 days?")).toContain("Using the last 30 days, it's 2.");
  });

  it("answers new and dormant customers with stated lookbacks", async () => {
    const { ask } = claire();
    await say(ask, "How many active customers do we have?");
    expect(await say(ask, "How many of those were new customers?")).toContain(
      "1 of the 3 active customer identities in the last 30 days had no paid order in the year before."
    );
    const dormant = claire();
    expect(await say(dormant.ask, "Which customers haven't ordered in 60 days?")).toContain("They are Dee Lopez.");
  });
});

describe("Claire business conversation — other questions", () => {
  it("average order value", async () => {
    const { ask } = claire();
    expect(await say(ask, "What's average order value?")).toContain(
      "Average order value in the last 30 days is $38.00 across 5 paid orders."
    );
  });

  it("top customers (J)", async () => {
    const { ask } = claire();
    expect(await say(ask, "Who were my top three customers?")).toContain(
      "Your top 3 customers by paid revenue in the last 90 days are Ava Stone with $150, Dee Lopez with $80.00, and Ben Ortiz with $60.00."
    );
  });

  it("customer-specific revenue (K)", async () => {
    const { ask } = claire();
    expect(await say(ask, "How much revenue did Ava generate this year?")).toContain(
      "Ava Stone has $150 in paid revenue across 3 orders this year so far; the most recent was September 12."
    );
  });

  it("uses one planning call for a customer question the parser can't resolve, and never lets it write numbers", async () => {
    const plan = vi.fn(async (): Promise<BusinessQuery> => ({
      metric: "customer_history",
      period: { kind: "this_year" },
      comparison: null,
      serviceType: null,
      minOrders: 1,
      limit: 5,
      customerName: "ava",
      listMembers: false,
    }));
    const { ask } = claire({ plan });
    const turn = await ask("how much did ava spend with us this year");
    expect(plan).toHaveBeenCalledTimes(1);
    expect(turn).toMatchObject({ handled: true });
    if (turn.handled) expect(turn.speak).toContain("$150");
  });

  it("scopes to a building from order records, and still refuses customer types it cannot prove (M)", async () => {
    const { ask } = claire();
    const building = await ask("What was revenue from OPUS last month?");
    expect(building).toMatchObject({ handled: true });
    if (building.handled) {
      expect(building.speak).toBe(
        "Paid revenue at OPUS LA last month was $0.00 across 0 orders. Source coverage does not support an exact total for this window, so that figure is recorded revenue only."
      );
    }
    await say(ask, "How many active customers do we have?");
    const commercial = await ask("Exclude commercial accounts.");
    if (!commercial.handled) throw new Error("expected handled");
    expect(commercial.speak).toContain("doesn't classify customers as commercial or residential");
  });

  it("open orders and data coverage", async () => {
    const { ask } = claire();
    expect(await say(ask, "How many open orders are there?")).toContain("There are 4 open orders");
    expect(await say(ask, "What data sources do you have?")).toContain("It doesn't have payroll / labor");
  });
});

describe("financial language (I)", () => {
  it("profit is refused with the real missing inputs and never equated with revenue", async () => {
    const { ask } = claire();
    const text = await say(ask, "How much profit did we make last month?");
    expect(text).toContain("paid revenue last month was $155");
    expect(text).toContain("can't calculate trustworthy profit, because Goldline doesn't have payroll and supply costs connected");
    expect(text).not.toMatch(/profit (?:is|was) \$/);
  });

  it("asks revenue or profit for 'how much did we make', then continues", async () => {
    const { ask } = claire();
    const clarify = await ask("How much did we make?");
    expect(clarify).toMatchObject({ handled: true, speak: expect.stringContaining("Do you mean revenue or profit?") });
    expect(await say(ask, "Revenue.")).toContain("$190");
  });
});

describe("failure honesty (N, O)", () => {
  it("database failure is never spoken as zero", async () => {
    const { ask } = claire({ loaders: failingLoaders });
    const turn = await ask("What was revenue in the last 30 days?");
    expect(turn).toMatchObject({ handled: true, speak: "I couldn't get a reliable revenue number just now, so I won't guess." });
    if (turn.handled) expect(turn.speak).not.toMatch(/\$0|\bzero\b/);
  });

  it("a real empty period is a real zero", async () => {
    const { ask } = claire({ loaders: emptyLoaders });
    expect(await say(ask, "What was revenue in the last 30 days?")).toBe(
      "Paid revenue in the last 30 days is $0.00 across 0 orders. Source coverage does not support an exact total for this window, so that figure is recorded revenue only."
    );
  });

  it("a partial source load is qualified", async () => {
    const loaders: LedgerLoaders = { laundry_butler: fixtureLoaders().laundry_butler, cleancloud: failingLoaders.cleancloud };
    const { ask } = claire({ loaders });
    expect(await say(ask, "What was revenue in the last 30 days?")).toContain(
      "That only includes Goldline's own orders; I couldn't reach CleanCloud just now."
    );
  });
});

describe("intent separation (P–T)", () => {
  it.each([
    "Add reviewing last month's revenue tomorrow.",
    "Remind me to review yesterday's orders.",
    "Change the revenue review to Friday.",
    "Cancel the revenue review.",
    "I left the flyer at the front desk.",
    "Who am I meeting today?",
    "Revenue has been rough lately and I'm frustrated about it, honestly it keeps me up at night.",
  ])("does not treat as analytics: %s", async utterance => {
    const { ask } = claire();
    expect(await ask(utterance)).toEqual({ handled: false });
  });

  it("does not hijack field or plan talk mid-thread", async () => {
    const { ask } = claire();
    await say(ask, "What was revenue in the last 30 days?");
    expect(await ask("Who am I meeting today?")).toEqual({ handled: false });
    expect(await ask("Okay.")).toEqual({ handled: false });
    expect(await ask("Add a task to call Ava tomorrow.")).toEqual({ handled: false });
  });

  it("work requests are recognized as work", () => {
    expect(looksLikeWorkRequest("Add reviewing revenue tomorrow")).toBe(true);
    expect(looksLikeWorkRequest("What was revenue last month?")).toBe(false);
  });

  it("pending yes/no confirmations take precedence over analytics", () => {
    expect(hasPendingClaireAction({ pendingProposal: { title: "x" } as never })).toBe(true);
    expect(hasPendingClaireAction({})).toBe(false);
  });
});

describe("context isolation and expiry (H, X, Z)", () => {
  it("two conversations never share follow-up context", async () => {
    const callA = claire();
    const callB = claire();
    await say(callA.ask, "How many active customers do we have?");
    expect(await callB.ask("Who are they?")).toEqual({ handled: false });
    expect(await say(callA.ask, "Who are they?")).toContain("Ava Stone");
  });

  it("follow-up context expires", async () => {
    const call = claire();
    await say(call.ask, "How many active customers do we have?");
    call.advance(CLAIRE_ANALYTICS_SESSION_TTL_MS + 1);
    expect(await call.ask("Who are they?")).toEqual({ handled: false });
    expect(call.state.analytics).toBeNull();
  });

  it("queries run only for the tenant Claire was authenticated for", async () => {
    const seen: string[] = [];
    const { ask } = claire({ seenTenants: seen });
    await ask("What was revenue in the last 30 days?", "tenant-a");
    expect(new Set(seen)).toEqual(new Set(["tenant-a"]));
  });
});

describe("no demo data", () => {
  it("Claire's analytics path has no route to Composer demo data", () => {
    for (const file of ["businessConversation.ts", "../analytics/businessQuery.ts", "../analytics/paidOrderLedger.ts"]) {
      const source = readFileSync(resolve(__dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(source, file).not.toMatch(/demo/i);
    }
  });
});
