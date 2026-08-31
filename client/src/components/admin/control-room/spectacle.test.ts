import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  adoptWithoutSpectacle,
  chargeFraction,
  dischargePlan,
  magnitudeWeight,
  markSeen,
  readSeenCursor,
  spectacleMagnitude,
  unseenEventIds,
  writeSeenCursor,
  projectLiveEvent,
  resetSessionSeenCursorForTests,
} from "./spectacle";
import { IMPACT_CLASSES } from "@shared/impactSignal";
import { initialTowerWarsState } from "@shared/towerWars";

describe("magnitude is a pure function of impact class", () => {
  it("covers every rung of the honesty ladder", () => {
    for (const cls of IMPACT_CLASSES) {
      expect(spectacleMagnitude(cls)).toBeTruthy();
    }
  });

  it("never lets effort animate like an outcome", () => {
    // A door knock must not detonate like a paid order.
    expect(magnitudeWeight(spectacleMagnitude("field_activity"))).toBeLessThan(
      magnitudeWeight(spectacleMagnitude("economic_outcome"))
    );
    expect(spectacleMagnitude("observation")).toBe("whisper");
    expect(spectacleMagnitude("field_activity")).toBe("whisper");
    expect(spectacleMagnitude("economic_outcome")).toBe("detonation");
  });

  it("rises monotonically with the ladder", () => {
    const weights = IMPACT_CLASSES.map(c =>
      magnitudeWeight(spectacleMagnitude(c))
    );
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeGreaterThanOrEqual(weights[i - 1]!);
    }
  });
});

describe("only genuinely unseen events earn spectacle", () => {
  it("treats a refetch of the same ledger as nothing new", () => {
    const ledger = ["e1", "e2", "e3"];
    let cursor = { seen: ["e0"] };
    const first = adoptWithoutSpectacle(ledger, cursor);
    expect(first.play).toEqual(ledger);
    cursor = first.cursor;
    // Same data arriving again — a refresh is not an event.
    const second = adoptWithoutSpectacle(ledger, cursor);
    expect(second.play).toEqual([]);
  });

  it("plays only the new tail when the ledger grows", () => {
    let cursor = markSeen(["e1", "e2"], { seen: ["seed"] });
    const { play } = adoptWithoutSpectacle(["e1", "e2", "e3", "e4"], cursor);
    expect(play).toEqual(["e3", "e4"]);
  });

  it("does not detonate the whole day on a cold first load", () => {
    // Opening Tower Wars at 4pm must not replay every order since breakfast.
    const { play, cursor } = adoptWithoutSpectacle(["a", "b", "c"], { seen: [] });
    expect(play).toEqual([]);
    expect(cursor.seen).toEqual(["a", "b", "c"]);
  });

  it("preserves the order reality produced", () => {
    expect(unseenEventIds(["c", "a", "b"], { seen: ["a"] })).toEqual(["c", "b"]);
  });

  it("never plays the same event twice within one batch", () => {
    expect(unseenEventIds(["x", "x", "y"], { seen: [] })).toEqual(["x", "y"]);
  });
});

describe("the seen cursor is presentation, never truth", () => {
  function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: k => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: k => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    } as unknown as Storage;
  }

  it("round-trips through this viewer's own storage", () => {
    const s = memoryStorage();
    writeSeenCursor({ seen: ["e1", "e2"] }, s);
    expect(readSeenCursor(s).seen).toEqual(["e1", "e2"]);
  });

  it("degrades to replaying nothing when storage is unavailable", () => {
    resetSessionSeenCursorForTests();
    const hostile = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(readSeenCursor(hostile)).toEqual({ seen: [] });
    expect(() => writeSeenCursor({ seen: ["a"] }, hostile)).not.toThrow();
    resetSessionSeenCursorForTests();
  });

  it("keeps an in-memory cursor when storage is unavailable", () => {
    resetSessionSeenCursorForTests();
    const hostile = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } as unknown as Storage;
    const adopted = markSeen(["A", "B"], readSeenCursor(hostile));
    writeSeenCursor(adopted, hostile);
    expect(unseenEventIds(["A", "B"], readSeenCursor(hostile))).toEqual([]);
    expect(unseenEventIds(["A", "B", "C"], readSeenCursor(hostile))).toEqual(["C"]);
    expect(unseenEventIds(["A", "B"], readSeenCursor(hostile))).toEqual([]);
    resetSessionSeenCursorForTests();
  });

  it("is never sent to the server", () => {
    const src = readFileSync(new URL("./spectacle.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/fetch\(|trpc\.|mutation/);
  });
});

