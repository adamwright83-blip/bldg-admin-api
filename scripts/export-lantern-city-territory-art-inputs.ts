import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  GOLDLINE_LA_VIEWPORT,
  projectLatLngToLanternAtlas,
} from "../shared/lanternCity";
import {
  LANTERN_TERRITORIES,
  classifyTerritory,
  geometryContainsPoint,
} from "../shared/lanternTerritories";
import { CANONICAL_BUILDING_GEOGRAPHY } from "../shared/canonicalGeography";

type Coordinate = { latitude: number; longitude: number };
const output = path.resolve("artifacts/lantern-city-territory-art-inputs");
const customerFile = process.env.LANTERN_CUSTOMER_COORDINATES;

function projectedGeometry(geometry: (typeof LANTERN_TERRITORIES)[number]["geometry"]) {
  const projectRing = (ring: [number, number][]) => ring.map(([longitude, latitude]) => {
    const { x, y } = projectLatLngToLanternAtlas({ latitude, longitude });
    return [x, y];
  });
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: geometry.coordinates.map(projectRing) }
    : { type: "MultiPolygon", coordinates: geometry.coordinates.map(poly => poly.map(projectRing)) };
}

let customers: Coordinate[] = [];
if (customerFile) {
  const parsed = JSON.parse(await readFile(customerFile, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("LANTERN_CUSTOMER_COORDINATES must contain a JSON array");
  customers = parsed.map((row, index) => {
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error(`Invalid coordinate at customer row ${index}`);
    return { latitude, longitude };
  });
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

const towers = Object.values(CANONICAL_BUILDING_GEOGRAPHY).map(tower => ({
  id: tower.id,
  name: tower.name,
  latitude: tower.latitude,
  longitude: tower.longitude,
}));

const manifest = {
  generatedAt: new Date().toISOString(),
  projection: { ...GOLDLINE_LA_VIEWPORT, type: "existing Goldline Mercator atlas projection" },
  customerDataStatus: customerFile ? "coordinate_only_input" : "unavailable_no_coordinate_input",
  customerCount: customers.length,
  customerClassifications: customers.map(point => ({ ...point, territoryId: classifyTerritory(point.latitude, point.longitude)?.id ?? null })),
  towers: towers.map(tower => ({ ...tower, territoryId: classifyTerritory(tower.latitude, tower.longitude)?.id ?? null })),
  territories: LANTERN_TERRITORIES.map(territory => ({
    territoryId: territory.id,
    name: territory.name,
    sourceType: territory.sourceType,
    parentTerritory: territory.parentTerritory,
    boundaryBasis: territory.boundaryBasis,
    realGeometry: territory.geometry,
    projectedGeometry: projectedGeometry(territory.geometry),
    customers: customers.filter(point => geometryContainsPoint(territory.geometry, [point.longitude, point.latitude])),
    towers: towers.filter(tower => geometryContainsPoint(territory.geometry, [tower.longitude, tower.latitude])),
  })),
};
await writeFile(path.join(output, "_authoritative-manifest.json"), JSON.stringify(manifest, null, 2));

const render = spawnSync("python3", [path.resolve("scripts/render-lantern-city-territory-art-inputs.py"), output], { stdio: "inherit" });
if (render.status !== 0) process.exit(render.status ?? 1);

const zipPath = `${output}.zip`;
await rm(zipPath, { force: true });
const zip = spawnSync("zip", ["-qr", zipPath, path.basename(output)], { cwd: path.dirname(output), stdio: "inherit" });
if (zip.status !== 0) process.exit(zip.status ?? 1);
console.log(JSON.stringify({ territoryPackages: manifest.territories.length, customerDataStatus: manifest.customerDataStatus, zipPath }, null, 2));
