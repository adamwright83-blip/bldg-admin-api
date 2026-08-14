import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  commercialMissionEvents,
  commercialMissionFieldStates,
  commercialMissions,
  commercialVisitOutcomes,
  dayforgeSaasMemberships,
  dayforgeSaasTenants,
} from "../../drizzle/schema";
import {
  createCommercialMission,
  getCommercialMission,
} from "../commercialMissions/commercialMissionStore";
import { recordCommercialMissionVisitOutcome } from "../commercialMissions/commercialMissionFieldService";
import { getDb } from "../db";
import {
  getAuthoritativeVisitRoute,
  startAuthoritativeVisitRoute,
} from "./authoritativeVisitRouteService";
import { deriveAuthoritativeRouteGrammar } from "../../shared/actionGrammar";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);
vi.setConfig({ testTimeout: 30_000 });

const tenantId = `route-${randomUUID().slice(0, 8)}`;
const actorId = `field-${randomUUID().slice(0, 8)}`;
const missionIds: number[] = [];

function missionInput(index: number) {
  return {
    tenantId,
    assignedTo: actorId,
    account: {
      name: `Route Account ${index}`,
      accountType: "hotel",
      address: `${100 + index} Route Street, Los Angeles, CA`,
      latitude: null,
      longitude: null,
      locationCount: 1,
      decisionMaker: { name: null, title: null },
    },
    opportunity: {
      estimatedAnnualValueCents: null,
      estimateConfidence: "medium" as const,
      score: 70 - index,
      primarySignal: "Production-shaped route integration fixture",
      reasons: ["Genuine commercial visit candidate"],
      risks: [],
      evidence: [],
    },
    brief: {
      laundryOpportunity: "Recurring commercial laundry",
      salesAngle: "Local service",
      openingLine: "How is laundry handled today?",
      discoveryQuestions: [],
      objections: [],
    },
    steps: [],
    actor: { type: "driver" as const, id: actorId },
    idempotencyKey: `route-create:${tenantId}:${index}`,
  };
}

