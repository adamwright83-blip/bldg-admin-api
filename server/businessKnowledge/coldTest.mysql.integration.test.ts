import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GOOGLE_PRODUCT_SCOPES } from "../../shared/firstTenMinutes";
import { BRIEF_NAMES, SCENARIO_NOW, onboardingScenario } from "../firstTenMinutes/testSupport/onboardingScenario";

/**
 * The cold-start harness on real MySQL, against a controlled Google standing in for a person's connected account.
 * The person already has a history here: an investigation of their accounts, their own answer (website work is in the
 * past), a kept portrait, a confirmed finding, a reading, a decision and a draft. Two cold tests in a row, of each kind,
 * must each start from nothing, never see that history or each other, delete exactly what they wrote, and leave every
 * one of the person's rows (their connection included) byte for byte as it was.
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

const PERSON_TABLES = [
  "business_knowledge_entities",
  "business_knowledge_evidence",
  "business_knowledge_timeline",
  "business_knowledge_assertions",
  "business_knowledge_questions",
  "business_knowledge_runs",
  "first_ten_readings",
  "first_ten_findings",
  "first_ten_events",
  "first_ten_portraits",
  "first_ten_drafts",
  "first_ten_connections",
];
const sum = (counts: Record<string, number>) => Object.values(counts).reduce((total, n) => total + n, 0);

describe.skipIf(!allowed)("cold-start tests against a connected account (MySQL, controlled Google)", () => {
  const names = BRIEF_NAMES;
  let db: mysql.Connection;
  let personId = "";
  let before: unknown;
  const extraJourneys: string[] = [];
  /** runs kept on purpose; deleted afterwards even if an assertion stops a test first */
  const keptRuns: string[] = [];

  /** Every row of the person's, table by table, as plain JSON. */
  async function snapshot(id: string) {
    const out: Record<string, unknown> = {};
    for (const table of PERSON_TABLES) {
      const [rows] = await db.query(`SELECT * FROM ${table} WHERE journey_id = ? ORDER BY 1`, [id]);
      out[table] = JSON.parse(JSON.stringify(rows));
    }
    const [journeys] = await db.query("SELECT * FROM first_ten_journeys WHERE id = ?", [id]);
    out.first_ten_journeys = JSON.parse(JSON.stringify(journeys));
    return out;
  }

  async function wipe(id: string) {
    for (const table of PERSON_TABLES) await db.query(`DELETE FROM ${table} WHERE journey_id = ?`, [id]);
    await db.query("DELETE FROM first_ten_journeys WHERE id = ?", [id]);
  }

  const controlled = async () => {
    const { fakeGoogle } = await import("../firstTenMinutes/testSupport/fakeGoogle");
    return fakeGoogle(onboardingScenario(names), { now: SCENARIO_NOW });
  };

  beforeAll(async () => {
    db = await mysql.createConnection(url);
    const { createJourney, saveConnection } = await import("../firstTenMinutes/store");
    const person = await createJourney({ acquisitionSessionId: randomUUID(), kind: "own" });
    personId = person.id;
    await saveConnection({
      journeyId: person.id,
      provider: "google",
      accountLabel: names.owner.email,
      accountSubject: "subject-of-the-person",
      grantedScopes: Object.values(GOOGLE_PRODUCT_SCOPES),
      accessToken: "the-persons-access-token",
      refreshToken: "the-persons-refresh-token",
      accessExpiresAt: new Date("2030-01-01T00:00:00.000Z"),
    });

    // the person's own history, which no cold test may see or touch
    const { fakeAccess } = await import("../firstTenMinutes/testSupport/fakeGoogle");
    const { CoverageLedger } = await import("../firstTenMinutes/research/coverage");
    const { googleResearch } = await import("../firstTenMinutes/research/googleResearch");
    const { heuristicInvestigator } = await import("./investigation/heuristic");
    const { investigate } = await import("./investigation/loop");
    const { questions } = await import("./store");
    const { answerQuestion } = await import("./clarify");
    const { readBusinessUnderstanding } = await import("./understanding");
    const scope = { journeyId: person.id, tenantId: null };
    const ledger = new CoverageLedger(() => SCENARIO_NOW);
    const research = googleResearch(fakeAccess(names.owner.email), ledger, { fetch: (await controlled()).fetch, now: () => SCENARIO_NOW, sleep: async () => undefined });
    await investigate(scope, { research, ledger, model: heuristicInvestigator(), ownerEmail: names.owner.email, now: () => SCENARIO_NOW });
    const website = (await questions(scope)).find(row => row.kind === "status" && /website/i.test(row.question))!;
    await answerQuestion(scope, website.id, "No, I stopped doing websites last spring.");
    const theirs = await readBusinessUnderstanding(scope);
    expect(theirs.historical.find(item => /website/i.test(item.name))?.statusBasis).toMatch(/^user_/);

    const portrait = { greeting: "Hello", paragraphs: [[{ key: "p1.s1", text: "A line the person kept.", findingIds: [] }]], closing: null };
    await db.query("INSERT INTO first_ten_readings (journey_id, run_id, status, finished_json, counts_json, notes_json) VALUES (?, ?, 'complete', '[]', '{}', '[]')", [person.id, randomUUID()]);
    await db.query("INSERT INTO first_ten_portraits (journey_id, run_id, status, basis, portrait_json, edits_json, written_by, kept_at) VALUES (?, ?, 'kept', 'kept-basis', ?, '{}', 'claude', NOW())", [person.id, randomUUID(), JSON.stringify(portrait)]);
    await db.query(
      "INSERT INTO first_ten_findings (id, journey_id, run_id, kind, companion, `rank`, payload_json, sources_json, status) VALUES (?, ?, ?, 'rule', 'sable', 0, ?, '[]', 'confirmed')",
      [randomUUID(), person.id, randomUUID(), JSON.stringify({ kind: "rule", statement: "No Sunday deliveries", quote: "No more Sunday deliveries.", saidTo: null, at: "2026-08-01T00:00:00.000Z" })]
    );
    await db.query("INSERT INTO first_ten_events (id, journey_id, kind, payload_json) VALUES (?, ?, 'portrait_kept', '{}')", [randomUUID(), person.id]);
    await db.query(
      "INSERT INTO first_ten_drafts (journey_id, opportunity_id, recipient_name, recipient_address, subject, body, approach, edited, status) VALUES (?, ?, 'Elena', 'elena@example.com', 'Friday flowers', 'Hi Elena', 'still_wanted', 0, 'prepared')",
      [person.id, randomUUID()]
    );
    before = await snapshot(person.id);
  }, 180_000);

  afterAll(async () => {
    if (personId) await wipe(personId);
    for (const id of extraJourneys) await wipe(id);
    const { forgetColdTest } = await import("./coldTest");
    for (const id of keptRuns) await forgetColdTest(id).catch(() => undefined);
    await db?.end();
  });

  it("two intelligence cold tests in a row share nothing, and the person's own records are untouched", async () => {
    const { coldTestRowCounts, coldTestSource, forgetColdTest, leftoverColdTests, runIntelligenceColdTest } = await import("./coldTest");
    const source = await coldTestSource(personId);
    const google = await controlled();
    const options = { source, choice: { investigator: "heuristic" as const }, fetch: google.fetch, now: () => SCENARIO_NOW, sleep: async () => undefined };

    // the first is kept, so the second runs with the first's rows still in the database
    const first = await runIntelligenceColdTest({ ...options, keep: true });
    keptRuns.push(first.id);
    const kept = await coldTestRowCounts(first.id);
    expect(sum(kept)).toBeGreaterThan(0);

    const second = await runIntelligenceColdTest(options);
    expect(second.id).not.toBe(first.id);
    expect(second.startedFromNothing).toBe(true);
    expect(second.cleanup).toMatchObject({ left: 0 });
    expect(sum(await coldTestRowCounts(second.id))).toBe(0);
    // the second didn't touch the first's rows, and the same accounts read from nothing gave the same understanding
    // (questions compared as a set: two of equal priority made in the same second can come back either way)
    expect(await coldTestRowCounts(first.id)).toEqual(kept);
    const settled = (run: typeof first) => ({ ...run.understanding, questions: [...run.understanding.questions].sort() });
    expect(settled(second)).toEqual(settled(first));
    expect(second.checks.every(check => check.ok)).toBe(true);

    // the person said website work is in the past: neither test knew that, so each asks
    for (const run of [first, second]) {
      const website = run.understanding.entities.find(item => /website/i.test(item.name));
      expect(website).toMatchObject({ bucket: "paused" });
      expect(website?.basis).not.toMatch(/^user_/);
      expect(run.understanding.questions.some(question => /website/i.test(question))).toBe(true);
    }

    // the sweep finds the kept test by its id, and deletes exactly it
    expect(await leftoverColdTests()).toContain(first.id);
    await forgetColdTest(first.id);
    expect(sum(await coldTestRowCounts(first.id))).toBe(0);
    expect(await leftoverColdTests()).not.toContain(first.id);

    expect(await snapshot(personId)).toEqual(before);
  }, 180_000);

  it("two full-journey cold tests in a row share nothing: an earlier answer, a kept portrait and a draft never carry over", async () => {
    const { coldTestRowCounts, coldTestSource, forgetColdTest, runJourneyColdTest } = await import("./coldTest");
    const { exampleExtractor } = await import("../firstTenMinutes/understanding/extractors");
    const { exampleGeocoder } = await import("../firstTenMinutes/understanding/exampleReaders");
    const { examplePortraitWriter } = await import("../firstTenMinutes/portrait/writers");
    const source = await coldTestSource(personId);
    const google = await controlled();
    const options = {
      source,
      choice: { investigator: "heuristic" as const },
      fetch: google.fetch,
      now: () => SCENARIO_NOW,
      sleep: async () => undefined,
      extractor: exampleExtractor(),
      geocoder: exampleGeocoder(),
      portraitWriter: { writer: examplePortraitWriter(), name: "example" },
    };

    // the first answers Claire (how the two names relate, and that website work is in the past), and is kept while
    // the second runs
    const answer = async (question: { question: string; followUp: string | null }) => {
      const asked = question.followUp ?? question.question;
      if (/website/i.test(asked)) return "No, I stopped doing websites last spring.";
      if (asked.includes(names.brand)) return `${names.brand} is the building service. Same crew, separate contracts.`;
      return null;
    };
    const first = await runJourneyColdTest({ ...options, keep: true, answer });
    keptRuns.push(first.id);
    const kept = await coldTestRowCounts(first.id);
    expect(first.journey!.reading.status).toBe("complete");
    expect(first.journey!.questions.some(item => /website/i.test(item.question) && item.answered && item.understood)).toBe(true);
    expect(first.journey!.questions.some(item => item.question.includes(names.brand) && item.answered && item.understood)).toBe(true);
    expect(kept.business_knowledge_questions).toBeGreaterThan(0);
    expect(kept.first_ten_readings).toBe(1);

    const second = await runJourneyColdTest({ ...options, answer: async () => null });
    expect(second.id).not.toBe(first.id);
    expect(second.startedFromNothing).toBe(true);
    // the first run's answer settled nothing for the second: it was asked the same first question, from scratch
    expect(second.journey!.questions[0].question).toBe(first.journey!.questions[0].question);
    expect(second.journey!.questions.every(item => !item.answered && !item.understood)).toBe(true);
    // the website the first run's answer put in the past is asked about again in the second (and left), and stays
    // paused there, never past
    expect(second.journey!.questions.some(item => /website/i.test(item.question))).toBe(true);
    expect(first.understanding.entities.find(item => /website/i.test(item.name))).toMatchObject({ bucket: "past" });
    expect(second.understanding.entities.find(item => /website/i.test(item.name))).toMatchObject({ bucket: "paused" });
    // the person's kept portrait is theirs alone: the test wrote its own page (or none), never a kept one
    expect(second.journey!.portrait?.status ?? "none").not.toBe("kept");
    // nothing left the table, in either run
    for (const run of [first, second]) expect(run.checks.find(check => check.name === "no draft left the table")?.ok).toBe(true);

    expect(second.cleanup).toMatchObject({ left: 0 });
    expect(sum(await coldTestRowCounts(second.id))).toBe(0);
    expect(await coldTestRowCounts(first.id)).toEqual(kept);
    await forgetColdTest(first.id);
    expect(sum(await coldTestRowCounts(first.id))).toBe(0);

    expect(await snapshot(personId)).toEqual(before);
    // the in-process switch the full journey needs is put back as it was
    expect(process.env.JOYSTICK_ONBOARDING_INTELLIGENCE).toBeUndefined();
  }, 240_000);

  it("deletes only cold-test ids that no journey, connection or workspace has carried, and reads only a person's own journey", async () => {
    const { coldTestRowCounts, coldTestSource, forgetColdTest, newColdTestId } = await import("./coldTest");
    const { createJourney } = await import("../firstTenMinutes/store");

    await expect(forgetColdTest(personId)).rejects.toThrow(/not a cold-test id/);
    await expect(forgetColdTest("coldtest-%")).rejects.toThrow(/not a cold-test id/);

    // shaped like a test id, but a journey carries it: refused, nothing deleted
    const impostor = newColdTestId();
    extraJourneys.push(impostor);
    await db.query("INSERT INTO first_ten_journeys (id, acquisition_session_id, kind, stage, version) VALUES (?, ?, 'own', 'connect', 1)", [impostor, randomUUID()]);
    await db.query("INSERT INTO first_ten_events (id, journey_id, kind, payload_json) VALUES (?, ?, 'portrait_kept', '{}')", [randomUUID(), impostor]);
    await expect(forgetColdTest(impostor)).rejects.toThrow(/first_ten_journeys/);
    expect((await coldTestRowCounts(impostor)).first_ten_events).toBe(1);

    // shaped like a test id, but stamped with a workspace: refused
    const stamped = newColdTestId();
    extraJourneys.push(stamped);
    await db.query("INSERT INTO business_knowledge_runs (id, journey_id, tenant_id, kind, status, started_at) VALUES (?, ?, 'tenant-x', 'full', 'complete', NOW())", [randomUUID(), stamped]);
    await expect(forgetColdTest(stamped)).rejects.toThrow(/workspace/);
    expect((await coldTestRowCounts(stamped)).business_knowledge_runs).toBe(1);

    // the source is a person's own journey with Google, never a test, an example, or a journey without Google
    await expect(coldTestSource(newColdTestId())).rejects.toThrow(/not a test/);
    const bare = await createJourney({ acquisitionSessionId: randomUUID(), kind: "own" });
    extraJourneys.push(bare.id);
    await expect(coldTestSource(bare.id)).rejects.toThrow(/no Google connection/);
    const example = await createJourney({ acquisitionSessionId: randomUUID(), kind: "example" });
    extraJourneys.push(example.id);
    await expect(coldTestSource(example.id)).rejects.toThrow(/No own journey/);

    expect(await snapshot(personId)).toEqual(before);
  });
});
