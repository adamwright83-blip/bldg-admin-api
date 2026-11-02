#!/usr/bin/env node
/**
 * Picks the CI areas a change needs (table in ciAreas.mjs) for .github/workflows/ci.yml.
 *
 *   pull_request       the files the merge commit changes against its base (HEAD^1)
 *   push to main       the global guards and the type-check only
 *   schedule, dispatch everything: every area, the whole unit suite, every browser entry
 * If the changed files cannot be read, everything runs.
 *
 * Every pull request runs the nomenclature and story spoiler guards. Any code change also runs the
 * type-check and the unit tests that import a changed file (all of them for a full-regression change).
 *
 * Writes to $GITHUB_OUTPUT:
 *   jobs              JSON array of ci.yml jobs that must run; merge-gate requires each to pass
 *   unit_tests        space-separated unit test files, or "" for the whole suite
 *   unit_shards       JSON array of shard numbers, unit_shard_total their count
 *   story_mysql       true | false
 *   smoke_contracts   true | false
 *   smoke_entries     JSON array of Fast Goldline browser entries
 * and a table of every area, with the file and rule that selected it, to $GITHUB_STEP_SUMMARY.
 *
 * Locally: node scripts/ci/ciScopes.mjs --base origin/main   (or --files a.ts b.ts) prints that table.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { AREAS, FULL_REGRESSION, LAYERS, NO_CODE, STANDALONE } from "./ciAreas.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Jobs every run has. merge-gate requires them whenever they are selected. */
export const BASE_JOBS = ["guards", "story"];

/** Unit tests the default Vitest config collects (vitest.config.ts include/exclude). */
const UNIT_TEST = /^(?:server|client|shared)\/.+\.(?:test|spec)\.ts$/;
const INTEGRATION_TEST = /\.integration\.test\.ts$/;
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** More affected unit tests than this run the whole suite on four shards. */
const WHOLE_SUITE_AT = 450;
const TESTS_PER_SHARD = 150;
/** Vitest receives these names as arguments; anything else runs the whole suite instead. */
const SAFE_PATH = /^[\w./@+-]+$/;

/** How far an area follows imports from what its workflow runs (see importedWithin). */
const IMPORT_DEPTH = 2;

const CODE = /\.(?:[cm]?[jt]sx?)$/;
/** Type-checked or bundled inputs. A change elsewhere (an image, a font) does not need tsc. */
const TYPED = /\.(?:[cm]?[jt]sx?|json)$/;
/** Reached at runtime by spawning the server; the server layer covers it. Its own imports are not followed. */
const LEAF = new Set(["server/_core/index.ts"]);
const ALIASES = [
  ["@/", "client/src/"],
  ["@shared/", "shared/"],
  ["@assets/", "attached_assets/"],
];
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];
/** pnpm commands that are not package scripts, and scripts other areas own (build/boot: schema-release). */
const NOT_A_ROOT_SCRIPT = new Set(["install", "exec", "dlx", "vitest", "tsx", "playwright", "build", "start", "check", "test"]);

// ── Globs ────────────────────────────────────────────────────────────────────────────────────

const globCache = new Map();

/** GitHub paths-filter globs: `**` crosses directories, `*` and `?` do not; `[...]` and `{a,b}` as usual. */
export function globToRegExp(glob) {
  let cached = globCache.get(glob);
  if (cached) return cached;
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else if (c === "[") {
      const end = glob.indexOf("]", i);
      re += glob.slice(i, end + 1);
      i = end;
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      re += `(?:${glob.slice(i + 1, end).split(",").map(escapeRegExp).join("|")})`;
      i = end;
    } else re += escapeRegExp(c);
  }
  cached = new RegExp(`^${re}$`);
  globCache.set(glob, cached);
  return cached;
}

