import fs from "node:fs/promises";
import path from "node:path";

const rendererPath = path.resolve("scripts/render-lantern-city-vector-master.mjs");
let renderer = await fs.readFile(rendererPath, "utf8");

const replacements = new Map([
  ['"residential", "#eadbb5"', '"residential", "#deddd4"'],
  ['"commercial", "#e7cfaa"', '"commercial", "#e7ded1"'],
  ['"retail", "#efd2a9"', '"retail", "#ead7ca"'],
  ['"industrial", "#d8c6a3"', '"industrial", "#d3d0c7"'],
  ['"railway", "#d7c4a0"', '"railway", "#d0ccc1"'],
  ['"cemetery", "#91aa6a"', '"cemetery", "#82a05f"'],
  ['"hospital", "#edd5b3"', '"hospital", "#ead8d1"'],
  ['"school", "#ead9b4"', '"school", "#e3ded2"'],
  ['"university", "#e7d3ad"', '"university", "#e5ddd0"'],
  ['"#e4d3aa",', '"#ddd9cd",'],
  ['"wood", "#557b3b"', '"wood", "#69864b"'],
  ['"grass", "#86a955"', '"grass", "#82a25a"'],
  ['"scrub", "#7b934c"', '"scrub", "#aaa071"'],
  ['"farmland", "#d9c98f"', '"farmland", "#d3c794"'],
  ['"sand", "#e7d1a1"', '"sand", "#e4d4aa"'],
  ['"#d9c99b",', '"#cfc9ae",'],
  ['"motorway", "#f2d49e"', '"motorway", "#f3eee3"'],
  ['"trunk", "#f0d7a8"', '"trunk", "#f1eadf"'],
  ['"primary", "#eedab3"', '"primary", "#eee7dc"'],
  ['"secondary", "#eadcbd"', '"secondary", "#e9e3da"'],
  ['"tertiary", "#e5d8bb"', '"tertiary", "#e4ded5"'],
  ['"minor", "#dfd3b7"', '"minor", "#ded8cf"'],
  ['"service", "#d9cdb2"', '"service", "#d9d4ca"'],
  ['"path", "#cdbf9f"', '"path", "#cec8bc"'],
  ['"track", "#c9bb9b"', '"track", "#c9c3b6"'],
  ['"#e0d4b9",', '"#ddd8ce",'],
  ['"motorway", "#9e7655"', '"motorway", "#a98d73"'],
  ['"trunk", "#a27b59"', '"trunk", "#ac9278"'],
  ['"primary", "#a98261"', '"primary", "#b19980"'],
  ['"secondary", "#ad8c6d"', '"secondary", "#b6a088"'],
  ['"tertiary", "#b59a7e"', '"tertiary", "#bbaa94"'],
  ['"minor", "#b8a58d"', '"minor", "#bdb09e"'],
  ['"service", "#bcae98"', '"service", "#c1b7a7"'],
  ['"#ad957a",', '"#b5a18c",'],
  ['"background-color": "#ead7a8"', '"background-color": "#ddd9cd"'],
  ['"fill-color": "#75a04c"', '"fill-color": "#76a052"'],
  ['"fill-outline-color": "#5d873f"', '"fill-outline-color": "#668b47"'],
  ['0, "#ead3a5"', '0, "#e5d3c3"'],
  ['18, "#f3dfb8"', '18, "#eee4d8"'],
  ['55, "#f6e8cb"', '55, "#f4eadf"'],
  ['160, "#fff0cf"', '160, "#fff1dc"'],
  ['"fill-outline-color": "#c18d62"', '"fill-outline-color": "#bd8b6b"'],
]);

let changed = 0;
for (const [from, to] of replacements) {
  if (renderer.includes(from)) {
    renderer = renderer.split(from).join(to);
    changed += 1;
  }
}
if (changed < 30) {
  throw new Error(`Lantern art-target patch matched only ${changed} expected palette anchors; renderer drifted`);
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

console.log(`Locked Lantern City palette toward the approved concept target (${changed} renderer palette anchors).`);
