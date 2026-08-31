import { describe, expect, it } from "vitest";
import { clusterGeographicCustomers, fanOutAtlasCollisions, type GeographicCustomer } from "./customerGeography";

const customer = (id: string, address: string, state: "active" | "dimming" | "dark", lat = 34.0618): GeographicCustomer => ({ identityKey: id, displayName: id, phone: null, cadence: { state, daysSinceLastOrder: 1 }, location: { latitude: lat, longitude: -118.3011, x: 65, y: 63, outOfBounds: false, canonicalAddress: address } });

describe("customer physical geography", () => {
  it("clusters same-building units and preserves mixed health", () => {
    const clusters = clusterGeographicCustomers([customer("a", "3545 Wilshire Blvd Apt 1201", "active"), customer("b", "3545 Wilshire Blvd Unit 1403", "dark"), customer("c", "3545 Wilshire Blvd # 2", "dimming")]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({ total: 3, active: 1, dimming: 1, dark: 1, latitude: 34.0618 });
  });
  it("keeps different physical addresses separate", () => expect(clusterGeographicCustomers([customer("a", "1 Main St", "active"), customer("b", "2 Main St", "active", 34.07)])).toHaveLength(2));
  it("keeps residents of one building on one lantern when the provider varies the unit token and ZIP+4", () => {
    // Shapes Address Validation actually returned in production for one tower.
    const clusters = clusterGeographicCustomers([
      customer("a", "2170 Century Park East, Los Angeles, CA 90067-2243, USA", "active"),
      customer("b", "2170 Century Park East #1209s, Los Angeles, CA 90067-2247, USA", "dimming"),
      customer("c", "3545 Wilshire Boulevard, Los Angeles, CA 90010-4300, USA", "active", 34.0622),
      customer("d", "3545 Wilshire Boulevard apartment 1127, Los Angeles, CA 90010-4313, USA", "active", 34.0622),
    ]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map(cluster => cluster.total).sort()).toEqual([2, 2]);
  });
  it("keeps neighbouring towers apart even though they nearly share a coordinate", () => {
    const clusters = clusterGeographicCustomers([
      customer("a", "2170 Century Park East, Los Angeles, CA 90067-2243, USA", "active", 34.058461),
      customer("b", "2160 Century Park East, Los Angeles, CA 90067-2244, USA", "active", 34.058296),
    ]);
    expect(clusters).toHaveLength(2);
  });
  it("keeps a single customer as a single lantern", () => expect(clusterGeographicCustomers([customer("a", "1 Main St", "active")])[0]?.total).toBe(1));
});

const at = (id: string, address: string, x: number, y: number): GeographicCustomer => ({
  identityKey: id,
  displayName: id,
  phone: null,
  cadence: { state: "active", daysSinceLastOrder: 1 },
  location: { latitude: 34.0618, longitude: -118.3011, x, y, outOfBounds: false, canonicalAddress: address },
});

describe("atlas lantern collision fan-out", () => {
  // The two collisions measured on the deployed atlas.
  const colliding = () =>
    fanOutAtlasCollisions(
      clusterGeographicCustomers([
        at("a", "2170 Century Park East, Los Angeles, CA 90067-2243, USA", 15.53, 66.57),
        at("b", "2160 Century Park East, Los Angeles, CA 90067-2244, USA", 15.6, 66.71),
        at("c", "3545 Wilshire Boulevard, Los Angeles, CA 90010-4300, USA", 65.0, 63.3),
        at("d", "3650 West 6th Street, Los Angeles, CA 90020-3182, USA", 65.07, 62.27),
      ])
    );

  it("gives every colliding pair a distinct slot so neither is buried", () => {
    const fanned = colliding();
    expect(fanned).toHaveLength(4);
    const cpe = fanned.filter(f => /century park east/i.test(f.cluster.canonicalAddress ?? ""));
    const wilshire = fanned.filter(f => !/century park east/i.test(f.cluster.canonicalAddress ?? ""));
    expect(new Set(cpe.map(f => f.fanSlot)).size).toBe(2);
    expect(new Set(wilshire.map(f => f.fanSlot)).size).toBe(2);
  });

  it("leaves each colliding pair one lantern on its true anchor", () => {
    const fanned = colliding();
    const cpeSlots = fanned.filter(f => /century park east/i.test(f.cluster.canonicalAddress ?? "")).map(f => f.fanSlot);
    expect(cpeSlots).toContain(0);
  });

  it("never moves a lantern that has no neighbour", () => {
    const fanned = fanOutAtlasCollisions(
      clusterGeographicCustomers([
        at("a", "1 Main St", 10, 10),
        at("b", "2 Main St", 60, 60),
      ])
    );
    expect(fanned.every(f => f.fanSlot === 0)).toBe(true);
  });

  it("does not alter the underlying geography", () => {
    const fanned = colliding();
    const cpe = fanned.find(f => /2170/.test(f.cluster.canonicalAddress ?? ""))!;
    expect(cpe.cluster.x).toBe(15.53);
    expect(cpe.cluster.y).toBe(66.57);
    expect(cpe.cluster.latitude).toBe(34.0618);
  });

  it("is deterministic across call order", () => {
    const first = colliding().map(f => `${f.cluster.key}:${f.fanSlot}`);
    const second = colliding().map(f => `${f.cluster.key}:${f.fanSlot}`);
    expect(first).toEqual(second);
  });
});
