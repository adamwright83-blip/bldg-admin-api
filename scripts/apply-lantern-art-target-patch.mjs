import fs from "node:fs/promises";
import path from "node:path";

const rendererPath = path.resolve("scripts/render-lantern-city-vector-master.mjs");
let renderer = await fs.readFile(rendererPath, "utf8");

// APPROVED ART TARGET
// -------------------
// The source-of-truth screenshot is a bright, premium fantasy Los Angeles:
// warm ivory/cream/terracotta city mass, saturated turquoise waterways,
// genuinely green hills/parks, crisp pale-stone roads, dimensional buildings,
// and NO satellite texture or broad violet faction wash.
//
// Geography stays deterministic. These replacements change presentation only.
const replacements = new Map([
  // Urban land: warm, varied, sunlit California rather than pearl-grey.
  ['"residential", "#eadbb5"', '"residential", "#efd9ad"'],
  ['"commercial", "#e7cfaa"', '"commercial", "#e9d0a4"'],
  ['"retail", "#efd2a9"', '"retail", "#f2cfaa"'],
  ['"industrial", "#d8c6a3"', '"industrial", "#d9c49f"'],
  ['"railway", "#d7c4a0"', '"railway", "#d7c3a5"'],
  ['"cemetery", "#91aa6a"', '"cemetery", "#77915f"'],
  ['"hospital", "#edd5b3"', '"hospital", "#f0d7b7"'],
  ['"school", "#ead9b4"', '"school", "#ecd8b5"'],
  ['"university", "#e7d3ad"', '"university", "#ead1ae"'],
  ['"#e4d3aa",', '"#e5cea6",'],

  // Hills and parks stay richly green, but only where real landcover says so.
  ['"wood", "#557b3b"', '"wood", "#557640"'],
  ['"grass", "#86a955"', '"grass", "#84a25a"'],
  ['"scrub", "#7b934c"', '"scrub", "#889855"'],
  ['"farmland", "#d9c98f"', '"farmland", "#cdbf88"'],
  ['"sand", "#e7d1a1"', '"sand", "#e5cf9f"'],
  ['"#d9c99b",', '"#a7a064",'],

  // Roads: pale stone with a restrained brown casing. They remain the real
  // centerlines and therefore become bridges where fantasy waterways cross.
  ['"motorway", "#f2d49e"', '"motorway", "#fff0cb"'],
  ['"trunk", "#f0d7a8"', '"trunk", "#fae8c2"'],
  ['"primary", "#eedab3"', '"primary", "#f6e1ba"'],
  ['"secondary", "#eadcbd"', '"secondary", "#f0dfc1"'],
  ['"tertiary", "#e5d8bb"', '"tertiary", "#ebddc1"'],
  ['"minor", "#dfd3b7"', '"minor", "#e5d8bd"'],
  ['"service", "#d9cdb2"', '"service", "#ded0b7"'],
  ['"path", "#cdbf9f"', '"path", "#cfbea0"'],
  ['"track", "#c9bb9b"', '"track", "#c7b694"'],
  ['"#e0d4b9",', '"#e2d3b6",'],
  ['"motorway", "#9e7655"', '"motorway", "#855d41"'],
  ['"trunk", "#a27b59"', '"trunk", "#8c6546"'],
  ['"primary", "#a98261"', '"primary", "#96704f"'],
  ['"secondary", "#ad8c6d"', '"secondary", "#a27b5b"'],
  ['"tertiary", "#b59a7e"', '"tertiary", "#aa896b"'],
  ['"minor", "#b8a58d"', '"minor", "#ad977f"'],
  ['"service", "#bcae98"', '"service", "#b2a18e"'],
  ['"#ad957a",', '"#a07f64",'],

  // Broad city canvas and vegetation.
  ['"background-color": "#ead7a8"', '"background-color": "#e8c995"'],
  ['"fill-color": "#75a04c"', '"fill-color": "#74a04e"'],
  ['"fill-outline-color": "#5d873f"', '"fill-outline-color": "#51773e"'],

  // Stronger pseudo-dimensional building treatment while keeping every real
  // footprint fixed. The translated layer is only a contact shadow.
  ['"fill-color": "#6c4f3a"', '"fill-color": "#5a3c28"'],
  ['"fill-opacity": 0.22,', '"fill-opacity": 0.30,'],
  ['"fill-translate": [2.4, 3.2]', '"fill-translate": [3.2, 4.6]'],
  ['0, "#ead3a5"', '0, "#d6ad7b"'],
  ['18, "#f3dfb8"', '18, "#e9c28f"'],
  ['55, "#f6e8cb"', '55, "#f5d7a6"'],
  ['160, "#fff0cf"', '160, "#fff0c8"'],
  ['"fill-outline-color": "#c18d62"', '"fill-outline-color": "#a86f48"'],
  ['"line-color": "#9e8063"', '"line-color": "#8d765e"'],
  ['"fill-color": "#ddc9a3"', '"fill-color": "#ddc59c"'],
  ['"line-color": "#bfa785"', '"line-color": "#aa9071"'],

  // Canal banks belong to the warm city palette. Water itself stays vivid cyan.
  ['"line-color": "#e6d3aa"', '"line-color": "#ead4ad"'],
  ['"line-color": "#087fae"', '"line-color": "#067ca7"'],
  ['"line-color": "#20c5ee"', '"line-color": "#16bde8"'],

  // The previous patch made these 140% wider and produced giant blue capsules.
  // Keep waterways prominent but proportional enough to read as canals/rivers.
  [
    'const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 18, 14, ["get", "width"]];',
    'const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 12, 14, ["*", ["get", "width"], 0.72]];'
  ],
  [
    'const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 28, 14, ["+", ["get", "width"], 18]];',
    'const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 19, 14, ["+", ["*", ["get", "width"], 0.72], 12]];'
  ],
  [
    'const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 23, 14, ["+", ["get", "width"], 8]];',
    'const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 15, 14, ["+", ["*", ["get", "width"], 0.72], 5]];'
  ],
]);

