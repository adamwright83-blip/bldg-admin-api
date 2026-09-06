import fs from "node:fs/promises";
import path from "node:path";

const rendererPath = path.resolve("scripts/render-lantern-city-vector-master.mjs");
let renderer = await fs.readFile(rendererPath, "utf8");

// APPROVED ART TARGET
// -------------------
// The authority is the saturated game-world screenshot supplied by Adam, not
// a conventional cartographic style. Geographic primitives remain exact; only
// their visual treatment changes. Ground mass stays mostly neutral stone so
// warm cream/terracotta BUILDINGS, cyan WATER and green HILLS can separate
// clearly instead of collapsing into one beige wash.
const replacements = new Map([
  // Urban ground: neutral warm stone. These deliberately avoid occupying the
  // same hue family as the buildings, which is what made the previous pass 89%
  // beige/warm and visually flat.
  ['"residential", "#eadbb5"', '"residential", "#d8d7cc"'],
  ['"commercial", "#e7cfaa"', '"commercial", "#d4d2c9"'],
  ['"retail", "#efd2a9"', '"retail", "#ddd0c6"'],
  ['"industrial", "#d8c6a3"', '"industrial", "#c9c9bf"'],
  ['"railway", "#d7c4a0"', '"railway", "#c9c7bd"'],
  ['"cemetery", "#91aa6a"', '"cemetery", "#698450"'],
  ['"hospital", "#edd5b3"', '"hospital", "#ded3c8"'],
  ['"school", "#ead9b4"', '"school", "#d9d5ca"'],
  ['"university", "#e7d3ad"', '"university", "#d9d0c6"'],
  ['"#e4d3aa",', '"#d1d2c8",'],

  // Real hills / parks: saturated California green, not satellite texture.
  ['"wood", "#557b3b"', '"wood", "#456b37"'],
  ['"grass", "#86a955"', '"grass", "#73964d"'],
  ['"scrub", "#7b934c"', '"scrub", "#788c48"'],
  ['"farmland", "#d9c98f"', '"farmland", "#aaa56b"'],
  ['"sand", "#e7d1a1"', '"sand", "#d9c493"'],
  ['"#d9c99b",', '"#8b9255",'],

  // Roads: bright raised-looking stone over much darker casings. Because real
  // roads render above fantasy water, crossings read as bridges automatically.
  ['"motorway", "#f2d49e"', '"motorway", "#fff0c9"'],
  ['"trunk", "#f0d7a8"', '"trunk", "#f9e7c0"'],
  ['"primary", "#eedab3"', '"primary", "#f6dfb6"'],
  ['"secondary", "#eadcbd"', '"secondary", "#efdbbc"'],
  ['"tertiary", "#e5d8bb"', '"tertiary", "#ead5b8"'],
  ['"minor", "#dfd3b7"', '"minor", "#e3d1b7"'],
  ['"service", "#d9cdb2"', '"service", "#dccab0"'],
  ['"path", "#cdbf9f"', '"path", "#c9b591"'],
  ['"track", "#c9bb9b"', '"track", "#c2ad89"'],
  ['"#e0d4b9",', '"#dfcdb0",'],
  ['"motorway", "#9e7655"', '"motorway", "#6f4b36"'],
  ['"trunk", "#a27b59"', '"trunk", "#79553c"'],
  ['"primary", "#a98261"', '"primary", "#866247"'],
  ['"secondary", "#ad8c6d"', '"secondary", "#947256"'],
  ['"tertiary", "#b59a7e"', '"tertiary", "#9f8063"'],
  ['"minor", "#b8a58d"', '"minor", "#a58f77"'],
  ['"service", "#bcae98"', '"service", "#aa9b87"'],
  ['"#ad957a",', '"#94765d",'],

  // Canvas / parks.
  ['"background-color": "#ead7a8"', '"background-color": "#c8b58e"'],
  ['"fill-color": "#75a04c"', '"fill-color": "#689548"'],
  ['"fill-outline-color": "#5d873f"', '"fill-outline-color": "#456f35"'],

  // Buildings carry the warm fantasy architecture: cream, ivory and
  // terracotta with a much stronger contact shadow for toy-city depth.
  ['"fill-color": "#6c4f3a"', '"fill-color": "#493126"'],
  ['"fill-opacity": 0.22,', '"fill-opacity": 0.42,'],
  ['"fill-translate": [2.4, 3.2]', '"fill-translate": [3.8, 5.4]'],
  ['0, "#ead3a5"', '0, "#cb9568"'],
  ['18, "#f3dfb8"', '18, "#dfb57f"'],
  ['55, "#f6e8cb"', '55, "#f2d39f"'],
  ['160, "#fff0cf"', '160, "#fff0c7"'],
  ['"fill-outline-color": "#c18d62"', '"fill-outline-color": "#8b583b"'],
  ['"line-color": "#9e8063"', '"line-color": "#766553"'],
  ['"fill-color": "#ddc9a3"', '"fill-color": "#c9b38d"'],
  ['"line-color": "#bfa785"', '"line-color": "#91775c"'],

  // Cyan water with warm banks. Keep real water and fantasy water in the same
  // family so they read as one authored world.
  ['"fill-color": "#21b9e5"', '"fill-color": "#09addd"'],
  ['"fill-outline-color": "#0f84af"', '"fill-outline-color": "#056d96"'],
  ['"line-color": "#0c86b4"', '"line-color": "#056f99"'],
  ['"line-color": "#1aaedb"', '"line-color": "#0a9dcc"'],
  ['"line-color": "#e6d3aa"', '"line-color": "#d5ba8b"'],
  ['"line-color": "#087fae"', '"line-color": "#046d99"'],
  ['"line-color": "#20c5ee"', '"line-color": "#0bbbe8"'],

  // More branches + moderate widths is better than a handful of giant blue
  // capsules. The authored GeoJSON now supplies the density; this keeps each
  // individual watercourse proportional to the target art.
  [
    'const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 18, 14, ["get", "width"]];',
    'const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 15, 14, ["*", ["get", "width"], 0.95]];'
  ],
  [
    'const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 28, 14, ["+", ["get", "width"], 18]];',
    'const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 23, 14, ["+", ["*", ["get", "width"], 0.95], 14]];'
  ],
  [
    'const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 23, 14, ["+", ["get", "width"], 8]];',
    'const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 19, 14, ["+", ["*", ["get", "width"], 0.95], 6]];'
  ],
]);

