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
      if (fromMatches && toMatches) {
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