let changed = 0;
for (const [from, to] of replacements) {
  if (renderer.includes(from)) {
    renderer = renderer.split(from).join(to);
    changed += 1;
  }
}
if (changed < 50) {
  throw new Error(`Lantern art-target patch matched only ${changed} expected palette/width anchors; renderer drifted`);
}
await fs.writeFile(rendererPath, renderer);

const cutterPath = path.resolve("scripts/build-lantern-city-territory-mosaic.py");
let cutter = await fs.readFile(cutterPath, "utf8");

// Finishing grade: saturated game world, not a flat cartographic export.
cutter = cutter
  .replace('master = ImageEnhance.Color(master).enhance(1.04)', 'master = ImageEnhance.Color(master).enhance(1.12)')
  .replace('master = ImageEnhance.Contrast(master).enhance(1.025)', 'master = ImageEnhance.Contrast(master).enhance(1.07)')
  .replace('if metrics["cyanPct"] < 1.8:', 'if metrics["cyanPct"] < 4.0:')
  .replace('if metrics["greenPct"] > 28.0:', 'if metrics["greenPct"] > 22.0:')
  .replace('if metrics["warmPct"] < 15.0:', 'if metrics["warmPct"] < 26.0:');

const warmAnchor = '        failures.append(f"warm ivory/cream/terracotta city mass is too weak ({metrics[\'warmPct\']}%)")';
if (!cutter.includes('warm ivory/cream/terracotta city mass overwhelms')) {
  if (!cutter.includes(warmAnchor)) throw new Error("Lantern art gate warm anchor changed");
  cutter = cutter.replace(
    warmAnchor,
    `${warmAnchor}\n    if metrics["warmPct"] > 72.0:\n        failures.append(f"warm ivory/cream/terracotta city mass overwhelms the water/green palette ({metrics['warmPct']}%)")`
  );
}
await fs.writeFile(cutterPath, cutter);

console.log(`Retuned Lantern City toward the approved fantasy screenshot (${changed} renderer anchors).`);
