import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = new URL("../..", import.meta.url).pathname;

// Allowlist for direct internal persistence helpers:
// - server/db.ts: defines them
// - server/orders/orderLifecycleService.ts: canonical order authority wrapping them
// - tests / migrations / seeders are excluded from production files
const rawOrderMutationAllowlist = new Set([
  "server/db.ts",
  "server/orders/orderLifecycleService.ts",
]);

function productionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === ".git" ||
      entry === "tests" ||
      entry === "testSupport"
    ) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...productionFiles(full));
      continue;
    }
    if (!/\.(?:ts|tsx)$/.test(entry) || /\.test\.|\.spec\./.test(entry)) continue;
    files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return relative(repoRoot, file).replaceAll("\\", "/");
}

describe("Order Authority Architecture Guard", () => {
  it("prohibits production callers from calling raw updateOrderStatus directly outside canonical authority", () => {
    const serverFiles = productionFiles(join(repoRoot, "server"));
    const violations: string[] = [];

    for (const file of serverFiles) {
      const relPath = rel(file);
      if (rawOrderMutationAllowlist.has(relPath)) continue;

      const source = readFileSync(file, "utf8");
      if (/\bupdateOrderStatus\s*\(/.test(source)) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });

  it("prohibits production callers from calling raw attemptOrderPickupCollection directly outside canonical authority", () => {
    const serverFiles = productionFiles(join(repoRoot, "server"));
    const violations: string[] = [];

    for (const file of serverFiles) {
      const relPath = rel(file);
      if (rawOrderMutationAllowlist.has(relPath)) continue;

      const source = readFileSync(file, "utf8");
      if (/\battemptOrderPickupCollection\s*\(/.test(source)) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });

  it("prohibits routers and tools from calling raw createOrder directly outside canonical authority and resident authority", () => {
    const surfaces = [
      ...productionFiles(join(repoRoot, "server/agents/tools")),
      join(repoRoot, "server/routers.ts"),
    ];
    const violations: string[] = [];

    for (const file of surfaces) {
      const relPath = rel(file);
      const source = readFileSync(file, "utf8");
      if (/\bcreateOrder\s*\(/.test(source)) {
        violations.push(relPath);
      }
    }

    expect(violations).toEqual([]);
  });
});
