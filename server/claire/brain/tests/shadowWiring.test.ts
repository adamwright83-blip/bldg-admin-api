/**
 * Architectural tests for the shadow observer after the guarded V2 cutover began.
 *
 * The shadow path is still permanently one-way. A separate, explicit live orchestrator
 * may now run before V1 for the authorized operator; that does not give the shadow
 * observer a return path.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readOnlyWorkingMemorySource } from "../shadow/v1Snapshot";
import { observeShadowTurn, observeShadowTurnDetached } from "../shadow/observeShadowTurn";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";
import { createInMemoryShadowMemoryStore } from "../shadow/shadowMemory";

const TWILIO = readFileSync(path.join(process.cwd(), "server/claire/claireTwilio.ts"), "utf8");
const ROUTER = readFileSync(path.join(process.cwd(), "server/claire/claireRouter.ts"), "utf8");

const CTX = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
  conversationKey: "claire-call:wiring",
};
const ON = { CLAIRE_BRAIN_V2_SHADOW: "1" } as unknown as NodeJS.ProcessEnv;

function observe(
  input: Parameters<typeof observeShadowTurn>[0],
  options: Parameters<typeof observeShadowTurn>[1] = {}
) {
  return observeShadowTurn(input, { memory: createInMemoryShadowMemoryStore(), ...options });
}

describe("both surfaces observe, and only observe", () => {
  it("voice and desk both emit a shadow observation", () => {
    expect(TWILIO).toMatch(/observeShadowTurnDetached\(/);
    expect(ROUTER).toMatch(/observeShadowTurnDetached\(/);
  });

  it("the shadow observer is still never awaited or assigned", () => {
    expect(TWILIO).not.toMatch(/await\s+observeShadowTurn/);
    expect(ROUTER).not.toMatch(/await\s+observeShadowTurn/);
    expect(TWILIO).not.toMatch(/=\s*observeShadowTurn/);
    expect(ROUTER).not.toMatch(/=\s*observeShadowTurn/);
  });

  it("the guarded live orchestrator is distinct from the shadow observer", () => {
    expect(TWILIO).toMatch(/await runClaireBrainV2LiveTurn\(/);
    expect(ROUTER).toMatch(/await runClaireBrainV2LiveTurn\(/);
    expect(TWILIO).toMatch(/await runClaireTurn\(/);
    expect(ROUTER).toMatch(/await runClaireTurn\(/);
  });

  it("shadow observation still happens only after the legacy adapter result exists", () => {
    expect(TWILIO.indexOf("await runClaireTurn(")).toBeLessThan(
      TWILIO.indexOf("observeShadowTurnDetached(")
    );
    expect(ROUTER.indexOf("await runClaireTurn(")).toBeLessThan(
      ROUTER.indexOf("observeShadowTurnDetached(")
    );
  });


  it("a held voice fragment is not a V2 reasoning turn", async () => {
    // Transport skips observation on listen-only holds. Direct observer still
    // treats an explicit incomplete label as a half-turn with no retrieval.
    expect(TWILIO).toMatch(/observationUtteranceForBrain\(/);
    expect(TWILIO).toMatch(/observation\.observe/);
    expect(TWILIO).toMatch(/assembledText:\s*observation\.assembledText/);
    expect(ROUTER).toMatch(/observationUtteranceForBrain\(/);
    expect(ROUTER).toMatch(/observation\.observe/);
    expect(ROUTER).toMatch(/assembledText:\s*observation\.assembledText/);

    const held = await observe(
      { rawText: "So for Dana I was thinking", completeness: "incomplete", ...CTX },
      { env: ON }
    );
    expect(held.observed).toBe(true);
    if (held.observed) {
      expect(held.comparison.perceived.completeness).toBe("incomplete");
      // A half-turn reaches no retrieval and asserts nothing.
      expect(held.comparison.evidenceIds).toEqual([]);
    }
  });

  it("neither surface passes the live mutable state object to the brain", () => {
    // Every observation must go through the frozen snapshot boundary.
    for (const source of [TWILIO, ROUTER]) {
      const call = source.slice(source.indexOf("observeShadowTurnDetached("));
      expect(call).toMatch(/readOnlyWorkingMemorySource\(/);
      expect(call.slice(0, 600)).not.toMatch(/state:\s*conversation\s*,/);
    }
  });
});

describe("the snapshot boundary cannot be written through", () => {
  it("returns a frozen object that shares no identity with the live state", () => {
    const live = {
      pendingFragment: "Desired timing is",
      fragmentHolds: 1,
      focusAccount: { id: 7, name: "The Louise" },
      claimReceipts: [{ id: "r1", claireTurnOrdinal: 2, claimType: "revenue", recheck: { kind: "business_query" } }],
      pendingBriefing: { parsed: { items: [1, 2] }, createdAt: 5 },
    };
    const snapshot = readOnlyWorkingMemorySource(live);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.focusAccount).not.toBe(live.focusAccount);
    expect(snapshot.claimReceipts).not.toBe(live.claimReceipts);
    expect(snapshot.pendingBriefing).not.toBe(live.pendingBriefing);
  });

  it("mutating the snapshot cannot reach the live state", () => {
    const live = { pendingFragment: "held", fragmentHolds: 1, focusAccount: { id: 7, name: "The Louise" } };
    const snapshot = readOnlyWorkingMemorySource(live) as Record<string, unknown>;

    try {
      snapshot.pendingFragment = "tampered";
      (snapshot.focusAccount as { name: string }).name = "tampered";
    } catch {
      /* strict mode throws; either way the live object must be untouched */
    }

    expect(live.pendingFragment).toBe("held");
    expect(live.focusAccount.name).toBe("The Louise");
  });

  it("the brain reading a snapshot leaves the live state byte-identical", async () => {
    const live = {
      pendingFragment: "held",
      fragmentHolds: 2,
      pendingReminded: false,
      focusAccount: { id: 7, name: "The Louise" },
      claimReceipts: [{ id: "r1", claireTurnOrdinal: 2, claimType: "revenue", recheck: { kind: "business_query" } }],
      pendingBriefing: { parsed: { items: [1] }, createdAt: 5 },
    };
    const before = JSON.stringify(live);

    await observe(
      { rawText: "What were my last five sales?", state: readOnlyWorkingMemorySource(live), ...CTX },
      { env: ON }
    );

    expect(JSON.stringify(live)).toBe(before);
  });

  it("working memory reads the snapshot without needing to write to it", () => {
    const snapshot = readOnlyWorkingMemorySource({ pendingFragment: "held", fragmentHolds: 3 });
    const memory = snapshotWorkingMemory(snapshot, {
      conversationKey: "k",
      tenantId: "default",
      operatorUserId: "adam-admin",
      surface: "voice",
    });
    expect(memory.pendingFragment).toBe("held");
    expect(memory.fragmentHolds).toBe(3);
  });
});

