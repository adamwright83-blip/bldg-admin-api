#!/usr/bin/env node
/**
 * Picks which Fast Goldline smoke browser jobs a pull request needs.
 *
 * Default is everything. A job is dropped only when every changed file sits in
 * an area that job provably does not load:
 *   - docs, artifacts and Markdown never reach a browser, so they skip all jobs;
 *   - server areas with no route into the proof worlds (CleanCloud sync, Mitch,
 *     President, procurement), extensions and other workflows skip the
 *     world-specific jobs. The core jobs (world, territories, campaign) still run.
 * An unrecognised path counts as "might matter", so new code runs every job.
 * workflow_dispatch and any API failure also run every job.
 *
 * When ci.yml calls this workflow it has already chosen the entries (scripts/ci/ciAreas.mjs) and passes
 * their names as BROWSER_ENTRIES, a JSON array; this script then runs exactly those. "auto" or unset keeps
 * the choice above.
 *
 * Writes `matrix=<json>` for $GITHUB_OUTPUT.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MATRIX = new URL("../../.github/goldline-fast-smoke-matrix.json", import.meta.url);

const NO_BROWSER = [/^docs\//, /^artifacts\//, /\.md$/i];

const NO_WORLD = [
  /^server\/integrations\/cleancloud\//,
  /^server\/mitch\//,
  /^server\/president\//,
  /^server\/procurement\//,
  /^extensions\//,
  // Other workflows. This one and its matrix stay "might matter".
  /^\.github\/workflows\/(?!goldline-fast-smoke\.yml$)/,
];

/** @returns {"none" | "core" | "all"} */
export function smokeScope(files) {
  if (files === null) return "all";
  let scope = "none";
  for (const file of files) {
    if (NO_BROWSER.some(re => re.test(file))) continue;
    if (NO_WORLD.some(re => re.test(file))) {
      scope = "core";
      continue;
    }
    return "all";
  }
  return scope;
}

/** Entries named in BROWSER_ENTRIES, or null when the choice is left to smokeScope. */
export function namedEntries(entries, browserEntries) {
  if (!browserEntries || browserEntries === "auto") return null;
  const names = JSON.parse(browserEntries);
  const unknown = names.filter(name => !entries.some(entry => entry.name === name));
  if (unknown.length) throw new Error(`browser-scope: no matrix entry named ${unknown.join(", ")}`);
  return entries.filter(entry => names.includes(entry.name));
}

export function selectEntries(entries, scope) {
  if (scope === "none") return [];
  if (scope === "core") return entries.filter(entry => entry.scope === "core");
  return entries;
}

async function changedFiles() {
  const { GITHUB_REPOSITORY: repo, PR_NUMBER: pr, GH_TOKEN: token } = process.env;
  if (!repo || !pr) return null; // workflow_dispatch
  const files = [];
  for (let page = 1; page <= 30; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/pulls/${pr}/files?per_page=100&page=${page}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } }
    );
    if (!res.ok) {
      console.error(`browser-scope: GitHub API ${res.status}; running every job`);
      return null;
    }
    const batch = await res.json();
    for (const f of batch) {
      files.push(f.filename);
      if (f.previous_filename) files.push(f.previous_filename);
    }
    if (batch.length < 100) return files;
  }
  return null; // more than 3000 files: run everything
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entries = JSON.parse(readFileSync(MATRIX, "utf8"));
  const named = namedEntries(entries, process.env.BROWSER_ENTRIES);
  if (named) {
    console.error(`browser-scope: ci.yml chose ${named.map(entry => entry.name).join(", ") || "no browser jobs"}`);
    console.log(`matrix=${JSON.stringify(named)}`);
    process.exit(0);
  }
  const files = await changedFiles();
  const scope = smokeScope(files);
  const selected = selectEntries(entries, scope);
  console.error(
    `browser-scope: ${files === null ? "all files" : `${files.length} files`} -> ${scope}: ${
      selected.map(entry => entry.name).join(", ") || "no browser jobs"
    }`
  );
  console.log(`matrix=${JSON.stringify(selected)}`);
}
