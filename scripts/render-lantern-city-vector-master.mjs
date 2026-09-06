import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const ROOT = process.cwd();
const INPUTS = path.resolve(ROOT, "artifacts/lantern-city-territory-art-inputs");
const INDEX_PATH = path.join(INPUTS, "_qa/territory-index.json");
const MASTER_DIR = path.resolve(ROOT, "artifacts/lantern-city-territory-mosaic");
const MASTER_PATH = path.join(MASTER_DIR, "lantern-city-hd-master.png");
const TRUTH_PATH = path.resolve(
  ROOT,
  "client/public/assets/admin/control-room/world/lantern-city-truth-reference.jpg",
);
const WATERWAYS_PATH = path.resolve(
  ROOT,
  "client/public/assets/admin/control-room/world/fantasy-waterways-v1.geojson",
);

const MASTER_W = Number(process.env.LANTERN_MASTER_WIDTH || 7680);
const MASTER_H = Number(process.env.LANTERN_MASTER_HEIGHT || 4320);
const DPR = 2;
const CSS_W = Math.round(MASTER_W / DPR);
const CSS_H = Math.round(MASTER_H / DPR);
const OPENFREE_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const OPENFREE_TILES = "https://tiles.openfreemap.org/planet/latest/{z}/{x}/{y}.pbf";
const MAPLIBRE_JS = "https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js";

async function fetchText(url, attempts = 4) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Goldline-LanternCity-Vector-Renderer/2.0" },
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`Failed to fetch ${url}: ${last}`);
}

async function projectionFromExport() {
  const index = JSON.parse(await fs.readFile(INDEX_PATH, "utf8"));
  const first = index?.territories?.[0];
  if (!first?.territoryId) throw new Error("Territory export is missing or empty");
  const meta = JSON.parse(
    await fs.readFile(path.join(INPUTS, first.territoryId, "metadata.json"), "utf8"),
  );
  if (!meta.projection) throw new Error("Territory metadata has no projection");
  return meta.projection;
}

const landuseColors = [
  "match",
  ["get", "class"],
  "residential", "#eadbb5",
  "commercial", "#e7cfaa",
  "retail", "#efd2a9",
  "industrial", "#d8c6a3",
  "railway", "#d7c4a0",
  "cemetery", "#91aa6a",
  "hospital", "#edd5b3",
  "school", "#ead9b4",
  "university", "#e7d3ad",
  "#e4d3aa",
];

const landcoverColors = [
  "match",
  ["get", "class"],
  "wood", "#557b3b",
  "grass", "#86a955",
  "scrub", "#7b934c",
  "farmland", "#d9c98f",
  "glacier", "#eaf4ef",
  "sand", "#e7d1a1",
  "#d9c99b",
];

const roadColors = [
  "match",
  ["get", "class"],
  "motorway", "#f2d49e",
  "trunk", "#f0d7a8",
  "primary", "#eedab3",
  "secondary", "#eadcbd",
  "tertiary", "#e5d8bb",
  "minor", "#dfd3b7",
  "service", "#d9cdb2",
  "path", "#cdbf9f",
  "track", "#c9bb9b",
  "#e0d4b9",
];

const roadCasingColors = [
  "match",
  ["get", "class"],
  "motorway", "#9e7655",
  "trunk", "#a27b59",
  "primary", "#a98261",
  "secondary", "#ad8c6d",
  "tertiary", "#b59a7e",
  "minor", "#b8a58d",
  "service", "#bcae98",
  "#ad957a",
];

function stripNetworkNoise(style) {
  const copy = structuredClone(style);
  copy.name = "Goldline Lantern City Vector Base";
  delete copy.sprite;
  delete copy.glyphs;

  // Pin the geographic source explicitly. There is no satellite/raster source
  // in the production fantasy renderer.
  copy.sources.openmaptiles = {
    type: "vector",
    tiles: [OPENFREE_TILES],
    maxzoom: 14,
  };
  for (const [name, source] of Object.entries(copy.sources)) {
    if (name !== "openmaptiles" && source?.type === "raster") delete copy.sources[name];
  }
  copy.layers = copy.layers.filter(layer => !layer.source || copy.sources[layer.source]);
  return copy;
}

