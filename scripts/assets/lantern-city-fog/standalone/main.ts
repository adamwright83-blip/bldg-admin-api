/**
 * Standalone Lantern City v7 for sharing without the admin app (no login, no database): the same
 * world renderer with sample lanterns. Bundled by build.sh into a folder the Artifact publishes.
 */
import { createLanternWorld, type LanternInput } from "../../../../client/src/components/admin/control-room/LanternCityV7/lanternWorld";

const SAMPLE: LanternInput[] = ([
  [34.0906, -118.2766, "Silver Lake", 6, 5, 1, 0],
  [34.0851, -118.2703, "Silver Lake", 2, 1, 1, 0],
  [34.0985, -118.3265, "Hollywood", 5, 4, 0, 1],
  [34.1012, -118.3389, "Hollywood", 3, 3, 0, 0],
  [34.059, -118.4145, "Century Park East", 7, 6, 1, 0],
  [34.0612, -118.3009, "OPUS LA", 8, 6, 1, 1],
  [34.0578, -118.2963, "Koreatown", 2, 2, 0, 0],
  [34.088, -118.298, "East Hollywood", 3, 2, 0, 1],
  [34.1052, -118.2885, "Los Feliz", 4, 3, 1, 0],
] as const).map(([latitude, longitude, label, total, active, dimming, dark], i) => ({
  key: `sample-${i}`, latitude, longitude, label, total, active, dimming, dark,
}));

const $ = (id: string) => document.getElementById(id)!;
const world = createLanternWorld($("stage"), {
  onReady: () => $("loading").remove(),
  onStats: s => {
    $("nL").textContent = String(s.lanterns);
    $("nC").textContent = `${s.chartedPct}%`;
    $("nD").textContent = s.doorsInLight.toLocaleString();
    $("stats").hidden = false;
  },
  onMission: m => {
    if (!m) return;
    $("mTitle").textContent = m.title;
    $("mBody").textContent = m.body;
    $("mKind").textContent = m.kind === "run" ? "Door-hanger run" : "Uncharted";
    $("mDistWrap").hidden = m.kind === "run";
    $("mDoors").textContent = `~${m.doors.toLocaleString()}`;
    $("mDist").textContent = `${m.miles.toFixed(1)} mi`;
    ($("mGo") as HTMLButtonElement).onclick = () => world.focusPoint(m.x, m.z, m.radius ? m.radius * 4 : 1600);
    if (!selected) $("mission").hidden = false;
  },
  onSelect: key => {
    selected = key;
    const l = SAMPLE.find(s => s.key === key);
    $("lantern").hidden = !l;
    $("mission").hidden = !!l;
    if (!l) return;
    $("lTitle").textContent = l.label;
    $("lBody").textContent = `${l.total} customers · ${l.active} active${l.dimming ? ` · ${l.dimming} dimming` : ""}${l.dark ? ` · ${l.dark} gone dark` : ""}`;
  },
  onError: () => { $("loading").textContent = "Lantern City could not load its map. Reload to try again."; },
}, { assetBase: "assets" });
let selected: string | null = null;
($("lClose") as HTMLButtonElement).onclick = () => { selected = null; $("lantern").hidden = true; $("mission").hidden = false; };
world.setLanterns(SAMPLE);
(window as unknown as { __w: typeof world }).__w = world;
