import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** The person's answers to the crew, on real MySQL (drizzle/0154). Local disposable database only. */
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

describe.skipIf(!allowed)("answers to the crew on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("./journeys");
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  async function readExample() {
    const { startJourney } = await import("./journeys");
    const { runReading } = await import("./understanding/run");
    const { readingDepsFor } = await import("./understanding/deps");
    const { claimReading } = await import("./understanding/store");
    const { understandingView } = await import("./understanding/view");
    const journey = (await startJourney({ requestId: randomUUID(), kind: "example" })).journey;
    const runId = randomUUID();
    await claimReading(journey.id, runId, { again: false });
    await runReading(journey.id, runId, await readingDepsFor(journey));
    return { journey, view: await understandingView(journey.id) };
  }

  it("keeps Sable's confirmation and the person's corrections, in order, append-only", async () => {
    const { journey, view } = await readExample();
    const { answerFinding } = await import("./crew");
    const { understandingView } = await import("./understanding/view");
    const { suggestionRules } = await import("../../shared/firstTenMinutesCrew");
    const rule = view.findings.find(finding => finding.payload.kind === "rule")!;
    const habit = view.findings.find(finding => finding.payload.kind === "habit")!;
    await answerFinding(journey, rule.id, "confirm", null);
    await answerFinding(journey, habit.id, "change", "I used to. Not since the summer.");

    const after = await understandingView(journey.id);
    expect(after.findings.find(finding => finding.id === rule.id)?.status).toBe("confirmed");
    expect(after.findings.find(finding => finding.id === habit.id)).toMatchObject({ status: "changed", correction: "I used to. Not since the summer." });
    expect(suggestionRules(after.findings).closedDays).toEqual([0]);

    const [events] = await db.query<mysql.RowDataPacket[]>(
      "SELECT kind, payload_json FROM first_ten_events WHERE journey_id = ? ORDER BY created_at",
      [journey.id]
    );
    const payload = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);
    expect(events.map(event => event.kind)).toEqual(["finding_confirmed", "finding_changed"]);
    expect(payload(events[0].payload_json)).toMatchObject({ findingId: rule.id, kind: "rule", companion: "sable" });
    expect(payload(events[1].payload_json)).toMatchObject({ kind: "habit", correction: "I used to. Not since the summer." });
  });

  it("refuses a finding that isn't this journey's, and shows the example's own photograph", async () => {
    const { journey, view } = await readExample();
    const other = await readExample();
    const { answerFinding, findingPicture } = await import("./crew");
    const foreign = other.view.findings[0];
    await expect(answerFinding(journey, foreign.id, "dismiss", null)).rejects.toThrow(/no longer here/);
    const image = view.findings.find(finding => finding.payload.kind === "image")!;
    expect(await findingPicture(journey, image.id)).toEqual({ src: "/assets/first-ten/example/blue-jug.webp" });
    const notAnImage = view.findings.find(finding => finding.payload.kind === "rule")!;
    expect(await findingPicture(journey, notAnImage.id)).toBeNull();
  });
});
