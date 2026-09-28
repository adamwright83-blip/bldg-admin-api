/**
 * Standalone island board for sharing without the admin app (no login, no database): the board
 * renderer with sample lanterns. Bundled by build.sh into a folder the Artifact publishes.
 */
import { createIslandBoard, type IslandLantern } from "../../../../client/src/components/admin/control-room/LanternCityIslands/islandBoard";

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
  onHover: h => {
    const tip = $("tip");
    tip.hidden = !h;
    if (!h) return;
    const who = h.keys.map(k => SAMPLE.find(c => c.key === k) ?? (k === "win-weho" ? { name: "New customer" } : null)).filter(Boolean) as { name?: string }[];
    $("tipTitle").textContent = who.length === 1 ? who[0].name ?? "Customer" : `${who.length} customers here`;
    $("tipBody").textContent = who.length > 1 ? who.map(c => c.name).join("\n") : "Lantern lit · sample customer";
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
(window as unknown as { __sample: IslandLantern[] }).__sample = SAMPLE;
