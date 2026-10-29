/**
 * Structural check of scenario files. Prints only ids and problem counts, so a
 * sealed set can be verified without reading its contents.
 *
 *   pnpm tsx server/claire/prototype/evals/validateScenarios.ts [dev|sealed|all]
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateScenario, type Scenario } from "./scenario";

export function loadScenarioSet(set: "dev" | "sealed"): Scenario[] {
  const dir = path.resolve(import.meta.dirname, "scenarios", set);
  return readdirSync(dir)
    .filter(file => file.endsWith(".json"))
    .sort()
    .map(file => JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Scenario);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const which = (process.argv[2] ?? "all") as "dev" | "sealed" | "all";
  const sets = which === "all" ? (["dev", "sealed"] as const) : ([which] as const);
  let failed = 0;
  for (const set of sets) {
    const scenarios = loadScenarioSet(set);
    const ids = new Set<string>();
    for (const scenario of scenarios) {
      const problems = validateScenario(scenario);
      if (ids.has(scenario.id)) problems.push("duplicate id");
      ids.add(scenario.id);
      if (problems.length) failed += 1;
      console.log(`${set}\t${scenario.id}\t${scenario.operator.mode}\t${problems.length ? "PROBLEMS: " + problems.join("; ") : "ok"}`);
    }
    console.log(`${set}: ${scenarios.length} scenarios`);
  }
  process.exit(failed ? 1 : 0);
}
