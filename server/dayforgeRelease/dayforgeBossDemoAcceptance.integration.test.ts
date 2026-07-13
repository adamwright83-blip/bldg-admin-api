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
  getCommercialMission,
  listCommercialMissionEvents,
  transitionCommercialMission,
} from "../commercialMissions/commercialMissionStore";
import {
  approveCommercialProposal,
  generateCommercialProposal,
  recordCommercialProposalBrowserPrint,
  saveCommercialProposalProfile,
} from "../commercialProposals/commercialProposalService";
import {
  attributeCommercialOrder,
  getCommercialPipelineDetail,
  listCommercialPipeline,
  resolveCommercialPipelineMission,
} from "../commercialPipeline/commercialPipelineService";
import {
  approveCustomerRecoveryDraft,
  createCustomerRecoveryIntervention,
  getLatestChurnScan,
  markCustomerRecoveryContacted,
  prepareCustomerRecoveryManualContact,
  refreshCustomerRecoveryAttribution,
  runCustomerChurnScan,
  saveCustomerRecoveryProfile,
  setCustomerRecoveryPermission,
} from "../churnRadar/customerChurnService";
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
      estimatedAnnualValueCents: opportunity.score.estimatedAnnualValueCents,
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
    actor: { type: "operator" as const, id: "boss-demo-operator" },
  };
}

