import fs from "node:fs/promises";
import path from "node:path";

const file = path.resolve(
  "client/src/components/admin/control-room/WorldGeographySurface.tsx"
);
let source = await fs.readFile(file, "utf8");

const importAnchor = 'import { FactionBattlefieldLayer } from "./FactionBattlefieldLayer";';
if (!source.includes('import { LanternTerritoryMosaic } from "./LanternTerritoryMosaic";')) {
  if (!source.includes(importAnchor)) throw new Error("WorldGeographySurface import anchor changed");
  source = source.replace(
    importAnchor,
    `${importAnchor}\nimport { LanternTerritoryMosaic } from "./LanternTerritoryMosaic";`
  );
}

const atlasAnchor = 'const ATLAS_IMAGE = "/assets/admin/control-room/world/lantern-city-atlas-v4.png";';
if (!source.includes("lantern-city-truth-reference.jpg")) {
  if (!source.includes(atlasAnchor)) throw new Error("WorldGeographySurface atlas constant anchor changed");
  source = source.replace(
    atlasAnchor,
    `${atlasAnchor}\nconst TRUTH_IMAGE = "/assets/admin/control-room/world/lantern-city-truth-reference.jpg";`
  );
}

const territoryDebugAnchor = `  const territoryDebug =\n    typeof window !== "undefined" &&\n    new URLSearchParams(window.location.search).get("territoryDebug") === "1";`;
if (!source.includes("const worldTruth =")) {
  if (!source.includes(territoryDebugAnchor)) throw new Error("WorldGeographySurface query flag anchor changed");
  source = source.replace(
    territoryDebugAnchor,
    `${territoryDebugAnchor}\n  // Permanent QA switch: the real vector map and the fantasy surface occupy\n  // the exact same Mercator canvas. Towers/lanterns stay put while only the\n  // presentation skin changes, so registration drift becomes visually obvious.\n  const worldTruth =\n    typeof window !== "undefined" &&\n    new URLSearchParams(window.location.search).get("worldTruth") === "1";`
  );
}

source = source.replace(
  '            src={ATLAS_IMAGE}',
  '            src={worldTruth ? TRUTH_IMAGE : ATLAS_IMAGE}'
);
source = source.replace(
  '            alt="Fictional daylight Los Angeles kingdom atlas; real entities are positioned from geographic evidence"',
  '            alt={worldTruth ? "Neutral real-vector Los Angeles registration reference" : "Fictional daylight Los Angeles kingdom atlas; real entities are positioned from geographic evidence"}'
);
source = source.replace(
  '          <div className="cr-world-skin-shade" />',
  '          {!worldTruth ? <div className="cr-world-skin-shade" /> : null}'
);

const skinAnchor = `        </div>\n\n      {/* 2. Living Atmosphere Overlay: real clouds, AQI haze, rain */}`;
if (!source.includes("<LanternTerritoryMosaic />")) {
  if (!source.includes(skinAnchor)) throw new Error("WorldGeographySurface skin anchor changed");
  source = source.replace(
    skinAnchor,
    `        </div>\n\n      {/* 1b. HD geography-locked territory mosaic. The v4 atlas remains the safety underlay. */}\n      {!googleVisible && !worldTruth ? <LanternTerritoryMosaic /> : null}\n\n      {/* 2. Living Atmosphere Overlay: real clouds, AQI haze, rain */}`
  );
} else {
  source = source.replace(
    "{!googleVisible ? <LanternTerritoryMosaic /> : null}",
    "{!googleVisible && !worldTruth ? <LanternTerritoryMosaic /> : null}"
  );
}

source = source.replace(
  "<WorldAtmosphereOverlay atmosphere={atmosphere} />",
  '<WorldAtmosphereOverlay atmosphere={mode === "lantern_atlas" || worldTruth ? null : atmosphere} />'
);
source = source.replace(
  '<WorldAtmosphereOverlay atmosphere={mode === "lantern_atlas" ? null : atmosphere} />',
  '<WorldAtmosphereOverlay atmosphere={mode === "lantern_atlas" || worldTruth ? null : atmosphere} />'
);
source = source.replace(
  "{combatPresentation && !googleVisible ? (",
  '{combatPresentation && !googleVisible && mode !== "lantern_atlas" && !worldTruth ? ('
);
source = source.replace(
  '{combatPresentation && !googleVisible && mode !== "lantern_atlas" ? (',
  '{combatPresentation && !googleVisible && mode !== "lantern_atlas" && !worldTruth ? ('
);
source = source.replace(
  "{showOpportunityLayer && opportunity && !googleVisible ? (",
  '{showOpportunityLayer && opportunity && !googleVisible && mode !== "lantern_atlas" && !worldTruth ? ('
);
source = source.replace(
  '{showOpportunityLayer && opportunity && !googleVisible && mode !== "lantern_atlas" ? (',
  '{showOpportunityLayer && opportunity && !googleVisible && mode !== "lantern_atlas" && !worldTruth ? ('
);

// The opportunity projection currently arrives through a loosely typed tRPC
// surface in this legacy component. Keep the integration patch from adding a
// new noImplicitAny failure while the repo-wide historical type debt remains.
source = source.replace(
  "opportunity.districts.map(district => (",
  "opportunity.districts.map((district: any) => ("
);

source = source.replace(
  '      data-day-phase="day"',
  '      data-day-phase="day"\n      data-world-truth={worldTruth ? "1" : "0"}'
);

await fs.writeFile(file, source);
console.log("WorldGeographySurface patched for HD fantasy mosaic, clean lighting, and truth-vs-fantasy QA.");
