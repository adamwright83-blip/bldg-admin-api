import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Claire's portrait on real MySQL (drizzle/0155). Local disposable database only. */
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

describe.skipIf(!allowed)("Claire's portrait on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  async function readExample() {
    const { startJourney } = await import("../journeys");
    const { runReading } = await import("../understanding/run");
    const { readingDepsFor } = await import("../understanding/deps");
    const { claimReading } = await import("../understanding/store");
    const { journeyById } = await import("../store");
    const started = (await startJourney({ requestId: randomUUID(), kind: "example" })).journey;
    const runId = randomUUID();
    await claimReading(started.id, runId, { again: false });
    await runReading(started.id, runId, await readingDepsFor(started));
    const { setJourneyStage } = await import("../store");
    await setJourneyStage(started.id, "crew");
    return (await journeyById(started.id))!;
  }

  async function written(journeyId: string) {
    const { journeyById } = await import("../store");
    const { preparePortrait } = await import("./portrait");
    const prepared = await preparePortrait((await journeyById(journeyId))!);
    await prepared.started;
    return prepared;
  }

  it("is written once, changed in the person's words, put back, kept, and then stays as kept", async () => {
    const journey = await readExample();
    const { portraitView, changePortraitLine, restorePortraitLine, keepPortraitFor, preparePortrait } = await import("./portrait");
    const { journeyById } = await import("../store");

    const first = await written(journey.id);
    expect(first.started).not.toBeNull();
    const ready = await portraitView(journey.id);
    expect(ready).toMatchObject({ status: "ready", greeting: "Nina, here's where you are." });
    expect(ready!.paragraphs.flat().map(line => line.text)).toContain("Jules handles the installations.");
    expect((await journeyById(journey.id))!.stage).toBe("portrait");

    // asked again with nothing changed: not written again
    expect((await preparePortrait((await journeyById(journey.id))!)).started).toBeNull();

    let view = await changePortraitLine(journey, "p2.s1", "Jules builds the big pieces. I do the rest.");
    expect(view.paragraphs[1][0]).toMatchObject({ text: "Jules handles the installations.", changedTo: "Jules builds the big pieces. I do the rest." });
    view = await changePortraitLine(journey, "p1.s1", null);
    expect(view.paragraphs[0][0].changedTo).toBeNull();
    view = await restorePortraitLine(journey, "p1.s1");
    expect(view.paragraphs[0][0].changedTo).toBeUndefined();

    const kept = await keepPortraitFor((await journeyById(journey.id))!);
    expect(kept.status).toBe("kept");
    expect(kept.paragraphs[1][0].changedTo).toBe("Jules builds the big pieces. I do the rest.");
    expect((await journeyById(journey.id))!.stage).toBe("chapter");
    await expect(changePortraitLine(journey, "p2.s2", "No.")).rejects.toThrow(/can't be changed/);

    const [events] = await db.query<mysql.RowDataPacket[]>(
      "SELECT kind, payload_json FROM first_ten_events WHERE journey_id = ? ORDER BY created_at",
      [journey.id]
    );
    const payload = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);
    expect(events.map(event => event.kind)).toEqual(["portrait_changed", "portrait_changed", "portrait_changed", "portrait_kept"]);
    expect(payload(events[0].payload_json)).toMatchObject({ key: "p2.s1", from: "Jules handles the installations.", to: "Jules builds the big pieces. I do the rest." });
    expect(payload(events[3].payload_json)).toMatchObject({ changed: ["p2.s1"] });
  });

  it("is written again when the person changes what it rests on, but never once kept", async () => {
    const journey = await readExample();
    const { portraitView, keepPortraitFor, preparePortrait } = await import("./portrait");
    const { answerFinding } = await import("../crew");
    const { understandingView } = await import("../understanding/view");
    const { journeyById } = await import("../store");
    await written(journey.id);
    expect((await portraitView(journey.id))!.paragraphs[2][0].text).toBe("You've added Friday deliveries and kept Sundays for yourself.");

    const rule = (await understandingView(journey.id)).findings.find(finding => finding.payload.kind === "rule")!;
    await answerFinding(journey, rule.id, "change", "Sundays are fine in wedding season.");
    const again = await written(journey.id);
    expect(again.started).not.toBeNull();
    expect((await portraitView(journey.id))!.paragraphs[2][0].text).toBe("You've added Friday deliveries.");

    await keepPortraitFor((await journeyById(journey.id))!);
    await answerFinding(journey, rule.id, "confirm", null);
    expect((await preparePortrait((await journeyById(journey.id))!)).started).toBeNull();
    expect((await portraitView(journey.id))!.status).toBe("kept");
  });

  it("is written by one run at a time", async () => {
    const journey = await readExample();
    const { claimPortrait } = await import("./store");
    const claims = await Promise.all([claimPortrait(journey.id, randomUUID(), "basis-a"), claimPortrait(journey.id, randomUUID(), "basis-a")]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