let changed = 0;
for (const [from, to] of replacements) {
  if (renderer.includes(from)) {
    renderer = renderer.split(from).join(to);
    changed += 1;
  }
}
if (changed < 56) {
  throw new Error(`Lantern art-target patch matched only ${changed} expected palette/width anchors; renderer drifted`);
}
await fs.writeFile(rendererPath, renderer);

const cutterPath = path.resolve("scripts/build-lantern-city-territory-mosaic.py");
let cutter = await fs.readFile(cutterPath, "utf8");

// Stronger game-art finishing grade. This operates on a deterministic vector
// render; it cannot move a single road, building, territory or coordinate.
cutter = cutter
  .replace('master = ImageEnhance.Color(master).enhance(1.04)', 'master = ImageEnhance.Color(master).enhance(1.24)')
  .replace('master = ImageEnhance.Contrast(master).enhance(1.025)', 'master = ImageEnhance.Contrast(master).enhance(1.14)\n    master = ImageEnhance.Brightness(master).enhance(0.96)')
  .replace('if metrics["cyanPct"] < 1.8:', 'if metrics["cyanPct"] < 4.0:')
  .replace('if metrics["greenPct"] > 28.0:', 'if metrics["greenPct"] > 22.0:')
  .replace('if metrics["warmPct"] < 15.0:', 'if metrics["warmPct"] < 20.0:')
  .replace('if metrics["nearBlackPct"] > 7.0:', 'if metrics["nearBlackPct"] > 12.0:');

const warmAnchor = '        failures.append(f"warm ivory/cream/terracotta city mass is too weak ({metrics[\'warmPct\']}%)")';
if (!cutter.includes('warm ivory/cream/terracotta city mass overwhelms')) {
  if (!cutter.includes(warmAnchor)) throw new Error("Lantern art gate warm anchor changed");
  cutter = cutter.replace(
    warmAnchor,
    `${warmAnchor}\n    if metrics["warmPct"] > 55.0:\n        failures.append(f"warm ivory/cream/terracotta city mass overwhelms the water/stone palette ({metrics['warmPct']}%)")`
  );
}

// Prevent another technically-correct but washed-out cartographic pass. The
// supplied authority screenshot is roughly 41% mean saturation; production
// does not need to match that number exactly, but it must clearly live in the
// same game-art family rather than the ~16% saturation of the rejected map.
const nearBlackLine = '    near_black = ((r + g + b) / 3.0) < 0.12';
if (!cutter.includes('saturationMeanPct')) {
  if (!cutter.includes(nearBlackLine)) throw new Error("Lantern art metrics anchor changed");
  cutter = cutter.replace(
    nearBlackLine,
    `${nearBlackLine}\n    mx = np.maximum(np.maximum(r, g), b)\n    mn = np.minimum(np.minimum(r, g), b)\n    saturation = (mx - mn) / np.maximum(mx, 0.001)\n    brightness = (r + g + b) / 3.0`
  );
  cutter = cutter.replace(
    '        "nearBlackPct": round(float(near_black.mean() * 100), 2),',
    '        "nearBlackPct": round(float(near_black.mean() * 100), 2),\n        "saturationMeanPct": round(float(saturation.mean() * 100), 2),\n        "brightnessPct": round(float(brightness.mean() * 100), 2),'
  );
  cutter = cutter.replace(
    '    metrics["passed"] = not failures',
    '    if metrics["saturationMeanPct"] < 28.0:\n        failures.append(f"city is still too cartographic/washed out ({metrics[\'saturationMeanPct\']}% mean saturation)")\n    if metrics["brightnessPct"] > 72.0:\n        failures.append(f"city is still too pale/washed out ({metrics[\'brightnessPct\']}% mean brightness)")\n    metrics["passed"] = not failures'
  );
}

await fs.writeFile(cutterPath, cutter);
console.log(`Locked Lantern City to the supplied saturated fantasy target (${changed} renderer anchors).`);
