import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The first chapter on real MySQL (drizzle/0156): beats in their turn, the draft composed once and kept as the person left it. */
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

describe.skipIf(!allowed)("the first chapter on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  async function readExample(kind: "example" | "example_dev" = "example") {
    const { startJourney } = await import("../journeys");
    const { runReading } = await import("../understanding/run");
    const { readingDepsFor } = await import("../understanding/deps");
    const { claimReading } = await import("../understanding/store");
    const { journeyById, setJourneyStage } = await import("../store");
    const started = (await startJourney({ requestId: randomUUID(), kind })).journey;
    const runId = randomUUID();
    await claimReading(started.id, runId, { again: false });
    await runReading(started.id, runId, await readingDepsFor(started));
    await setJourneyStage(started.id, "chapter");
    return (await journeyById(started.id))!;
  }

  it("plays each beat in its turn, then composes Astra's draft to Elena, once", async () => {
    const journey = await readExample();
    const { chapterView, recordChapterStep, prepareDraft } = await import("./chapter");
    const before = await chapterView(journey);
    expect(before.opportunity?.person.address).toBe("elena@larkspurhotel.example");
    expect(before.progress).toEqual({ revealed: false, steps: [], letterWritten: false, trays: null });

    await recordChapterStep(journey, "revealed");
    // Pip first: not yet. The letter before the quill: not yet.
    await expect(recordChapterStep(journey, "shake")).rejects.toThrow(/Not yet/);
    await expect(recordChapterStep(journey, "letter_written")).rejects.toThrow(/proper response/);
    for (const step of ["glove", "shake", "quill", "dip"] as const) await recordChapterStep(journey, step);
    await recordChapterStep(journey, "glove"); // again: recorded once
    const played = await recordChapterStep(journey, "letter_written");
    expect(played.progress).toEqual({ revealed: true, steps: ["glove", "shake", "quill", "dip"], letterWritten: true, trays: null });

    const first = await prepareDraft(journey, new Date("2026-10-29T17:00:00Z"));
    expect(first.draft).toMatchObject({
      to: { name: "Elena Ruiz", address: "elena@larkspurhotel.example" },
      subject: "Re: Friday flowers?",
      body: "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?",
      status: "prepared",
      edited: false,
    });
    const again = await prepareDraft(journey, new Date("2026-10-29T17:00:00Z"));
    expect(again.draft?.body).toBe(first.draft?.body);

    const [events] = await db.query<mysql.RowDataPacket[]>("SELECT kind FROM first_ten_events WHERE journey_id = ? ORDER BY created_at", [journey.id]);
    expect(events.map(event => event.kind)).toEqual([
      "chapter_revealed",
      "letter_step",
      "letter_step",
      "letter_step",
      "letter_step",
      "letter_written",
      "draft_prepared",
    ]);
  });

  it("keeps the person's own words, another approach, and their decision, and never marks anything sent", async () => {
    const journey = await readExample();
    const { recordChapterStep, prepareDraft, changeDraft, declineDraft } = await import("./chapter");
    const { journeyById } = await import("../store");
    await recordChapterStep(journey, "revealed");
    for (const step of ["glove", "shake", "quill", "dip", "letter_written"] as const) await recordChapterStep(journey, step);
    const now = new Date("2026-10-29T17:00:00Z");
    await prepareDraft(journey, now);
    expect((await journeyById(journey.id))!.stage).toBe("table");

    let view = await changeDraft(journey, { approach: "short" }, now);
    expect(view.draft).toMatchObject({ approach: "short", body: "Hi Elena — we have a weekly Friday delivery now. Still interested?", edited: false });
    view = await changeDraft(journey, { body: "Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?" }, now);
    expect(view.draft).toMatchObject({ approach: "short", edited: true });
    view = await declineDraft(journey, now);
    expect(view.draft?.status).toBe("declined");
    // brought back as it was left
    view = await changeDraft(journey, {}, now);
    expect(view.draft).toMatchObject({ status: "prepared", body: "Hi Elena — Friday delivery exists now. Shall I bring a sample this Friday?" });

    const [rows] = await db.query<mysql.RowDataPacket[]>(
      "SELECT status, handed_off_at, reported_sent_at, verified_sent_at FROM first_ten_drafts WHERE journey_id = ?",
      [journey.id]
    );
    expect(rows[0]).toMatchObject({ status: "prepared", handed_off_at: null, reported_sent_at: null, verified_sent_at: null });
  });

  it("splits Dev's estimate onto two trays, keeps the arrangement, and composes the focused estimate or the question", async () => {
    const journey = await readExample("example_dev");
    const { chapterView, arrangeEstimate, prepareDraft, changeDraft } = await import("./chapter");
    const now = new Date("2026-10-29T17:00:00Z");
    const before = await chapterView(journey, now);
    expect(before).toMatchObject({ kind: "scope", title: "The Estimate That Wouldn't Fit", progress: { trays: null } });
    expect(before.opportunity?.estimate?.areas.map(area => area.name)).toEqual(["Garage", "Kitchen", "Upstairs hallway"]);

    // it won't go through the arch until the scope is separated, and nothing is taken out to make it
    await expect(prepareDraft(journey, now)).rejects.toThrow(/won't fit/);
    await expect(arrangeEstimate(journey, { thisJob: ["Garage", "Kitchen", "Upstairs hallway"], later: [] })).rejects.toThrow(/won't fit/);
    await expect(arrangeEstimate(journey, { thisJob: ["Garage"], later: ["Kitchen"] })).rejects.toThrow(/Nothing is taken out/);
    const arranged = await arrangeEstimate(journey, { thisJob: ["Garage"], later: ["Kitchen", "Upstairs hallway"] });
    expect(arranged.progress.trays).toEqual({ thisJob: ["Garage"], later: ["Kitchen", "Upstairs hallway"] });

    const asked = await prepareDraft(journey, now, "question");
    expect(asked.draft).toMatchObject({
      approach: "question",
      to: { name: "Marisol Ortega", address: "marisol.ortega@mail.example" },
      subject: "Re: Electrical work at Avenue 54",
      body: "Hi Marisol — before I finish the garage estimate, I need one detail from you: the charger model. Could you let me know?",
      status: "prepared",
      edited: false,
    });
    const focused = await changeDraft(journey, { approach: "focused" }, now);
    expect(focused.draft?.body.split("\n")[0]).toBe(
      "Hi Marisol — I've separated the garage work from the house work so we can move ahead with the first part. The later work is listed separately."
    );
    expect(focused.draft?.body).toContain("EV charger installation — charger model TBD by client");
    await expect(changeDraft(journey, { approach: "short" }, now)).rejects.toThrow(/not a way/);
    // once it's through the arch, the arrangement stays as the person left it
    await expect(arrangeEstimate(journey, { thisJob: ["Kitchen"], later: ["Garage", "Upstairs hallway"] })).rejects.toThrow(/already gone through/);

    const [events] = await db.query<mysql.RowDataPacket[]>(
      "SELECT kind FROM first_ten_events WHERE journey_id = ? AND kind IN ('estimate_arranged', 'draft_prepared', 'draft_changed') ORDER BY created_at",
      [journey.id]
    );
    expect(events.map(event => event.kind)).toEqual(["estimate_arranged", "draft_prepared", "draft_changed"]);
  });
});
