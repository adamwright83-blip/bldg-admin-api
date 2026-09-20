/**
 * Architectural tests for the Phase I shadow wiring.
 *
 * The permanent invariant:
 *
 *   BRAIN V2 MAY OBSERVE A COMPLETED V1 TURN.
 *   BRAIN V2 MAY NEVER AFFECT THAT TURN.
 *
 * These tests assert the ABSENCE of a return path, which is the property that is easy
 * to lose accidentally during a later edit. They read the production call sites as text
 * on purpose: a future change that starts awaiting V2, or that feeds a V2 value into a
 * V1 decision, should fail here rather than in someone's phone call.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readOnlyWorkingMemorySource } from "../shadow/v1Snapshot";
import { observeShadowTurn, observeShadowTurnDetached } from "../shadow/observeShadowTurn";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";

const TWILIO = readFileSync(path.join(process.cwd(), "server/claire/claireTwilio.ts"), "utf8");
const ROUTER = readFileSync(path.join(process.cwd(), "server/claire/claireRouter.ts"), "utf8");

const CTX = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  surface: "voice" as const,
  conversationKey: "claire-call:wiring",
};
const ON = { CLAIRE_BRAIN_V2_SHADOW: "1" } as unknown as NodeJS.ProcessEnv;

describe("both surfaces observe, and only observe", () => {
  it("voice and desk both emit a shadow observation", () => {
    expect(TWILIO).toMatch(/observeShadowTurnDetached\(/);
    expect(ROUTER).toMatch(/observeShadowTurnDetached\(/);
  });

  it("neither surface awaits Brain V2 on the response-critical path", () => {
    expect(TWILIO).not.toMatch(/await\s+observeShadowTurn/);
    expect(ROUTER).not.toMatch(/await\s+observeShadowTurn/);
    expect(TWILIO).not.toMatch(/await\s+runClaireBrainTurn/);
    expect(ROUTER).not.toMatch(/await\s+runClaireBrainTurn/);
  });

  it("neither surface assigns a Brain V2 result to anything", () => {
    // No `const x = observeShadowTurn...` — the return value must be unusable.
    expect(TWILIO).not.toMatch(/=\s*observeShadowTurn/);
    expect(ROUTER).not.toMatch(/=\s*observeShadowTurn/);
  });

  it("neither surface references a V2 candidate as a live value", () => {
    for (const source of [TWILIO, ROUTER]) {
      expect(source).not.toMatch(/candidateSpeak/);
      expect(source).not.toMatch(/candidateEndCall/);
      expect(source).not.toMatch(/productionAuthority/);
    }
  });

  it("the live production entrypoint is still runClaireTurn, not the brain", () => {
    expect(TWILIO).toMatch(/await runClaireTurn\(/);
    expect(ROUTER).toMatch(/await runClaireTurn\(/);
    expect(TWILIO).not.toMatch(/runClaireBrainTurn/);
    expect(ROUTER).not.toMatch(/runClaireBrainTurn/);
  });

  it("observation happens after V1's authoritative result exists", () => {
    // The V1 call must textually precede the observation on both surfaces.
    expect(TWILIO.indexOf("await runClaireTurn(")).toBeLessThan(TWILIO.indexOf("observeShadowTurnDetached("));
    expect(ROUTER.indexOf("await runClaireTurn(")).toBeLessThan(ROUTER.indexOf("observeShadowTurnDetached("));
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

    await observeShadowTurn(
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
    const result = await observeShadowTurn(
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
    }
  });
});

describe("observation carries no authority", () => {
  it("a candidate action grant is never live and never executes", async () => {
    const result = await observeShadowTurn({ rawText: "I need to call Dana Tuesday.", ...CTX }, { env: ON });
    expect(result.observed).toBe(true);
    if (result.observed) {
      expect(result.comparison.productionAuthority).toBe(false);
      // Candidate classes are telemetry labels, not executable authority.
      expect(result.candidateActionClasses.every(cls => typeof cls === "string")).toBe(true);
    }
  });

  it("a candidate call-end is recorded but never terminates anything", async () => {
    const result = await observeShadowTurn({ rawText: "I gotta go.", ...CTX }, { env: ON });
    expect(result.observed).toBe(true);
    if (result.observed) expect(result.candidateEndCall).toBe(true);
    // V1 remains the sole live call-control authority; nothing here can hang up.
    expect(TWILIO).not.toMatch(/observeShadowTurn[\s\S]{0,400}speakAndHangUp/);
  });
});
