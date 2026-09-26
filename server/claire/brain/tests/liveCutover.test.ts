import { describe, expect, it, vi } from "vitest";
import type { ClaireTurnResult } from "../../turn/claireTurn";
import type { BusinessMemoryDeps } from "../businessMemory/adapter";
import {
  runClaireBrainV2LiveTurn,
  isClaireBrainV2LiveEnabled,
  type ClaireBrainV2LiveInput,
} from "../live/runClaireBrainV2LiveTurn";

const ON = { CLAIRE_BRAIN_V2_LIVE: "1" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as unknown as NodeJS.ProcessEnv;


const hermeticBusiness: BusinessMemoryDeps = {
  runQuery: async () => ({}) as never,
  listAccounts: async () => [],
  listContacts: async () => [],
  loadHistory: async ({ account }) =>
    ({
      account,
      missions: [],
      events: [],
      fieldVisits: [],
      outcomes: [],
      followUps: [],
      pipelineStage: null,
      pipelineId: null,
      contacts: [],
      dayLineMentions: [],
      conversationMentions: [],
    }) as never,
  loadOpenOrders: async () => [],
  loadOperations: async ({ businessDate }) => ({
    businessDate,
    open: [],
    completed: [],
    routeAvailable: true,
  }),
  verifyClaim: async () => ({}) as never,
};

const live = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  conversationId: "live-cutover",
  dayDirectorActorId: "42",
  businessDate: "2026-09-25",
  timeZone: "America/Los_Angeles",
  surface: "voice" as const,
  priorClaimReceipts: [],
};

function adapterResult(
  kind: ClaireTurnResult["kind"] = "briefing_proposed"
): ClaireTurnResult {
  return {
    speak: "legacy adapter speech",
    kind,
    assembledUtterance: "adapter",
    thoughtCompleteness: "complete",
  };
}

function input(
  over: Partial<ClaireBrainV2LiveInput> = {}
): ClaireBrainV2LiveInput {
  return {
    rawText: "I need to call Dana Tuesday.",
    assembledText: "I need to call Dana Tuesday.",
    state: {},
    tenantId: "default",
    operatorUserId: "adam-admin",
    surface: "voice" as const,
    conversationKey: "claire-call:live-cutover",
    live,
    liveDeps: { business: hermeticBusiness },
    executeLegacyAdapter: vi.fn(async () => adapterResult()),
    ...over,
  };
}