describe.skipIf(!runDatabaseGate)(
  "authoritative visit route production chain",
  () => {
    afterAll(async () => {
      const db = await getDb();
      if (!db) return;
      if (missionIds.length) {
        await db
          .delete(commercialVisitOutcomes)
          .where(
            and(
              eq(commercialVisitOutcomes.tenantId, tenantId),
              inArray(commercialVisitOutcomes.missionId, missionIds)
            )
          );
        await db
          .delete(commercialMissionFieldStates)
          .where(
            and(
              eq(commercialMissionFieldStates.tenantId, tenantId),
              inArray(commercialMissionFieldStates.missionId, missionIds)
            )
          );
        await db
          .delete(commercialMissionEvents)
          .where(
            and(
              eq(commercialMissionEvents.tenantId, tenantId),
              inArray(commercialMissionEvents.missionId, missionIds)
            )
          );
        await db
          .delete(commercialMissions)
          .where(
            and(
              eq(commercialMissions.tenantId, tenantId),
              inArray(commercialMissions.id, missionIds)
            )
          );
      }
      await db
        .delete(dayforgeSaasMemberships)
        .where(eq(dayforgeSaasMemberships.tenantId, tenantId));
      await db
        .delete(dayforgeSaasTenants)
        .where(eq(dayforgeSaasTenants.id, tenantId));
    });

    it("real stop -> route start -> visit write -> fresh read -> derived coverage", async () => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.insert(dayforgeSaasTenants).values({
        id: tenantId,
        slug: tenantId,
        businessName: "Route Integration",
        brandName: "Route Integration",
        primaryColor: "#000000",
        contactName: "Test Operator",
        contactEmail: `${tenantId}@example.test`,
        timeZone: "America/Los_Angeles",
        status: "active",
      });
      await db
        .insert(dayforgeSaasMemberships)
        .values({ tenantId, userOpenId: actorId, role: "field", active: true });
      for (let index = 0; index < 3; index += 1) {
        const mission = await createCommercialMission(missionInput(index));
        missionIds.push(mission.id);
      }

      await expect(
        startAuthoritativeVisitRoute({
          tenantId,
          actorId,
          requestId: randomUUID(),
          missionIds: [missionIds[0]!, 999_999_999],
        })
      ).rejects.toThrow(/current eligible visit recommendation/);

      await db
        .update(commercialMissions)
        .set({ assignedTo: "another-field-user" })
        .where(
          and(
            eq(commercialMissions.tenantId, tenantId),
            eq(commercialMissions.id, missionIds[2]!)
          )
        );
      await expect(
        startAuthoritativeVisitRoute({
          tenantId,
          actorId,
          requestId: randomUUID(),
          missionIds,
        })
      ).rejects.toThrow(/current eligible visit recommendation/);
      await db
        .update(commercialMissions)
        .set({ assignedTo: actorId, expiresAt: new Date(Date.now() - 60_000) })
        .where(
          and(
            eq(commercialMissions.tenantId, tenantId),
            eq(commercialMissions.id, missionIds[2]!)
          )
        );
      await expect(
        startAuthoritativeVisitRoute({
          tenantId,
          actorId,
          requestId: randomUUID(),
          missionIds,
        })
      ).rejects.toThrow(/current eligible visit recommendation/);
      await db
        .update(commercialMissions)
        .set({ expiresAt: null })
        .where(
          and(
            eq(commercialMissions.tenantId, tenantId),
            eq(commercialMissions.id, missionIds[2]!)
          )
        );

      const requestId = randomUUID();
      const started = await startAuthoritativeVisitRoute({
        tenantId,
        actorId,
        requestId,
        missionIds,
      });
      expect(started).toMatchObject({ totalStops: 3, coveredCount: 0 });
      const replay = await startAuthoritativeVisitRoute({
        tenantId,
        actorId,
        requestId,
        missionIds,
      });
      expect(replay.occurrenceId).toBe(started.occurrenceId);

      const mission = await getCommercialMission({
        tenantId,
        missionId: missionIds[0]!,
      });
      if (!mission) throw new Error("Activated mission is missing");
      await db
        .update(commercialMissions)
        .set({ status: "arrived" })
        .where(
          and(
            eq(commercialMissions.tenantId, tenantId),
            eq(commercialMissions.id, mission.id)
          )
        );
      await db.insert(commercialMissionFieldStates).values({
        tenantId,
        missionId: mission.id,
        version: 1,
        notes: "",
        arrivedAt: new Date(),
        checkInMethod: "manual",
      });

      const outcomeRequestId = randomUUID();
      await recordCommercialMissionVisitOutcome({
        tenantId,
        missionId: mission.id,
        actorId,
        expectedMissionVersion: mission.version,
        expectedFieldVersion: 1,
        requestId: outcomeRequestId,
        outcome: "follow_up",
        notes: "Commercial visit completed; follow-up requested.",
        followUpAt: new Date(Date.now() + 86_400_000),
        decisionMakerStatus: "met",
        collateralDelivered: false,
        quoteRequested: false,
        pilotRequested: false,
        followUpRequested: true,
      });
      await recordCommercialMissionVisitOutcome({
        tenantId,
        missionId: mission.id,
        actorId,
        expectedMissionVersion: mission.version,
        expectedFieldVersion: 1,
        requestId: outcomeRequestId,
        outcome: "follow_up",
        notes: "Commercial visit completed; follow-up requested.",
        followUpAt: new Date(Date.now() + 86_400_000),
        decisionMakerStatus: "met",
        collateralDelivered: false,
        quoteRequested: false,
        pilotRequested: false,
        followUpRequested: true,
      });

      const refreshed = await getAuthoritativeVisitRoute({ tenantId, actorId });
      expect(refreshed).toMatchObject({
        occurrenceId: started.occurrenceId,
        totalStops: 3,
        coveredCount: 1,
      });
      expect(refreshed?.stops.filter(stop => stop.evidenced)).toHaveLength(1);
      expect(deriveAuthoritativeRouteGrammar(refreshed)?.count).toBe(3);
      expect(
        await getAuthoritativeVisitRoute({
          tenantId,
          actorId: "another-field-user",
        })
      ).toBeNull();

      await db
        .update(commercialMissions)
        .set({ assignedTo: "another-field-user" })
        .where(
          and(
            eq(commercialMissions.tenantId, tenantId),
            eq(commercialMissions.id, missionIds[2]!)
          )
        );
      const reconciled = await getAuthoritativeVisitRoute({
        tenantId,
        actorId,
      });
      expect(reconciled).toMatchObject({ totalStops: 2, coveredCount: 1 });
      expect(reconciled?.stops.map(stop => stop.missionId)).toEqual(
        missionIds.slice(0, 2)
      );
    });
  }
);
