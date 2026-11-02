#!/usr/bin/env node
/**
 * merge-gate: the one check main requires. It runs on every ci.yml run, after everything else, and fails
 * unless
 *   - the scope job succeeded and said which jobs this change needs,
 *   - each of those jobs succeeded, and
 *   - no job failed or was cancelled, needed or not.
 * A job the scope did not select is skipped, and that is a pass. So a path-skipped suite can never leave a
 * merge waiting on a check that will not come, and a needed suite can never be skipped into a pass.
 *
 * Reads NEEDS (toJSON(needs) of the merge-gate job).
 */
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * @param {Record<string, { result: string, outputs?: Record<string, string> }>} needs
 * @returns {{ ok: boolean, rows: Array<{ job: string, required: boolean, result: string, ok: boolean }>, problem?: string }}
 */
export function judge(needs) {
  const scope = needs.scope;
  if (!scope || scope.result !== "success") {
    return { ok: false, rows: [], problem: `scope job ${scope ? scope.result : "missing"}: nothing can be judged` };
  }
  let required;
  try {
    required = JSON.parse(scope.outputs?.jobs ?? "");
    if (!Array.isArray(required) || !required.length) throw new Error("empty");
  } catch {
    return { ok: false, rows: [], problem: "scope job gave no list of required jobs" };
  }
  const unknown = required.filter(job => !(job in needs));
  if (unknown.length) {
    return { ok: false, rows: [], problem: `scope requires jobs merge-gate does not wait for: ${unknown.join(", ")}` };
  }
  const rows = Object.entries(needs)
    .filter(([job]) => job !== "scope")
    .map(([job, { result }]) => {
      const isRequired = required.includes(job);
      const ok = isRequired ? result === "success" : result === "success" || result === "skipped";
      return { job, required: isRequired, result, ok };
    });
  return { ok: rows.every(row => row.ok), rows };
}

export function report({ ok, rows, problem }) {
  const lines = [`### merge-gate: ${ok ? "pass" : "FAIL"}`, ""];
  if (problem) lines.push(problem, "");
  if (rows.length) {
    lines.push("| Job | Needed | Result |", "| --- | --- | --- |");
    for (const row of rows) lines.push(`| ${row.job} | ${row.required ? "yes" : "no"} | ${row.ok ? row.result : `**${row.result}**`} |`);
  }
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const verdict = judge(JSON.parse(process.env.NEEDS ?? "{}"));
  const text = report(verdict);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  process.exit(verdict.ok ? 0 : 1);
}
