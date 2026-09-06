import fs from "node:fs/promises";
import path from "node:path";

const rendererPath = path.resolve("scripts/render-lantern-city-vector-master.mjs");
let renderer = await fs.readFile(rendererPath, "utf8");

// APPROVED ART TARGET
// -------------------
// The supplied Lantern City screenshot is the authority: dense toy-city depth,
// warm cream/terracotta architecture, rich green hills, vivid turquoise water,
// pale stone roads/bridges and strong California daylight. Geography remains
// exact; these changes only restyle the real vector primitives.
const replacements = new Map([
  // Keep the broad ground neutral so the warm BUILDINGS read as architecture
  // instead of turning the whole city into one beige sheet.
  ['"residential", "#eadbb5"', '"residential", "#c6c9c1"'],
  ['"commercial", "#e7cfaa"', '"commercial", "#c2c5be"'],
  ['"retail", "#efd2a9"', '"retail", "#ccc5bf"'],
  ['"industrial", "#d8c6a3"', '"industrial", "#b9bdb7"'],
  ['"railway", "#d7c4a0"', '"railway", "#bbbdb7"'],
  ['"cemetery", "#91aa6a"', '"cemetery", "#587744"'],
  ['"hospital", "#edd5b3"', '"hospital", "#d1cbc5"'],
  ['"school", "#ead9b4"', '"school", "#cccac3"'],
  ['"university", "#e7d3ad"', '"university", "#cdc6c0"'],
  ['"#e4d3aa",', '"#c1c4bc",'],

  // Real topography stays lush and deliberate, not satellite-green everywhere.
  ['"wood", "#557b3b"', '"wood", "#345f35"'],
  ['"grass", "#86a955"', '"grass", "#628b48"'],
  ['"scrub", "#7b934c"', '"scrub", "#667c3e"'],
  ['"farmland", "#d9c98f"', '"farmland", "#969660"'],
  ['"sand", "#e7d1a1"', '"sand", "#d0b986"'],
  ['"#d9c99b",', '"#718048",'],

  // Real roads remain exact. Pale interiors over dark casings make every
  // fantasy-water crossing read as an ornate bridge without moving the road.
  ['"motorway", "#f2d49e"', '"motorway", "#ece8dc"'],
  ['"trunk", "#f0d7a8"', '"trunk", "#e8e3d7"'],
  ['"primary", "#eedab3"', '"primary", "#e4dfd4"'],
  ['"secondary", "#eadcbd"', '"secondary", "#dfdbd2"'],
  ['"tertiary", "#e5d8bb"', '"tertiary", "#dad7cf"'],
  ['"minor", "#dfd3b7"', '"minor", "#d3d2cb"'],
  ['"service", "#d9cdb2"', '"service", "#ccccc6"'],
  ['"path", "#cdbf9f"', '"path", "#c1bdb2"'],
  ['"track", "#c9bb9b"', '"track", "#bbb7aa"'],
  ['"#e0d4b9",', '"#d5d3ca",'],
  ['"motorway", "#9e7655"', '"motorway", "#624535"'],
  ['"trunk", "#a27b59"', '"trunk", "#6d4d39"'],
  ['"primary", "#a98261"', '"primary", "#775743"'],
  ['"secondary", "#ad8c6d"', '"secondary", "#82644e"'],
  ['"tertiary", "#b59a7e"', '"tertiary", "#8d7058"'],
  ['"minor", "#b8a58d"', '"minor", "#987f69"'],
  ['"service", "#bcae98"', '"service", "#9e8d79"'],
  ['"#ad957a",', '"#84664f",'],

  // Canvas / park treatment.
  ['"background-color": "#ead7a8"', '"background-color": "#b8b9ad"'],
  ['"fill-color": "#75a04c"', '"fill-color": "#4f813e"'],
  ['"fill-outline-color": "#5d873f"', '"fill-outline-color": "#315f32"'],

  // Buildings are the warm element. A darker translated base plus two extra
  // deterministic sidewall bands creates pseudo-3D toy-city depth while the
  // roof footprint itself stays exactly registered to the real building.
  ['"fill-color": "#6c4f3a"', '"fill-color": "#38241e"'],
  ['"fill-opacity": 0.22,', '"fill-opacity": 0.36,'],
  ['"fill-translate": [2.4, 3.2]', '"fill-translate": [5.2, 7.0]'],
  ['0, "#ead3a5"', '0, "#c5875f"'],
  ['18, "#f3dfb8"', '18, "#dfa977"'],
  ['55, "#f6e8cb"', '55, "#efd09c"'],
  ['160, "#fff0cf"', '160, "#fff0c8"'],
  ['"fill-outline-color": "#c18d62"', '"fill-outline-color": "#815039"'],
  ['"line-color": "#9e8063"', '"line-color": "#6f5d4d"'],
  ['"fill-color": "#ddc9a3"', '"fill-color": "#c4ae88"'],
  ['"line-color": "#bfa785"', '"line-color": "#846d56"'],

  // One vivid water language for real and fantasy water.
  ['"fill-color": "#21b9e5"', '"fill-color": "#05a9d9"'],
  ['"fill-outline-color": "#0f84af"', '"fill-outline-color": "#045d87"'],
  ['"line-color": "#0c86b4"', '"line-color": "#05658d"'],
  ['"line-color": "#1aaedb"', '"line-color": "#0599c7"'],
  ['"line-color": "#e6d3aa"', '"line-color": "#cfae7d"'],
  ['"line-color": "#087fae"', '"line-color": "#035e89"'],
  ['"line-color": "#20c5ee"', '"line-color": "#05b8e6"'],

  // The network now has many connected branches; moderately broaden them to
  // reach the target's ~5-7% visible water without recreating giant capsules.
  [
    'const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 18, 14, ["get", "width"]];',
    'const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 20, 14, ["*", ["get", "width"], 1.58]];'
  ],
  [
    'const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 28, 14, ["+", ["get", "width"], 18]];',
    'const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 30, 14, ["+", ["*", ["get", "width"], 1.58], 15]];'
  ],
  [
    'const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 23, 14, ["+", ["get", "width"], 8]];',
    'const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 25, 14, ["+", ["*", ["get", "width"], 1.58], 7]];'
  ],
]);

