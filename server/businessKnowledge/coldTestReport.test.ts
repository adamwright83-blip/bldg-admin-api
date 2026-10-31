import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { BusinessUnderstanding, UnderstoodEntity } from "../../shared/businessKnowledge";
import {
  coldTestOutcome,
  compareWithExpectations,
  compareWithPrevious,
  nameMatches,
  parseExpectations,
  previousOutcome,
  renderColdTestReport,
  repriced,
  writeColdTestReport,
  type ColdTestRaw,
} from "./coldTestReport";

/**
 * The private report: redacted (no bodies, quotes, emails or phone numbers), compared with what the owner says is
 * true and with the previous run, and priced without counting a model call twice.
 */
const entity = (name: string, extra: Partial<UnderstoodEntity> = {}): UnderstoodEntity => ({
  id: `id-${name}`,
  kind: "company",
  name,
  status: null,
  statusBasis: "inferred",
  statusWhy: "Seen in sent mail",
  lastActivityAt: "2026-10-01T00:00:00.000Z",
  role: null,
  sources: [{ provider: "gmail", label: "Email to Pat", excerpt: "BODY TEXT THAT MUST NEVER BE PRINTED", at: null, url: null }],
  ...extra,
});

function understanding(over: Partial<BusinessUnderstanding> = {}): BusinessUnderstanding {
  return {
    journeyId: "coldtest-aaaaaaaaaaaaaaaaaaaaaaaaaaa",
    understoodAt: "2026-10-31T00:00:00.000Z",
    owner: { name: "Sam Owner", email: "sam@example.com" },
    current: [entity("Acme Cleaning LLC", { statusWhy: "Invoices to pat@client.example and calls to (310) 555-0199" })],
    prelaunch: [entity("Lantern App", { kind: "product" })],
    dormant: [entity("Website proposals", { kind: "project" })],
    historical: [],
    unknown: [entity("Mystery Co")],
    people: [entity("Jules Rivera", { kind: "person", role: "Operations lead" })],
    relationships: [{ id: "r1", subject: "Acme Cleaning LLC", type: "brand_of", object: "Acme Holdings", basis: "inferred", detail: null, confidence: 60, authorizesFinancialMerge: false } as never],
    conflicts: [],
    openQuestions: [{ id: "q1", kind: "status", question: "Is Website proposals still something you do?", followUp: null, status: "open", answer: null, explanation: null }],
    resolvedQuestions: [],
    coverageGaps: [{ source: "sheets", state: "failed", reasons: ["403 SERVICE_DISABLED"] }],
    ...over,
  };
}

function raw(over: Partial<ColdTestRaw> = {}): ColdTestRaw {
  return {
    id: "coldtest-aaaaaaaaaaaaaaaaaaaaaaaaaaa",
    mode: "intelligence",
    source: "11111111-1111-4111-8111-111111111111",
    startedAt: new Date("2026-10-31T10:00:00.000Z"),
    finishedAt: new Date("2026-10-31T10:02:00.000Z"),
    cleanup: { deleted: { business_knowledge_entities: 4, first_ten_findings: 0 } },
    investigator: { configured: "claude", model: "claude:claude-sonnet-5-5+heuristic", status: "complete", rounds: 3, toolCalls: 20, stoppedBecause: "no new evidence", notes: [] },
    investigatorUsage: { calls: 3, failures: 0, inputTokens: 1_000_000, outputTokens: 100_000, latencyMs: 9000 },
    stages: null,
    timings: { investigation: 110_000 },
    coverage: [
      { source: "gmail", operation: "search", target: 'in:sent "Acme"', status: "ok", items: 12, window: null, reason: null, at: "2026-10-31T10:00:00.000Z" },
      { source: "sheets", operation: "read_spreadsheet", target: "abc", status: "failed", items: 0, window: null, reason: "403", at: "2026-10-31T10:00:00.000Z" },
    ],
    understanding: understanding(),
    live: [],
    events: [],
    run: undefined,
    ...over,
  };
}

describe("the outcome and its page", () => {
  it("keeps names, statuses, dates and source labels; never bodies, emails or phone numbers", () => {
    const outcome = coldTestOutcome(raw());
    const page = renderColdTestReport(outcome, null, null);
    const everything = `${JSON.stringify(outcome)}\n${page}`;
    expect(everything).not.toContain("BODY TEXT");
    expect(everything).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(everything).not.toContain("555-0199");
    expect(everything).not.toContain('in:sent "Acme"');
    expect(page).toContain("**Acme Cleaning LLC**");
    expect(page).toContain("Email to Pat");
    expect(page).toContain("Started from nothing");
    expect(page).toContain("4 rows deleted");
    expect(page).toContain("| gmail | 1 | 12 | 1 |");
    expect(page).toContain("sheets: failed (403 SERVICE_DISABLED)");
    expect(page).toContain("Is Website proposals still something you do?");
  });

  it("prices the investigator from JOYSTICK's table, and an operator's rate on request", () => {
    const outcome = coldTestOutcome(raw());
    // Sonnet-class: 300¢ per million in, 1500¢ per million out
    expect(outcome.usage.investigator.costCents).toBe(300 + 150);
    expect(outcome.usage.totalCostCents).toBe(450);
    const gemini = repriced(coldTestOutcome(raw({ investigator: { ...raw().investigator!, model: "gemini:gemini-2.5-flash+heuristic" } })), { input: 30, output: 250 });
    expect(gemini.usage.investigator.costCents).toBe(30 + 25);
    expect(gemini.usage.investigator.priceBasis).toContain("operator's rate");
  });

  it("doesn't count a Claude investigator twice when the spend ledger already holds it", () => {
    const stages = [
      { category: "llm:first_ten_conversations", tokens: 1000, costCents: 7 },
      { category: "llm:onboarding_investigator", tokens: 1_100_000, costCents: 450 },
    ];
    expect(coldTestOutcome(raw({ mode: "journey", stages })).usage.totalCostCents).toBe(457);
    const gemini = coldTestOutcome(raw({ mode: "journey", stages: stages.slice(0, 1), investigator: { ...raw().investigator!, model: "gemini:x+heuristic" } }));
    expect(gemini.usage.totalCostCents).toBe(7 + gemini.usage.investigator.costCents);
  });

  it("holds the run to the rules, and a broken rule is an incorrect conclusion", () => {
    const quiet = entity("Website proposals", { kind: "project" });
    const outcome = coldTestOutcome(raw({ understanding: understanding({ current: [quiet], dormant: [quiet] }) }));
    expect(outcome.checks.find(check => check.name === "nothing paused or past is listed as current")?.ok).toBe(false);
    expect(compareWithExpectations(outcome, {}).incorrect).toContain("rule broken: nothing paused or past is listed as current");
  });
});

