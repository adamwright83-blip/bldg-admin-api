import { execFileSync } from "node:child_process";

const base =
  process.env.DEFAULT_TENANT_RATCHET_BASE?.trim() ||
  (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD^");

let diff = "";
try {
  diff = execFileSync("git", ["diff", "--unified=0", base, "HEAD", "--", "server", "shared", "client", "scripts"], {
    encoding: "utf8",
  });
} catch (error) {
  console.error(`Unable to compute default-tenant ratchet diff from ${base} to HEAD.`);
  throw error;
}

const productionPath = path =>
  /^(server|shared|client|scripts)\//.test(path) &&
  !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path) &&
  !path.includes("/testSupport/");

const patterns = [
  /\btenant(?:Id|_id)\b[^\n]{0,80}(?:\?\?|\|\|)\s*["']default["']/i,
  /\btenant(?:Id|_id)\b\s*=\s*["']default["']/i,
  /COALESCE\s*\([^\n]{0,80}\btenant(?:Id|_id)\b[^\n]{0,80},\s*["']default["']/i,
];

let path = "";
let added = 0;
let removed = 0;
const matches = [];
for (const line of diff.split("\n")) {
  if (line.startsWith("+++ b/")) {
    path = line.slice(6);
    continue;
  }
  if (!productionPath(path)) continue;
  const sign = line[0];
  if (sign !== "+" && sign !== "-") continue;
  const body = line.slice(1);
  if (!patterns.some(pattern => pattern.test(body))) continue;
  if (sign === "+") added += 1;
  else removed += 1;
  matches.push(`${sign} ${path}: ${body.trim()}`);
}

const delta = added - removed;
console.log(`Default-tenant fallback ratchet: +${added} / -${removed} / delta ${delta}`);
if (matches.length) console.log(matches.join("\n"));
if (delta > 0) {
  console.error("New implicit tenant→default fallbacks are forbidden. Remove the fallback or delete at least as many existing fallbacks in the same change.");
  process.exit(1);
}
