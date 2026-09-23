import { describe, expect, it } from "vitest";
import { COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } from "../../shared/colosseumAuthoredFinale";
import { overworldPostRookOpen } from "../../shared/goldlineDomainProgression";
import {
  colosseumKingdomBindingNewlySatisfied,
  colosseumKingdomBindingSatisfied,
  colosseumLeadHuntDefinition,
} from "./colosseumKingdomBinding";
import {
  assertCompanionRookRecordPermitted,
  assertLevelColosseumRecordPermitted,
  attemptRecordKingdomBrassRepublicCompleted,
  ProgressionForgeError,
  ProgressionNotPermittedError,
  projectGoldlineProgression,
} from "./progressionContract";

const TARGETS = () => [...(colosseumLeadHuntDefinition()?.targetIds ?? [])];

function outcomesFor(ids: string[]): Record<string, unknown> {
  return Object.fromEntries(ids.map(id => [id, "pitched"]));
}

function project(
  outcomes: Record<string, unknown> | null,
  available = true,
  stored?: Parameters<typeof projectGoldlineProgression>[0]["stored"],
  capability = false
) {
  return projectGoldlineProgression({
    tenantId: "tenant-a",
    operatorId: "op-a",
    outcomes,
    outcomesAvailable: available,
    capabilityRookContactGranted: capability,
    capabilityRookContactReadable: true,
    stored,
  });
}

describe("colosseumKingdomBindingSatisfied", () => {
  it("is satisfied only when every Greystar Koreatown lead-hunt target has an outcome", () => {
    const ids = TARGETS();
    expect(ids).toHaveLength(5);
    expect(colosseumKingdomBindingSatisfied(outcomesFor(ids))).toBe(true);
    expect(colosseumKingdomBindingSatisfied(outcomesFor(ids.slice(0, 4)))).toBe(false);
    expect(colosseumKingdomBindingSatisfied(outcomesFor(["other-building"]))).toBe(false);
    expect(colosseumKingdomBindingSatisfied({ "kingdom-1-colosseum": "complete" })).toBe(false);
  });

  it("records only the transition into satisfied, not an already-complete hunt", () => {
    const ids = TARGETS();
    const four = outcomesFor(ids.slice(0, 4));
    const all = outcomesFor(ids);
    expect(colosseumKingdomBindingNewlySatisfied(four, all)).toBe(true);
    expect(colosseumKingdomBindingNewlySatisfied(all, all)).toBe(false);
    expect(colosseumKingdomBindingNewlySatisfied(four, four)).toBe(false);
  });
});

describe("progression read contract", () => {
  it("keeps a satisfied binding unearned when no progression row exists", () => {
    const read = project(outcomesFor(TARGETS()));
    expect(read.kingdomBinding.status).toBe("satisfied");
    expect(read.levelColosseumResolved).toEqual({ status: "unearned", value: false });
    expect(read.companionRookOwned).toEqual({ status: "unearned", value: false });
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.status).toBe("unearned");
    expect(read.kingdomBrassRepublicCompleted.impliedByLevelColosseum).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.impliedByStoredKingdomRow).toBe(false);
    expect(read.overworldUnlocks.flags.postRook).toBe(false);
  });

  it("does not complete Brass Republic or open post-Rook when only the level is earned", () => {
    const read = project(outcomesFor(TARGETS()), true, {
      readable: true,
      row: {
        levelColosseumResolvedAt: new Date("2026-09-23T00:00:00.000Z"),
        companionRookOwnedAt: null,
        kingdomBrassRepublicCompletedAt: null,
      },
    });
    expect(read.levelColosseumResolved).toEqual({ status: "earned", value: true });
    expect(read.companionRookOwned.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(read.overworldUnlocks.flags.postRook).toBe(false);
    expect(overworldPostRookOpen(read)).toBe(false);
  });

  it("opens post-Rook only when both server values are earned", () => {
    const read = project(outcomesFor(TARGETS()), true, {
      readable: true,
      row: {
        levelColosseumResolvedAt: new Date("2026-09-23T00:00:00.000Z"),
        companionRookOwnedAt: new Date("2026-09-23T01:00:00.000Z"),
        kingdomBrassRepublicCompletedAt: null,
      },
    });
    expect(read.levelColosseumResolved.value).toBe(true);
    expect(read.companionRookOwned.value).toBe(true);
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(overworldPostRookOpen(read)).toBe(true);
    expect(overworldPostRookOpen(null)).toBe(false);
    expect(overworldPostRookOpen({
      levelColosseumResolved: { value: true },
      companionRookOwned: { value: false },
    })).toBe(false);
  });

  it("keeps an unreadable row unknown and unearned", () => {
    const read = project(null, false, { readable: false });
    expect(read.kingdomBinding.status).toBe("uncertain");
    expect(read.levelColosseumResolved).toEqual({ status: "uncertain", value: false });
    expect(read.companionRookOwned.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(overworldPostRookOpen(read)).toBe(false);
  });

  it("keeps capability.rook.contact from granting companion.rook", () => {
    const read = project({}, true, undefined, true);
    expect(read.capabilityRookContact.granted).toBe(true);
    expect(read.capabilityRookContact.grantsCompanionOwnership).toBe(false);
    expect(read.companionRookOwned.value).toBe(false);
  });

  it("rejects a local-only Rook or client resolved flag instead of promoting it", () => {
    expect(() =>
      projectGoldlineProgression({
        tenantId: "tenant-a",
        operatorId: "op-a",
        outcomes: {},
        outcomesAvailable: true,
        capabilityRookContactGranted: false,
        capabilityRookContactReadable: true,
        rookOwned: true,
      } as never)
    ).toThrow(ProgressionForgeError);
  });
});