let changed = 0;
for (const [from, to] of replacements) {
  if (renderer.includes(from)) {
    renderer = renderer.split(from).join(to);
    changed += 1;
  }
}
if (changed < 58) {
  throw new Error(`Lantern art-target patch matched only ${changed} expected palette/width anchors; renderer drifted`);
}

// Add two deterministic sidewall bands underneath every building roof. This
// is intentionally NOT fill-extrusion/pitched camera geometry: the exact roof
// footprint remains the registration truth, while translated copies provide
// the dimensional craft visible in the approved target.
const buildingDepthAnchor = '      layers.push(shadow);\n      layer.paint = {';
if (!renderer.includes('goldline-side-near')) {
  if (!renderer.includes(buildingDepthAnchor)) throw new Error('Building depth anchor changed');
  renderer = renderer.replace(
    buildingDepthAnchor,
    `      layers.push(shadow);\n\n      const sideFar = structuredClone(layer);\n      sideFar.id = \`${'${layer.id}'}-goldline-side-far\`;\n      sideFar.paint = {\n        "fill-color": "#704734",\n        "fill-opacity": 0.78,\n        "fill-translate": [3.5, 4.8],\n        "fill-translate-anchor": "map",\n      };\n      layers.push(sideFar);\n\n      const sideNear = structuredClone(layer);\n      sideNear.id = \`${'${layer.id}'}-goldline-side-near\`;\n      sideNear.paint = {\n        "fill-color": "#a66c49",\n        "fill-opacity": 0.88,\n        "fill-translate": [1.7, 2.4],\n        "fill-translate-anchor": "map",\n      };\n      layers.push(sideNear);\n\n      layer.paint = {`
  );
}
await fs.writeFile(rendererPath, renderer);

const cutterPath = path.resolve("scripts/build-lantern-city-territory-mosaic.py");
let cutter = await fs.readFile(cutterPath, "utf8");

// Game-art finishing grade. Still deterministic and incapable of moving map
// geometry.
cutter = cutter
  .replace('master = ImageEnhance.Color(master).enhance(1.04)', 'master = ImageEnhance.Color(master).enhance(1.34)')
  .replace('master = ImageEnhance.Contrast(master).enhance(1.025)', 'master = ImageEnhance.Contrast(master).enhance(1.19)\n    master = ImageEnhance.Brightness(master).enhance(0.91)')
  .replace('if metrics["cyanPct"] < 1.8:', 'if metrics["cyanPct"] < 4.0:')
  .replace('if metrics["greenPct"] > 28.0:', 'if metrics["greenPct"] > 22.0:')
  .replace('if metrics["warmPct"] < 15.0:', 'if metrics["warmPct"] < 18.0:')
  .replace('if metrics["nearBlackPct"] > 7.0:', 'if metrics["nearBlackPct"] > 14.0:');

const warmAnchor = '        failures.append(f"warm ivory/cream/terracotta city mass is too weak ({metrics[\'warmPct\']}%)")';
if (!cutter.includes('warm ivory/cream/terracotta city mass overwhelms')) {
  if (!cutter.includes(warmAnchor)) throw new Error("Lantern art gate warm anchor changed");
  cutter = cutter.replace(
    warmAnchor,
    `${warmAnchor}\n    if metrics["warmPct"] > 58.0:\n        failures.append(f"warm ivory/cream/terracotta city mass overwhelms the water/stone palette ({metrics['warmPct']}%)")`
  );
}

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
    '    if metrics["saturationMeanPct"] < 26.0:\n        failures.append(f"city is still too cartographic/washed out ({metrics[\'saturationMeanPct\']}% mean saturation)")\n    if metrics["brightnessPct"] > 68.0:\n        failures.append(f"city is still too pale/washed out ({metrics[\'brightnessPct\']}% mean brightness)")\n    metrics["passed"] = not failures'
  );
}

await fs.writeFile(cutterPath, cutter);
console.log(`Applied registered fantasy depth, palette and water balance (${changed} renderer anchors).`);
