import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, normalize, posix, relative, resolve } from "node:path";

const base = process.env.DOMAIN_BOUNDARY_RATCHET_BASE?.trim() || "HEAD^1";
const contract = JSON.parse(
  readFileSync("docs/architecture/domain-boundaries.json", "utf8")
);

function repoPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function pathMatches(path, prefix) {
  const p = repoPath(path);
  const q = repoPath(prefix);
  return p === q || p.startsWith(q.endsWith("/") ? q : q + "/");
}

function resolveImport(sourcePath, specifier) {
  if (specifier.startsWith("@shared/")) return "shared/" + specifier.slice("@shared/".length);
  if (!specifier.startsWith(".")) return null;
  const absolute = resolve(process.cwd(), dirname(sourcePath), specifier);
  const rel = repoPath(relative(process.cwd(), absolute));
  return rel.replace(/\.(?:[cm]?[jt]sx?)$/, "");
}

let diff = "";
try {
  diff = execFileSync(
    "git",
    ["diff", "--unified=0", base, "HEAD", "--", "server", "shared", "client"],
    { encoding: "utf8" }
  );
} catch (error) {
  console.error(`Unable to compute domain-boundary ratchet diff from ${base} to HEAD.`);
  throw error;
}

// A relocation can rewrite an existing import without adding a semantic edge.
// Require Git rename evidence and the identical pre-move source line; no caller
// or target is allowlisted. New callers and changed import forms still fail.
const renamedPaths = new Map();
for (const line of execFileSync("git", ["diff", "--name-status", "--find-renames", base, "HEAD"], { encoding: "utf8" }).trim().split("\n")) {
  const [status, oldPath, newPath] = line.split("\t");
  if (status?.startsWith("R")) renamedPaths.set(newPath, oldPath);
}
const stripExtension = path => path.replace(/\.(?:[cm]?[jt]sx?)$/, "");
const oldTargets = new Map([...renamedPaths].map(([next, previous]) => [stripExtension(next), stripExtension(previous)]));
const baseFiles = new Map();
function provenRelocatedImport(path, source, specifier, target) {
  const oldPath = renamedPaths.get(path) || path;
  const oldTarget = oldTargets.get(target) || target;
  if (oldPath === path && oldTarget === target) return false;
  if (!baseFiles.has(oldPath)) {
    try {
      baseFiles.set(oldPath, execFileSync("git", ["show", `${base}:${oldPath}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    } catch { baseFiles.set(oldPath, ""); }
  }
  for (const oldLine of baseFiles.get(oldPath).split("\n")) {
    const imports = [
      ...oldLine.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...oldLine.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...oldLine.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ];
    for (const match of imports) {
      if (resolveImport(oldPath, match[1]) === oldTarget &&
          oldLine.replace(match[1], specifier).trim() === source.trim()) return true;
    }
  }
  return false;
}

let currentPath = "";
const violations = [];
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ b/")) {
    currentPath = line.slice(6);
    continue;
  }
  if (!currentPath || !line.startsWith("+") || line.startsWith("+++")) continue;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(currentPath)) continue;

  const source = line.slice(1);
  const matches = [
    ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
  ];

  for (const match of matches) {
    const target = resolveImport(currentPath, match[1]);
    if (!target) continue;

    for (const rule of contract.forbiddenImports) {
      const fromMatches = rule.from.some(prefix => pathMatches(currentPath, prefix));
      const toMatches = rule.to.some(prefix => pathMatches(target, prefix));
      if (fromMatches && toMatches && !provenRelocatedImport(currentPath, source, match[1], target)) {
        violations.push(
          `${rule.id}: ${currentPath} -> ${match[1]} (${target})\n  ${rule.reason}`
        );
      }
    }
  }
}

if (violations.length) {
  console.error("New forbidden domain dependencies:\n" + violations.join("\n"));
  console.error(
    "Existing debt is intentionally baselined. Remove the new dependency or update the architecture contract deliberately."
  );
  process.exit(1);
}

console.log(
  `Domain-boundary ratchet passed using ${contract.forbiddenImports.length} current-path rules.`
);
