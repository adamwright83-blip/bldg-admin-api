import { describe, expect, it } from "vitest";
import {
  currentLocalTargetRunTarget,
  decodeLocalTargetRunPayload,
  encodeLocalTargetRunPayload,
  localTargetRunIsComplete,
  localTargetRunProgressLabel,
  localTargetRunVisitedCount,
  simulatedLocalTargetRunTargets,
  SIMULATED_DRY_CLEANER_TARGETS,
  type LocalTargetRunPayload,
} from "./localTargetRun";

function payload(overrides: Partial<LocalTargetRunPayload> = {}): LocalTargetRunPayload {
  return {
    kind: "local_target_run",
    action: "visit",
    targetQuery: "dry cleaner",
    requestedCount: 10,
    purpose: "referral partnership",
    geographicAnchorLabel: "your current location",
    sourcingStatus: "sourced",
    simulated: false,
    sourcedTargets: [
      {
        id: "places:a",
        name: "A Cleaners",
        address: "1 Main St",
        lat: 1,
        lng: 1,
        website: null,
        phone: null,
        navigationUrl: "https://maps.google.com/?q=a",
        simulated: false,
      },
      {
        id: "places:b",
        name: "B Cleaners",
        address: "2 Main St",
        lat: 2,
        lng: 2,
        website: null,
        phone: null,
        navigationUrl: "https://maps.google.com/?q=b",
        simulated: false,
      },
    ],
    visitedTargetIds: [],
    ...overrides,
  };
}

describe("encode/decode round trip", () => {
  it("decodes exactly what was encoded", () => {
    const original = payload();
    const decoded = decodeLocalTargetRunPayload(encodeLocalTargetRunPayload(original));
    expect(decoded).toEqual(original);
  });

  it("returns null for an ordinary task's free-text detail", () => {
    expect(decodeLocalTargetRunPayload("Call the landlord about the lease renewal.")).toBeNull();
  });

  it("returns null for malformed JSON rather than throwing", () => {
    expect(() => decodeLocalTargetRunPayload("{not json")).not.toThrow();
    expect(decodeLocalTargetRunPayload("{not json")).toBeNull();
  });

  it("returns null for JSON that isn't a target-run payload", () => {
    expect(decodeLocalTargetRunPayload('{"kind":"something_else"}')).toBeNull();
    expect(decodeLocalTargetRunPayload('{"title":"unrelated"}')).toBeNull();
  });
});

describe("progress projection (§PR77 Part 14/20 gate J)", () => {
  it("current target is the first unvisited one, in sourced order", () => {
    const p = payload();
    expect(currentLocalTargetRunTarget(p)?.id).toBe("places:a");
  });

  it("advances to the next target once the current one is visited", () => {
    const p = payload({ visitedTargetIds: ["places:a"] });
    expect(currentLocalTargetRunTarget(p)?.id).toBe("places:b");
  });

  it("no current target once every sourced target is visited", () => {
    const p = payload({ visitedTargetIds: ["places:a", "places:b"] });
    expect(currentLocalTargetRunTarget(p)).toBeNull();
    expect(localTargetRunProgressLabel(p)).toBeNull();
  });

  it("progress label is real visited count over real sourced count, not requestedCount", () => {
    // Only 2 sourced though 10 were requested — the label must say 0 OF 2,
    // never 0 OF 10 (that would silently promise ten real targets exist).
    const p = payload();
    expect(localTargetRunProgressLabel(p)).toBe("TARGET 1 OF 2");
    expect(localTargetRunVisitedCount(p)).toBe(0);
  });

  it("visited count ignores ids that don't belong to this run's sourced targets", () => {
    const p = payload({ visitedTargetIds: ["places:a", "places:not-in-this-run"] });
    expect(localTargetRunVisitedCount(p)).toBe(1);
  });

  it("is complete only once every sourced target has been visited", () => {
    expect(localTargetRunIsComplete(payload())).toBe(false);
    expect(
      localTargetRunIsComplete(payload({ visitedTargetIds: ["places:a"] }))
    ).toBe(false);
    expect(
      localTargetRunIsComplete(payload({ visitedTargetIds: ["places:a", "places:b"] }))
    ).toBe(true);
  });

  it("is never complete with zero sourced targets — nothing to be complete about", () => {
    expect(localTargetRunIsComplete(payload({ sourcedTargets: [] }))).toBe(false);
  });
});

describe("labeled simulation fallback (Adam's road-testing rail)", () => {
  it("produces exactly ten targets, every one clearly marked simulated", () => {
    const targets = simulatedLocalTargetRunTargets();
    expect(targets).toHaveLength(10);
    expect(targets.every(target => target.simulated)).toBe(true);
  });

  it("every simulated target has an un-routable, deliberately fake address", () => {
    const targets = simulatedLocalTargetRunTargets();
    for (const target of targets) {
      expect(target.lat).toBeNull();
      expect(target.lng).toBeNull();
      expect(target.address).toMatch(/Nowhere, ZZ 00000/);
    }
  });

  it("NAVIGATE still opens Google Maps — it just cannot route — the point of the signal", () => {
    const targets = simulatedLocalTargetRunTargets();
    for (const target of targets) {
      expect(target.navigationUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
    }
  });

  it("ids are stable and unique across the fixed set", () => {
    const targets = simulatedLocalTargetRunTargets();
    const ids = new Set(targets.map(target => target.id));
    expect(ids.size).toBe(10);
  });

  it("the known fixture list is exactly ten entries (hardcoded, not generated)", () => {
    expect(SIMULATED_DRY_CLEANER_TARGETS).toHaveLength(10);
  });
});