describe("shadow wiring is inert while the flag is off", () => {
  it("does not invoke the observer when disabled", async () => {
    let ran = 0;
    const result = await observe(
      { rawText: "What was my revenue?", ...CTX },
      { env: {} as unknown as NodeJS.ProcessEnv, sink: () => { ran += 1; } }
    );
    expect(result.observed).toBe(false);
    expect(ran).toBe(0);
  });

  it("the detached call is a no-op while disabled and still returns void", () => {
    let ran = 0;
    const returned = observeShadowTurnDetached(
      { rawText: "What was my revenue?", ...CTX },
      { env: {} as unknown as NodeJS.ProcessEnv, sink: () => { ran += 1; } }
    );
    expect(returned).toBeUndefined();
    expect(ran).toBe(0);
  });

  it("the flag is not enabled by default anywhere in the repo", () => {
    for (const source of [TWILIO, ROUTER]) {
      expect(source).not.toMatch(/CLAIRE_BRAIN_V2_SHADOW\s*=/);
      expect(source).not.toMatch(/episodicTerms/);
      expect(source).toMatch(/dayDirectorActorId:/);
      expect(source).toMatch(/priorClaimReceipts:/);
    }
  });
});

describe("observation carries no authority", () => {
  it("a candidate action grant is never live and never executes", async () => {
    const result = await observe({ rawText: "I need to call Dana Tuesday.", ...CTX }, { env: ON });
    expect(result.observed).toBe(true);
    if (result.observed) {
      expect(result.comparison.productionAuthority).toBe(false);
      // Candidate classes are telemetry labels, not executable authority.
      expect(result.candidateActionClasses.every(cls => typeof cls === "string")).toBe(true);
    }
  });

  it("a candidate call-end is recorded but never terminates anything", async () => {
    const result = await observe({ rawText: "I gotta go.", ...CTX }, { env: ON });
    expect(result.observed).toBe(true);
    if (result.observed) expect(result.candidateEndCall).toBe(true);
    // V1 remains the sole live call-control authority; nothing here can hang up.
    expect(TWILIO).not.toMatch(/observeShadowTurn[\s\S]{0,400}speakAndHangUp/);
  });
});