describe.skipIf(!runDatabaseGate)(
  "DayForge boss demo acceptance journey",
  () => {
    it(
      "keeps one tenant-scoped mission and account identity from territory through recovered revenue, and blocks cross-tenant access",
      async () => {
        process.env.JWT_SECRET =
          process.env.JWT_SECRET ?? "dayforge-release-gate-secret";
        const db = await getDb();
        expect(db, "DATABASE_URL must connect to the release MySQL service").not.toBeNull();
        if (!db) return;

        const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
        const tenantId = `boss-${suffix}`;
        const otherTenantId = `boss-other-${suffix}`;
        const driverId = `boss-field-${suffix}`;
        const correlationId = `boss-demo-${suffix}`;
        const numericSuffix = suffix
          .split("")
          .map(char => (/[0-9]/.test(char) ? char : String(char.charCodeAt(0) % 10)))
          .join("")
          .slice(0, 4);
        const customerPhone = "555010" + numericSuffix;

        // ---- Configure store (recovery/proposal profile) ----
        await saveCommercialProposalProfile({
          tenantId,
          actorId: "boss-demo-operator",
          profile: {
            storeName: "Boss Demo Laundry",
            operatorName: "Boss Demo Operator",
            phone: "+1-555-0199",
            email: "boss-demo@fixture.invalid",
            website: "https://laundry.fixture.invalid",
            address: "200 Boss Demo Way, Los Angeles, CA 90012",
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
        await saveCustomerRecoveryProfile({
          tenantId,
          actorId: "boss-demo-operator",
          storeName: "Boss Demo Laundry",
          senderName: "Boss Demo Operator",
          schedulingUrl: "https://laundry.fixture.invalid/schedule",
        });

        // ---- Territory scan -> select opportunity ----
        const discovery = await discoverLaundryTerritory({
          addressOrBusiness: "Boss Demo Laundry",
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
          addressQuery: "Boss Demo Laundry",
          createdBy: "boss-demo-operator",
          result: discovery,
        });
        const selected = await getPersistedTerritoryResult({
          tenantId,
          scanId: persistedScan.scanId,
          candidateKey: discovery.opportunities[0]!.candidateKey,
        });
        if (!selected) throw new Error("Fixture territory result was not persisted");
        const estimatedAnnualValueCents = selected.score.estimatedAnnualValueCents;

        // ---- Create mission -> assign ----
        const create = missionInput(tenantId, driverId, selected);
        const mission0 = await createCommercialMission({
          ...create,
          idempotencyKey: `${correlationId}:create`,
        });
        expect(mission0.tenantId).toBe(tenantId);
        expect(mission0.assignedTo).toBe(driverId);
        expect(mission0.opportunity.estimatedAnnualValueCents).toBe(
          estimatedAnnualValueCents
        );
        expect(
          await getCommercialMission({ tenantId: otherTenantId, missionId: mission0.id })
        ).toBeNull();

        let mission = await transitionCommercialMission({
          tenantId,
          missionId: mission0.id,
          expectedVersion: mission0.version,
          toStatus: "selected",
          actor: { type: "operator", id: "boss-demo-operator" },
          idempotencyKey: `${correlationId}:selected`,
        });
        mission = await transitionCommercialMission({
          tenantId,
          missionId: mission.id,
          expectedVersion: mission.version,
          toStatus: "game_ready",
          actor: { type: "operator", id: "boss-demo-operator" },
          idempotencyKey: `${correlationId}:game-ready`,
        });

        // ---- Start BORESLAY attempt -> abandon -> retry -> qualifying completion ----
        const abandonedAttemptId = `boss-attempt-abandoned-${suffix}`;
        const abandonedStart = await startCommercialMissionGame({
          tenantId,
          missionId: mission.id,
          playerId: driverId,
          expectedVersion: mission.version,
          gameAttemptId: abandonedAttemptId,
        });
        expect(abandonedStart.mission.id).toBe(mission.id);

        const attemptId = `boss-attempt-${suffix}`;
        const gameStarted = await startCommercialMissionGame({
          tenantId,
          missionId: mission.id,
          playerId: driverId,
          expectedVersion: abandonedStart.mission.version,
          gameAttemptId: attemptId,
        });
        expect(gameStarted.mission.id).toBe(mission.id);

        const telemetry = {
          sparkScore: 9,
          clockheadScore: 2,
          durationMs: 88_000,
          replay: { fixture: true, externalProvider: false },
        };
        // Retry-completion: complete the same attempt twice concurrently to prove
        // exactly one reward and one phone unlock regardless of retries.
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
        expect(completions.every(item => item.mission.id === mission.id)).toBe(true);
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
        // Exactly one qualifying completion result and exactly one reward, despite
        // the earlier abandoned attempt and the concurrent retry-completion.
        expect(gameResults).toHaveLength(1);
        expect(gameRewards).toHaveLength(1);

        // ---- Phone unlock (idempotent across repeat handoff calls) ----
        const handoff = await createCommercialMissionPhoneHandoff({
          tenantId,
          missionId: mission.id,
          actorId: "boss-demo-operator",
          requestId: `handoff-${suffix}`,
          driverOrigin: "https://driver.fixture.invalid",
        });
        const token = new URL(handoff.secureUrl).searchParams.get("handoff");
        if (!token) throw new Error("Secure fixture handoff token is missing");
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
        const consumedHandoffs = await db
          .select()
          .from(commercialMissionPhoneHandoffs)
          .where(
            and(
              eq(commercialMissionPhoneHandoffs.tenantId, tenantId),
              eq(commercialMissionPhoneHandoffs.missionId, mission.id)
            )
          );
        expect(consumedHandoffs).toHaveLength(1);

        // ---- Load Field -> complete preparation ----
        mission = (await getCommercialMission({ tenantId, missionId: mission.id }))!;
        let fieldState = await startCommercialMissionFieldPreparation({
          tenantId,
          missionId: mission.id,
          actorId: driverId,
          expectedMissionVersion: mission.version,
          requestId: `prep-${suffix}`,
        });

        // ---- Proposal: generate -> approve -> print job ----
        const proposal = await generateCommercialProposal({
          tenantId,
          missionId: mission.id,
          actorId: "boss-demo-operator",
          requestId: `proposal-${suffix}`,
        });
        expect(proposal.missionId).toBe(mission.id);
        const approvedProposal = await approveCommercialProposal({
          tenantId,
          missionId: mission.id,
          proposalId: proposal.id,
          actorId: "boss-demo-operator",
          requestId: `approve-${suffix}`,
        });
        expect(approvedProposal.status).toBe("approved");
        const printJob = await recordCommercialProposalBrowserPrint({
          tenantId,
          missionId: mission.id,
          proposalId: proposal.id,
          actorId: "boss-demo-operator",
          requestId: `print-${suffix}`,
        });
        expect(printJob.id).toBe(proposal.id);

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

        // ---- Depart -> arrive -> record visit as won ----
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
          expectedMissionVersion: fieldState.mission.version,
          expectedFieldVersion: fieldState.field!.version,
          requestId: `arrive-${suffix}`,
          checkInMethod: "manual",
        });
        fieldState = await recordCommercialMissionVisitOutcome({
          tenantId,
          missionId: mission.id,
          actorId: driverId,
          expectedMissionVersion: fieldState.mission.version,
          expectedFieldVersion: fieldState.field!.version,
          requestId: `outcome-${suffix}`,
          outcome: "follow_up",
          notes: "Fixture visit requests an operator follow-up before closing.",
          followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          decisionMakerStatus: "met",
          collateralDelivered: true,
          quoteRequested: true,
          pilotRequested: false,
          followUpRequested: true,
          reason: "follow_up_requested",
        });
        expect(fieldState.mission.status).toBe("follow_up");

        // ---- Mark won / convert account (idempotent across repeat won resolution) ----
        const pipelineRow = (await listCommercialPipeline(tenantId)).find(
          item => item.mission.id === mission.id
        );
        if (!pipelineRow) throw new Error("Mission pipeline projection is missing");
        const firstWonPipeline = await resolveCommercialPipelineMission({
          tenantId,
          pipelineId: pipelineRow.id,
          expectedMissionVersion: fieldState.mission.version,
          action: "won",
          actorId: "boss-demo-operator",
          requestId: `won-${suffix}`,
          reason: "Fixture approval recorded",
        });
        // Sequential replay with the same requestId proves idempotency: no
        // duplicate account/customer is created on repeat won-conversion.
        const replayWonPipeline = await resolveCommercialPipelineMission({
          tenantId,
          pipelineId: pipelineRow.id,
          expectedMissionVersion: fieldState.mission.version,
          action: "won",
          actorId: "boss-demo-operator",
          requestId: `won-${suffix}`,
          reason: "Fixture approval recorded",
        });
        const wonPipelines = [firstWonPipeline, replayWonPipeline];
        expect(
          wonPipelines.every(item => item.customer?.sourceMissionId === mission.id)
        ).toBe(true);
        const accountIds = new Set(
          wonPipelines.map(item => item.customer?.id).filter(Boolean)
        );
        expect(accountIds.size).toBe(1);
        expect(
          wonPipelines.every(item => item.finalReward?.missionId === mission.id)
        ).toBe(true);

        // ---- Create attributed paid order -> realize revenue (idempotent) ----
        const firstOrderInsert = await db.insert(orders).values({
          tenantId,
          serviceType: "wash_fold",
          pickupDate: "2026-01-16",
          pickupTimeWindow: "9am-11am",
          address: "1420 Boss Demo Avenue, Los Angeles, CA 90012",
          firstName: "Boss",
          lastName: "Demo Account",
          phone: customerPhone,
          status: "delivered",
          subtotal: "260.00",
          total: "260.00",
          paid: true,
          paidAt: new Date("2026-01-15T12:00:00Z"),
          createdAt: new Date("2026-01-15T12:00:00Z"),
        });
        const firstOrderId = Number(firstOrderInsert[0].insertId);
        const attributions = await Promise.all([
          attributeCommercialOrder({
            tenantId,
            pipelineId: pipelineRow.id,
            orderId: firstOrderId,
            actorId: "boss-demo-operator",
            requestId: `order-${suffix}`,
          }),
          attributeCommercialOrder({
            tenantId,
            pipelineId: pipelineRow.id,
            orderId: firstOrderId,
            actorId: "boss-demo-operator",
            requestId: `order-${suffix}`,
          }),
        ]);
        expect(
          attributions.every(item => item.firstOrderId === firstOrderId)
        ).toBe(true);
        const persistedAttributions = await db
          .select()
          .from(commercialOrderAttributions)
          .where(
            and(
              eq(commercialOrderAttributions.tenantId, tenantId),
              eq(commercialOrderAttributions.orderId, firstOrderId)
            )
          );
        expect(persistedAttributions).toHaveLength(1);
        const pipelineAfterFirstOrder = await getCommercialPipelineDetail({
          tenantId,
          pipelineId: pipelineRow.id,
        });
        expect(pipelineAfterFirstOrder?.values.realizedRevenueCents).toBe(26_000);
        assertNoFabricatedExternalTruth({
          invoicedRevenueCents:
            pipelineAfterFirstOrder?.values.invoicedRevenueCents ?? -1,
          invoiceEvidenceAvailable: false,
        });

        // ---- Create churn risk: seed a prior completed order two weeks before
        // the already-attributed firstOrderId, establishing a short normal
        // cadence, then scan far enough past firstOrderId that it reads as
        // badly overdue relative to that cadence ----
        const staleOrder1Insert = await db.insert(orders).values({
          tenantId,
          serviceType: "wash_fold",
          pickupDate: "2026-01-01",
          pickupTimeWindow: "9am-11am",
          address: "1420 Boss Demo Avenue, Los Angeles, CA 90012",
          firstName: "Boss",
          lastName: "Demo Account",
          phone: customerPhone,
          status: "delivered",
          subtotal: "200.00",
          total: "200.00",
          paid: true,
          paidAt: new Date("2026-01-01T12:00:00Z"),
          createdAt: new Date("2026-01-01T12:00:00Z"),
        });
        const staleOrder1Id = Number(staleOrder1Insert[0].insertId);
        expect(staleOrder1Id).toBeGreaterThan(0);
        // The already-attributed firstOrderId above (2026-01-15) stands in as
        // the second historical completed order for this customer's churn
        // history, giving a ~14-day normal cadence. Scanning many months past
        // that date reads as badly overdue.
        const churnScanNow = new Date("2026-08-01T00:00:00Z");
        const churnScan = await runCustomerChurnScan({
          tenantId,
          actorId: "boss-demo-operator",
          requestId: `churn-scan-${suffix}`,
          now: churnScanNow,
        });
        expect(churnScan).toBeTruthy();
        const staleSnapshot = churnScan!.customers.find(
          customer => customer.customerName === "Boss Demo Account"
        );
        expect(
          staleSnapshot,
          "Expected the boss-demo account to appear in the churn scan as at-risk"
        ).toBeTruthy();
        if (!staleSnapshot) throw new Error("Churn snapshot missing for boss-demo account");
        expect(staleSnapshot.score).toBeGreaterThanOrEqual(40);
        expect(staleSnapshot.activeOrderCount).toBe(0);

        const latestScan = await getLatestChurnScan(tenantId);
        expect(latestScan?.id).toBe(churnScan!.id);

        // ---- Prepare + approve win-back ----
        const intervention = await createCustomerRecoveryIntervention({
          tenantId,
          snapshotId: staleSnapshot.id,
          actorId: "boss-demo-operator",
          requestId: `recovery-${suffix}`,
        });
        expect(intervention).toBeTruthy();
        if (!intervention) throw new Error("Recovery intervention was not created");

        await setCustomerRecoveryPermission({
          tenantId,
          interventionId: intervention.id,
          actorId: "boss-demo-operator",
          requestId: `recovery-consent-${suffix}`,
          status: "opted_in",
          sourceReference: "fixture-consent-record",
          capturedAt: new Date("2026-01-01T00:00:00Z"),
          expiresAt: null,
        });

        const approvedRecovery = await approveCustomerRecoveryDraft({
          tenantId,
          interventionId: intervention.id,
          draftId: intervention.draft.id,
          actorId: "boss-demo-operator",
          requestId: `recovery-approve-${suffix}`,
        });
        expect(approvedRecovery.status).toBe("approved");
        expect(approvedRecovery.draft.status).toBe("approved");

        await prepareCustomerRecoveryManualContact({
          tenantId,
          interventionId: intervention.id,
          draftId: approvedRecovery.draft.id,
          contentHash: approvedRecovery.draft.contentHash,
          actorId: "boss-demo-operator",
          requestId: `recovery-composer-${suffix}`,
        });
        const contactedRecovery = await markCustomerRecoveryContacted({
          tenantId,
          interventionId: intervention.id,
          draftId: approvedRecovery.draft.id,
          contentHash: approvedRecovery.draft.contentHash,
          actorId: "boss-demo-operator",
          requestId: `recovery-contacted-${suffix}`,
        });
        expect(contactedRecovery?.status).toBe("contacted");

        // ---- Record returned paid order -> attribute recovered revenue (idempotent) ----
        // `contactedAt` is a MySQL `timestamp` column with second-level
        // precision, so the returning order must be timestamped a full
        // second (or more) after it to reliably land on the `>` side of the
        // attribution comparison in refreshCustomerRecoveryAttribution.
        const returnedOrderAt = new Date(Date.now() + 5_000);
        const returnedOrderInsert = await db.insert(orders).values({
          tenantId,
          serviceType: "wash_fold",
          pickupDate: "2026-06-10",
          pickupTimeWindow: "1pm-3pm",
          address: "1420 Boss Demo Avenue, Los Angeles, CA 90012",
          firstName: "Boss",
          lastName: "Demo Account",
          phone: customerPhone,
          status: "delivered",
          subtotal: "180.00",
          total: "180.00",
          paid: true,
          paidAt: returnedOrderAt,
          createdAt: returnedOrderAt,
        });
        const returnedOrderId = Number(returnedOrderInsert[0].insertId);

        const recoveredCountA = await refreshCustomerRecoveryAttribution(tenantId);
        // Sequential replay proves idempotency: no duplicate revenue on repeat
        // order attribution.
        const recoveredCountB = await refreshCustomerRecoveryAttribution(tenantId);
        expect(recoveredCountA).toBeGreaterThanOrEqual(1);
        expect(recoveredCountB).toBe(0);

        const finalIntervention = await createCustomerRecoveryIntervention({
          tenantId,
          snapshotId: staleSnapshot.id,
          actorId: "boss-demo-operator",
          requestId: `recovery-${suffix}`,
        });
        expect(finalIntervention?.id).toBe(intervention.id);
        expect(finalIntervention?.status).toBe("recovered");
        expect(finalIntervention?.recoveredOrderId).toBe(returnedOrderId);
        expect(finalIntervention?.recoveredRevenueCents).toBe(18_000);

        // ---- Verify timeline: mission events are immutable/ordered and match
        // the full boss demo journey exactly once each for the retried steps ----
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
        const gameStartedEvents = eventRows.filter(
          event => event.eventName === "game_started"
        );
        expect(createEvents).toHaveLength(1);
        expect(phoneUnlocks).toHaveLength(1);
        // Two starts: the abandoned attempt and the retry that actually qualified.
        expect(gameStartedEvents).toHaveLength(2);
        for (const missionId of [mission.id]) {
          expect(
            await db
              .select()
              .from(commercialMissionEvents)
              .where(
                and(
                  eq(commercialMissionEvents.tenantId, otherTenantId),
                  eq(commercialMissionEvents.missionId, missionId)
                )
              )
          ).toHaveLength(0);
        }

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
        expect(new Set(auditRows.map(row => row.tenantId))).toEqual(
          new Set([tenantId])
        );

        // ---- Cross-tenant isolation: a second tenant cannot read or mutate any
        // of this tenant's records ----
        expect(
          await getCommercialMission({ tenantId: otherTenantId, missionId: mission.id })
        ).toBeNull();
        expect(
          (await listCommercialPipeline(otherTenantId)).find(
            item => item.mission.id === mission.id
          )
        ).toBeUndefined();
        expect(
          await getCommercialPipelineDetail({
            tenantId: otherTenantId,
            pipelineId: pipelineRow.id,
          })
        ).toBeNull();
        await expect(
          transitionCommercialMission({
            tenantId: otherTenantId,
            missionId: mission.id,
            expectedVersion: fieldState.mission.version,
            toStatus: "selected",
            actor: { type: "operator", id: "cross-tenant-attacker" },
            idempotencyKey: `${correlationId}:cross-tenant`,
          })
        ).rejects.toThrow();
        await expect(
          resolveCommercialPipelineMission({
            tenantId: otherTenantId,
            pipelineId: pipelineRow.id,
            expectedMissionVersion: fieldState.mission.version,
            action: "won",
            actorId: "cross-tenant-attacker",
            requestId: `cross-tenant-won-${suffix}`,
            reason: "Attempted cross-tenant takeover",
          })
        ).rejects.toThrow();
        expect(
          await db
            .select()
            .from(commercialOrderAttributions)
            .where(
              and(
                eq(commercialOrderAttributions.tenantId, otherTenantId),
                eq(commercialOrderAttributions.orderId, firstOrderId)
              )
            )
        ).toHaveLength(0);
      },
      120_000
    );
  }
);
