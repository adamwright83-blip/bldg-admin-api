import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * "Your first chapter" on real MySQL: the person returns to their portrait, a new entry from what they actually did is
 * there, and Claire answers from the records and remembers what she said. Local disposable database only.
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

const ASTRA = "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?";

describe.skipIf(!allowed)("your first chapter on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  async function atTheTable() {
    const { startJourney } = await import("../journeys");
    const { runReading } = await import("../understanding/run");
    const { readingDepsFor } = await import("../understanding/deps");
    const { claimReading } = await import("../understanding/store");
    const { journeyById, setJourneyStage } = await import("../store");
    const { recordChapterStep, prepareDraft } = await import("../chapter/chapter");
    const started = (await startJourney({ requestId: randomUUID(), kind: "example" })).journey;
    const runId = randomUUID();
    await claimReading(started.id, runId, { again: false });
    await runReading(started.id, runId, await readingDepsFor(started));
    await setJourneyStage(started.id, "chapter");
    const journey = (await journeyById(started.id))!;
    await recordChapterStep(journey, "revealed");
    for (const step of ["glove", "shake", "quill", "dip", "letter_written"] as const) await recordChapterStep(journey, step);
    await prepareDraft(journey, new Date("2026-10-29T17:00:00Z"));
    return (await journeyById(started.id))!;
  }

  it("puts the new entry on the portrait, and Claire answers from the records and remembers", async () => {
    const journey = await atTheTable();
    const { askClaire, firstChapterView, openFirstChapter } = await import("./firstChapter");
    const { changeDraft, declineDraft } = await import("../chapter/chapter");
    const { journeyById } = await import("../store");

    expect(await firstChapterView(journey)).toEqual({
      entry: "You revisited Elena's Friday request and prepared a reply using the weekly service you now offer.",
      question: "Where did we leave things with Elena?",
      answer: null,
    });
    await openFirstChapter(journey);
    await openFirstChapter((await journeyById(journey.id))!);
    expect((await journeyById(journey.id))!.stage).toBe("first_chapter");

    const asked = await askClaire((await journeyById(journey.id))!, "America/Los_Angeles");
    expect(asked?.answer?.text).toBe(
      `You picked up Elena's Friday request from April. You kept the reply as it was drafted: “${ASTRA}” It's ready, and it hasn't been sent.`
    );
    // she remembers what she said
    expect((await firstChapterView(journey))?.answer).toEqual(asked?.answer);

    // Nina puts it in her own words and decides it can wait; asked again, Claire says exactly that
    const now = new Date("2026-10-29T17:10:00Z");
    await changeDraft(journey, { body: "Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?" }, now);
    await declineDraft(journey, now);
    const again = await askClaire(journey, "America/Los_Angeles");
    expect(again?.entry).toBe("You revisited Elena's Friday request and decided the reply could wait.");
    expect(again?.answer?.text).toBe(
      "You picked up Elena's Friday request from April. You put the reply in your own words: “Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?” You decided it could wait. It hasn't been sent."
    );

    const [events] = await db.query<mysql.RowDataPacket[]>(
      "SELECT kind, payload_json FROM first_ten_events WHERE journey_id = ? AND kind IN ('first_chapter_opened', 'claire_answered') ORDER BY created_at",
      [journey.id]
    );
    expect(events.map(event => event.kind)).toEqual(["first_chapter_opened", "claire_answered", "claire_answered"]);
    const payload = (raw: unknown) => (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
    expect(payload(events[1].payload_json)).toMatchObject({ question: "Where did we leave things with Elena?", draftStatus: "prepared", reply: "unknown" });
    expect(payload(events[2].payload_json)).toMatchObject({ draftStatus: "declined" });
  });
});