function escapeRegExp(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** The first glob that matches `file`, or null. */
export function matchGlob(globs, file) {
  return globs.find(glob => globToRegExp(glob).test(file)) ?? null;
}

// ── Import graph ─────────────────────────────────────────────────────────────────────────────

// import/export ... from "x", import "x", import("x"), require("x"). Type-only imports carry no runtime code.
const IMPORT =
  /\b(?:import|export)\s+(type\s+)?(?:[\w*${}\s,]*?\s*from\s*)?["'`]([^"'`\n]+)["'`]|\bimport\s*\(\s*["'`]([^"'`\n]+)["'`]\s*\)|\brequire\s*\(\s*["'`]([^"'`\n]+)["'`]\s*\)/g;
// A quoted repo path or relative path: tests that read source files, migrate.mjs reading drizzle/*.sql.
const FILE_LITERAL =
  /["'`]((?:\.{1,2}\/|(?:server|shared|client|drizzle|scripts|e2e|extensions|\.github)\/)[^"'`\s$]+?\.(?:[cm]?[jt]sx?|json|sql|ya?ml|sh|css|html))["'`]/g;

/**
 * @param {string[]} files  tracked files
 * @param {(file: string) => string} read
 * @param {Iterable<string>} [extra]  paths that resolve but are not tracked (deleted in this change)
 */
export function buildGraph(files, read, extra = []) {
  const known = new Set([...files, ...extra]);
  /** @type {Map<string, Set<string>>} file -> files it imports */
  const imports = new Map();
  /** @type {Map<string, Set<string>>} file -> files that import it */
  const dependents = new Map();
  const add = (map, key, value) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(value);
  };
  const addEdge = (from, to) => {
    if (from === to) return;
    add(imports, from, to);
    add(dependents, to, from);
  };
  for (const file of files) {
    if (!CODE.test(file) || LEAF.has(file)) continue;
    let source;
    try {
      source = read(file);
    } catch {
      continue;
    }
    for (const match of source.matchAll(IMPORT)) {
      if (match[1]) continue;
      const target = resolveImport(file, match[2] ?? match[3] ?? match[4], known);
      if (target) addEdge(file, target);
    }
    for (const match of source.matchAll(FILE_LITERAL)) {
      const literal = match[1];
      const target = literal.startsWith(".") ? posix.normalize(posix.join(posix.dirname(file), literal)) : literal;
      if (known.has(target)) addEdge(file, target);
    }
  }
  return { imports, dependents, known };
}

export function resolveImport(from, spec, known) {
  spec = spec.split("?")[0];
  let base = null;
  for (const [alias, dir] of ALIASES) if (spec.startsWith(alias)) base = dir + spec.slice(alias.length);
  if (base === null) {
    if (!spec.startsWith(".")) return null; // a package
    base = posix.normalize(posix.join(posix.dirname(from), spec));
  }
  const stems = [base];
  const js = base.match(/^(.*)\.[cm]?jsx?$/);
  if (js) stems.push(js[1]); // TypeScript ESM: "./x.js" is ./x.ts
  for (const stem of stems) {
    if (known.has(stem)) return stem;
    for (const ext of EXTENSIONS) if (known.has(stem + ext)) return stem + ext;
    for (const ext of EXTENSIONS) if (known.has(`${stem}/index${ext}`)) return `${stem}/index${ext}`;
  }
  return null;
}

/**
 * Files `roots` import within `depth` steps, mapped to the root that reaches them. Depth 2 is a suite's
 * tests, the modules they test and what those modules import. Following every step instead reaches most
 * of the server from any router, which would select every suite for every server change.
 */
export function importedWithin(graph, roots, depth) {
  const via = new Map();
  let frontier = [...roots];
  for (const root of frontier) via.set(root, root);
  for (let step = 0; step < depth && frontier.length; step++) {
    const next = [];
    for (const file of frontier) {
      for (const target of graph.imports.get(file) ?? []) {
        if (via.has(target)) continue;
        via.set(target, via.get(file));
        next.push(target);
      }
    }
    frontier = next;
  }
  return via;
}

/** Every file that imports, directly or not, one of `changed`, mapped to the changed file it reaches. */
export function affectedBy(graph, changed) {
  const via = new Map();
  const queue = [];
  for (const file of changed) {
    via.set(file, file);
    queue.push(file);
  }
  while (queue.length) {
    const file = queue.shift();
    for (const dependent of graph.dependents.get(file) ?? []) {
      if (via.has(dependent)) continue;
      via.set(dependent, via.get(file));
      queue.push(dependent);
    }
  }
  return via;
}

// ── Area roots: what an area's workflow runs ─────────────────────────────────────────────────

const PATH_TOKEN =
  /(?<![\w./-])(?:(?:server|shared|client|e2e|scripts|extensions|drizzle|procurement)\/[\w./*@{},-]*[\w*}]|(?:playwright|vite|vitest)[\w.-]*\.config\.ts|tsconfig[\w.-]*\.json)/g;
const PNPM_SCRIPT = /\bpnpm\s+(?:run\s+)?([a-z][\w:.-]*)/g;

/** The lines of one job (two-space-indented key) in a workflow file. */
export function jobBlock(workflowText, job) {
  const lines = workflowText.split("\n");
  const start = lines.findIndex(line => line === `  ${job}:` || line.startsWith(`  ${job}: `));
  if (start < 0) throw new Error(`job ${job} not found`);
  let end = start + 1;
  while (end < lines.length && !/^  [\w-]+:\s*$/.test(lines[end]) && !/^\S/.test(lines[end])) end++;
  return lines.slice(start, end).join("\n");
}

/** Repo paths named in `text`, with package scripts expanded. */
export function pathTokens(text, scripts, seen = new Set()) {
  const tokens = new Set(text.match(PATH_TOKEN) ?? []);
  for (const [, name] of text.matchAll(PNPM_SCRIPT)) {
    if (NOT_A_ROOT_SCRIPT.has(name) || seen.has(name) || !scripts[name]) continue;
    seen.add(name);
    for (const token of pathTokens(scripts[name], scripts, seen)) tokens.add(token);
  }
  return tokens;
}

/** Tracked files a token names: the file, a directory's files, or a glob's matches. */
function filesFor(token, ctx) {
  token = token.replace(/\/$/, "");
  if (ctx.trackedSet.has(token)) return [token];
  if (/[*?[{]/.test(token)) return ctx.tracked.filter(file => globToRegExp(token).test(file));
  return ctx.tracked.filter(file => file.startsWith(`${token}/`));
}

export function areaRoots(area, ctx) {
  let text = ctx.read(`.github/workflows/${area.workflow}`);
  if (area.rootsFromJob) text = jobBlock(text, area.rootsFromJob);
  // What a workflow runs, not what its comments mention.
  text = text.split("\n").filter(line => !line.trimStart().startsWith("#")).join("\n");
  const tokens = pathTokens(text, ctx.scripts);
  for (const root of area.roots ?? []) tokens.add(root);
  if (area.smokeEntry) {
    const entry = ctx.smokeMatrix.find(candidate => candidate.name === area.smokeEntry);
    if (!entry) throw new Error(`${area.id}: no Fast Goldline matrix entry ${area.smokeEntry}`);
    for (const token of pathTokens(entry.command, ctx.scripts)) tokens.add(token);
  }
  const roots = new Set();
  // A Playwright command that names its spec files runs only those, not its config's whole testDir.
  const namesSpecs = [...tokens].some(token => /\.spec\.ts$/.test(token));
  const visit = (file, depth) => {
    if (roots.has(file)) return;
    roots.add(file);
    if (depth > 2) return;
    // Shell scripts and Playwright configs reach their files by path, not by import.
    if (file.endsWith(".sh")) for (const token of pathTokens(ctx.read(file), ctx.scripts)) for (const f of filesFor(token, ctx)) visit(f, depth + 1);
    const testDir = !namesSpecs && /config\.ts$/.test(file) && ctx.read(file).match(/testDir:\s*["'`]([^"'`]+)["'`]/);
    if (testDir) for (const f of filesFor(posix.normalize(posix.join(posix.dirname(file), testDir[1])), ctx)) visit(f, depth + 1);
  };
  for (const token of tokens) for (const file of filesFor(token, ctx)) visit(file, 0);
  // Shared layers reach an area only through `uses`: most suites run migrate.mjs, few depend on its changes.
  // The CI scripts select and gate suites; the scope job tests them.
  const notRoots = [...Object.values(LAYERS).flat(), "scripts/ci/**"];
  for (const file of roots) if (matchGlob(notRoots, file)) roots.delete(file);
  return roots;
}

// ── Selection ────────────────────────────────────────────────────────────────────────────────

/**
 * @param {object} input
 * @param {string} input.event              github.event_name
 * @param {string[] | null} input.changed   null: unknown, run everything
 * @param {string[]} input.tracked
 * @param {(file: string) => string} input.read
 */
export function selectScope({ event, changed, tracked, read }) {
  const ctx = makeContext(tracked, read);
  const unitTests = tracked.filter(file => UNIT_TEST.test(file) && !INTEGRATION_TEST.test(file));

  if (event === "push") {
    return finish(ctx, { mode: "push", changed: [], typecheck: true, areas: new Map(), unit: [] });
  }
  if (event !== "pull_request" || changed === null) {
    const areas = new Map(AREAS.map(area => [area.id, [event === "pull_request" ? "the changed files could not be read" : `${event}: full regression`]]));
    return finish(ctx, { mode: "full", changed: changed ?? [], typecheck: true, areas, unit: null });
  }

  const full = changed.map(file => [file, matchGlob(FULL_REGRESSION, file)]).find(([, glob]) => glob);
  if (full) {
    const reason = `${full[0]} is a full-regression trigger (${full[1]})`;
    return finish(ctx, { mode: "full", changed, typecheck: true, areas: new Map(AREAS.map(area => [area.id, [reason]])), unit: null });
  }

  const graph = buildGraph(tracked.filter(file => CODE.test(file)), ctx.read, changed);
  const reached = affectedBy(graph, changed);
  const areas = new Map();
  for (const area of AREAS) {
    const reasons = [];
    const workflow = `.github/workflows/${area.workflow}`;
    if (changed.includes(workflow)) reasons.push(`${workflow} changed`);
    const depth = area.importDepth ?? IMPORT_DEPTH;
    for (const file of changed) {
      // A test changes only the suites that run it, and roots say which those are. Areas that follow no
      // imports keep their old paths filter exactly, tests included.
      if (depth > 0 && TEST_FILE.test(file)) continue;
      const glob = matchGlob(area.paths ?? [], file);
      if (glob && !matchGlob(area.exclude ?? [], file)) {
        reasons.push(`${file} matches ${glob}`);
        break;
      }
    }
    for (const layer of area.uses ?? []) {
      const file = changed.find(candidate => matchGlob(LAYERS[layer], candidate));
      if (file) {
        reasons.push(`${file} is in the ${layer} layer`);
        break;
      }
    }
    {
      const near = importedWithin(graph, ctx.roots(area), depth);
      const file = changed.find(candidate => near.has(candidate));
      if (file) {
        const root = near.get(file);
        reasons.push(root === file ? `${area.workflow} runs ${file}` : `${area.workflow} runs ${root}, which imports ${file}`);
      }
    }
    if (reasons.length) areas.set(area.id, reasons);
  }
  const code = changed.filter(file => !matchGlob(NO_CODE, file));
  return finish(ctx, {
    mode: "changed",
    changed,
    typecheck: code.some(file => TYPED.test(file)),
    areas,
    // The unit workflow itself changed: prove it on the whole suite.
    unit: changed.includes(".github/workflows/unit-suite.yml") ? null : unitTests.filter(test => reached.has(test)),
  });
}

function makeContext(tracked, read) {
  const scripts = JSON.parse(read("package.json")).scripts ?? {};
  const smokeMatrix = JSON.parse(read(".github/goldline-fast-smoke-matrix.json"));
  const rootsCache = new Map();
  const ctx = {
    tracked,
    trackedSet: new Set(tracked),
    read,
    scripts,
    smokeMatrix,
    roots(area) {
      if (!rootsCache.has(area.id)) rootsCache.set(area.id, areaRoots(area, ctx));
      return rootsCache.get(area.id);
    },
  };
  return ctx;
}

function finish(ctx, { mode, changed, typecheck, areas, unit }) {
  const selected = AREAS.filter(area => areas.has(area.id));
  const unsafe = unit?.some(test => !SAFE_PATH.test(test));
  const whole = unit === null || unsafe || unit.length > WHOLE_SUITE_AT;
  const shardTotal = whole ? 4 : Math.min(4, Math.max(1, Math.ceil(unit.length / TESTS_PER_SHARD)));
  const runUnit = mode !== "push" && (whole || unit.length > 0);
  const jobs = [...BASE_JOBS];
  if (typecheck) jobs.push("typecheck");
  if (runUnit) jobs.push("unit");
  for (const area of selected) if (!jobs.includes(area.job)) jobs.push(area.job);
  return {
    mode,
    changed,
    jobs,
    areas,
    typecheck,
    unit: runUnit ? { whole, tests: whole ? [] : unit, shardTotal } : null,
    storyMysql: areas.has("story"),
    smokeContracts: selected.some(area => area.smokeContracts),
    smokeEntries: selected.filter(area => area.smokeEntry).map(area => area.smokeEntry),
    standalone: STANDALONE,
  };
}

// ── Output ───────────────────────────────────────────────────────────────────────────────────

export function outputs(scope) {
  const shards = scope.unit ? Array.from({ length: scope.unit.shardTotal }, (_, i) => i + 1) : [];
  return {
    jobs: JSON.stringify(scope.jobs),
    unit_tests: scope.unit ? scope.unit.tests.join(" ") : "",
    unit_shards: JSON.stringify(shards),
    unit_shard_total: String(shards.length),
    story_mysql: String(scope.storyMysql),
    smoke_contracts: String(scope.smokeContracts),
    smoke_entries: JSON.stringify(scope.smokeEntries),
  };
}

export function summary(scope) {
  const code = text => `\`${String(text).replaceAll("`", "'")}\``;
  const lines = [`### CI scope: ${scope.mode === "changed" ? `${scope.changed.length} changed files` : scope.mode}`, ""];
  lines.push(`Always: nomenclature and domain guards, story spoiler guard${scope.typecheck ? ", type-check" : ""}.`);
  if (scope.unit) {
    lines.push(scope.unit.whole ? "Unit: the whole suite on 4 shards." : `Unit: ${scope.unit.tests.length} test files that import a changed file, on ${scope.unit.shardTotal} shard(s).`);
  } else lines.push("Unit: none (no code changed).");
  lines.push("", "| Area | Runs | Why |", "| --- | --- | --- |");
  for (const area of AREAS) {
    const reasons = scope.areas.get(area.id);
    lines.push(`| ${area.title} | ${reasons ? "yes" : "no"} | ${reasons ? reasons.map(code).join("<br>") : ""} |`);
  }
  for (const standalone of scope.standalone) lines.push(`| ${standalone.title} | own trigger | ${code(standalone.workflow)} is not behind merge-gate yet |`);
  return `${lines.join("\n")}\n`;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function changedSince(base) {
  try {
    return git(["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`]).split("\0").filter(Boolean);
  } catch (error) {
    console.error(`ci-scope: cannot diff against ${base} (${error.message.split("\n")[0]}); running everything`);
    return null;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const local = args[0] === "--base" || args[0] === "--files";
  const event = local ? "pull_request" : process.env.GITHUB_EVENT_NAME ?? "workflow_dispatch";
  let changed = null;
  if (args[0] === "--files") changed = args.slice(1);
  else if (args[0] === "--base") changed = changedSince(args[1] ?? "origin/main");
  // On a pull_request checkout HEAD is the merge commit and HEAD^1 the base it merged into.
  else if (event === "pull_request") changed = changedSince("HEAD^1");
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  const scope = selectScope({ event, changed, tracked, read: file => readFileSync(ROOT + file, "utf8") });
  const text = summary(scope);
  console.error(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  const out = outputs(scope);
  const body = Object.entries(out).map(([key, value]) => `${key}=${value}`).join("\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
  else console.log(body);
}
