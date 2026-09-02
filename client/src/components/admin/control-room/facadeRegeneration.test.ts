import { describe, expect, it } from "vitest";
import {
  HEALED_SCAR_FLOOR,
  ORDERS_TO_CLOSE_ONE_STRATUM,
  datedCollectedOrders,
  projectRegeneration,
  scarOpacityFor,
} from "./facadeRegeneration";
import type { SettledStratum } from "./facadeScars";
import type { DatedCollectedOrder } from "./facadeRegeneration";

const stratum = (businessDate: string): SettledStratum =>
  ({ businessDate, damage: "cracked", strikes: 4 }) as unknown as SettledStratum;

let nextId = 1;
/** A genuinely collected order, dated. */
const collected = (collectedOn: string): DatedCollectedOrder => ({
  id: nextId++,
  status: "collected",
  collectedOn,
});
/** N of them, all on the same day. */
const collectedOn = (day: string, count: number): DatedCollectedOrder[] =>
  Array.from({ length: count }, () => collected(day));

describe("facade regeneration", () => {
  it("does not heal anything without collected orders", () => {
    const projection = projectRegeneration({
      orders: [],
      strata: [stratum("2026-08-30"), stratum("2026-08-31")],
    });
    expect(projection.byStratum.every(item => item.closure === 0)).toBe(true);
    expect(projection.overall).toBe(0);
    expect(projection.hasAuthoritativeRestoration).toBe(false);
  });

  it("closes the oldest wound first", () => {
    const projection = projectRegeneration({
      orders: collectedOn("2026-09-01", ORDERS_TO_CLOSE_ONE_STRATUM),
      strata: [stratum("2026-08-31"), stratum("2026-08-29")],
    });
    // Input order is deliberately newest-first to prove it sorts.
    expect(projection.byStratum[0].businessDate).toBe("2026-08-29");
    expect(projection.byStratum[0].closure).toBe(1);
    expect(projection.byStratum[1].closure).toBe(0);
  });

  it("heals partially — recovery is a process, not a switch", () => {
    const projection = projectRegeneration({
      orders: collectedOn("2026-09-01", 1),
      strata: [stratum("2026-08-29")],
    });
    expect(projection.byStratum[0].closure).toBeCloseTo(
      1 / ORDERS_TO_CLOSE_ONE_STRATUM,
      5
    );
    expect(projection.overall).toBeGreaterThan(0);
    expect(projection.overall).toBeLessThan(1);
  });

  it("never exceeds full closure no matter how many orders land", () => {
    const projection = projectRegeneration({
      orders: collectedOn("2026-09-01", 60),
      strata: [stratum("2026-08-29"), stratum("2026-08-30")],
    });
    expect(projection.byStratum.every(item => item.closure === 1)).toBe(true);
    expect(projection.overall).toBe(1);
  });

  it("is deterministic — a reload cannot reroll how repaired a building looks", () => {
    const input = {
      orders: collectedOn("2026-09-01", 4),
      strata: [stratum("2026-08-29"), stratum("2026-08-30")],
    };
    expect(projectRegeneration(input)).toEqual(projectRegeneration(input));
  });

  it("treats a building with no history as unrecovered, not fully healed", () => {
    const projection = projectRegeneration({
      orders: [],
      strata: [],
    });
    expect(projection.overall).toBe(0);
    expect(projection.hasAuthoritativeRestoration).toBe(false);
  });

  it("ignores rows that are not genuine collected truth", () => {
    const projection = projectRegeneration({
      orders: [
        { id: 91, status: "scheduled", collectedOn: "2026-09-01" },
        { id: 92, status: "cancelled", collectedOn: "2026-09-01" },
      ],
      strata: [stratum("2026-08-29")],
    });
    expect(projection.byStratum[0].closure).toBe(0);
    expect(projection.hasAuthoritativeRestoration).toBe(false);
  });

  it("counts one order once, however many rows mention it", () => {
    const duplicate = { id: 77, status: "collected", collectedOn: "2026-09-01" };
    const projection = projectRegeneration({
      orders: [duplicate, duplicate, duplicate],
      strata: [stratum("2026-08-29")],
    });
    expect(projection.byStratum[0].closure).toBeCloseTo(
      1 / ORDERS_TO_CLOSE_ONE_STRATUM,
      5
    );
  });

  it("spends an order once — one delivery cannot repair the whole facade", () => {
    const projection = projectRegeneration({
      orders: collectedOn("2026-09-01", ORDERS_TO_CLOSE_ONE_STRATUM),
      strata: [stratum("2026-08-29"), stratum("2026-08-30")],
    });
    expect(projection.byStratum[0].closure).toBe(1);
    expect(projection.byStratum[1].closure).toBe(0);
  });

  it("never deletes history — a fully healed scar still reads faintly", () => {
    expect(scarOpacityFor(1)).toBeCloseTo(HEALED_SCAR_FLOOR, 10);
    expect(scarOpacityFor(0)).toBe(1);
    expect(scarOpacityFor(0.5)).toBeGreaterThan(HEALED_SCAR_FLOOR);
    expect(HEALED_SCAR_FLOOR).toBeGreaterThan(0);
  });

  it("clamps closure inputs the renderer might pass out of range", () => {
    expect(scarOpacityFor(-1)).toBe(1);
    expect(scarOpacityFor(4)).toBeCloseTo(HEALED_SCAR_FLOOR, 10);
  });
});