function fantasyStyle(baseStyle, waterways) {
  const style = stripNetworkNoise(baseStyle);
  const layers = [];

  for (const original of style.layers) {
    const layer = structuredClone(original);
    const sourceLayer = layer["source-layer"] || "";
    const id = String(layer.id || "").toLowerCase();

    if (layer.type === "symbol") {
      layer.layout = { ...(layer.layout || {}), visibility: "none" };
      layers.push(layer);
      continue;
    }
    if (layer.type === "raster") {
      layer.layout = { ...(layer.layout || {}), visibility: "none" };
      layers.push(layer);
      continue;
    }
    if (layer.type === "background") {
      layer.paint = { ...(layer.paint || {}), "background-color": "#ead7a8" };
      layers.push(layer);
      continue;
    }

    if (sourceLayer === "water") {
      if (layer.type === "fill") {
        layer.paint = {
          ...(layer.paint || {}),
          "fill-color": "#21b9e5",
          "fill-opacity": 0.96,
          "fill-outline-color": "#0f84af",
        };
      } else if (layer.type === "line") {
        layer.paint = {
          ...(layer.paint || {}),
          "line-color": "#0c86b4",
          "line-opacity": 0.9,
        };
      }
    } else if (sourceLayer === "waterway") {
      if (layer.type === "line") {
        layer.paint = {
          ...(layer.paint || {}),
          "line-color": "#1aaedb",
          "line-opacity": 0.95,
        };
      }
    } else if (sourceLayer === "park") {
      if (layer.type === "fill") {
        layer.paint = {
          ...(layer.paint || {}),
          "fill-color": "#75a04c",
          "fill-opacity": 0.92,
          "fill-outline-color": "#5d873f",
        };
      }
    } else if (sourceLayer === "landcover") {
      if (layer.type === "fill") {
        layer.paint = {
          ...(layer.paint || {}),
          "fill-color": landcoverColors,
          "fill-opacity": 0.9,
        };
      }
    } else if (sourceLayer === "landuse") {
      if (layer.type === "fill") {
        layer.paint = {
          ...(layer.paint || {}),
          "fill-color": landuseColors,
          "fill-opacity": 0.9,
        };
      }
    } else if (sourceLayer === "building" && layer.type === "fill") {
      const shadow = structuredClone(layer);
      shadow.id = `${layer.id}-goldline-shadow`;
      shadow.paint = {
        "fill-color": "#6c4f3a",
        "fill-opacity": 0.22,
        "fill-translate": [2.4, 3.2],
        "fill-translate-anchor": "map",
      };
      layers.push(shadow);
      layer.paint = {
        ...(layer.paint || {}),
        "fill-color": [
          "interpolate",
          ["linear"],
          ["coalesce", ["get", "render_height"], 8],
          0, "#ead3a5",
          18, "#f3dfb8",
          55, "#f6e8cb",
          160, "#fff0cf",
        ],
        "fill-opacity": 0.98,
        "fill-outline-color": "#c18d62",
      };
    } else if (sourceLayer === "transportation" && layer.type === "line") {
      const isCasing = /casing|outline|background/.test(id);
      const isRail = /rail/.test(id);
      layer.paint = {
        ...(layer.paint || {}),
        "line-color": isRail ? "#8f7f70" : isCasing ? roadCasingColors : roadColors,
        "line-opacity": isRail ? 0.64 : 0.98,
      };
    } else if (sourceLayer === "boundary" && layer.type === "line") {
      layer.paint = {
        ...(layer.paint || {}),
        "line-color": "#9e8063",
        "line-opacity": 0.16,
      };
    } else if (sourceLayer === "aeroway") {
      if (layer.type === "fill") {
        layer.paint = { ...(layer.paint || {}), "fill-color": "#ddc9a3", "fill-opacity": 0.8 };
      } else if (layer.type === "line") {
        layer.paint = { ...(layer.paint || {}), "line-color": "#bfa785", "line-opacity": 0.7 };
      }
    }

    layers.push(layer);
  }

  style.sources["goldline-fantasy-waterways"] = { type: "geojson", data: waterways };
  const firstRoad = layers.findIndex(layer => layer["source-layer"] === "transportation");
  const insertAt = firstRoad >= 0 ? firstRoad : layers.length;
  const canalWidth = ["interpolate", ["linear"], ["zoom"], 10, 18, 14, ["get", "width"]];
  const canalBankWidth = ["interpolate", ["linear"], ["zoom"], 10, 28, 14, ["+", ["get", "width"], 18]];
  const canalDepthWidth = ["interpolate", ["linear"], ["zoom"], 10, 23, 14, ["+", ["get", "width"], 8]];

  layers.splice(
    insertAt,
    0,
    {
      id: "goldline-fantasy-canal-bank",
      type: "line",
      source: "goldline-fantasy-waterways",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#e6d3aa",
        "line-width": canalBankWidth,
        "line-opacity": 0.98,
      },
    },
    {
      id: "goldline-fantasy-canal-depth",
      type: "line",
      source: "goldline-fantasy-waterways",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#087fae",
        "line-width": canalDepthWidth,
        "line-opacity": 0.98,
      },
    },
    {
      id: "goldline-fantasy-canal-water",
      type: "line",
      source: "goldline-fantasy-waterways",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#20c5ee",
        "line-width": canalWidth,
        "line-opacity": 0.98,
      },
    },
    {
      id: "goldline-fantasy-canal-sunline",
      type: "line",
      source: "goldline-fantasy-waterways",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(222,250,255,0.78)",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.2, 14, 3.2],
        "line-offset": ["interpolate", ["linear"], ["zoom"], 10, -3, 14, -9],
        "line-opacity": 0.72,
      },
    },
  );

  style.layers = layers;
  return style;
}

