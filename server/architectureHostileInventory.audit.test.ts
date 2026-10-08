import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import { describe, it } from "vitest";

type Hit = { file: string; line: number; text: string; tags: string[] };

const ROOT = resolve(import.meta.dirname, "..");
const REPO = resolve(ROOT, "..");
const roots = ["server", "shared", "client/src"];
const skip = /(\.test\.|\.spec\.|testSupport|fixtures|__tests__|node_modules|dist|archive\/)/;

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    const rel = relative(REPO, p).replace(/\\/g, "/");
    if (skip.test(rel)) continue;
    const s = statSync(p);
    if (s.isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function tagsFor(line: string): string[] {
  const tags: string[] = [];
  if (/\.update\(orders\)|\.insert\(orders\)|UPDATE\s+orders|INSERT\s+INTO\s+orders/i.test(line)) tags.push("raw_order_write");
  if (/orders\.paid\b/.test(line)) tags.push("orders_paid");
  if (/orders\.paidAt\b/.test(line)) tags.push("orders_paidAt");
  if (/orders\.total\b/.test(line)) tags.push("orders_total");
  if (/orders\.stripePaymentIntentId\b/.test(line)) tags.push("payment_intent");
  if (/tenantId[^\n]{0,100}(\?\?|\|\||COALESCE)[^\n]{0,100}['"]default['"]|COALESCE[^\n]{0,160}tenantId[^\n]{0,160}['"]default['"]/i.test(line)) tags.push("tenant_default");
  if (/stage\s*:\s*['"]won['"]|stage\s*===?\s*['"]won['"]/.test(line)) tags.push("commercial_won");
  if (/truth_events/i.test(line)) tags.push("truth_events");
  return tags;
}

describe("architecture hostile inventory", () => {
  it("prints suspicious production truth seams for classification", () => {
    const hits: Hit[] = [];
    for (const root of roots) {
      const abs = resolve(REPO, root);
      for (const file of files(abs)) {
        const rel = relative(REPO, file).replace(/\\/g, "/");
        const lines = readFileSync(file, "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
          const tags = tagsFor(lines[i]!);
          if (tags.length) hits.push({ file: rel, line: i + 1, text: lines[i]!.trim().slice(0, 260), tags });
        }
      }
    }
    console.log("ARCH_HOSTILE_INVENTORY_BEGIN");
    console.log(JSON.stringify(hits, null, 2));
    console.log("ARCH_HOSTILE_INVENTORY_END");
  });
});