describe("facade regeneration firewall", () => {
  /**
   * The structural half: there is nowhere on the input to put a game result.
   * Asserted on the value so widening the type without widening the test still
   * fails, matching the guard style used for SURVEY reveals.
   */
  it("accepts only order truth and settled history — no gameplay channel", () => {
    const input = { orders: collectedOn("2026-09-01", 3), strata: [stratum("2026-08-29")] };
    expect(Object.keys(input).sort()).toEqual(["orders", "strata"]);
    for (const forbidden of [
      "score",
      "combo",
      "guardianDefeated",
      "towerWarsWon",
      "chapterCompleted",
      "timingGrade",
    ]) {
      expect(forbidden in input).toBe(false);
    }
  });

  it("work delivered BEFORE the damage cannot retroactively heal it", () => {
    // The whole point of the boundary: an order collected in March must not
    // close a wound that was inflicted in August.
    const projection = projectRegeneration({
      orders: collectedOn("2026-03-04", 12),
      strata: [stratum("2026-08-29")],
    });
    expect(projection.byStratum[0].closure).toBe(0);
    expect(projection.hasAuthoritativeRestoration).toBe(false);
  });

  it("a collection on the damage date itself does not heal it", () => {
    const projection = projectRegeneration({
      orders: collectedOn("2026-08-29", 6),
      strata: [stratum("2026-08-29")],
    });
    expect(projection.byStratum[0].closure).toBe(0);
  });

  it("heals only the strata a given collection actually postdates", () => {
    // Collected between the two wounds: repairs the older, not the newer.
    const projection = projectRegeneration({
      orders: collectedOn("2026-08-30", ORDERS_TO_CLOSE_ONE_STRATUM),
      strata: [stratum("2026-08-29"), stratum("2026-08-31")],
    });
    expect(projection.byStratum[0].closure).toBe(1);
    expect(projection.byStratum[1].closure).toBe(0);
  });

  it("a building with damage and no delivered work stays scarred", () => {
    // The Guardian may have fallen and the campaign chapter may have closed.
    // Neither is expressible here, so neither can repair a facade.
    const projection = projectRegeneration({
      orders: [],
      strata: [stratum("2026-08-29"), stratum("2026-08-30")],
    });
    expect(projection.overall).toBe(0);
    expect(scarOpacityFor(projection.byStratum[0].closure)).toBe(1);
  });
});