describe("the weapon charge makes the threshold visible", () => {
  const T = 5000;

  it("fills toward the next strike", () => {
    expect(chargeFraction(0, T)).toBe(0);
    expect(chargeFraction(2500, T)).toBeCloseTo(0.5);
    expect(chargeFraction(5000, T)).toBe(1);
  });

  it("clamps rather than overflowing", () => {
    expect(chargeFraction(9999, T)).toBe(1);
    expect(chargeFraction(-100, T)).toBe(0);
  });

  it("lets a non-firing order still resolve", () => {
    // $10 charged + a $20 order = $30 charged, no shot. Without a visible charge
    // the user sees money arrive and nothing happen, and reads it as a bug.
    const plan = dischargePlan({
      chargedBeforeCents: 1000,
      orderValueCents: 2000,
      thresholdCents: T,
    });
    expect(plan.strikes).toBe(0);
    expect(plan.remainderCents).toBe(3000);
  });

  it("preserves cardinality when one order crosses twice", () => {
    // ONE revenue arrival, then two discharges, then $25 left charged.
    const plan = dischargePlan({
      chargedBeforeCents: 0,
      orderValueCents: 12500,
      thresholdCents: T,
    });
    expect(plan.strikes).toBe(2);
    expect(plan.remainderCents).toBe(2500);
  });

  it("carries prior charge into the crossing", () => {
    const plan = dischargePlan({
      chargedBeforeCents: 4000,
      orderValueCents: 2000,
      thresholdCents: T,
    });
    expect(plan.strikes).toBe(1);
    expect(plan.remainderCents).toBe(1000);
  });
});

describe("live event causal projection", () => {
  const event = {
    eventId: "real:125",
    occurredAt: "2026-08-30T18:00:00.000Z",
    businessDate: "2026-08-30",
    buildingId: "century_park_east" as const,
    buildingDisplayName: "Century Park East",
    orderId: 125,
    customerIdentity: "customer:1",
    customerDisplayName: "Resident",
    customerPhone: null,
    revenueSource: "stripe" as const,
    realOrderValueCents: 12500,
    sourceEvidence: {},
  };

  it("shows one revenue arrival followed by exactly two truthful discharges", () => {
    const prior = initialTowerWarsState();
    const arrival = projectLiveEvent({ prior, event, revealedDischarges: 0, thresholdCents: 5000 });
    expect(arrival.state.buildings.century_park_east.revenueCents).toBe(12500);
    expect(arrival.state.buildings.century_park_east.attackCount).toBe(0);
    expect(arrival.totalDischarges).toBe(2);
    const first = projectLiveEvent({ prior, event, revealedDischarges: 1, thresholdCents: 5000 });
    expect(first.state.buildings.century_park_east.attackCount).toBe(1);
    expect(first.state.buildings.opus_la.incomingAttackCount).toBe(1);
    const second = projectLiveEvent({ prior, event, revealedDischarges: 2, thresholdCents: 5000 });
    expect(second.state.buildings.century_park_east.attackCount).toBe(2);
    expect(second.state.buildings.century_park_east.unspentValueCents).toBe(2500);
    expect(second.state.buildings.opus_la.incomingAttackCount).toBe(2);
  });
});

describe("the charge is drawn in art space, not piece space", () => {
  const art = readFileSync(
    new URL("./CanonicalBuildingArt.tsx", import.meta.url),
    "utf8"
  );
  const css = readFileSync(
    new URL("./admin-control-room.css", import.meta.url),
    "utf8"
  );

  it("letterboxes with every other layer", () => {
    // A CSS-percentage version floated above the building: the weapon element
    // fills the piece box while the art is contain-fitted inside it.
    expect(art).toContain('preserveAspectRatio="xMidYMax meet"');
    expect(art).toContain("viewBox={`0 0 ${ART_SPACE.width} ${ART_SPACE.height}`}");
    expect(css).not.toMatch(/\.cb-weapon:after\{[^}]*top:var\(--cb-pivot-y/);
  });

  it("sites the meter at the weapon's own mount", () => {
    expect(art).toContain("BUILDING_ART[buildingId].weaponGeometry");
    expect(art).toContain("pivot.x - W / 2");
  });

  it("shows nothing at all when there is no charge", () => {
    expect(art).toContain("if (value <= 0) return null;");
  });
});
