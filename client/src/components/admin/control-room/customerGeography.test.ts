import { describe, expect, it } from "vitest";
import { clusterGeographicCustomers, type GeographicCustomer } from "./customerGeography";

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
