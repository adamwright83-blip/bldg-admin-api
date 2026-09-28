/**
 * Standalone island board for sharing without the admin app (no login, no database): the board
 * renderer with sample lanterns. Bundled by build.sh into a folder the Artifact publishes.
 */
import { createIslandBoard, type IslandLantern } from "../../../../client/src/components/admin/control-room/LanternCityIslands/islandBoard";
import { buildTowerModel, darkFloors, TOWER_BUILDINGS, type Resident } from "../../../../client/src/components/admin/control-room/LanternCityIslands/towerStack";
import { createTowerRooms } from "../../../../client/src/components/admin/control-room/LanternCityIslands/towerRooms";

// sample customers (placeholders: the app lights the real ones)
const SPOTS: [number, number, number][] = [
  [34.0906, -118.2766, 5], [34.0851, -118.2703, 3], [34.0985, -118.3265, 4], [34.1012, -118.3389, 3],
  [34.059, -118.4145, 1], [34.0612, -118.3009, 3], [34.0578, -118.2963, 2], [34.088, -118.298, 1], [34.1052, -118.2885, 1],
];
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const SAMPLE: IslandLantern[] = [];
for (const [lat, lng, count] of SPOTS) for (let i = 0; i < count; i++) {
  SAMPLE.push({ key: `sample-${SAMPLE.length}`, latitude: lat + (rnd() - 0.5) * 0.004, longitude: lng + (rnd() - 0.5) * 0.005, name: `Sample Customer ${SAMPLE.length + 1}` });
}

const $ = (id: string) => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const board = createIslandBoard($("stage"), {
  onReady: () => $("loading").remove(),
  onStats: s => {
    $("nL").textContent = String(s.lanterns);
    $("nO").textContent = `${s.open} of ${s.islands}`;
    $("stats").hidden = false;
  },
  onIsland: info => {
    $("card").hidden = !info;
    if (!info) return;
    $("cTitle").textContent = info.name;
    $("cBody").textContent = info.lanterns
      ? `${info.lanterns} lantern${info.lanterns === 1 ? "" : "s"} lit here. Every customer's home burns gold.`
      : "Still under cloud. Win one customer here and the clouds burn off the whole island.";
  },
  onTower: id => openTower(id),
  onHover: h => {
    const tip = $("tip");
    tip.hidden = !h;
    if (!h) return;
    if (h.tower && !h.keys.length) {
      $("tipTitle").textContent = TOWER_BUILDINGS.find(b => b.id === h.tower)?.name ?? "Tower";
      $("tipBody").textContent = "Click to open every floor";
      tip.style.left = `${Math.min(h.x + 16, innerWidth - 260)}px`;
      tip.style.top = `${Math.max(h.y - 70, 8)}px`;
      return;
    }
    const who = h.keys.map(k => SAMPLE.find(c => c.key === k) ?? (k === "win-weho" ? { name: "New customer" } : null)).filter(Boolean) as { name?: string }[];
    $("tipTitle").textContent = who.length === 1 ? who[0].name ?? "Customer" : `${who.length} customers here`;
    $("tipBody").textContent = (who.length > 1 ? who.map(c => c.name).join("\n") : "Lantern lit · sample customer") + (h.tower ? "\nClick to open every floor" : "");
    tip.style.left = `${Math.min(h.x + 16, innerWidth - 260)}px`;
    tip.style.top = `${Math.max(h.y - 70, 8)}px`;
  },
  onError: () => { $("loading").textContent = "The island board could not load its map. Reload to try again."; },
}, { assetBase: "assets", capture: params.has("capture") });
($("cClose") as HTMLButtonElement).onclick = () => { $("card").hidden = true; board.board(); };
board.setLanterns(SAMPLE);
// the moment worth sharing: a new customer in West Hollywood, and its clouds burn away
($("win") as HTMLButtonElement).onclick = () => {
  const next = [...SAMPLE, { key: "win-weho", latitude: 34.0900, longitude: -118.3617, name: "New customer" }];
  board.setLanterns(next);
  board.focusIsland("West Hollywood");
  ($("win") as HTMLButtonElement).disabled = true;
};
(window as unknown as { __b: typeof board; __sample: IslandLantern[] }).__b = board;
(window as unknown as { __tower: () => typeof cut }).__tower = () => cut;
(window as unknown as { __sample: IslandLantern[] }).__sample = SAMPLE;

// sample residents of our two towers (placeholders: the app reads each customer's real address and unit)
const RES: Record<string, Resident[]> = {
  opus_la: [
    ["3545 Wilshire Blvd", "1507"], ["3545 Wilshire Blvd", "2204"], ["3545 Wilshire Blvd", "812"], ["3545 Wilshire Blvd", "1211"],
    ["3545 Wilshire Blvd", "1916"], ["3545 Wilshire Blvd", "403"], ["3545 Wilshire Blvd", "1507"], ["3650 W 6th St", "902"],
    ["3650 W 6th St", "1115"], ["3650 W 6th St", "306"],
  ].map(([address, unit], i) => ({ key: `opus-${i}`, name: `Sample Resident ${i + 1}`, address, unit })),
  century_park_east: [
    ["2160 Century Park East", "1804"], ["2160 Century Park East", "705"], ["2170 Century Park East", "2112"],
    ["2170 Century Park East", "1001"], ["2170 Century Park East", "1409"],
  ].map(([address, unit], i) => ({ key: `cpe-${i}`, name: `Sample Resident ${i + 11}`, address, unit })),
};
let cut: ReturnType<typeof createTowerRooms> | null = null;
function openTower(id: string) {
  const spec = TOWER_BUILDINGS.find(b => b.id === id);
  if (!spec) return;
  const m = buildTowerModel(spec, RES[id] ?? []);
  $("tower").hidden = false;
  $("tip").hidden = true;
  $("twName").textContent = spec.name;
  const lit = m.towers.reduce((n, t) => n + t.lit, 0), units = m.towers.reduce((n, t) => n + t.spec.floors * t.spec.unitsPerFloor, 0);
  const dark = m.towers.reduce((n, t) => n + darkFloors(t).length, 0), floors = m.towers.reduce((n, t) => n + t.spec.floors, 0);
  $("twStats").textContent = `${lit} homes lit of ${units} · ${dark} of ${floors} floors with no customer`;
  cut ??= createTowerRooms($("twStage"), {
    onHover: h => {
      const tip = $("tip");
      tip.hidden = !h;
      if (!h) return;
      $("tipTitle").textContent = h.residents.length === 1 ? h.residents[0].name : `${h.residents.length} customers`;
      $("tipBody").textContent = (h.residents.length > 1 ? h.residents.map(r => r.name).join("\n") + "\n" : "") + h.label;
      tip.style.left = `${Math.min(h.x + 16, innerWidth - 260)}px`;
      tip.style.top = `${Math.max(h.y - 70, 8)}px`;
    },
  });
  cut.show(m);
}
($("twClose") as HTMLButtonElement).onclick = () => { $("tower").hidden = true; $("tip").hidden = true; };
document.querySelectorAll<HTMLButtonElement>("[data-tower]").forEach(b => (b.onclick = () => openTower(b.dataset.tower!)));
