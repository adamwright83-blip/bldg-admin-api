import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  commercialMissionEvents,
  commercialMissionGameResults,
  commercialMissionGameRewards,
  commercialMissionPhoneHandoffs,
  commercialOrderAttributions,
  dayforgeAuditEvents,
  dayforgeProductEvents,
  orders,
} from "../../drizzle/schema";
import { createCommercialMission } from "../commercialMissions/commercialMissionStore";
import {
  completeCommercialMissionGame,
  startCommercialMissionGame,
} from "../commercialMissions/commercialMissionGameService";
import {
  arriveCommercialMissionField,
  consumeCommercialMissionPhoneHandoff,
  createCommercialMissionPhoneHandoff,
  departCommercialMissionField,
  recordCommercialMissionVisitOutcome,
  startCommercialMissionFieldPreparation,
  updateCommercialMissionFieldChecklist,
} from "../commercialMissions/commercialMissionFieldService";
import {
  assertDriverCanReadMission,
} from "../commercialMissions/commercialMissionAuthorization";
import {
  getCommercialMission,
  listCommercialMissionEvents,
  transitionCommercialMission,
} from "../commercialMissions/commercialMissionStore";
import {
  approveCommercialProposal,
  generateCommercialProposal,
  saveCommercialProposalProfile,
} from "../commercialProposals/commercialProposalService";
import {
  attributeCommercialOrder,
  completeCommercialFollowUp,
  getCommercialPipelineDetail,
  listCommercialPipeline,
  resolveCommercialPipelineMission,
  scheduleCommercialFollowUp,
} from "../commercialPipeline/commercialPipelineService";
import { getDb } from "../db";
import {
  discoverLaundryTerritory,
  type RankedTerritoryOpportunity,
} from "../territory/territoryDiscovery";
import {
  getPersistedTerritoryResult,
  persistTerritoryScan,
} from "../territory/territoryStore";
import { DeterministicTerritoryProvider } from "../territory/testSupport/deterministicTerritoryProvider";
import {
  assertNoFabricatedExternalTruth,
  assertOrderedEventRows,
  assertPrivacySafeAnalyticsProperties,
} from "./releaseAssertions";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

function missionInput(
  tenantId: string,
  assignedTo: string,
  opportunity: RankedTerritoryOpportunity
) {
  return {
    tenantId,
    assignedTo,
    account: {
      providerName: opportunity.providerName,
      providerAccountId: opportunity.providerAccountId,
      name: opportunity.account.name,
      accountType: opportunity.account.accountType,
      address: opportunity.account.address,
      latitude: opportunity.account.latitude,
      longitude: opportunity.account.longitude,
      locationCount: opportunity.account.locationCount,
      decisionMaker: opportunity.account.decisionMaker,
    },
    opportunity: {
      estimatedAnnualValueCents:
        opportunity.score.estimatedAnnualValueCents,
      estimateConfidence: opportunity.score.grade,
      score: opportunity.score.score,
      primarySignal: opportunity.primarySignal,
      reasons: opportunity.score.reasons,
      risks: opportunity.score.risks,
    },
    brief: {
      laundryOpportunity: `Recurring commercial laundry for ${opportunity.account.name}.`,
      salesAngle: "Local scheduled pickup sized to the account's estimated demand.",
      openingLine: "Who owns the recurring laundry program?",
      discoveryQuestions: [
        "How is laundry handled today?",
        "Which pickup cadence fits the operation?",
      ],
      objections: ["Current provider", "Pricing", "Turnaround"],
    },
    steps: [
      {
        key: "scout",
        label: "Scout",
        detail: "Review sourced evidence.",
        status: "completed" as const,
        position: 0,
      },
      {
        key: "prepare",
        label: "Prepare",
        detail: "Build the pitch.",
        status: "ready" as const,
        position: 1,
      },
      {
        key: "battle",
        label: "Battle",
        detail: "Complete BORESLAY.",
        status: "locked" as const,
        position: 2,
      },
      {
        key: "field",
        label: "Field",
        detail: "Complete the visit.",
        status: "locked" as const,
        position: 3,
      },
    ],
    actor: { type: "operator" as const, id: "release-operator" },
  };
}