describe("Brain V2 live cutover", () => {
  it("is default-off and operator-scoped", async () => {
    const executeLegacyAdapter = vi.fn(async () => adapterResult());
    const result = await runClaireBrainV2LiveTurn(
      input({ executeLegacyAdapter }),
      { env: OFF }
    );
    expect(result).toEqual({ active: false, reason: "disabled" });
    expect(executeLegacyAdapter).not.toHaveBeenCalled();

    expect(
      isClaireBrainV2LiveEnabled({
        tenantId: "default",
        operatorUserId: "adam-admin",
        env: ON,
      })
    ).toBe(true);
    expect(
      isClaireBrainV2LiveEnabled({
        tenantId: "other",
        operatorUserId: "someone",
        env: ON,
      })
    ).toBe(false);
  });

  it("makes V2 the live executive for a Day Line work declaration", async () => {
    const executeLegacyAdapter = vi.fn(async () => adapterResult());
    const result = await runClaireBrainV2LiveTurn(
      input({ executeLegacyAdapter }),
      { env: ON }
    );

    expect(result.active).toBe(true);
    if (!result.active) return;
    expect(result.result.productionAuthority).toBe(true);
    expect(result.actionClasses).toContain("propose_day_line");
    expect(executeLegacyAdapter).toHaveBeenCalledTimes(1);

    const grant = result.result.decision.actionGrants[0]!;
    expect(grant.constraints).toEqual({
      mutationAllowed: true,
      shadowOnly: false,
    });
    expect(result.adapterResult?.kind).toBe("briefing_proposed");
  });

  it("never lets an explicit Day Line command claim success without a write receipt", async () => {
    const executeLegacyAdapter = vi.fn(async () => ({
      speak: "Done. I added it.",
      kind: "answered" as const,
      assembledUtterance: "Add the stuff to the Day Line.",
      thoughtCompleteness: "complete" as const,
      actionIds: [],
    }));
    const result = await runClaireBrainV2LiveTurn(
      input({
        rawText: "Add the stuff to the Day Line.",
        assembledText: "Add the stuff to the Day Line.",
        state: {},
        executeLegacyAdapter,
      }),
      { env: ON }
    );

    expect(result.active).toBe(true);
    if (!result.active) return;
    expect(result.actionClasses).toContain("commit_day_line");
    expect(executeLegacyAdapter).toHaveBeenCalledTimes(1);
    expect(result.adapterResult?.actionIds).toEqual([]);
    expect(result.adapterResult?.speak).toMatch(/don't have a write receipt/i);
    expect(result.adapterResult?.speak).not.toMatch(/\bDone\b|\badded\b/i);
  });

  it("keeps a receipt-backed explicit Day Line commit intact", async () => {
    const executeLegacyAdapter = vi.fn(async () => ({
      speak: "Done. 2 on today's line.",
      kind: "briefing_saved" as const,
      assembledUtterance: "Add the stuff to the Day Line.",
      thoughtCompleteness: "complete" as const,
      actionIds: ["c1", "c2"],
      mutationReceipts: [
        { claimedState: "created" as const, entityId: "c1", statement: "Added Call permit office to the Day Line" },
        { claimedState: "created" as const, entityId: "c2", statement: "Added Send estimate to the Day Line" },
      ],
    }));
    const result = await runClaireBrainV2LiveTurn(
      input({
        rawText: "Add the stuff to the Day Line.",
        assembledText: "Add the stuff to the Day Line.",
        state: {},
        executeLegacyAdapter,
      }),
      { env: ON }
    );

    expect(result.active).toBe(true);
    if (!result.active) return;
    expect(result.actionClasses).toContain("commit_day_line");
    expect(result.adapterResult?.actionIds).toEqual(["c1", "c2"]);
    expect(result.adapterResult?.speak).toBe("Done. 2 on today's line.");
  });

  it("binds a bare yes to the pre-turn pending briefing before the adapter clears it", async () => {
    const executeLegacyAdapter = vi.fn(async () =>
      adapterResult("briefing_saved")
    );
    const result = await runClaireBrainV2LiveTurn(
      input({
        rawText: "Yes.",
        assembledText: "Yes.",
        state: {
          pendingBriefing: {
            parsed: { items: [{ title: "Drop off Malcolm" }] },
            createdAt: 1,
          },
        },
        executeLegacyAdapter,
      }),
      { env: ON }
    );

    expect(result.active).toBe(true);
    if (!result.active) return;
    expect(result.actionClasses).toContain("commit_briefing");
    expect(executeLegacyAdapter).toHaveBeenCalledTimes(1);
    expect(result.adapterResult?.kind).toBe("briefing_saved");
  });

  it("owns call control without manufacturing a business mutation", async () => {
    const executeLegacyAdapter = vi.fn(async () => adapterResult("answered"));
    const result = await runClaireBrainV2LiveTurn(
      input({
        rawText: "I gotta go.",
        assembledText: "I gotta go.",
        executeLegacyAdapter,
      }),
      { env: ON }
    );

    expect(result.active).toBe(true);
    if (!result.active) return;
    expect(result.result.candidateEndCall).toBe(true);
    expect(result.actionClasses).toEqual([]);
    expect(executeLegacyAdapter).not.toHaveBeenCalled();
  });

  it("falls back outside the first live scope instead of pretending V2 owns every organ", async () => {
    const executeLegacyAdapter = vi.fn(async () => adapterResult("answered"));
    const result = await runClaireBrainV2LiveTurn(
      input({
        rawText: "Good morning.",
        assembledText: "Good morning.",
        executeLegacyAdapter,
      }),
      { env: ON }
    );

    expect(result).toEqual({ active: false, reason: "outside_live_scope" });
    expect(executeLegacyAdapter).not.toHaveBeenCalled();
  });
});
