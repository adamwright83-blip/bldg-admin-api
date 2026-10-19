// Browser seam witness: real React Islands shell and real lazy-loaded painted game.
// The renderer seam is deterministic; production acceptance separately exercises WebGL.
export default function ObjectiveMarksLayer() { return null; }
const customers = [{ identityKey: "fixture-customer", displayName: "Fixture", phone: null,
  cadence: { state: "dark", daysSinceLastOrder: 100 },
  location: { latitude: 34.1, longitude: -118.33, x: 0, y: 0, outOfBounds: false, canonicalAddress: null } }];
export const useAuth = () => ({ user: { role: "admin", openId: "legacy-admin" } });
const fixtureReport = (windowDays: 30 | 90 = 30) => ({
  tenantId: "fixture",
  figuresAreLive: false,
  windowDays,
  periodLabel: windowDays === 30 ? "the last 30 days" : "the last 90 days",
  comparisonLabel: "the previous period",
  status: "ready" as const,
  reason: null,
  geographyBasis: "tenant_location" as const,
  source: {
    bookStatus: "fresh" as const,
    completeness: "complete",
    loadedSources: ["fixture"],
    failedSources: [],
    checkedAt: "2026-10-18T18:00:00.000Z",
    mayStateExact: false,
    notes: ["Fixture source."],
  },
  comparison: {
    mostRecordedRevenue: { territoryId: "hollywood", name: "Hollywood", revenueCents: 12300, evidenceClass: "fresh" },
    steepestDecline: null,
    dormantOpportunities: [],
    insufficient: [{ territoryId: "fixture", name: "Fixture", reason: "These figures are a fixture, not a live book." }],
    withheldReason: null,
  },
  territories: [
    {
      id: "hollywood",
      name: "Hollywood",
      revenueCents: 12300,
      previousRevenueCents: 10000,
      revenueChangeCents: 2300,
      paidOrderCount: 2,
      activeCustomers: 1,
      dormantCustomers: 0,
      locatedCustomers: 1,
      direction: "up" as const,
      directionReliable: true,
      evidenceNote: "Fixture paid orders. Not a live total.",
      customers: [{ identityKey: "fixture-customer", displayName: "Fixture Customer", phone: "3105550100" }],
    },
    {
      id: "silver-lake",
      name: "Silver Lake",
      revenueCents: 4500,
      previousRevenueCents: 4500,
      revenueChangeCents: 0,
      paidOrderCount: 1,
      activeCustomers: 1,
      dormantCustomers: 0,
      locatedCustomers: 1,
      direction: "flat" as const,
      directionReliable: true,
      evidenceNote: "Fixture paid orders. Not a live total.",
      customers: [],
    },
  ],
  unattributed: { revenueCents: 0, orderCount: 0 },
  ambiguous: { revenueCents: 0, orderCount: 0 },
  outsideService: { revenueCents: 0, orderCount: 0 },
  missingPaymentEvidence: { orderCount: 0, cents: 0 },
  partitionedRevenueCents: 16800,
});
export const trpc = { system: { geographicTruth: {
  myAtlas: { useQuery: () => ({ data: { customers }, isError: false, refetch: () => {} }) },
  territoryReport: { useQuery: (input?: { windowDays?: 30 | 90 }) => ({ data: fixtureReport(input?.windowDays ?? 30), isError: false, isLoading: false, refetch: () => {} }) },
} } };
export function createIslandBoard(host: HTMLElement, events: any) {
  const house = document.createElement("button");
  house.textContent = "Tin Can House renderer click";
  house.onclick = () => events.onSuitcase();
  host.append(house);
  queueMicrotask(() => { events.onReady(); events.onIsland({ name: "Hollywood", lanterns: 1, served: true, x: 0, z: 0 }); });
  return {
    enterSmallComforts: () => events.onSuitcase(),
    setLanterns: (inputs: any[]) => { host.dataset.customerKeys = inputs.map(c => c.key).join(); events.onStats({ islands: 1, open: 1, lanterns: inputs.length }); },
    setPaused: (paused: boolean) => { host.dataset.paused = String(paused); },
    focusIsland: (name: string) => { host.dataset.focusIsland = name; },
    dispose: () => house.remove(),
  };
}
