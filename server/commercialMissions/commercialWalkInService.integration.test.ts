import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  commercialFollowUps,
  commercialMissions,
  commercialPipelineRecords,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { logCommercialWalkIn } from "./commercialWalkInService";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

describe.runIf(runDatabaseGate)("commercial walk-in service (MySQL)", () => {
  it("transitions the mission, updates the pipeline, and creates a follow-up in one pass", async () => {
    const db = await getDb();
    expect(db, "DATABASE_URL must connect to the release MySQL service").not.toBeNull();

    const tenantId = `walkin-${randomUUID().slice(0, 8)}`;
    const requestId = randomUUID();
    const followUpAt = new Date("2026-08-01T16:00:00Z");

    const result = await logCommercialWalkIn({
      tenantId,
      actorId: "operator-1",
      idempotencyKey: `walk-in:${requestId}`,
      requestId,
      businessName: "Integration Test Hotel",
      businessType: "hotel",
      address: "1 Test Way, Los Angeles, CA",
      contactName: "Vincent",
      contactTitle: "Concierge",
      contactEmail: "vincent@integration-test.example",
      contactPhone: "+1 310 555 0199",
      relationshipType: "concierge",
      conversationNotes: "Asked about turnaround",
      visitResult: "follow_up",
      nextAction: "Email pricing sheet tomorrow",
      followUpAt,
    });

    const mission = await db!
      .select({ status: commercialMissions.status, version: commercialMissions.version })
      .from(commercialMissions)
      .where(eq(commercialMissions.id, result.missionId));
    expect(mission[0]?.status).toBe("follow_up");
    expect(mission[0]?.version).toBe(2);

    const pipeline = await db!
      .select({ stage: commercialPipelineRecords.stage, nextFollowUpAt: commercialPipelineRecords.nextFollowUpAt })
      .from(commercialPipelineRecords)
      .where(eq(commercialPipelineRecords.missionId, result.missionId));
    expect(pipeline[0]?.stage).toBe("follow_up");
    expect(pipeline[0]?.nextFollowUpAt).toEqual(followUpAt);

    const followUps = await db!
      .select({ dueAt: commercialFollowUps.dueAt, note: commercialFollowUps.note })
      .from(commercialFollowUps)
      .where(eq(commercialFollowUps.missionId, result.missionId));
    expect(followUps).toHaveLength(1);
    expect(followUps[0]?.note).toBe("Email pricing sheet tomorrow");
  });

  it("does not duplicate the follow-up transition when the same request is retried", async () => {
    const db = await getDb();
    const tenantId = `walkin-${randomUUID().slice(0, 8)}`;
    const requestId = randomUUID();
    const input = {
      tenantId,
      actorId: "operator-1",
      idempotencyKey: `walk-in:${requestId}`,
      requestId,
      businessName: "Retry Test Hotel",
      businessType: "hotel",
      address: "2 Retry Way, Los Angeles, CA",
      contactName: "Dana",
      contactTitle: "Manager",
      conversationNotes: "Follow-up requested",
      visitResult: "follow_up" as const,
      nextAction: "Call back Thursday",
      followUpAt: new Date("2026-08-02T16:00:00Z"),
    };

    const first = await logCommercialWalkIn(input);

    const mission = await db!
      .select({ status: commercialMissions.status })
      .from(commercialMissions)
      .where(eq(commercialMissions.id, first.missionId));
    expect(mission[0]?.status).toBe("follow_up");

    const followUps = await db!
      .select({ id: commercialFollowUps.id })
      .from(commercialFollowUps)
      .where(eq(commercialFollowUps.missionId, first.missionId));
    expect(followUps).toHaveLength(1);
  });
});
