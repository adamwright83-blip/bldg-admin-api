import type { GeographicCustomer } from "../customerGeography";

// Dev-only: the local visual-test build has no database, so it shows sample customers instead of
// an empty board. Never used in a production build.
export function devSampleCustomers(): GeographicCustomer[] {
  if (!import.meta.env.DEV) return [];
  const spots: [number, number, number][] = [
    [34.0906, -118.2766, 5], [34.0851, -118.2703, 3], [34.0985, -118.3265, 4], [34.1012, -118.3389, 2],
    [34.059, -118.4145, 1], [34.0612, -118.3009, 3], [34.0578, -118.2963, 2], [34.088, -118.298, 1], [34.1052, -118.2885, 1],
    [34.0874, -118.3697, 1], [34.0654, -118.4006, 1],
  ];
  let n = 0, seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const out: GeographicCustomer[] = [];
  for (const [lat, lng, count] of spots) {
    for (let i = 0; i < count; i++) {
      n++;
      const state = rnd() < 0.7 ? "active" : rnd() < 0.6 ? "dimming" : "dark";
      out.push({
        identityKey: `dev-sample-${n}`,
        displayName: `Sample Customer ${n}`,
        phone: null,
        totalOrders: 1 + Math.floor(rnd() * 30),
        totalSpendCents: Math.round((60 + rnd() * 4800) * 100),
        lastOrderAt: new Date(Date.now() - rnd() * 60 * 86400000).toISOString(),
        cadence: { state, daysSinceLastOrder: Math.floor(rnd() * 60) },
        location: { latitude: lat + (rnd() - 0.5) * 0.004, longitude: lng + (rnd() - 0.5) * 0.005, x: 0, y: 0, outOfBounds: false, canonicalAddress: `Sample address ${n}` },
      });
    }
  }
  // a few sample residents of our towers, so the tower view has something to show locally
  const towers: [string, string][] = [
    ["3545 Wilshire Blvd", "1507"], ["3545 Wilshire Blvd", "2204"], ["3545 Wilshire Blvd", "812"], ["3650 W 6th St", "902"],
    ["2160 Century Park East", "1804"], ["2170 Century Park East", "1001"], ["3545 Wilshire Blvd", "Lobby"],
  ];
  for (const [address, unit] of towers) {
    n++;
    out.push({
      identityKey: `dev-sample-${n}`, displayName: `Sample Resident ${n}`, phone: null, address, unit,
      cadence: { state: "active", daysSinceLastOrder: 3 }, location: null,
    });
  }
  return out;
}
