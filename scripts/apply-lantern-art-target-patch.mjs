import fs from "node:fs/promises";
import path from "node:path";

const rendererPath = path.resolve("scripts/render-lantern-city-vector-master.mjs");
let renderer = await fs.readFile(rendererPath, "utf8");

// The approved target is a bright California fantasy atlas: cool pearl/ivory
// city mass, deliberate turquoise waterways, restrained green accents, and no
// broad purple haze. Real vector geography stays untouched; only presentation
// colors and fantasy-waterway stroke widths change here.
const replacements = new Map([
  ['"residential", "#eadbb5"', '"residential", "#dce1de"'],
  ['"commercial", "#e7cfaa"', '"commercial", "#e3e2de"'],
  ['"retail", "#efd2a9"', '"retail", "#e5ddda"'],
  ['"industrial", "#d8c6a3"', '"industrial", "#d7dcda"'],
  ['"railway", "#d7c4a0"', '"railway", "#d6d8d4"'],
  ['"cemetery", "#91aa6a"', '"cemetery", "#a4aa91"'],
  ['"hospital", "#edd5b3"', '"hospital", "#e7e2df"'],
  ['"school", "#ead9b4"', '"school", "#e3e2dc"'],
  ['"university", "#e7d3ad"', '"university", "#e4e0da"'],
  ['"#e4d3aa",', '"#dedfda",'],
  ['"wood", "#557b3b"', '"wood", "#929a7e"'],
  ['"grass", "#86a955"', '"grass", "#a3aa8e"'],
  ['"scrub", "#7b934c"', '"scrub", "#b8b49d"'],
  ['"farmland", "#d9c98f"', '"farmland", "#d2d3c7"'],
  ['"sand", "#e7d1a1"', '"sand", "#dddcd5"'],
  ['"#d9c99b",', '"#cbcbbd",'],
  ['"motorway", "#f2d49e"', '"motorway", "#f3f1eb"'],
  ['"trunk", "#f0d7a8"', '"trunk", "#f0eee8"'],
  ['"primary", "#eedab3"', '"primary", "#eceae5"'],
  ['"secondary", "#eadcbd"', '"secondary", "#e8e7e2"'],
  ['"tertiary", "#e5d8bb"', '"tertiary", "#e3e2dd"'],
  ['"minor", "#dfd3b7"', '"minor", "#ddddd8"'],
  ['"service", "#d9cdb2"', '"service", "#d8d9d4"'],
  ['"path", "#cdbf9f"', '"path", "#cfd0ca"'],
  ['"track", "#c9bb9b"', '"track", "#c9cbc5"'],
  ['"#e0d4b9",', '"#dcddd8",'],
  ['"motorway", "#9e7655"', '"motorway", "#a99b8e"'],
  ['"trunk", "#a27b59"', '"trunk", "#aca093"'],
  ['"primary", "#a98261"', '"primary", "#b1a69a"'],
  ['"secondary", "#ad8c6d"', '"secondary", "#b6ada2"'],
  ['"tertiary", "#b59a7e"', '"tertiary", "#bbb4aa"'],
  ['"minor", "#b8a58d"', '"minor", "#bdb8b0"'],
  ['"service", "#bcae98"', '"service", "#c1bdb5"'],
  ['"#ad957a",', '"#b5aca2",'],
  ['"background-color": "#ead7a8"', '"background-color": "#dfe3df"'],
  ['"fill-color": "#75a04c"', '"fill-color": "#9aa481"'],
  ['"fill-outline-color": "#5d873f"', '"fill-outline-color": "#8f9979"'],
  ['"fill-color": "#6c4f3a"', '"fill-color": "#77736f"'],
  ['"fill-opacity": 0.22,', '"fill-opacity": 0.14,'],
  ['0, "#ead3a5"', '0, "#e1deda"'],
  ['18, "#f3dfb8"', '18, "#ebe9e5"'],
  ['55, "#f6e8cb"', '55, "#f3efea"'],
  ['160, "#fff0cf"', '160, "#fff8f4"'],
  ['"fill-outline-color": "#c18d62"', '"fill-outline-color": "#bd9478"'],
  ['"line-color": "#9e8063"', '"line-color": "#a5a39c"'],
  ['"fill-color": "#ddc9a3"', '"fill-color": "#d9ddd9"'],
  ['"line-color": "#bfa785"', '"line-color": "#b7bbb8"'],
  ['"line-color": "#e6d3aa"', '"line-color": "#d9dedb"'],
  [
    'const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 18, 14, ["get", "width"]];',
    'const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 24, 14, ["*", ["get", "width"], 1.4]];'
  ],
  [
    'const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 28, 14, ["+", ["get", "width"], 18]];',
    'const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 36, 14, ["+", ["*", ["get", "width"], 1.4], 22]];'
  ],
  [
    'const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 23, 14, ["+", ["get", "width"], 8]];',
    'const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 30, 14, ["+", ["*", ["get", "width"], 1.4], 10]];'
  ],
]);

let changed = 0;
for (const [from, to] of replacements) {
  if (renderer.includes(from)) {
    renderer = renderer.split(from).join(to);
    changed += 1;
  }
}
if (changed < 38) {
  throw new Error(`Lantern art-target patch matched only ${changed} expected palette/width anchors; renderer drifted`);
}
await fs.writeFile(rendererPath, renderer);

const cutterPath = path.resolve("scripts/build-lantern-city-territory-mosaic.py");
let cutter = await fs.readFile(cutterPath, "utf8");
cutter = cutter
  .replace('if metrics["cyanPct"] < 1.8:', 'if metrics["cyanPct"] < 3.5:')
  .replace('if metrics["greenPct"] > 28.0:', 'if metrics["greenPct"] > 8.0:')
  .replace('if metrics["warmPct"] < 15.0:', 'if metrics["warmPct"] < 22.0:');

const warmAnchor = '        failures.append(f"warm ivory/cream/terracotta city mass is too weak ({metrics[\'warmPct\']}%)")';
if (!cutter.includes('warm ivory/cream/terracotta city mass overwhelms')) {
  if (!cutter.includes(warmAnchor)) throw new Error("Lantern art gate warm anchor changed");
  cutter = cutter.replace(
    warmAnchor,
    `${warmAnchor}\n    if metrics["warmPct"] > 65.0:\n        failures.append(f"warm ivory/cream/terracotta city mass overwhelms the water/stone palette ({metrics['warmPct']}%)")`
  );
}
await fs.writeFile(cutterPath, cutter);

console.log(`Locked Lantern City palette and water mass toward the approved concept target (${changed} renderer anchors).`);