describe.skipIf(!runDatabaseGate)(
  "DayForge MySQL release journey",
  () => {
    it(
      "keeps one tenant-scoped mission from territory through realized revenue",
      async () => {
        process.env.JWT_SECRET =
          process.env.JWT_SECRET ?? "dayforge-release-gate-secret";
        const db = await getDb();
        expect(db, "DATABASE_URL must connect to the release MySQL service").not.toBeNull();
        if (!db) return;

        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const tenantId = `release-${suffix}`;
        const otherTenantId = `other-${suffix}`;
        const driverId = `field-${suffix}`;
        const correlationId = `journey-${suffix}`;

        const discovery = await discoverLaundryTerritory({
          addressOrBusiness: "Release Gate Laundry",
          provider: new DeterministicTerritoryProvider(),
          operator: {
            tenantId,
            serviceRadiusMiles: 3,
            commercialWashFoldEnabled: true,
            averagePricePerPoundCents: 250,
            availableWeeklyCapacityPounds: 700,
            routePoints: [],
            turnaroundCompatibleByDefault: true,
            pickupDaysCompatibleByDefault: true,
          },
          limit: 12,
        });
        const persistedScan = await persistTerritoryScan({
          tenantId,
          mode: "tenant",
          addressQuery: "Release Gate Laundry",
          createdBy: "release-operator",
          result: discovery,
        });
        const selected = await getPersistedTerritoryResult({
          tenantId,
          scanId: persistedScan.scanId,
          candidateKey: discovery.opportunities[0]!.candidateKey,
        });
        expect(selected?.account.name).toBe("Westview Property Management");
        if (!selected) throw new Error("Fixture territory result was not persisted");

        const create = missionInput(tenantId, driverId, selected);
        const [firstCreate, replayCreate] = await Promise.all([
          createCommercialMission({
            ...create,
            idempotencyKey: `${correlationId}:create`,
          }),
          createCommercialMission({
            ...create,
            idempotencyKey: `${correlationId}:create`,
          }),
        ]);
        expect(replayCreate.id).toBe(firstCreate.id);
        expect(await getCommercialMission({ tenantId: otherTenantId, missionId: firstCreate.id })).toBeNull();
        expect(() =>
          assertDriverCanReadMission({
            mission: firstCreate,
            userId: `wrong-${suffix}`,
            isAdmin: false,
          })
        ).toThrow(/not assigned/);

        let mission = await transitionCommercialMission({
          tenantId,
          missionId: firstCreate.id,
          expectedVersion: firstCreate.version,
          toStatus: "selected",
          actor: { type: "operator", id: "release-operator" },
          idempotencyKey: `${correlationId}:selected`,
        });
        mission = await transitionCommercialMission({
          tenantId,
          missionId: mission.id,
          expectedVersion: mission.version,
          toStatus: "game_ready",
          actor: { type: "operator", id: "release-operator" },
          idempotencyKey: `${correlationId}:game-ready`,
        });

        const attemptId = `attempt-${suffix}`;
        const gameStarted = await startCommercialMissionGame({
          tenantId,
          missionId: mission.id,
          playerId: driverId,
          expectedVersion: mission.version,
          gameAttemptId: attemptId,
        });
        const telemetry = {
          sparkScore: 8,
          clockheadScore: 3,
          durationMs: 95_000,
          replay: { fixture: true, externalProvider: false },
        };
        const completions = await Promise.all([
          completeCommercialMissionGame({
            tenantId,
            missionId: mission.id,
            playerId: driverId,
            expectedVersion: gameStarted.mission.version,
            gameAttemptId: attemptId,
            telemetry,
          }),
          completeCommercialMissionGame({
            tenantId,
            missionId: mission.id,
            playerId: driverId,
            expectedVersion: gameStarted.mission.version,
            gameAttemptId: attemptId,
            telemetry,
          }),
        ]);
        expect(completions.every(item => item.phoneMissionUnlocked)).toBe(true);
        const [gameResults, gameRewards] = await Promise.all([
          db
            .select()
            .from(commercialMissionGameResults)
            .where(
              and(
                eq(commercialMissionGameResults.tenantId, tenantId),
                eq(commercialMissionGameResults.missionId, mission.id)
              )
            ),
          db
            .select()
            .from(commercialMissionGameRewards)
            .where(
              and(
                eq(commercialMissionGameRewards.tenantId, tenantId),
                eq(commercialMissionGameRewards.missionId, mission.id)
              )
            ),
        ]);
        expect(gameResults).toHaveLength(1);
        expect(gameRewards).toHaveLength(1);

        const handoff = await createCommercialMissionPhoneHandoff({
          tenantId,
          missionId: mission.id,
          actorId: "release-operator",
          requestId: `handoff-${suffix}`,
          driverOrigin: "https://driver.fixture.invalid",
        });
        const token = new URL(handoff.secureUrl).searchParams.get("handoff");
        expect(token).toBeTruthy();
        if (!token) throw new Error("Secure fixture handoff token is missing");
        await expect(
          consumeCommercialMissionPhoneHandoff({
            tenantId,
            missionId: mission.id,
            actorId: `wrong-${suffix}`,
            token,
          })
        ).rejects.toThrow(/assigned to another/);
        await Promise.all([
          consumeCommercialMissionPhoneHandoff({
            tenantId,
            missionId: mission.id,
            actorId: driverId,
            token,
          }),
          consumeCommercialMissionPhoneHandoff({
            tenantId,
            missionId: mission.id,
            actorId: driverId,
            token,
          }),
        ]);
        const consumed = await db
          .select()
          .from(commercialMissionPhoneHandoffs)
          .where(
            and(
              eq(commercialMissionPhoneHandoffs.tenantId, tenantId),
              eq(commercialMissionPhoneHandoffs.missionId, mission.id)
            )
          );
        expect(consumed).toHaveLength(1);
        expect(consumed[0]?.consumedBy).toBe(driverId);

        await saveCommercialProposalProfile({
          tenantId,
          actorId: "release-operator",
          profile: {
            storeName: "Release Gate Laundry",
            operatorName: "Release Operator",
            phone: "+1-555-0102",
            email: "release@fixture.invalid",
            website: "https://laundry.fixture.invalid",
            address: "100 Release Gate Way, Los Angeles, CA 90012",
            logoUrl: null,
            commercialPricePerPoundCents: 250,
            minimumOrderCents: 5_000,
            turnaroundLabel: "48-hour fixture turnaround",
            pickupScheduleLabel: "Two fixture pickups per week",
            serviceAreaLabel: "Three-mile fixture service area",
            insuranceLabel: null,
            services: ["Commercial wash, dry, and fold"],
          },
        });
        mission = (await getCommercialMission({ tenantId, missionId: mission.id }))!;
        let fieldState = await startCommercialMissionFieldPreparation({
          tenantId,
          missionId: mission.id,
          actorId: driverId,
          expectedMissionVersion: mission.version,
          requestId: `prep-${suffix}`,
        });
        const proposal = await generateCommercialProposal({
          tenantId,
          missionId: mission.id,
          actorId: "release-operator",
          requestId: `proposal-${suffix}`,
        });
        await approveCommercialProposal({
          tenantId,
          missionId: mission.id,
          proposalId: proposal.id,
          actorId: "release-operator",
          requestId: `approve-${suffix}`,
        });
        for (const item of fieldState.checklist.filter(item => item.required)) {
          fieldState = await updateCommercialMissionFieldChecklist({
            tenantId,
            missionId: mission.id,
            actorId: driverId,
            expectedFieldVersion: fieldState.field!.version,
            itemKey: item.itemKey,
            status: "completed",
            requestId: `check-${item.itemKey}-${suffix}`,
          });
        }
        fieldState = await departCommercialMissionField({
          tenantId,
          missionId: mission.id,
          actorId: driverId,
          expectedMissionVersion: fieldState.mission.version,
          expectedFieldVersion: fieldState.field!.version,
          requestId: `depart-${suffix}`,
        });
        fieldState = await arriveCommercialMissionField({
          tenantId,
          missionId: mission.id,
          actorId: driverId,
          expectedMissionVersion: fieldState!.mission.version,
          expectedFieldVersion: fieldState!.field!.version,
          requestId: `arrive-${suffix}`,
          checkInMethod: "manual",
        });
        fieldState = await recordCommercialMissionVisitOutcome({
          tenantId,
          missionId: mission.id,
          actorId: driverId,
          expectedMissionVersion: fieldState!.mission.version,
          expectedFieldVersion: fieldState!.field!.version,
          requestId: `outcome-${suffix}`,
          outcome: "follow_up",
          notes: "Fixture visit requests an operator follow-up.",
          followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          decisionMakerStatus: "met",
          collateralDelivered: true,
          quoteRequested: true,
          pilotRequested: false,
          followUpRequested: true,
          reason: "follow_up_requested",
        });
        expect(fieldState.mission.status).toBe("follow_up");

        const pipelineRow = (await listCommercialPipeline(tenantId)).find(
          item => item.mission.id === mission.id
        );
        expect(pipelineRow).toBeTruthy();
        if (!pipelineRow) throw new Error("Mission pipeline projection is missing");
        let pipeline = await scheduleCommercialFollowUp({
          tenantId,
          pipelineId: pipelineRow.id,
          actorId: "release-operator",
          requestId: `followup-${suffix}`,
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          note: "Confirm the fixture pilot scope.",
        });
        const followUp = pipeline.followUps.find(
          item => item.requestId === `followup-${suffix}`
        );
        expect(followUp).toBeTruthy();
        if (!followUp) throw new Error("Fixture follow-up is missing");
        pipeline = await completeCommercialFollowUp({
          tenantId,
          pipelineId: pipelineRow.id,
          followUpId: followUp.id,
          actorId: "release-operator",
          requestId: `followup-done-${suffix}`,
        });
        expect(
          pipeline.followUps.find(item => item.id === followUp.id)?.status
        ).toBe("completed");
        pipeline = await resolveCommercialPipelineMission({
          tenantId,
          pipelineId: pipelineRow.id,
          expectedMissionVersion: fieldState.mission.version,
          action: "won",
          actorId: "release-operator",
          requestId: `won-${suffix}`,
          reason: "Fixture approval recorded",
        });
        expect(pipeline.customer?.sourceMissionId).toBe(mission.id);
        expect(pipeline.finalReward?.missionId).toBe(mission.id);

        const orderInsert = await db.insert(orders).values({
          tenantId,
          serviceType: "wash_fold",
          pickupDate: "2026-01-16",
          pickupTimeWindow: "9am-11am",
          address: "1420 Westview Avenue, Los Angeles, CA 90012",
          firstName: "Fixture",
          lastName: "Account",
          phone: "+1-555-0103",
          status: "delivered",
          subtotal: "240.00",
          total: "240.00",
          paid: true,
          paidAt: new Date(),
        });
        const orderId = Number(orderInsert[0].insertId);
        const attributions = await Promise.all([
          attributeCommercialOrder({
            tenantId,
            pipelineId: pipelineRow.id,
            orderId,
            actorId: "release-operator",
            requestId: `order-${suffix}`,
          }),
          attributeCommercialOrder({
            tenantId,
            pipelineId: pipelineRow.id,
            orderId,
            actorId: "release-operator",
            requestId: `order-${suffix}`,
          }),
        ]);
        expect(attributions.every(item => item.pipeline.firstOrderId === orderId)).toBe(true);
        const persistedAttributions = await db
          .select()
          .from(commercialOrderAttributions)
          .where(
            and(
              eq(commercialOrderAttributions.tenantId, tenantId),
              eq(commercialOrderAttributions.orderId, orderId)
            )
          );
        expect(persistedAttributions).toHaveLength(1);
        const finalPipeline = await getCommercialPipelineDetail({
          tenantId,
          pipelineId: pipelineRow.id,
        });
        expect(finalPipeline?.pipeline.realizedRevenueCents).toBe(24_000);
        expect(finalPipeline?.pipeline.invoicedRevenueCents).toBe(0);
        assertNoFabricatedExternalTruth({
          invoicedRevenueCents:
            finalPipeline?.pipeline.invoicedRevenueCents ?? -1,
          invoiceEvidenceAvailable: false,
        });

        const eventRows = await listCommercialMissionEvents({
          tenantId,
          missionId: mission.id,
        });
        assertOrderedEventRows(eventRows);
        expect(eventRows.map(event => event.eventName)).toEqual(
          expect.arrayContaining([
            "mission_created",
            "game_started",
            "game_completed",
            "phone_unlocked",
            "phone_handoff_consumed",
            "preparation_started",
            "departed",
            "arrived",
            "follow_up_required",
            "account_won",
            "first_order_attributed",
          ])
        );
        const createEvents = eventRows.filter(
          event => event.idempotencyKey === `${correlationId}:create`
        );
        const phoneUnlocks = eventRows.filter(
          event => event.eventName === "phone_unlocked"
        );
        expect(createEvents).toHaveLength(1);
        expect(phoneUnlocks).toHaveLength(1);
        expect(
          await db
            .select()
            .from(commercialMissionEvents)
            .where(
              and(
                eq(commercialMissionEvents.tenantId, otherTenantId),
                eq(commercialMissionEvents.missionId, mission.id)
              )
            )
        ).toHaveLength(0);

        const auditRows = await db
          .select()
          .from(dayforgeAuditEvents)
          .where(
            and(
              eq(dayforgeAuditEvents.tenantId, tenantId),
              eq(dayforgeAuditEvents.entityType, "commercial_mission"),
              eq(dayforgeAuditEvents.entityId, String(mission.id))
            )
          )
          .orderBy(asc(dayforgeAuditEvents.createdAt), asc(dayforgeAuditEvents.id));
        expect(auditRows.length).toBeGreaterThan(5);
        assertOrderedEventRows(auditRows);

        const productRows = await db
          .select()
          .from(dayforgeProductEvents)
          .where(
            and(
              eq(dayforgeProductEvents.tenantId, tenantId),
              eq(dayforgeProductEvents.missionId, mission.id)
            )
          )
          .orderBy(
            asc(dayforgeProductEvents.occurredAt),
            asc(dayforgeProductEvents.createdAt)
          );
        expect(productRows.length).toBeGreaterThan(3);
        for (const productEvent of productRows) {
          assertPrivacySafeAnalyticsProperties(
            (productEvent.propertiesJson ?? {}) as Record<string, unknown>
          );
        }
        const productEventNames = productRows.map(event => event.eventName);
        expect(productEventNames).toEqual(
          expect.arrayContaining([
            "mission_created",
            "mission_game_started",
            "mission_game_completed",
            "mission_phone_unlocked",
            "field_preparation_started",
            "field_departed",
            "field_arrived",
            "visit_completed",
            "follow_up_created",
            "account_won",
            "revenue_realized",
          ])
        );
        expect(productEventNames).not.toEqual(
          expect.arrayContaining([
            "first_order_created",
            "revenue_invoiced",
            "print_job_ready",
            "win_back_sent",
          ])
        );
      },
      60_000
    );
  }
);
