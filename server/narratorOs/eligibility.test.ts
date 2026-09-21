import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isLegalEligibilityGoldlineEvidence } from "./brainBoundary";
import {
  eligibilityMutates,
  evaluateEligibility,
  issueEligibilityAuthorizations,
  isEligibilityAuthorization,
  outcomeOfPassing,
  type EligibilityInput,
} from "./eligibility";
import {
  applyElapsedTime,
  applyQuietClose,
  commitAuthorizedBeat,
  commitFiredBeat,
  fireOffscreenIfLegal,
  IneligibleBeatCommitError,
  recordVerifiedGoldlineOutcome,
} from "./ledger";
import { initNarratorOperator } from "./init";
import { createInMemoryNarratorStore } from "./memoryStore";
import {
  AUTHORED_BEATS,
  AUTHORED_GRAPH,
  BEAT_IDS,
  getBeat,
  offscreenCatalog,
} from "./registry";
import { type NarratorSnapshot } from "./store";

const scope = { tenantId: "t-d", operatorUserId: "op-d" };

const LATE_REVEAL_IDS = [
  BEAT_IDS.K_COVE_ORIGIN,
  BEAT_IDS.CONSTRUCTEDNESS,
  "M15",
  "M16",
  "M17",
  "M18",
  "M19",
  "M20",
  "M21",
  "M22",
  "M23",
  "M24",
] as const;

async function seeded(): Promise<{
  store: ReturnType<typeof createInMemoryNarratorStore>;
  snapshot: NarratorSnapshot;
}> {
  const store = createInMemoryNarratorStore();
  const snapshot = await initNarratorOperator(store, scope);
  return { store, snapshot };
}

function evalInput(
  snapshot: NarratorSnapshot,
  extra?: Partial<EligibilityInput>
): EligibilityInput {
  return {
    registry: AUTHORED_BEATS,
    graph: AUTHORED_GRAPH,
    snapshot,
    verifiedGoldline: [],
    nowMs: Date.parse("2026-09-21T00:00:00Z"),
    mode: "interactive",
    ...extra,
  };
}

