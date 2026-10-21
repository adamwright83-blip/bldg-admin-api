/**
 * Placing the daily call never spends the promise it speaks (Codex review of PR #689).
 *
 * executeDailyClaireCall used to call markConsumed on every prepared item right after dialing, so an
 * unanswered call, a failed dial or voicemail spent "Last night I said I'd have the open property visits
 * ready…". It now records exactly the spoken item on the call (showrunner.preparedOffered) and consumes
 * nothing; the voice turn handler consumes it on delivery (preparedDelivery.mysql.integration.test.ts).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const markConsumed = vi.fn(async () => undefined);
const dialed: Array<Record<string, any>> = [];
let dialOutcome: "accepted" | "throws" = "accepted";

const SPOKEN = {
  id: "cprep_spoken",
  kind: "property_visit_choice" as const,
  forBusinessDate: "2026-10-21",
  promiseText: "Tomorrow morning I'll have the open property visits ready so you can choose one.",
  targets: [{ name: "Wilshire Vermont", address: null }, { name: "The Chadwick", address: null }],
  remainingCount: 2,
};

vi.mock("./preparedItems", async importOriginal => ({
  ...(await importOriginal<typeof import("./preparedItems")>()),
  drizzlePreparedItemStore: () => ({ markConsumed, upsert: vi.fn(), listDue: vi.fn(async () => []), listRecent: vi.fn(async () => []) }),
}));

vi.mock("../../claire/showrunner/showrunnerBriefing", async importOriginal => {
  const actual = await importOriginal<typeof import("../../claire/showrunner/showrunnerBriefing")>();
  return {
    ...actual,
    buildShowrunnerBriefing: vi.fn(async () => ({
      purpose: "morning_readiness",
      businessDate: "2026-10-21",
      weekday: "Wednesday",
      objective: "Get to 50 active customers",
      weekPlan: null,
      today: [],
      tomorrow: [],
      developments: [],
      pendingDecision: null,
      adaptations: [],
      uncertain: [],
      weekToDate: { reportedOutcomes: [], planChanges: [] },
      driverDayLine: null,
      // A second prepared item the opening does NOT speak: it must not be recorded as offered.
      preparedItems: [SPOKEN, { ...SPOKEN, id: "cprep_unspoken", targets: [] }],
    })),
  };
});

vi.mock("../daphne/decisionPointSeam", () => ({ prepareDaphneCallDecision: vi.fn(async () => null) }));

vi.mock("../../claire/claireTwilio", () => ({
  startClairePreDriveCall: vi.fn(async (input: Record<string, any>) => {
    dialed.push(input);
    if (dialOutcome === "throws") throw new Error("Twilio refused the call");
    return { callSid: "CA_daily_test", communicationReceiptId: "receipt_daily_test" };
  }),
}));

vi.mock("./actionExecution", () => ({
  executePersistentOperatorAction: vi.fn(async (input: { execute: () => Promise<unknown> }) => ({ executed: true, result: await input.execute() })),
}));

vi.mock("../agentEvents", () => ({ logAgentEvent: vi.fn(async () => undefined) }));

let executeDailyClaireCall: typeof import("./operatorAppointmentExecution").executeDailyClaireCall;

async function placeMorningCall() {
  return executeDailyClaireCall({
    step: { timeZone: "America/Los_Angeles" } as never,
    now: new Date("2026-10-21T14:30:00.000Z"),
    store: { beginDailyCallDispatch: vi.fn(async () => true) } as never,
    context: {
      jobId: "appointment_daily_test",
      idempotencyKey: "idem_daily_test",
      scope: { tenantId: "default" },
      actor: { standingAuthorizationId: "standing_daily_test" },
      source: { appointmentKind: "daily_morning_readiness", sourceReference: "appointment_daily_test" },
    } as never,
    identity: {
      tenantId: "default",
      canonicalOperatorId: "tenant:default:operator:adam-admin",
      canonicalOpenId: "adam-admin",
      communicationOperatorUserId: "adam-admin",
      dayDirectorActorId: "1",
      dayDirectorActorIds: ["1"],
    } as never,
    purpose: "morning_readiness",
  });
}

describe("placing the daily call never spends the promise it speaks", () => {
  beforeAll(async () => {
    ({ executeDailyClaireCall } = await import("./operatorAppointmentExecution"));
  }, 120_000);

  beforeEach(() => {
    markConsumed.mockClear();
    dialed.length = 0;
    dialOutcome = "accepted";
  });

  it("an accepted dial records exactly the spoken item as offered and consumes nothing", async () => {
    const result = await placeMorningCall();
    expect(result).toMatchObject({ callSid: "CA_daily_test" });
    expect(markConsumed).not.toHaveBeenCalled();
    expect(dialed).toHaveLength(1);
    expect(dialed[0]!.showrunner.preparedOffered).toEqual({ ids: ["cprep_spoken"], consumedAt: null });
    expect(dialed[0]!.openingOverride).toMatch(/Last night I said I'd have the open property visits ready: Wilshire Vermont and The Chadwick\. Which one do you want first\?$/);
  });

  it("a dial that fails consumes nothing", async () => {
    dialOutcome = "throws";
    await expect(placeMorningCall()).rejects.toThrow(/Twilio refused/);
    expect(markConsumed).not.toHaveBeenCalled();
  });
});
