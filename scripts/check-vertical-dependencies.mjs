import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const roots = [
  "server/persistentOperator",
  "server/executionIntelligence",
];
const explicitGenericFiles = [
  "server/strategy/verticalTemplates/registry.ts",
  "shared/executionIntelligence.ts",
  "shared/tenantSourceAdapters.ts",
];

function filesUnder(root) {
  const out = [];
  function visit(path) {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (/\.[cm]?[jt]s$/.test(path) && !/\.(?:test|spec)\.[cm]?[jt]s$/.test(path)) {
      out.push(path);
    }
  }
  try { visit(root); } catch {}
  return out;
}

const files = [...new Set([
  ...roots.flatMap(filesUnder),
  ...explicitGenericFiles,
])];

const violations = [];
for (const path of files) {
  const source = readFileSync(path, "utf8");
  if (/from\s+["'][^"']*verticalTemplates\/(?:laundryFluffFold|multifamilyServiceVendor)["']/.test(source)) {
    violations.push(`${path}: generic core imports a concrete vertical implementation`);
  }
  for (const verticalId of ["laundry_fluff_fold", "multifamily_service_vendor"]) {
    if (source.includes(`"${verticalId}"`) || source.includes(`'${verticalId}'`)) {
      violations.push(`${path}: generic core branches or binds directly to concrete vertical id ${verticalId}`);
    }
  }
}

if (violations.length) {
  console.error(violations.join("\n"));
  process.exit(1);
}
console.log(`Vertical dependency check passed across ${files.length} generic core files.`);
