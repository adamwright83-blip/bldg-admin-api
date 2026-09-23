import { describe, expect, it } from "vitest";
import { colosseumKingdomBindingSatisfied, colosseumLeadHuntDefinition } from "./colosseumKingdomBinding";
import {
  attemptRecordCompanionRookOwned,
  attemptRecordKingdomBrassRepublicCompleted,
  attemptRecordLevelColosseumResolved,
  GOLDLINE_DOMAIN_PROGRESSION_MIGRATION,
  ProgressionForgeError,
  ProgressionNotPermittedError,
  ProgressionSchemaBlockedError,
  projectGoldlineProgression,
} from "./progressionContract";

const TARGETS = () => [...(colosseumLeadHuntDefinition()?.targetIds ?? [])];

function outcomesFor(ids: string[]): Record<string, unknown> {
  return Object.fromEntries(ids.map(id => [id, "pitched"]));
}

function project(outcomes: Record<string, unknown> | null, available = true, capability = false) {
  return projectGoldlineProgression({
    tenantId: "tenant-a",
    operatorId: "op-a",
    outcomes,
    outcomesAvailable: available,
    capabilityRookContactGranted: capability,
    capabilityRookContactReadable: true,
  });
}

describe("colosseumKingdomBindingSatisfied", () => {
  it("is satisfied only when every Greystar Koreatown lead-hunt target has an outcome", () => {
    const ids = TARGETS();
    expect(ids).toHaveLength(5);
    expect(colosseumKingdomBindingSatisfied(outcomesFor(ids))).toBe(true);
    expect(colosseumKingdomBindingSatisfied(outcomesFor(ids.slice(0, 4)))).toBe(false);
    expect(colosseumKingdomBindingSatisfied(outcomesFor(["other-building", "another-building"]))).toBe(false);
    expect(colosseumKingdomBindingSatisfied({ "kingdom-1-colosseum": "complete" })).toBe(false);
  });
});

describe("progression read contract", () => {
  it("does not resolve the level, own Rook, or complete Brass Republic when the binding is satisfied", () => {
    const read = project(outcomesFor(TARGETS()));
    expect(read.kingdomBinding.status).toBe("satisfied");
    expect(read.kingdomBinding.function).toBe("colosseumKingdomBindingSatisfied");
    expect(read.levelColosseumResolved.value).toBe(false);
    expect(read.levelColosseumResolved.status).toBe("unrecorded");
    expect(read.companionRookOwned.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.impliedByLevelColosseum).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.impliedByStoredKingdomRow).toBe(false);
    expect(read.overworldUnlocks.flags).toEqual({});
    expect(read.schema.migration.label).toBe(GOLDLINE_DOMAIN_PROGRESSION_MIGRATION.label);
  });

  it("keeps capability.rook.contact from granting companion.rook", () => {
    const read = project(outcomesFor(TARGETS()), true, true);
    expect(read.capabilityRookContact.granted).toBe(true);
    expect(read.capabilityRookContact.grantsCompanionOwnership).toBe(false);
    expect(read.capabilityRookContact.implementationCapabilityId).toBe("rook.outreach_drafting");
    expect(read.companionRookOwned.value).toBe(false);
  });

  it("stays uncertain when outcome evidence is unavailable and does not invent completion", () => {
    const read = project(null, false);
    expect(read.kingdomBinding.status).toBe("uncertain");
    expect(read.levelColosseumResolved.value).toBe(false);
    expect(read.kingdomBrassRepublicCompleted.value).toBe(false);
    expect(read.companionRookOwned.value).toBe(false);
  });

  it("rejects a local-only Rook or client resolved flag instead of promoting it", () => {
    expect(() =>
      projectGoldlineProgression({
        tenantId: "tenant-a",
        operatorId: "op-a",
        outcomes: outcomesFor(TARGETS()),
        outcomesAvailable: true,
        capabilityRookContactGranted: false,
        capabilityRookContactReadable: true,
        rookOwned: true,
      } as never)
    ).toThrow(ProgressionForgeError);
  });

  it("returns the same unrecorded Rook when read twice, with no client storage input", () => {
    const first = project({});
    const second = project({});
    expect(first.companionRookOwned).toEqual(second.companionRookOwned);
    expect(first.localStorage).toBe("cache_and_present_only");
    expect(first.companionRookOwned.value).toBe(false);
  });
});

describe("progression write boundary", () => {
  const satisfied = { outcomes: outcomesFor(TARGETS()), outcomesAvailable: true };

  it("refuses a client forge before any durable write", () => {
    expect(() => attemptRecordLevelColosseumResolved({ ...satisfied, clientPayload: { resolved: true } })).toThrow(
      ProgressionForgeError
    );
    expect(() => attemptRecordCompanionRookOwned({ ...satisfied, clientPayload: { rookOwned: true } })).toThrow(
      ProgressionForgeError
    );
    expect(() =>
      attemptRecordKingdomBrassRepublicCompleted({ ...satisfied, clientPayload: { kingdomComplete: true } })
    ).toThrow(ProgressionForgeError);
  });

  it("blocks level and Rook records on the named migration and does not complete Brass Republic", () => {
    expect(() => attemptRecordLevelColosseumResolved(satisfied)).toThrow(ProgressionSchemaBlockedError);
    expect(() => attemptRecordCompanionRookOwned(satisfied)).toThrow(ProgressionSchemaBlockedError);
    expect(() => attemptRecordKingdomBrassRepublicCompleted(satisfied)).toThrow(ProgressionNotPermittedError);
    try {
      attemptRecordLevelColosseumResolved(satisfied);
    } catch (error) {
      expect(error).toBeInstanceOf(ProgressionSchemaBlockedError);
      expect((error as ProgressionSchemaBlockedError).migrationLabel).toBe("CREATE TABLE goldline_domain_progression");
    }
  });

  it("is idempotent: a second attempt raises the same refusal and still does not complete the kingdom", () => {
    const once = () => attemptRecordLevelColosseumResolved(satisfied);
    const twice = () => attemptRecordLevelColosseumResolved(satisfied);
    expect(once).toThrow(ProgressionSchemaBlockedError);
    expect(twice).toThrow(ProgressionSchemaBlockedError);
    expect(() => attemptRecordKingdomBrassRepublicCompleted(satisfied)).toThrow(ProgressionNotPermittedError);
    expect(() => attemptRecordKingdomBrassRepublicCompleted(satisfied)).toThrow(ProgressionNotPermittedError);
  });

  it("does not permit resolution when the binding is short", () => {
    expect(() =>
      attemptRecordLevelColosseumResolved({ outcomes: outcomesFor(TARGETS().slice(0, 4)), outcomesAvailable: true })
    ).toThrow(ProgressionNotPermittedError);
    expect(() =>
      attemptRecordCompanionRookOwned({ outcomes: {}, outcomesAvailable: true })
    ).toThrow(ProgressionNotPermittedError);
  });
});
