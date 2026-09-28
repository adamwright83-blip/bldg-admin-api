/**
 * Standalone Lantern City v7 for sharing without the admin app (no login, no database): the same
 * world renderer with sample lanterns. Bundled by build.sh into a folder the Artifact publishes.
 */
import { createLanternWorld, type LanternInput } from "../../../../client/src/components/admin/control-room/LanternCityV7/lanternWorld";

// sample customers, each their own lantern (placeholders: the app lights the real ones)
const SPOTS: [number, number, number][] = [
  [34.0906, -118.2766, 5], [34.0851, -118.2703, 3], [34.0985, -118.3265, 4], [34.1012, -118.3389, 3],
  [34.059, -118.4145, 1], [34.0612, -118.3009, 3], [34.0578, -118.2963, 2], [34.088, -118.298, 1], [34.1052, -118.2885, 1],
];
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const SAMPLE: LanternInput[] = [];
for (const [lat, lng, count] of SPOTS) {
  for (let i = 0; i < count; i++) {
    const n = SAMPLE.length + 1, st = rnd();
    SAMPLE.push({
      key: `sample-${n - 1}`, latitude: lat + (rnd() - 0.5) * 0.004, longitude: lng + (rnd() - 0.5) * 0.005,
      label: `Sample address ${n}`, name: `Sample Customer ${n}`,
      spendCents: Math.round((60 + rnd() * 4800) * 100), lastOrderAt: new Date(Date.now() - rnd() * 60 * 86400000).toISOString(),
      total: 1, active: st < 0.7 ? 1 : 0, dimming: st >= 0.7 && st < 0.9 ? 1 : 0, dark: st >= 0.9 ? 1 : 0,
    });
  }
}

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
    $("mKind").textContent = m.kind === "run" ? "Door-hanger run" : "Uncharted neighbourhood";
    $("mGo").textContent = m.kind === "run" ? "Show me the run" : "Show me";
    $("mDistWrap").hidden = m.kind === "run";
    $("mDoors").textContent = `~${m.doors.toLocaleString()}`;
    $("mDist").textContent = `${m.miles.toFixed(1)} mi`;
    ($("mGo") as HTMLButtonElement).onclick = () => world.focusPoint(m.x, m.z, m.radius ? m.radius * 4 : 1600);
    if (!selected) $("mission").hidden = false;
  },
  onSelect: keys => {
    selected = keys ? keys[0] : null;
    const ls = (keys ?? []).map(k => SAMPLE.find(x => x.key === k)).filter((x): x is LanternInput => !!x);
    $("lantern").hidden = !ls.length;
    $("mission").hidden = !!ls.length;
    if (!ls.length) return;
    $("lTitle").textContent = ls.length === 1 ? ls[0].name! : `${ls.length} customers here`;
    $("lBody").textContent = ls.map(l => `${l.name} · $${Math.round((l.spendCents ?? 0) / 100).toLocaleString()} lifetime · last order ${new Date(l.lastOrderAt!).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`).join("\n");
  },
  onError: () => { $("loading").textContent = "Lantern City could not load its map. Reload to try again."; },
}, { assetBase: "assets", capture: new URLSearchParams(location.search).has("capture") });
let selected: string | null = null;
($("lClose") as HTMLButtonElement).onclick = () => { selected = null; $("lantern").hidden = true; $("mission").hidden = false; };
world.setLanterns(SAMPLE);
$("nCust").textContent = String(SAMPLE.length);
document.querySelectorAll<HTMLButtonElement>(".dock button").forEach(b => b.onclick = () => {
  const n = $("note");
  n.textContent = `${b.dataset.go} opens in the Joystick app. This preview uses sample customers.`;
  n.hidden = false;
  setTimeout(() => (n.hidden = true), 2600);
});
(window as unknown as { __w: typeof world; __sample: LanternInput[] }).__w = world;
(window as unknown as { __sample: LanternInput[] }).__sample = SAMPLE;
