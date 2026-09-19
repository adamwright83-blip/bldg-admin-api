import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryProgressionStore, type ProgressionStore } from "./store";
import { assertSimulationAllowed, createSimulationSession, SimulationNotAllowedError, SIMULATION_MARK } from "./simulator";
import { getProgressionStore, setProgressionStoreForTesting } from "./drizzleStore";
import { summarizeDeclineTelemetry } from "./declineTelemetry";
import { commitPendingDisclosures, pendingDisclosureCountForTesting, stashPendingDisclosure, abandonPendingDisclosures } from "./pendingReceipts";

const ENABLED = { NODE_ENV: "test", CLAIRE_PROGRESSION_SIMULATOR: "1" };
const father = async () => "He was an academic, on paper.";

describe("simulator hard guards (fail closed)", () => {
  it("refuses in production, on Railway production, and without the explicit flag", () => {
    expect(() => assertSimulationAllowed({ NODE_ENV: "production", CLAIRE_PROGRESSION_SIMULATOR: "1" })).toThrow(SimulationNotAllowedError);
    expect(() => assertSimulationAllowed({ NODE_ENV: "test", RAILWAY_ENVIRONMENT_NAME: "production", CLAIRE_PROGRESSION_SIMULATOR: "1" })).toThrow(SimulationNotAllowedError);
    expect(() => assertSimulationAllowed({ NODE_ENV: "test" })).toThrow(SimulationNotAllowedError);
    expect(() => assertSimulationAllowed({ NODE_ENV: "test", CLAIRE_PROGRESSION_SIMULATOR: "true" })).toThrow(SimulationNotAllowedError);
    expect(() => assertSimulationAllowed({})).toThrow(SimulationNotAllowedError);
    expect(() => assertSimulationAllowed(ENABLED)).not.toThrow();
  });

  it("refuses any non-in-memory store, including something shaped like the production store", () => {
    const fake = { ...createInMemoryProgressionStore(), kind: "drizzle" } as unknown as ProgressionStore;
    expect(() => createSimulationSession({ env: ENABLED, store: fake })).toThrow(SimulationNotAllowedError);
  });

  it("simulated actions, progress, rapport, rung, entitlements, and disclosures never reach the production store", async () => {
    const prodTouch = vi.fn();
    const trap = new Proxy({} as ProgressionStore, {
      get: (_target, prop) => {
        prodTouch(String(prop));
        return () => { throw new Error("production store must not be touched by the simulator"); };
      },
    });
    setProgressionStoreForTesting(trap);
    try {
      const session = createSimulationSession({ env: ENABLED });
      expect(await session.applyState("rung1")).toMatchObject({ personalRung: 1, entitlementsMinted: 1 });
      const revealed = await session.ask({ topic: "father", conversationId: "sim-1", generate: father });
      expect(revealed.outcome).toBe("answered_new_disclosure");
      expect(revealed.marked.startsWith(SIMULATION_MARK)).toBe(true);
      expect(prodTouch).not.toHaveBeenCalled();
      expect(getProgressionStore()).toBe(trap); // untouched
    } finally {
      setProgressionStoreForTesting(null);
    }
  });

  it("the simulator source imports no production store, emitter, or evidence source", () => {
    const source = readFileSync(new URL("./simulator.ts", import.meta.url), "utf8");
    for (const forbidden of ["drizzleStore", "relationshipEmitters", "evidenceSources", "character/store", "getDb", "relationshipState"]) {
      expect(source).not.toMatch(new RegExp(`import[^;]*${forbidden}`));
    }
  });

  it("every rung can be auditioned immediately, with production thresholds unchanged", async () => {
    for (const [state, rung] of [["rapport0_access0", 0], ["high_rapport_access0", 0], ["rung1", 1], ["rung2", 2], ["rung3", 3]] as const) {
      const session = createSimulationSession({ env: ENABLED });
      const result = await session.applyState(state);
      expect(result.personalRung).toBe(rung);
    }
    const high = createSimulationSession({ env: ENABLED });
    expect((await high.applyState("high_rapport_access0")).rapportBand).toBe(3);
  });
});

describe("decline telemetry", () => {
  it("reports fallback rate by rung, topic, and cause, and flags eligible-but-lost reveals as a defect signal", async () => {
    const session = createSimulationSession({ env: ENABLED });
    await session.applyState("rung1");
    await session.ask({ topic: "father", conversationId: "c1", generate: async () => "He worked at Oxford.", });
    await session.ask({ topic: "father", conversationId: "c1", generate: father });
    await session.ask({ topic: "age", conversationId: "c2", generate: async () => "Old enough to know better." });
    const rows = await session.store.listTenantLedger({ tenantId: session.scope.tenantId });
    const telemetry = summarizeDeclineTelemetry(rows);
    expect(telemetry.totalAsked).toBe(3);
    expect(telemetry.totalFallbacks).toBe(1);
    expect(telemetry.byFailureCause.ungrounded_specificity).toBe(1);
    expect(telemetry.eligibleButLost).toBe(1);
    expect(telemetry.byRung.rung_1.fallbacks).toBe(1);
    expect(telemetry.byTopic.father.fallbacks).toBe(1);
    expect(telemetry.recent[0]).toMatchObject({ declineId: expect.any(String), hadUnusedEntitlement: true, failurePhase: "post_validation" });
  });
});

describe("delivery boundary", () => {
  it("a stashed reveal commits only when the next turn arrives; abandon returns it to unused", async () => {
    const session = createSimulationSession({ env: ENABLED });
    await session.applyState("rung1");
    const { executePersonalTurn } = await import("./personalReveal");
    const turn = await executePersonalTurn({ store: session.store, scope: session.scope, conversationId: "call-x", topic: "father", generate: father, businessOpen: true, autoCommit: false });
    stashPendingDisclosure("call-x", turn.receipt!);
    expect(pendingDisclosureCountForTesting("call-x")).toBe(1);
    expect((await session.store.listEntitlements(session.scope))[0].status).toBe("reserved");
    expect(await commitPendingDisclosures("call-x")).toBe(1);
    expect((await session.store.listEntitlements(session.scope))[0].status).toBe("consumed");

    const other = createSimulationSession({ env: ENABLED });
    await other.applyState("rung1");
    const t2 = await executePersonalTurn({ store: other.store, scope: other.scope, conversationId: "call-y", topic: "father", generate: father, businessOpen: true, autoCommit: false });
    stashPendingDisclosure("call-y", t2.receipt!);
    await abandonPendingDisclosures("call-y");
    expect((await other.store.listEntitlements(other.scope))[0].status).toBe("unused");
  });
});
