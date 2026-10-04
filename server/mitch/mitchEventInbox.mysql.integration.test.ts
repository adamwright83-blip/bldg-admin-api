import mysql from "mysql2/promise";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MysqlMitchEventInbox } from "./mitchEventInbox";
import { mitchEventSchema } from "../../shared/mitchEvents";
// Only an explicit disposable database may be used; never mutate the production DB for this proof.
const database = process.env.MITCH_EVENT_TEST_DATABASE_URL;
describe.skipIf(!database)("Mitch MySQL event inbox", () => {
  it("persists dedupe across fresh instances and serializes concurrent processing", async () => {
    const pool = mysql.createPool(database!);
    const event = mitchEventSchema.parse({
      eventId: randomUUID(),
      type: "agent_failed",
      tenantId: "test",
      gameId: "test",
      milestoneId: randomUUID(),
      workOrderId: randomUUID(),
      actorId: "executor",
      error: "fixture",
    });
    const delivery = randomUUID();
    try {
      const ddl = await readFile(
        new URL(
          "../../drizzle/0111_mitch_producer_events.sql",
          import.meta.url
        ),
        "utf8"
      );
      for (const sql of ddl
        .split(";")
        .map(s => s.trim())
        .filter(Boolean))
        await pool.execute(sql);
      const a = new MysqlMitchEventInbox(pool),
        b = new MysqlMitchEventInbox(pool);
      await a.bindDelivery(delivery, event.eventId);
      await b.bindDelivery(delivery, event.eventId);
      expect(await a.put(event)).toBe(true);
      expect(await b.put(event)).toBe(false);
      let applied = 0;
      await Promise.all([
        a.process(event.eventId, async () => {
          applied++;
        }),
        b.process(event.eventId, async () => {
          applied++;
        }),
      ]);
      expect(applied).toBe(1);
      expect(
        await b.process(event.eventId, async () => {
          applied++;
        })
      ).toBe(false);
      await expect(b.put({ ...event, error: "changed" })).rejects.toThrow(
        "different payload"
      );
    } finally {
      await pool.execute(
        "DELETE FROM mitch_producer_deliveries WHERE delivery_id = ?",
        [delivery]
      );
      await pool.execute(
        "DELETE FROM mitch_producer_events WHERE event_id = ?",
        [event.eventId]
      );
      await pool.end();
    }
  });
});
