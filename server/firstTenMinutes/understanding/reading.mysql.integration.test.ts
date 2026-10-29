import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The crew's reading on real MySQL (drizzle/0153): Nina's example, read through the same runner a real account uses.
 * Local disposable database only (see journeys.mysql.integration.test.ts).
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

describe.skipIf(!allowed)("the crew's reading on MySQL", () => {
  let db: mysql.Connection;
  beforeAll(async () => {
    db = await mysql.createConnection(url);
    await import("../journeys");
  }, 60_000);
  afterAll(async () => {
    await db?.end();
  });

  async function exampleJourney() {
    const { startJourney } = await import("../journeys");
    return (await startJourney({ requestId: randomUUID(), kind: "example" })).journey;
  }

  it("reads the example to completion and keeps every finding with its sources", async () => {
    const journey = await exampleJourney();
    const { runReading } = await import("./run");
    const { readingDepsFor } = await import("./deps");
    const { claimReading } = await import("./store");
    const { understandingView } = await import("./view");
    const runId = randomUUID();
    expect(await claimReading(journey.id, runId, { again: false })).toBe(true);
    // a second reader can't take a reading that is running
    expect(await claimReading(journey.id, randomUUID(), { again: false })).toBe(false);
    expect(await runReading(journey.id, runId, await readingDepsFor(journey))).toBe("complete");

    const view = await understandingView(journey.id);
    expect(view.status).toBe("complete");
    expect(view.finished).toEqual(["people", "conversations", "work"]);
    expect(view.counts).toMatchObject({ sent: 12, received: 9, files: 5 });
    const kinds = view.findings.map(finding => finding.payload.kind);
    for (const kind of ["business", "person", "rule", "request", "reply", "service", "place", "habit", "image", "route", "contrast", "opportunity"]) {
      expect(kinds).toContain(kind);
    }
    const opportunity = view.findings.find(finding => finding.payload.kind === "opportunity" && finding.payload.person.name === "Elena Ruiz");
    expect(opportunity?.payload).toMatchObject({ type: "became_possible", along: "street" });
    expect(view.findings.every(finding => finding.sources.length > 0)).toBe(true);
    // found in an email and again in the service sheet: one stored finding with both sources, the email first
    const rule = view.findings.find(finding => finding.payload.kind === "rule");
    expect(rule?.payload).toMatchObject({ quote: "No more Sunday deliveries." });
    expect(rule?.sources.map(source => source.provider)).toEqual(["gmail", "drive"]);
    const service = view.findings.find(finding => finding.payload.kind === "service");
    expect(service?.sources.map(source => source.provider)).toEqual(["gmail", "drive"]);

    const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM first_ten_findings WHERE journey_id = ?", [journey.id]);
    expect(Number(rows[0].n)).toBe(view.findings.length);
    // the image remembers where its picture is, server-side only
    const [image] = await db.query<mysql.RowDataPacket[]>("SELECT origin_json FROM first_ten_findings WHERE journey_id = ? AND kind = 'image'", [journey.id]);
    const origin = typeof image[0].origin_json === "string" ? JSON.parse(image[0].origin_json) : image[0].origin_json;
    expect(origin).toMatchObject({ provider: "gmail", attachmentId: "att-blue-jug" });
  });

  it("is taken again only when asked, keeps finding ids stable, and keeps what the person said about a finding", async () => {
    const journey = await exampleJourney();
    const { runReading } = await import("./run");
    const { readingDepsFor } = await import("./deps");
    const { claimReading, setFindingStatus } = await import("./store");
    const { understandingView } = await import("./view");
    const first = randomUUID();
    await claimReading(journey.id, first, { again: false });
    await runReading(journey.id, first, await readingDepsFor(journey));
    const before = await understandingView(journey.id);
    const rule = before.findings.find(finding => finding.payload.kind === "rule")!;
    await setFindingStatus(journey.id, rule.id, "confirmed", null);

    expect(await claimReading(journey.id, randomUUID(), { again: false })).toBe(false);
    const second = randomUUID();
    expect(await claimReading(journey.id, second, { again: true })).toBe(true);
    await runReading(journey.id, second, await readingDepsFor(journey));
    const after = await understandingView(journey.id);
    expect(after.findings.map(finding => finding.id).sort()).toEqual(before.findings.map(finding => finding.id).sort());
    expect(after.findings.find(finding => finding.id === rule.id)?.status).toBe("confirmed");
  });

  it("shows a reading whose server went away as failed, so it can be started again", async () => {
    const journey = await exampleJourney();
    const { claimReading } = await import("./store");
    const { understandingView } = await import("./view");
    await claimReading(journey.id, randomUUID(), { again: false });
    await db.query("UPDATE first_ten_readings SET lease_until = DATE_SUB(NOW(), INTERVAL 5 MINUTE) WHERE journey_id = ?", [journey.id]);
    expect((await understandingView(journey.id)).status).toBe("failed");
    expect(await claimReading(journey.id, randomUUID(), { again: false })).toBe(true);
  });
});
