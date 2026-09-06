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

const skinAnchor = `        </div>\n\n      {/* 2. Living Atmosphere Overlay: real clouds, AQI haze, rain */}`;
if (!source.includes("<LanternTerritoryMosaic />")) {
  if (!source.includes(skinAnchor)) throw new Error("WorldGeographySurface skin anchor changed");
  source = source.replace(
    skinAnchor,
    `        </div>\n\n      {/* 1b. HD geography-locked territory mosaic. The v4 atlas remains the safety underlay. */}\n      {!googleVisible ? <LanternTerritoryMosaic /> : null}\n\n      {/* 2. Living Atmosphere Overlay: real clouds, AQI haze, rain */}`
  );
}

source = source.replace(
  "<WorldAtmosphereOverlay atmosphere={atmosphere} />",
  '<WorldAtmosphereOverlay atmosphere={mode === "lantern_atlas" ? null : atmosphere} />'
);
source = source.replace(
  "{combatPresentation && !googleVisible ? (",
  '{combatPresentation && !googleVisible && mode !== "lantern_atlas" ? ('
);
source = source.replace(
  "{showOpportunityLayer && opportunity && !googleVisible ? (",
  '{showOpportunityLayer && opportunity && !googleVisible && mode !== "lantern_atlas" ? ('
);

await fs.writeFile(file, source);
console.log("WorldGeographySurface patched for HD territory mosaic and clean Lantern City lighting.");