describe("progression write gates", () => {
  const satisfied = { outcomes: outcomesFor(TARGETS()), outcomesAvailable: true };

  it("refuses a client forge before either write", () => {
    expect(() => assertLevelColosseumRecordPermitted({ ...satisfied, clientPayload: { resolved: true } })).toThrow(
      ProgressionForgeError
    );
    expect(() =>
      assertCompanionRookRecordPermitted({
        ...satisfied,
        levelColosseumResolvedAt: new Date(),
        clientPayload: { rookOwned: true },
      })
    ).toThrow(ProgressionForgeError);
    expect(() =>
      attemptRecordKingdomBrassRepublicCompleted({ ...satisfied, clientPayload: { kingdomComplete: true } })
    ).toThrow(ProgressionForgeError);
  });

  it("does not permit the level write when the binding is short, or Rook before the level row", () => {
    expect(() =>
      assertLevelColosseumRecordPermitted({ outcomes: outcomesFor(TARGETS().slice(0, 4)), outcomesAvailable: true })
    ).toThrow(ProgressionNotPermittedError);
    expect(() =>
      assertCompanionRookRecordPermitted({
        ...satisfied,
        levelColosseumResolvedAt: null,
        authoredConsequence: COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE,
      })
    ).toThrow(/level\.colosseum/);
  });

  it("does not treat a resolved level or five visits as the authored finale", () => {
    expect(() =>
      assertCompanionRookRecordPermitted({
        ...satisfied,
        levelColosseumResolvedAt: new Date(),
      })
    ).toThrow(/authored Clockhead finale/);
    expect(() =>
      assertCompanionRookRecordPermitted({
        ...satisfied,
        levelColosseumResolvedAt: new Date(),
        authoredConsequence: "rookOwned",
      })
    ).toThrow(ProgressionNotPermittedError);
    expect(() =>
      assertCompanionRookRecordPermitted({
        outcomes: outcomesFor(TARGETS().slice(0, 4)),
        outcomesAvailable: true,
        levelColosseumResolvedAt: new Date(),
        authoredConsequence: COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE,
      })
    ).toThrow(/not satisfied/);
    expect(() =>
      assertCompanionRookRecordPermitted({
        ...satisfied,
        levelColosseumResolvedAt: new Date(),
        authoredConsequence: COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE,
      })
    ).not.toThrow();
  });

  it("never permits kingdom.brass_republic completion from the Colosseum binding", () => {
    expect(() => attemptRecordKingdomBrassRepublicCompleted(satisfied)).toThrow(ProgressionNotPermittedError);
    expect(() => attemptRecordKingdomBrassRepublicCompleted(satisfied)).toThrow(ProgressionNotPermittedError);
  });
});