function truthStyle(baseStyle) {
  const style = stripNetworkNoise(baseStyle);
  for (const layer of style.layers) {
    const sourceLayer = layer["source-layer"] || "";
    if (layer.type === "symbol" || layer.type === "raster") {
      layer.layout = { ...(layer.layout || {}), visibility: "none" };
    } else if (layer.type === "background") {
      layer.paint = { ...(layer.paint || {}), "background-color": "#ece7dd" };
    } else if (sourceLayer === "water" && layer.type === "fill") {
      layer.paint = { ...(layer.paint || {}), "fill-color": "#9dd7e8", "fill-opacity": 1 };
    } else if ((sourceLayer === "park" || sourceLayer === "landcover") && layer.type === "fill") {
      layer.paint = { ...(layer.paint || {}), "fill-color": "#b7cda0", "fill-opacity": 0.78 };
    } else if (sourceLayer === "landuse" && layer.type === "fill") {
      layer.paint = { ...(layer.paint || {}), "fill-color": "#e5dfd4", "fill-opacity": 0.86 };
    } else if (sourceLayer === "building" && layer.type === "fill") {
      layer.paint = {
        ...(layer.paint || {}),
        "fill-color": "#cfc7ba",
        "fill-opacity": 0.95,
        "fill-outline-color": "#a9a095",
      };
    } else if (sourceLayer === "transportation" && layer.type === "line") {
      layer.paint = { ...(layer.paint || {}), "line-color": "#fbfaf5", "line-opacity": 0.94 };
    }
  }
  return style;
}

async function localPageServer() {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body,#map{margin:0;width:100%;height:100%;overflow:hidden;background:#ead7a8}canvas{outline:none}</style></head><body><div id="map"></div></body></html>`;
  const server = http.createServer((_req, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(html);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind local renderer page");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function renderMap({ browser, maplibreSource, style, projection, width, height, dpr, output, jpeg = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("console", message => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", error => errors.push(error.message));

  const { server, url } = await localPageServer();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.addScriptTag({ content: maplibreSource });
    await page.evaluate(
      async ({ styleDocument, p }) => {
        const map = new window.maplibregl.Map({
          container: "map",
          style: styleDocument,
          attributionControl: false,
          interactive: false,
          preserveDrawingBuffer: true,
          fadeDuration: 0,
          bearing: 0,
          pitch: 0,
        });
        window.__goldlineMap = map;
        map.fitBounds(
          [[Number(p.west), Number(p.south)], [Number(p.east), Number(p.north)]],
          { padding: 0, animate: false, duration: 0 },
        );
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("MapLibre render timed out")), 120000);
          map.once("idle", () => {
            clearTimeout(timer);
            resolve();
          });
          map.once("error", event => {
            const message = event?.error?.message || "MapLibre map error";
            if (/glyph|sprite/i.test(message)) return;
            console.error(message);
          });
        });
        // Give late vector tile uploads one additional animation frame before capture.
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      },
      { styleDocument: style, p: projection },
    );

    if (errors.some(error => /403|Failed to fetch|CORS|WebGL context lost/i.test(error))) {
      throw new Error(`Vector renderer network/WebGL failure:\n${errors.join("\n")}`);
    }

    await page.screenshot(
      jpeg
        ? { path: output, type: "jpeg", quality: 91, scale: "device" }
        : { path: output, type: "png", scale: "device" },
    );
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
}

async function main() {
  await fs.mkdir(MASTER_DIR, { recursive: true });
  await fs.mkdir(path.dirname(TRUTH_PATH), { recursive: true });

  const [projection, waterwaysText, baseStyleText, maplibreSource] = await Promise.all([
    projectionFromExport(),
    fs.readFile(WATERWAYS_PATH, "utf8"),
    fetchText(OPENFREE_STYLE),
    fetchText(MAPLIBRE_JS),
  ]);
  const waterways = JSON.parse(waterwaysText);
  const baseStyle = JSON.parse(baseStyleText);

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-angle=swiftshader",
    ],
  });
  try {
    console.log(`Rendering fantasy vector master ${MASTER_W}x${MASTER_H} from real map geometry...`);
    await renderMap({
      browser,
      maplibreSource,
      style: fantasyStyle(baseStyle, waterways),
      projection,
      width: CSS_W,
      height: CSS_H,
      dpr: DPR,
      output: MASTER_PATH,
    });

    console.log("Rendering neutral truth reference for truth-vs-fantasy QA...");
    await renderMap({
      browser,
      maplibreSource,
      style: truthStyle(baseStyle),
      projection,
      width: 1920,
      height: 1080,
      dpr: 1,
      output: TRUTH_PATH,
      jpeg: true,
    });
  } finally {
    await browser.close();
  }

  const cutter = path.resolve(ROOT, "scripts/build-lantern-city-territory-mosaic.py");
  const result = spawnSync("python3", [cutter], {
    stdio: "inherit",
    env: {
      ...process.env,
      LANTERN_MASTER_INPUT: MASTER_PATH,
      LANTERN_MASTER_ATTRIBUTION: "OpenMapTiles Data from OpenStreetMap · rendered with OpenFreeMap vector tiles",
    },
  });
  process.exit(result.status ?? 1);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
