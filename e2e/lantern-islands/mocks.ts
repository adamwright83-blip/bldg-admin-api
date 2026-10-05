// Browser seam witness: real React Islands shell and real lazy-loaded painted game.
// The renderer seam is deterministic; production acceptance separately exercises WebGL.
export default function ObjectiveMarksLayer() { return null; }
const customers = [{ identityKey: "fixture-customer", displayName: "Fixture", phone: null,
  cadence: { state: "dark", daysSinceLastOrder: 100 },
  location: { latitude: 34.1, longitude: -118.33, x: 0, y: 0, outOfBounds: false, canonicalAddress: null } }];
export const useAuth = () => ({ user: { role: "admin", openId: "legacy-admin" } });
export const trpc = { system: { geographicTruth: { myAtlas: { useQuery: () => ({ data: { customers }, isError: false }) } } } };
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
