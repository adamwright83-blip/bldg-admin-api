import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeGoogleData } from "../../firstTenMinutes/testSupport/fakeGoogle";
import { BRIEF_NAMES, SCENARIO_NOW, SYNTHETIC_NAMES, onboardingScenario, type ScenarioNames } from "../../firstTenMinutes/testSupport/onboardingScenario";

/**
 * The brief's acceptance scenarios, end to end on real MySQL: a controlled Google, the real research tools, the
 * real investigation loop (deterministic interpreter), real reconciliation, real questions and answers. Run twice,
 * with two different sets of names, so nothing can be relying on a particular business or person.
 */
const url = process.env.DATABASE_URL ?? "";
const allowed = (() => {
  try {
    const parsed = new URL(url);
    return ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/first_ten_test";
  } catch {
    return false;
  }
})();
process.env.JWT_SECRET ||= "first-ten-integration-secret-000000000000";

async function investigateScenario(names: ScenarioNames, data: FakeGoogleData = onboardingScenario(names)) {
  const { fakeAccess, fakeGoogle } = await import("../../firstTenMinutes/testSupport/fakeGoogle");
  const { CoverageLedger } = await import("../../firstTenMinutes/research/coverage");
  const { googleResearch } = await import("../../firstTenMinutes/research/googleResearch");
  const { heuristicInvestigator } = await import("./heuristic");
  const { investigate } = await import("./loop");
  const scope = { journeyId: randomUUID(), tenantId: null as string | null };
  const google = fakeGoogle(data, { now: SCENARIO_NOW });
  const ledger = new CoverageLedger(() => SCENARIO_NOW);
  const research = googleResearch(fakeAccess(names.owner.email), ledger, { fetch: google.fetch, now: () => SCENARIO_NOW, sleep: async () => undefined });
  const result = await investigate(scope, { research, ledger, model: heuristicInvestigator(), ownerEmail: names.owner.email, now: () => SCENARIO_NOW });
  return { scope, result, google, ledger };
}

