import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dayDirectorCommitments } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { landReportedCommitments, speakLandedWork } from "./reportedWork";

/**
 * Real-MySQL proof for the 2026-10-23 morning call: the operator's three reported pickups pass the Day
 * Line admission boundary as an operator instruction, are stored once however often they are repeated,
 * and show on that day's Day Line.
 */
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;

describeMysql("reported pickups land on the Day Line (MySQL)", () => {
  it("two commitments from the call are stored, admitted as claire_turn, read back, and deduplicated", async () => {
    const tenantId = `reported-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    const businessDate = "2026-10-23";
    const developments = [
      { kind: "commitment" as const, who: "", what: "Two pickups due by 10 AM", date: businessDate, time: "10:00", window: "morning" as const, place: "", operatorWords: "I have 1, 2 pickups due by 10AM", reportedAt: "2026-10-23T14:32:30.608Z" },
      { kind: "commitment" as const, who: "", what: "One pickup at 10 AM or around noon", date: businessDate, time: "", window: "morning" as const, place: "", operatorWords: "I have 1 pickup that I can pick up right at 10AM as well or at noon or something", reportedAt: "2026-10-23T14:32:30.608Z" },
    ];
    const land = () =>
      landReportedCommitments({
        developments,
        tenantId,
        operatorUserId: "adam-admin",
        dayDirectorActorId: "1",
        dayDirectorActorIds: ["1"],
        businessDate,
        conversationKey: "claire-call:f7b1344f",
        sourceEventId: "turn-6",
      });

    const landed = await land();
    expect(landed).toEqual([
      { title: "Two pickups due by 10 AM", businessDate, verified: true },
      { title: "One pickup at 10 AM or around noon", businessDate, verified: true },
    ]);
    expect(speakLandedWork(landed, businessDate)).toBe("Added to today's Day Line: two pickups due by 10 AM, and one pickup at 10 AM or around noon.");

    await land(); // the operator repeats it on a later turn
    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const rows = await db.select().from(dayDirectorCommitments).where(eq(dayDirectorCommitments.tenantId, tenantId));
    expect(rows.map(r => r.title).sort()).toEqual(["One pickup at 10 AM or around noon", "Two pickups due by 10 AM"]);
    expect((rows[0]!.metadataJson as Record<string, any>).dayLineAdmission).toMatchObject({ kind: "operator_instruction", surface: "claire_turn", operatorUserId: "adam-admin" });

    const day = await getDayDirectorState({ tenantId, actorId: "1", businessDate });
    expect(day.commitments.filter(c => c.status === "open").map(c => c.title).sort()).toEqual(["One pickup at 10 AM or around noon", "Two pickups due by 10 AM"]);
  });
});