describe("Narrator OS slice D — ledger + eligibility + persistence", () => {
  it("returns NO_ELIGIBLE for a brand-new interactive user; late reveals stay ineligible", async () => {
    const { snapshot } = await seeded();
    const result = evaluateEligibility(evalInput(snapshot));
    expect(result.outcome).toBe("NO_ELIGIBLE");
    expect(result.eligibleBeatIds).toEqual([]);
    expect(result.withheldBeatIds).toEqual([]);
    expect(eligibilityMutates(result)).toBe(false);
    expect(snapshot.ledger).toEqual([]);
    for (const id of LATE_REVEAL_IDS) {
      const audit = result.audit.find(entry => entry.beatId === id)!;
      expect(audit.pass).toBe(false);
      expect(audit.failedGates.length).toBeGreaterThan(0);
    }
    expect(
      result.audit.find(entry => entry.beatId === BEAT_IDS.K_COVE_ORIGIN)
        ?.failedGates
    ).toEqual(
      expect.arrayContaining(["incomplete_eligibility", "open_unresolved"])
    );
    expect(
      result.audit.find(entry => entry.beatId === BEAT_IDS.CONSTRUCTEDNESS)
        ?.failedGates
    ).toContain("incomplete_eligibility");
    expect(
      result.audit.find(entry => entry.beatId === "M04")?.failedGates
    ).toContain("prerequisite");
    expect(
      result.audit.find(entry => entry.beatId === "M15")?.failedGates
    ).toContain("incomplete_eligibility");
  });

  it("returns ELIGIBLE_WITHHELD only from authored defaultSurface metadata, never taste", () => {
    expect(getBeat("constructedness").defaultSurface).toBe(false);
    expect(outcomeOfPassing([getBeat("constructedness")])).toBe(
      "ELIGIBLE_WITHHELD"
    );
    expect(outcomeOfPassing([getBeat("M03")])).toBe("ELIGIBLE");
    const src = readFileSync(
      resolve(process.cwd(), "server/narratorOs/eligibility.ts"),
      "utf8"
    );
    expect(src).not.toMatch(
      /feel(?:s)? early|pacing|exciting|mystery better|right time/i
    );
  });

  it("does not fire offscreen when the production catalog is empty", async () => {
    const { store, snapshot } = await seeded();
    expect(offscreenCatalog()).toEqual([]);
    const none = await fireOffscreenIfLegal({
      store,
      scope,
      eligibility: evalInput(snapshot, { mode: "offscreen" }),
    });
    expect(none.fired).toEqual([]);
    expect((await store.load(scope))?.ledger).toEqual([]);
  });

  it("refuses raw-id commit, ineligible commit, offscreen-disallowed commit, and incomplete/OPEN commit", async () => {
    const { store, snapshot } = await seeded();
    await expect(
      commitFiredBeat({ store, scope, beatId: "CL-031" })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    await expect(
      commitFiredBeat({ store, scope, beatId: "constructedness" })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);

    const interactive = evalInput(snapshot);
    const result = evaluateEligibility(interactive);
    expect(issueEligibilityAuthorizations(result, interactive)).toEqual([]);

    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: {
          beatId: BEAT_IDS.CONSTRUCTEDNESS,
          mode: "interactive",
          tenantId: scope.tenantId,
          operatorUserId: scope.operatorUserId,
          ledgerLength: 0,
        } as never,
        eligibility: interactive,
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);

    const m03Ready = evalInput(snapshot, {
      verifiedGoldline: [
        {
          outcomeId: "spoken_no",
          verificationClass: "VERIFIED",
          evidenceClass: "operator_attested",
        },
      ],
    });
    const m03Result = evaluateEligibility(m03Ready);
    const auths = issueEligibilityAuthorizations(m03Result, m03Ready);
    const m03Auth = auths.find(auth => auth.beatId === BEAT_IDS.M03);
    expect(m03Auth && isEligibilityAuthorization(m03Auth)).toBe(true);
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization: m03Auth!,
        eligibility: { ...m03Ready, mode: "offscreen" },
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
  });

  it("commits an authorized COMPLETE beat atomically and refuses non-repeatable replay", async () => {
    const { store, snapshot } = await seeded();
    const eligibility = evalInput(snapshot, {
      verifiedGoldline: [
        {
          outcomeId: "spoken_no",
          verificationClass: "VERIFIED",
          evidenceClass: "operator_attested",
        },
      ],
    });
    const result = evaluateEligibility(eligibility);
    expect(result.eligibleBeatIds).toContain(BEAT_IDS.M03);
    const authorization = issueEligibilityAuthorizations(
      result,
      eligibility
    ).find(auth => auth.beatId === BEAT_IDS.M03)!;
    const after = await commitAuthorizedBeat({
      store,
      scope,
      authorization,
      eligibility,
    });
    expect(after.ledger).toHaveLength(1);
    expect(after.ledger[0]?.beatId).toBe("M03");
    expect(after.narrativeState.values.m03).toBe("FIRED");
    expect(after.knowledge.planes.PLAYER.knownFactIds).not.toContain(
      "antarctica_is_father_reveal"
    );

    const replay = evaluateEligibility(
      evalInput(after, { verifiedGoldline: eligibility.verifiedGoldline })
    );
    const replayAuth = issueEligibilityAuthorizations(
      replay,
      evalInput(after, { verifiedGoldline: eligibility.verifiedGoldline })
    ).find(auth => auth.beatId === BEAT_IDS.M03);
    expect(replayAuth).toBeUndefined();
    await expect(
      commitAuthorizedBeat({
        store,
        scope,
        authorization,
        eligibility: evalInput(after, {
          verifiedGoldline: eligibility.verifiedGoldline,
        }),
      })
    ).rejects.toBeInstanceOf(IneligibleBeatCommitError);
    expect((await store.load(scope))?.ledger).toHaveLength(1);
  });

  it("lets Quiet close forward possibility without minting facts or rewriting events", async () => {
    const { snapshot } = await seeded();
    const closed = applyQuietClose(snapshot.narrativeState, "M03", true);
    expect(closed.closedForwardPaths).toEqual(["M03"]);
    expect(closed.values.m03).toBe("ARMED");
    expect(snapshot.ledger).toEqual([]);
    expect(snapshot.knowledge.planes.PLAYER.knownFactIds).toEqual([]);

    const aged = applyElapsedTime(
      { ...closed, holdOpenedAtMs: { m04_hold: 0 } },
      10_000,
      [
        {
          key: "m04_hold",
          durationMs: null,
          pathId: "M04",
          canonStatus: "WORKING",
        },
      ]
    );
    expect(aged.createdEvents).toBe(false);
    expect(aged.state.closedForwardPaths).toEqual(["M03"]);
  });

  it("time-ages an authored HOLD window and still creates no events", () => {
    const aged = applyElapsedTime(
      {
        values: {},
        closedForwardPaths: [],
        holdOpenedAtMs: { m04_hold: 0 },
      },
      5_000,
      [
        {
          key: "m04_hold",
          durationMs: 1_000,
          pathId: "M04",
          canonStatus: "LOCKED",
        },
      ]
    );
    expect(aged.createdEvents).toBe(false);
    expect(aged.state.closedForwardPaths).toEqual(["M04"]);
  });

  it("reality firewall: unverified evidence cannot satisfy Goldline gates", async () => {
    const { snapshot } = await seeded();
    expect(
      isLegalEligibilityGoldlineEvidence({
        verificationClass: "CLAIMED",
        evidenceClass: "operator_attested",
      })
    ).toBe(false);
    const m03 = evaluateEligibility(evalInput(snapshot)).audit.find(
      entry => entry.beatId === BEAT_IDS.M03
    )!;
    expect(m03.pass).toBe(false);
    expect(getBeat("M03").eligibilityConditions).toContainEqual({
      kind: "never_manufacture",
      claim: "rejection",
    });
    expect(
      evaluateEligibility(evalInput(snapshot)).audit.find(
        entry => entry.beatId === BEAT_IDS.C08
      )?.pass
    ).toBe(false);
  });

  it("audits every candidate with gates, not hidden reasoning", async () => {
    const { snapshot } = await seeded();
    const result = evaluateEligibility(evalInput(snapshot));
    expect(result.audit).toHaveLength(AUTHORED_BEATS.length);
    for (const entry of result.audit) {
      expect(entry.candidateConsidered).toBe(true);
      expect(entry.beatId).toBeTruthy();
      expect(["LOCKED", "WORKING", "OPEN"]).toContain(entry.canonStatus);
      expect(["COMPLETE", "INCOMPLETE"]).toContain(entry.eligibilityDefinition);
      expect(
        entry.finalOutcome === "pass" || entry.finalOutcome === "fail"
      ).toBe(true);
    }
  });

  it("records verified Goldline outcomes on the ledger when explicitly relevant", async () => {
    const { store } = await seeded();
    await recordVerifiedGoldlineOutcome({
      store,
      scope,
      outcomeId: "spoken_no",
      evidenceRef: {
        sourceType: "field_visit",
        sourceReference: "visit:1",
        classification: "operator_attested",
      },
      relatedBeatId: BEAT_IDS.M03,
    });
    const loaded = await store.load(scope);
    expect(loaded?.ledger).toHaveLength(1);
    expect(loaded?.ledger[0]?.kind).toBe("VERIFIED_GOLDLINE_OUTCOME");
    expect(loaded?.ledger[0]?.goldlineOutcomeId).toBe("spoken_no");
  });

  it("wraps drizzle knowledge replace and atomic commit in a transaction", () => {
    const src = readFileSync(
      resolve(process.cwd(), "server/narratorOs/drizzleStore.ts"),
      "utf8"
    );
    expect(src).toMatch(/async replaceKnowledge[\s\S]*db\.transaction/);
    expect(src).toMatch(/async commitAtomic[\s\S]*db\.transaction/);
  });
});

describe("Narrator OS brain boundary", () => {
  it("does not import Brain V2 or write goldline world events", () => {
    const files = [
      "server/narratorOs/eligibility.ts",
      "server/narratorOs/ledger.ts",
      "server/narratorOs/init.ts",
      "server/narratorOs/drizzleStore.ts",
      "server/narratorOs/registry.ts",
    ];
    for (const file of files) {
      const src = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/server\/claire\/brain/);
      expect(src).not.toMatch(/goldlineWorldEvents/);
      expect(src).not.toMatch(/workingMemoryGate/);
    }
  });
});
