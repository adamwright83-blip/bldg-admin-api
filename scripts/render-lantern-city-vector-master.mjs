import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.resolve("scripts/build-lantern-city-territory-mosaic.py");
const result = spawnSync("python3", [script], { stdio: "inherit" });
process.exit(result.status ?? 1);