describe.skipIf(!allowed)("onboarding intelligence acceptance (MySQL, controlled Google)", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  for (const names of [SYNTHETIC_NAMES, BRIEF_NAMES]) {
    describe(`telling the story as ${names.business} / ${names.brand} / ${names.collaborator.first} / ${names.product}`, () => {
      let run: Awaited<ReturnType<typeof investigateScenario>>;
      beforeAll(async () => {
        run = await investigateScenario(names);
      }, 120_000);

      it("investigates within its budget, records what it searched, and finishes", async () => {
        expect(run.result.status).toBe("complete");
        expect(run.result.research.length).toBeGreaterThan(5);
        expect(run.result.research.every(item => item.searches.length > 0 || item.status !== "answered")).toBe(true);
        expect(run.result.used.toolCalls).toBeLessThanOrEqual(60);
        // never the whole mailbox: a bounded number of Google calls
        expect(run.google.calls.length).toBeLessThan(900);
      });

      it("historical freelancing reads as possibly dormant, not current, and is asked about", async () => {
        const { readBusinessUnderstanding } = await import("../understanding");
        const understanding = await readBusinessUnderstanding(run.scope);
        const names = (list: { name: string }[]) => list.map(item => item.name.toLowerCase());
        expect(names(understanding.current).some(name => name.includes("website"))).toBe(false);
        const web = understanding.dormant.find(item => item.name.toLowerCase().includes("website"));
        expect(web).toBeTruthy();
        expect(web!.statusWhy).toContain("may be paused, not that it ended");
        expect(understanding.openQuestions.some(question => /website/i.test(question.question) && /still something you do/.test(question.question))).toBe(true);
      });

      it("the business is current; the product is prelaunch with no invented launch, sale or customers; its game belongs to it", async () => {
        const { readBusinessUnderstanding } = await import("../understanding");
        const understanding = await readBusinessUnderstanding(run.scope);
        expect(understanding.current.map(item => item.name)).toEqual(expect.arrayContaining([names.business, names.brand]));
        expect(understanding.prelaunch.map(item => item.name)).toContain(names.product);
        const [[sales]] = (await db.query("SELECT COUNT(*) AS n FROM business_knowledge_timeline WHERE journey_id = ? AND kind IN ('sale','launch')", [run.scope.journeyId])) as any;
        expect(Number(sales.n)).toBe(0);
        expect(understanding.relationships).toContainEqual(expect.objectContaining({ subject: names.game, type: "part_of", object: names.product }));
      });

      it("the collaborator is found from documents, spreadsheets and calendar, though not among the twelve most-emailed, with sources", async () => {
        const { readBusinessUnderstanding } = await import("../understanding");
        const understanding = await readBusinessUnderstanding(run.scope);
        const full = `${names.collaborator.first} ${names.collaborator.last}`;
        const person = understanding.people.find(item => item.name === full);
        expect(person).toBeTruthy();
        expect(person!.role?.toLowerCase()).toContain("operations lead");
        expect(person!.sources.length).toBeGreaterThan(0);
        // the twelve people the owner emails most do not include them
        const data = onboardingScenario(names);
        const counts = new Map<string, number>();
        for (const message of data.messages.filter(item => item.sent)) for (const to of message.to) counts.set(to, (counts.get(to) ?? 0) + 1);
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([to]) => to);
        expect(top.some(to => to.includes(names.collaborator.email))).toBe(false);
      });

      it("two related names: asked, a nuanced answer gets one follow-up, saved without merging companies or money", async () => {
        const { nextQuestion, answerQuestion } = await import("../clarify");
        const { readBusinessUnderstanding } = await import("../understanding");
        const first = await nextQuestion(run.scope, { limit: 3 });
        expect(first?.kind).toBe("relationship");
        expect(first!.question).toBe(`I found recent work under ${names.business} and ${names.brand}. Are these separate businesses, or two names for the same operation?`);
        const nuanced = await answerQuestion(run.scope, first!.id, "Yes, but it's complicated.", SCENARIO_NOW);
        expect(nuanced.status).toBe("needs_followup");
        expect(nuanced.question.followUp).toContain(`How do ${names.business} and ${names.brand} fit together?`);
        // the follow-up is the same question, still in progress, asked once
        expect((await nextQuestion(run.scope, { limit: 3 }))!.id).toBe(first!.id);
        const settled = await answerQuestion(run.scope, first!.id, `${names.brand} is our building service. Same team and vans, separate contracts and pricing.`, SCENARIO_NOW);
        expect(settled.status).toBe("resolved");
        expect(settled.question.explanation).toContain("won't treat them as one company");
        const understanding = await readBusinessUnderstanding(run.scope);
        const relationship = understanding.relationships.find(item => item.basis === "user_confirmed" && [item.subject, item.object].sort().join() === [names.business, names.brand].sort().join());
        expect(relationship?.type).toBe("related_operation");
        expect(relationship?.detail).toContain("Yes, but it's complicated.");
        expect(relationship?.detail).toContain("separate contracts and pricing");
        expect(understanding.relationships.some(item => item.type === "same_legal_entity")).toBe(false);
        const [[merge]] = (await db.query("SELECT MAX(authorizes_financial_merge) AS m FROM business_knowledge_assertions WHERE journey_id = ?", [run.scope.journeyId])) as any;
        expect(Number(merge.m)).toBe(0);
        // the person's words and when they said them are kept as evidence
        const [answers] = (await db.query("SELECT excerpt FROM business_knowledge_evidence WHERE journey_id = ? AND provider = 'user' ORDER BY discovered_at", [run.scope.journeyId])) as any;
        expect(answers.map((row: { excerpt: string }) => row.excerpt)[0]).toBe("Yes, but it's complicated.");
      });

      it("a resolved question is not asked again, even after re-investigating", async () => {
        const { proposeQuestions, nextQuestion } = await import("../clarify");
        await proposeQuestions(run.scope, SCENARIO_NOW);
        const { questions } = await import("../store");
        const relationshipQuestions = (await questions(run.scope)).filter(row => row.kind === "relationship");
        expect(relationshipQuestions).toHaveLength(1);
        expect(relationshipQuestions[0].status).toBe("resolved");
        const next = await nextQuestion(run.scope, { limit: 3 });
        expect(next?.kind).not.toBe("relationship");
      });

      it("after onboarding: corrections survive a full reread and an incremental update; nothing is asked twice", async () => {
        const { fakeAccess, fakeGoogle } = await import("../../firstTenMinutes/testSupport/fakeGoogle");
        const { CoverageLedger } = await import("../../firstTenMinutes/research/coverage");
        const { googleResearch } = await import("../../firstTenMinutes/research/googleResearch");
        const { heuristicInvestigator } = await import("./heuristic");
        const { investigate } = await import("./loop");
        const { reinvestigateIfChanged } = await import("./incremental");
        const { readBusinessUnderstanding } = await import("../understanding");
        const { questions } = await import("../store");
        const before = await readBusinessUnderstanding(run.scope);
        const confirmed = before.relationships.find(item => item.basis === "user_confirmed");
        expect(confirmed).toBeTruthy();
        // a whole new reading of the same sources
        const ledger = new CoverageLedger(() => SCENARIO_NOW);
        const research = googleResearch(fakeAccess(names.owner.email), ledger, { fetch: fakeGoogle(onboardingScenario(names), { now: SCENARIO_NOW }).fetch, now: () => SCENARIO_NOW, sleep: async () => undefined });
        await investigate(run.scope, { research, ledger, model: heuristicInvestigator(), ownerEmail: names.owner.email, now: () => SCENARIO_NOW, trigger: "test: reread" });
        const after = await readBusinessUnderstanding(run.scope);
        expect(after.relationships.find(item => item.id === confirmed!.id)).toEqual(confirmed);
        expect((await questions(run.scope)).filter(row => row.kind === "relationship")).toHaveLength(1);
        // a day later with nothing new: no investigation runs
        const tomorrow = new Date(SCENARIO_NOW.getTime() + 24 * 3600_000);
        const quiet = googleResearch(fakeAccess(names.owner.email), new CoverageLedger(), { fetch: fakeGoogle(onboardingScenario(names), { now: tomorrow }).fetch, now: () => tomorrow, sleep: async () => undefined });
        const outcome = await reinvestigateIfChanged(run.scope, { research: quiet, ledger: new CoverageLedger(), model: heuristicInvestigator(), ownerEmail: names.owner.email, now: () => tomorrow, minIntervalMs: 0 });
        expect(outcome.ran).toBe(false);
        expect(outcome.reason).toMatch(/^nothing new since/);
      });

      it("privacy: no banking numbers or personal finance anywhere in what was kept", async () => {
        for (const table of ["business_knowledge_evidence", "business_knowledge_timeline", "business_knowledge_assertions", "business_knowledge_entities", "business_knowledge_runs", "business_knowledge_questions"]) {
          const [rows] = (await db.query(`SELECT * FROM ${table} WHERE journey_id = ?`, [run.scope.journeyId])) as any;
          const text = JSON.stringify(rows);
          expect(text).not.toContain("004512339871");
          expect(text).not.toContain("121000358");
        }
        const { entities } = await import("../store");
        expect((await entities(run.scope)).map(entity => entity.name.toLowerCase()).some(name => /bank|banking/.test(name))).toBe(false);
      });
    });
  }

  it("conflicting information: the confirmed understanding wins, history stays, the conflict is named", async () => {
    const names = SYNTHETIC_NAMES;
    const { scope } = await investigateScenario(names);
    const { questions } = await import("../store");
    const { answerQuestion } = await import("../clarify");
    const web = (await questions(scope)).find(row => row.kind === "status")!;
    await answerQuestion(scope, web.id, "No, I stopped doing websites last spring.", SCENARIO_NOW);
    // newer evidence arrives: a fresh proposal after the answer
    const data = onboardingScenario(names);
    data.messages.push({ id: "late", threadId: "late", at: "2026-11-20T17:00:00Z", from: `${names.owner.name} <${names.owner.email}>`, to: ["Nail Bar <hi@nailbar.example>"], subject: "Website proposal for Nail Bar", body: "Here is my website proposal.", sent: true });
    const later = new Date("2026-11-25T12:00:00Z");
    const { fakeAccess, fakeGoogle } = await import("../../firstTenMinutes/testSupport/fakeGoogle");
    const { CoverageLedger } = await import("../../firstTenMinutes/research/coverage");
    const { googleResearch } = await import("../../firstTenMinutes/research/googleResearch");
    const { heuristicInvestigator } = await import("./heuristic");
    const { investigate, INCREMENTAL_BUDGET } = await import("./loop");
    const ledger = new CoverageLedger(() => later);
    const research = googleResearch(fakeAccess(names.owner.email), ledger, { fetch: fakeGoogle(data, { now: later }).fetch, now: () => later, sleep: async () => undefined });
    await investigate(scope, { research, ledger, model: heuristicInvestigator(), ownerEmail: names.owner.email, now: () => later, since: SCENARIO_NOW, budget: INCREMENTAL_BUDGET, trigger: "test: new mail" });
    const { readBusinessUnderstanding } = await import("../understanding");
    const understanding = await readBusinessUnderstanding(scope);
    const item = understanding.historical.find(entity => /website/i.test(entity.name));
    expect(item?.statusBasis).toBe("user_corrected");
    expect(understanding.conflicts).toContainEqual(expect.objectContaining({ confirmed: "historical", inferred: "active" }));
    const conflictQuestion = (await questions(scope)).find(row => row.kind === "conflict");
    expect(conflictQuestion?.question).toMatch(/Earlier you told me .* was in the past\. Since then I've seen/);
    // history kept: the inferred dormant version, the person's answer, and the conflict
    const [versions] = (await db.query("SELECT value, state, basis FROM business_knowledge_assertions WHERE journey_id = ? AND predicate = 'status' AND subject_entity_id = ? ORDER BY created_at", [scope.journeyId, item!.id])) as any;
    expect(versions.map((row: any) => `${row.value}/${row.state}/${row.basis}`)).toEqual(["dormant/superseded/inferred", "historical/current/user_corrected", "active/conflict/inferred"]);
  }, 120_000);

  it("missing sources: Sheets fails and a document is inaccessible: incomplete coverage, not absence", async () => {
    const names = SYNTHETIC_NAMES;
    const data = { ...onboardingScenario(names), fail: { sheets: { status: 403, reason: "SERVICE_DISABLED" } }, failItems: { "sheet-routes": { status: 403, reason: "cannotExportFile" }, "doc-roadmap": { status: 403, reason: "insufficientFilePermissions" } } };
    const { scope, result } = await investigateScenario(names, data);
    expect(result.status).toBe("complete");
    const { readBusinessUnderstanding } = await import("../understanding");
    const understanding = await readBusinessUnderstanding(scope);
    expect(understanding.coverageGaps.map(gap => gap.source)).toEqual(expect.arrayContaining(["sheets", "docs"]));
    expect(understanding.coverageGaps.find(gap => gap.source === "sheets")!.reasons.join(" ")).toContain("SERVICE_DISABLED");
    // the business is still understood from what could be read
    expect(understanding.current.map(item => item.name)).toContain(names.business);
  }, 120_000);

  it("missing sources: when Gmail fails, quiet work is unknown, never dormant or ended", async () => {
    const names = SYNTHETIC_NAMES;
    const base = onboardingScenario(names);
    // Gmail answers the survey, then fails every targeted search
    const { fakeGoogle, fakeAccess } = await import("../../firstTenMinutes/testSupport/fakeGoogle");
    const real = fakeGoogle(base, { now: SCENARIO_NOW });
    let surveyed = false;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const target = String(input);
      if (target.includes("gmail.googleapis.com") && target.includes("/messages?") && surveyed && !decodeURIComponent(target).includes("in:sent after:")) {
        return new Response(JSON.stringify({ error: { code: 503, details: [{ reason: "backendError" }] } }), { status: 503 });
      }
      if (target.includes("drive/v3/files?")) surveyed = true;
      return real.fetch(input, init);
    }) as typeof fetch;
    const { CoverageLedger } = await import("../../firstTenMinutes/research/coverage");
    const { googleResearch } = await import("../../firstTenMinutes/research/googleResearch");
    const { heuristicInvestigator } = await import("./heuristic");
    const { investigate } = await import("./loop");
    const scope = { journeyId: randomUUID(), tenantId: null };
    const ledger = new CoverageLedger(() => SCENARIO_NOW);
    const research = googleResearch(fakeAccess(names.owner.email), ledger, { fetch: flaky, now: () => SCENARIO_NOW, sleep: async () => undefined });
    await investigate(scope, { research, ledger, model: heuristicInvestigator(), ownerEmail: names.owner.email, now: () => SCENARIO_NOW });
    const { readBusinessUnderstanding } = await import("../understanding");
    const understanding = await readBusinessUnderstanding(scope);
    expect(understanding.dormant.some(item => /website/i.test(item.name))).toBe(false);
    expect(understanding.historical.some(item => /website/i.test(item.name))).toBe(false);
    expect(understanding.unknown.some(item => /website/i.test(item.name))).toBe(true);
    expect(understanding.coverageGaps.find(gap => gap.source === "gmail")?.state).toBe("partial");
  }, 120_000);
});