describe("dating a collection from authoritative pickup evidence", () => {
  const order = (id: number, status: string) => ({ id, status });
  const pickup = (orderId: number, at: string | null) => ({
    orderId,
    sourceEventType: "pickup_completed",
    actualEventTimestamp: at,
  });

  it("dates a collection from the real pickup instant, not the order row", () => {
    const dated = datedCollectedOrders(
      [order(1, "delivered")],
      [pickup(1, "2026-08-30T15:04:00.000Z")]
    );
    // `delivered` proves collection happened; the pickup event says WHEN.
    expect(dated).toEqual([
      { id: 1, status: "delivered", collectedOn: "2026-08-30" },
    ]);
  });

  it("drops an order proven collected but with no trustworthy date", () => {
    // strongholdRestoration would still count this one. Regeneration cannot:
    // it has no way to place it before or after a scar.
    expect(datedCollectedOrders([order(2, "collected")], [])).toEqual([]);
    expect(
      datedCollectedOrders([order(2, "collected")], [pickup(2, null)])
    ).toEqual([]);
  });

  it("ignores events that are not pickup completions", () => {
    const dated = datedCollectedOrders(
      [order(3, "collected")],
      [{ orderId: 3, sourceEventType: "delivery_completed", actualEventTimestamp: "2026-08-30T10:00:00.000Z" }]
    );
    expect(dated).toEqual([]);
  });

  it("takes the earliest pickup when duplicate rows exist", () => {
    const dated = datedCollectedOrders(
      [order(4, "ready")],
      [pickup(4, "2026-09-02T09:00:00.000Z"), pickup(4, "2026-08-28T09:00:00.000Z")]
    );
    expect(dated[0].collectedOn).toBe("2026-08-28");
  });

  it("still excludes orders whose status never proved collection", () => {
    expect(
      datedCollectedOrders([order(5, "scheduled")], [pickup(5, "2026-08-30T10:00:00.000Z")])
    ).toEqual([]);
  });

  it("an undatable collection cannot heal a scar", () => {
    const dated = datedCollectedOrders([order(6, "delivered")], []);
    const projection = projectRegeneration({
      orders: dated,
      strata: [stratum("2026-08-29")],
    });
    expect(projection.overall).toBe(0);
    expect(projection.hasAuthoritativeRestoration).toBe(false);
  });
});

describe("scarred before qualifying work, healed after — the end-to-end shape", () => {
  /** Exactly the row shape `canonicalBuilding.world.restorationEvidence` ships. */
  type ServerRow = {
    orderId: number;
    orderStatus: string;
    actualEventTimestamp: string;
  };
  const fromServer = (rows: ServerRow[]) =>
    datedCollectedOrders(
      rows.map(r => ({ id: r.orderId, status: r.orderStatus })),
      rows.map(r => ({
        orderId: r.orderId,
        sourceEventType: "pickup_completed",
        actualEventTimestamp: r.actualEventTimestamp,
      }))
    );

  const damagedOn = [stratum("2026-08-29")];

  it("a damaged building with no qualifying collection stays fully scarred", () => {
    const before = projectRegeneration({ orders: fromServer([]), strata: damagedOn });
    expect(before.overall).toBe(0);
    expect(scarOpacityFor(before.byStratum[0].closure)).toBe(1);
  });

  it("...stays scarred even when collections exist that PREDATE the damage", () => {
    const stale = projectRegeneration({
      orders: fromServer([
        { orderId: 2, orderStatus: "delivered", actualEventTimestamp: "2026-08-01T10:00:00.000Z" },
      ]),
      strata: damagedOn,
    });
    expect(stale.overall).toBe(0);
    expect(scarOpacityFor(stale.byStratum[0].closure)).toBe(1);
  });

  it("...and visibly heals once real work lands AFTER the damage", () => {
    const after = projectRegeneration({
      orders: fromServer([
        { orderId: 2, orderStatus: "delivered", actualEventTimestamp: "2026-08-01T10:00:00.000Z" },
        { orderId: 1, orderStatus: "delivered", actualEventTimestamp: "2026-09-01T10:00:00.000Z" },
        { orderId: 3, orderStatus: "ready", actualEventTimestamp: "2026-09-02T09:00:00.000Z" },
        { orderId: 4, orderStatus: "processing", actualEventTimestamp: "2026-09-03T09:00:00.000Z" },
      ]),
      strata: damagedOn,
    });
    // Three qualifying post-damage collections close the day completely; the
    // pre-damage one contributed nothing.
    expect(after.byStratum[0].closure).toBe(1);
    expect(after.hasAuthoritativeRestoration).toBe(true);
    // Visibly healed, but the building still remembers being hurt.
    const opacity = scarOpacityFor(after.byStratum[0].closure);
    expect(opacity).toBeLessThan(1);
    expect(opacity).toBeGreaterThan(0);
  });
});
