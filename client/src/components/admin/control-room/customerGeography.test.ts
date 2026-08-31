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
  it("keeps a single customer as a single lantern", () => expect(clusterGeographicCustomers([customer("a", "1 Main St", "active")])[0]?.total).toBe(1));
});
