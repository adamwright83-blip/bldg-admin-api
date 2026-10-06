import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const claireRoot = new URL(".", import.meta.url);

const rawPersistenceAllowlist = new Set([
  "character/generationLog.ts",
  "character/store.ts",
  "conversation/conversationQuery.ts",
  "conversation/drizzleStore.ts",
  "conversation/transcriptLog.ts",
  "knowledge/conversationMemory.ts",
  "progression/drizzleStore.ts",
  "turn/conversationStateStore.ts",
  "turn/decisionRecord.ts",
]);

const twilioProtocolAllowlist = new Set([
  "amdVoicemail.ts",
  "claireTwilio.ts",
  "conversation/twilioSignature.ts",
  "voice/claireVoiceTransport.ts",
  "voice/conversationRelaySignature.ts",
]);

function productionFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "tests" || entry === "testSupport") continue;
      files.push(...productionFiles(full));
      continue;
    }
    if (!/\.(?:ts|tsx)$/.test(entry) || /\.test\./.test(entry)) continue;
    files.push(full);
  }
  return files;
}

function rel(file: string): string {
  return relative(claireRoot.pathname, file).replaceAll("\\", "/");
}

describe("Claire domain-port architecture", () => {
  it("keeps raw database/schema access inside Claire-owned state stores", () => {
    const violations: string[] = [];
    for (const file of productionFiles(claireRoot.pathname)) {
      const path = rel(file);
      const source = readFileSync(file, "utf8");
      const usesRawPersistence =
        /from\s+["'][^"']*(?:drizzle\/schema|\/db)["']/.test(source) ||
        /\bgetDb\s*\(/.test(source);
      if (usesRawPersistence && !rawPersistenceAllowlist.has(path)) {
        violations.push(path);
      }
    }
    expect(violations).toEqual([]);
  });

  it("keeps provider placement/fetching outside Claire production surfaces", () => {
    const violations: string[] = [];
    for (const file of productionFiles(claireRoot.pathname)) {
      const path = rel(file);
      const source = readFileSync(file, "utf8");

      if (
        /\.calls\.create\s*\(/.test(source) ||
        /\.messages\.create\s*\(/.test(source) ||
        /https:\/\/api\.twilio\.com\//.test(source)
      ) {
        violations.push(path);
      }

      const importsTwilio = /from\s+["']twilio["']/.test(source);
      if (importsTwilio && !twilioProtocolAllowlist.has(path)) {
        violations.push(path);
      }
    }
    expect([...new Set(violations)]).toEqual([]);
  });

  it("keeps Claire's Twilio placement behind the platform provider port", () => {
    const source = readFileSync(new URL("./claireTwilio.ts", import.meta.url), "utf8");
    expect(source).toContain('from "../twilioPlatform/claireCallProvider"');
    expect(source).not.toContain('from "../db"');
    expect(source).not.toMatch(/\.calls\.create\s*\(/);
  });


  it("keeps payment-provider SDK authority out of Claire production surfaces", () => {
    const violations: string[] = [];
    for (const file of productionFiles(claireRoot.pathname)) {
      const source = readFileSync(file, "utf8");
      if (
        /from\s+["']stripe["']/.test(source) ||
        /\bnew\s+Stripe\s*\(/.test(source)
      ) {
        violations.push(rel(file));
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not convert authoritative Day Director read failures into empty work state", () => {
    const briefing = readFileSync(
      new URL("./briefing/briefingCommit.ts", import.meta.url),
      "utf8"
    );
    const turn = readFileSync(new URL("./turn/claireTurn.ts", import.meta.url), "utf8");

    expect(briefing).not.toMatch(/getState\([\s\S]{0,400}?\.catch\(\(\) => null\)/);
    expect(turn).not.toMatch(/deps\.loadExisting\([\s\S]{0,350}?\.catch\(\(\) => \[\]\)/);
  });

  it("binds live Brain V2 actions to the narrow grant adapter instead of rerunning V1", () => {
    const source = readFileSync(new URL("./claireTwilio.ts", import.meta.url), "utf8");
    expect(source).toContain('from "./brain/live/grantBoundLegacyAdapter"');
    expect(source).toContain("executeGrantBoundLegacyAdapter({");
    expect(source).toContain("brainV2CallControlResult({");
    expect(source).toContain("shouldFallbackToClaireLegacy(liveV2)");
    expect(source).toContain("brainV2ExecutionFailureResult({");
    expect(source).not.toContain("executeLegacyAdapter: async () => runLegacyAdapter()");
    expect(source).not.toMatch(/candidateEndCall\s*\?\s*\{\s*\.\.\.adapted/);
  });
});