describe("against what the owner says is true", () => {
  it("lists discoveries, omissions, incorrect conclusions and what's not in the expectations", () => {
    const outcome = coldTestOutcome(raw());
    const expected = parseExpectations({
      current: ["Acme Cleaning|Acme"],
      prelaunch: ["Lantern App"],
      past: ["Website proposals"],
      paused: ["Old Shop"],
      people: ["Jules Rivera|Jules", "Morgan Lee"],
      notCurrent: ["Acme Cleaning"],
      absent: ["Mystery Co"],
      relationships: [
        { subject: "Acme", type: "brand_of", object: "Acme Holdings" },
        { subject: "Lantern App", type: "product_of", object: "Acme" },
      ],
    });
    const comparison = compareWithExpectations(outcome, expected);
    expect(comparison.discoveries).toEqual(
      expect.arrayContaining(["Acme Cleaning: current, as you expect", "Lantern App: being prepared, as you expect", "Jules Rivera: found (Operations lead)", "Acme brand_of Acme Holdings: as you expect"])
    );
    expect(comparison.incorrect).toEqual(
      expect.arrayContaining([
        "Website proposals: you expect past; JOYSTICK concluded paused (quiet, searched)",
        "Acme Cleaning is listed as current; you say it isn't",
        "Mystery Co appears; you say it shouldn't",
      ])
    );
    expect(comparison.omissions).toEqual(expect.arrayContaining(["Old Shop (paused (quiet, searched)): not found", "Morgan Lee (person): not found", "Lantern App product_of Acme: not concluded"]));
    expect(comparison.unexpected).toEqual(["Mystery Co (unknown)"]);
  });

  it("matches names whatever the case, punctuation or company suffix", () => {
    expect(nameMatches("Acme Cleaning, LLC", "acme cleaning")).toBe(true);
    expect(nameMatches("The Acme Cleaning Co.", "Acme Cleaning")).toBe(true);
    expect(nameMatches("Acme Cleaning", "Acme|Acme Cleaning")).toBe(true);
    expect(nameMatches("Acme", "Acme Cleaning")).toBe(false);
    expect(nameMatches("Beacon", "Acme")).toBe(false);
  });

  it("refuses an expectations file it can't read", () => {
    expect(() => parseExpectations([])).toThrow();
    expect(() => parseExpectations({ current: "Acme" })).toThrow(/list of names/);
    expect(() => parseExpectations({ relationships: [{ subject: "a" }] })).toThrow(/relationships/);
  });
});

describe("the previous run, and keeping the report", () => {
  const dir = mkdtempSync(join(tmpdir(), "cold-test-report-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("says what changed since the previous run of the same kind, for the same source", () => {
    const before = coldTestOutcome(raw());
    const after = coldTestOutcome(
      raw({
        id: "coldtest-bbbbbbbbbbbbbbbbbbbbbbbbbbb",
        startedAt: new Date("2026-10-31T11:00:00.000Z"),
        finishedAt: new Date("2026-10-31T11:01:00.000Z"),
        understanding: understanding({ dormant: [], historical: [entity("Website proposals", { kind: "project" })], unknown: [], openQuestions: [] }),
      })
    );
    const diff = compareWithPrevious(after, before);
    expect(diff.moved).toEqual(["Website proposals: paused → past"]);
    expect(diff.noLongerFound).toEqual(["Mystery Co (unknown)"]);
    expect(diff.questionsDropped).toEqual(["Is Website proposals still something you do?"]);
    expect(diff.wallMsDelta).toBe(-60_000);

    const first = writeColdTestReport(dir, before, renderColdTestReport(before, null, null));
    expect(statSync(first.json).mode & 0o777).toBe(0o600);
    expect(statSync(first.markdown).mode & 0o777).toBe(0o600);
    expect(previousOutcome(dir, after)?.id).toBe(before.id);
    expect(previousOutcome(dir, { ...after, mode: "journey" })).toBeNull();
    expect(previousOutcome(dir, { ...after, source: "another-journey" })).toBeNull();
    expect(JSON.parse(readFileSync(first.json, "utf8")).id).toBe(before.id);
  });
});
