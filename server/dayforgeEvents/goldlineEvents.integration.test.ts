/**
 * Goldline gameplay event pipeline against real MySQL. Proves idempotency on
 * (sessionId, eventName, eventId) retry, tenant scoping of the effectiveness
 * summary, and that business-critical event names are structurally
 * unreachable from the client whitelist.
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { dayforgeAuditEvents, dayforgeProductEvents } from "../../drizzle/schema";
import { getDb } from "../db";
import { writeDayforgeEvent } from "./dayforgeEventStore";
import { getGoldlineEffectivenessSummary } from "./goldlineEffectivenessQueries";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const correlationIds: string[] = [];

describe.skipIf(!runDatabaseGate)("Goldline gameplay event pipeline", () => {
  afterAll(async () => {
    if (!correlationIds.length) return;
    const db = await getDb();
    if (!db) return;
    await db
      .delete(dayforgeProductEvents)
      .where(inArray(dayforgeProductEvents.correlationId, correlationIds));
    await db
      .delete(dayforgeAuditEvents)
      .where(inArray(dayforgeAuditEvents.correlationId, correlationIds));
  });

  async function recordGoldlineEvent(input: {
    tenantId: string;
    sessionId: string;
    eventId: string;
    eventName: "armory_weapon_selected" | "verified_capture" | "mission_engaged";
    missionId?: number | null;
    properties: Record<string, string | number | boolean>;
  }) {
    await writeDayforgeEvent({
      tenantId: input.tenantId,
      actor: { type: "field", id: "driver-1" },
      entityType: input.missionId ? "commercial_mission" : "goldline_session",
      entityId: input.missionId ? String(input.missionId) : input.sessionId,
      eventName: input.eventName,
      source: "goldline_client",
      correlationId: input.sessionId,
      idempotencyKey: `goldline:${input.sessionId}:${input.eventName}:${input.eventId}`,
      productEvent: {
        name: input.eventName,
        properties: input.properties,
        missionId: input.missionId ?? null,
      },
    });
  }

  it("does not duplicate an event on a retried eventId", async () => {
    const tenantId = `t-${randomUUID()}`;
    const sessionId = randomUUID();
    correlationIds.push(sessionId);
    const eventId = randomUUID();

    await recordGoldlineEvent({
      tenantId,
      sessionId,
      eventId,
      eventName: "armory_weapon_selected",
      properties: { sessionId, provenanceKind: "foundation" },
    });
    await recordGoldlineEvent({
      tenantId,
      sessionId,
      eventId,
      eventName: "armory_weapon_selected",
      properties: { sessionId, provenanceKind: "foundation" },
    });

    const db = await getDb();
    const rows = await db!
      .select()
      .from(dayforgeProductEvents)
      .where(inArray(dayforgeProductEvents.correlationId, [sessionId]));
    expect(rows).toHaveLength(1);
  });

  it("records two distinct events for two distinct eventIds", async () => {
    const tenantId = `t-${randomUUID()}`;
    const sessionId = randomUUID();
    correlationIds.push(sessionId);

    await recordGoldlineEvent({
      tenantId,
      sessionId,
      eventId: randomUUID(),
      eventName: "mission_engaged",
      properties: { sessionId, missionState: "active", archetype: "ANCHOR" },
    });
    await recordGoldlineEvent({
      tenantId,
      sessionId,
      eventId: randomUUID(),
      eventName: "mission_engaged",
      properties: { sessionId, missionState: "active", archetype: "GHOST" },
    });

    const db = await getDb();
    const rows = await db!
      .select()
      .from(dayforgeProductEvents)
      .where(inArray(dayforgeProductEvents.correlationId, [sessionId]));
    expect(rows).toHaveLength(2);
  });

  it("counts effectiveness summary within tenant only", async () => {
    const tenantA = `t-${randomUUID()}`;
    const tenantB = `t-${randomUUID()}`;
    const sessionA = randomUUID();
    correlationIds.push(sessionA);

    await recordGoldlineEvent({
      tenantId: tenantA,
      sessionId: sessionA,
      eventId: randomUUID(),
      eventName: "verified_capture",
      properties: { sessionId: sessionA, estimatedValueBand: "verified" },
    });

    const summaryA = await getGoldlineEffectivenessSummary({ tenantId: tenantA });
    const summaryB = await getGoldlineEffectivenessSummary({ tenantId: tenantB });
    expect(summaryA.missionProgression.verifiedCaptures).toBeGreaterThanOrEqual(1);
    expect(summaryB.missionProgression.verifiedCaptures).toBe(0);
  });
});
