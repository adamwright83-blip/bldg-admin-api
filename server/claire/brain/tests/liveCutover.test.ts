import { describe, expect, it, vi } from "vitest";
import type { ClaireTurnResult } from "../../turn/claireTurn";
import {
  runClaireBrainV2LiveTurn,
  isClaireBrainV2LiveEnabled,
} from "../live/runClaireBrainV2LiveTurn";

const ON = { CLAIRE_BRAIN_V2_LIVE: "1" } as unknown as NodeJS.ProcessEnv;
const OFF = {} as unknown as NodeJS.ProcessEnv;

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

function input(over: Record<string, unknown> = {}) {
  return {
    rawText: "I need to call Dana Tuesday.",
    assembledText: "I need to call Dana Tuesday.",
    state: {},
    tenantId: "default",
    operatorUserId: "adam-admin",
    surface: "voice" as const,
    conversationKey: "claire-call:live-cutover",
    live,
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
