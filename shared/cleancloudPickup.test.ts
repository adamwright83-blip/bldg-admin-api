import { describe, expect, it } from "vitest";
import { pickupCountsSchema, pickupDirectionsUrl } from "./cleancloudPickup";
describe("driver pickup inputs", () => {
  it("accepts bags, garments or both and rejects empty, fractional and negative counts", () => {
    for (const counts of [
      { bagCount: 2, garmentCount: 0 },
      { bagCount: 0, garmentCount: 5 },
      { bagCount: 2, garmentCount: 3 },
    ])
      expect(pickupCountsSchema.safeParse(counts).success).toBe(true);
    for (const counts of [
      { bagCount: 0, garmentCount: 0 },
      { bagCount: -1, garmentCount: 3 },
      { bagCount: 1.5, garmentCount: 0 },
      { bagCount: 1000, garmentCount: 0 },
    ])
      expect(pickupCountsSchema.safeParse(counts).success).toBe(false);
  });
  it("opens driving directions with an encoded destination and never invents a missing address", () => {
    const address = "42 Example St, Apt #7 & rear entrance";
    const url = new URL(pickupDirectionsUrl(address)!);
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("destination")).toBe(address);
    expect(url.searchParams.get("dir_action")).toBe("navigate");
    expect(url.searchParams.get("travelmode")).toBe("driving");
    expect(pickupDirectionsUrl("  ")).toBeNull();
  });
});
