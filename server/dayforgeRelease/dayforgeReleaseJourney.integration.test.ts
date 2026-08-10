import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  commercialAccounts,
  commercialMissions,
  commercialMissionEvents,
  commercialMissionGameResults,
  commercialMissionGameRewards,
  commercialMissionPhoneHandoffs,
  commercialOrderAttributions,
  commercialPipelineRecords,
  dayforgeAuditEvents,
  dayforgeProductEvents,
  driverGameWorldNodes,
  driverCapabilityUnlocks,
  driverColdCallBatches,
  driverColdCallTargets,
  driverScoutDiscoveries,
  driverScoutReports,
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
import { assertDriverCanReadMission } from "../commercialMissions/commercialMissionAuthorization";
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
  approveCommercialAgreement,
  attributeCommercialOrder,
  completeCommercialFollowUp,
  getCommercialPipelineDetail,
  listCommercialPipeline,
  resolveCommercialPipelineMission,
  scheduleCommercialFollowUp,
} from "../commercialPipeline/commercialPipelineService";
import { getDb } from "../db";
import {
  beginDriverRekindle,
  listDriverGameWorld,
} from "../driverGameWorld/driverGameWorldService";
import {
  completeColdCallTarget,
  createColdCallBatch,
  getColdCallBurstState,
  startColdCallTarget,
} from "../driverGameWorld/coldCallBurstService";
import {
  getLatestScoutReport,
  runExpansionScout,
} from "../driverGameWorld/expansionScoutService";
import { evaluateAndPersistExpansionScout } from "../capabilities/expansionScoutCapability";
import {
  discoverLaundryTerritory,
  type RankedTerritoryOpportunity,
} from "../territory/territoryDiscovery";
import {
  getPersistedTerritoryResult,
  persistTerritoryScan,
  saveTerritoryOperatorProfile,
} from "../territory/territoryStore";
import { listDriverBuiltMissions } from "../commercialMissions/commercialMissionBuilderService";
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
      decisionMaker: {
        ...opportunity.account.decisionMaker,
        phone: opportunity.account.phone,
        preferredChannel: opportunity.account.phone ? "phone" : "unknown",
        relationshipType: "unknown",
        source: "provider_sourced",
        sourcedAt: new Date().toISOString(),
      },
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
      salesAngle:
        "Local scheduled pickup sized to the account's estimated demand.",
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

describe.skipIf(!runDatabaseGate)("DayForge MySQL release journey", () => {
  it("keeps one tenant-scoped mission from territory through realized revenue", async () => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET ?? "dayforge-release-gate-secret";
    const db = await getDb();
    expect(
      db,
      "DATABASE_URL must connect to the release MySQL service"
    ).not.toBeNull();
    if (!db) return;

    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const tenantId = `release-${suffix}`;
    const otherTenantId = `other-${suffix}`;
    const driverId = `field-${suffix}`;
    const correlationId = `journey-${suffix}`;

    await saveTerritoryOperatorProfile({
      tenantId,
      storeName: "Release Gate Laundry",
      storeAddress: "100 Release Gate Way, Los Angeles, CA 90012",
      serviceRadiusMiles: 3,
      commercialWashFoldEnabled: true,
      averagePricePerPoundCents: 250,
      availableWeeklyCapacityPounds: 700,
      routePoints: [],
      turnaroundCompatibleByDefault: true,
      pickupDaysCompatibleByDefault: true,
    });

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
    if (!selected)
      throw new Error("Fixture territory result was not persisted");

    const callReadyFixture = {
      ...selected,
      account: {
        ...selected.account,
        // NANP 555-0100–0199 is reserved for fictional/test use. The fixture
        // remains provider-sourced so Cold Call exercises the production gate.
        phone: "+12025550199",
      },
    };
    const create = missionInput(tenantId, driverId, callReadyFixture);
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
    expect(
      await getCommercialMission({
        tenantId: otherTenantId,
        missionId: firstCreate.id,
      })
    ).toBeNull();
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

    const coldCallBatch = await createColdCallBatch({
      tenantId,
      actorId: driverId,
      requestId: randomUUID(),
    });
    expect(coldCallBatch?.targets).toHaveLength(1);
    const coldCallTarget = coldCallBatch?.targets[0];
    if (!coldCallBatch || !coldCallTarget) {
      throw new Error("Release fixture cold-call target is missing");
    }
    expect(coldCallTarget.phoneNumber).toBe("+12025550199");
    expect(coldCallTarget.sourceReference).toMatch(
      /^commercial_account_contacts:/
    );
    await startColdCallTarget({
      tenantId,
      actorId: driverId,
      batchId: coldCallBatch.id,
      targetId: coldCallTarget.id,
    });
    const coldCallRequestId = randomUUID();
    const completedColdCall = await completeColdCallTarget({
      tenantId,
      actorId: driverId,
      batchId: coldCallBatch.id,
      targetId: coldCallTarget.id,
      requestId: coldCallRequestId,
      outcome: "spoke",
      notes: "Release fixture recorded the actual call outcome.",
    });
    expect(completedColdCall?.status).toBe("completed");
    expect(completedColdCall?.completedCount).toBe(1);
    const replayedColdCall = await completeColdCallTarget({
      tenantId,
      actorId: driverId,
      batchId: coldCallBatch.id,
      targetId: coldCallTarget.id,
      requestId: coldCallRequestId,
      outcome: "spoke",
      notes: "Release fixture recorded the actual call outcome.",
    });
    expect(replayedColdCall?.completedCount).toBe(1);
    expect((await getColdCallBurstState({ tenantId, actorId: driverId })).batch?.completedCount).toBe(1);
    expect(
      await db
        .select()
        .from(driverColdCallBatches)
        .where(eq(driverColdCallBatches.id, coldCallBatch.id))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(driverColdCallTargets)
        .where(eq(driverColdCallTargets.batchId, coldCallBatch.id))
    ).toHaveLength(1);

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
    mission = (await getCommercialMission({
      tenantId,
      missionId: mission.id,
    }))!;
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

    const contestedWorld = await listDriverGameWorld({
      tenantId,
      actorId: driverId,
    });
    const contestedNode = contestedWorld.find(
      item => item.missionId === mission.id
    );
    expect(contestedNode?.visualState).toBe("contested");
    expect(contestedNode?.contestedUntil).toBeTruthy();

    const firstRekindle = await beginDriverRekindle({
      tenantId,
      actorId: driverId,
      missionId: mission.id,
    });
    const replayedRekindle = await beginDriverRekindle({
      tenantId,
      actorId: driverId,
      missionId: mission.id,
    });
    expect(firstRekindle.visualState).toBe("recovery_active");
    expect(replayedRekindle.visualState).toBe("recovery_active");

    const reloadedRecovery = await listDriverGameWorld({
      tenantId,
      actorId: driverId,
    });
    expect(
      reloadedRecovery.find(item => item.missionId === mission.id)?.visualState
    ).toBe("recovery_active");

    const persistedWorldRows = await db
      .select()
      .from(driverGameWorldNodes)
      .where(
        and(
          eq(driverGameWorldNodes.tenantId, tenantId),
          eq(driverGameWorldNodes.actorId, driverId),
          eq(driverGameWorldNodes.missionId, mission.id)
        )
      );
    expect(persistedWorldRows).toHaveLength(1);

    await expect(
      db.insert(driverGameWorldNodes).values({
        id: randomUUID(),
        tenantId,
        actorId: driverId,
        missionId: mission.id,
        entityType: "commercial_mission",
        entityId: String(mission.id),
        visualState: "recovery_active",
        worldAnchor: "gold_side_entrance",
        unlockedPath: "gold_recovery_path",
        discoveryState: "engaged",
      })
    ).rejects.toThrow();

    await db.insert(driverGameWorldNodes).values({
      id: randomUUID(),
      tenantId,
      actorId: `other-${driverId}`,
      missionId: mission.id,
      entityType: "commercial_mission",
      entityId: String(mission.id),
      visualState: "available",
      worldAnchor: "fortress_gate",
      discoveryState: "discovered",
    });

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

    pipeline = await approveCommercialAgreement({
      tenantId,
      pipelineId: pipelineRow.id,
      actorId: "release-operator",
      requestId: `agreement-${suffix}`,
      approvedAnnualValueCents: 2_160_000,
      evidenceReference: `release-fixture:${suffix}`,
    });
    expect(pipeline.customer?.approvedAnnualValueCents).toBe(2_160_000);

    const firstScoutCapability = await evaluateAndPersistExpansionScout({
      tenantId,
      actorId: driverId,
    });
    const replayedScoutCapability = await evaluateAndPersistExpansionScout({
      tenantId,
      actorId: driverId,
    });
    expect(firstScoutCapability.unlocked).toBe(true);
    expect(replayedScoutCapability.unlockedAt).toBe(firstScoutCapability.unlockedAt);
    expect(
      await db
        .select()
        .from(driverCapabilityUnlocks)
        .where(eq(driverCapabilityUnlocks.tenantId, tenantId))
    ).toHaveLength(1);

    const scoutRequestId = randomUUID();
    const scoutReport = await runExpansionScout({
      tenantId,
      actorId: driverId,
      requestId: scoutRequestId,
      provider: new DeterministicTerritoryProvider(),
    });
    expect(scoutReport.discoveries.length).toBeGreaterThan(0);
    const replayedScoutReport = await runExpansionScout({
      tenantId,
      actorId: driverId,
      requestId: scoutRequestId,
      provider: new DeterministicTerritoryProvider(),
    });
    expect(replayedScoutReport.id).toBe(scoutReport.id);
    expect((await getLatestScoutReport({ tenantId, actorId: driverId }))?.id).toBe(scoutReport.id);
    const builtScoutMissions = await listDriverBuiltMissions({ tenantId, driverId });
    expect(
      scoutReport.discoveries.every(discovery =>
        builtScoutMissions.some(mission => mission.id === discovery.missionId)
      )
    ).toBe(true);
    expect(
      await db
        .select()
        .from(driverScoutReports)
        .where(eq(driverScoutReports.tenantId, tenantId))
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(driverScoutDiscoveries)
        .where(eq(driverScoutDiscoveries.tenantId, tenantId))
    ).toHaveLength(scoutReport.discoveries.length);

    const capturedWorld = await listDriverGameWorld({
      tenantId,
      actorId: driverId,
    });
    const capturedNode = capturedWorld.find(
      item => item.missionId === mission.id
    );
    expect(capturedNode?.visualState).toBe("captured");
    expect(capturedNode?.verifiedAnnualValueCents).toBe(2_160_000);

    const reloadedCapturedWorld = await listDriverGameWorld({
      tenantId,
      actorId: driverId,
    });
    expect(
      reloadedCapturedWorld.find(item => item.missionId === mission.id)
        ?.visualState
    ).toBe("captured");

    const closedAccountInsert = await db.insert(commercialAccounts).values({
      tenantId,
      identityKey: `closed-${suffix}`,
      name: "Release Fixture Closed Account",
      accountType: "property_management",
    });
    const closedAccountId = Number(closedAccountInsert[0].insertId);
    const closedMissionInsert = await db.insert(commercialMissions).values({
      tenantId,
      opportunityId: 9_000_000,
      assignedTo: driverId,
      code: `CL${suffix.slice(0, 10)}`,
      status: "lost",
      accountSnapshotJson: { accountId: closedAccountId },
      opportunitySnapshotJson: { source: "release_fixture" },
      missionBriefJson: { source: "release_fixture" },
      createdBy: "release-operator",
      completedAt: new Date(),
    });
    const closedMissionId = Number(closedMissionInsert[0].insertId);
    await db.insert(commercialPipelineRecords).values({
      tenantId,
      accountId: closedAccountId,
      opportunityId: 9_000_000,
      missionId: closedMissionId,
      stage: "lost",
      estimatedContractValueCents: 500_000,
      lossReason: "hard_no",
    });

    const closedWorld = await listDriverGameWorld({
      tenantId,
      actorId: driverId,
    });
    const closedNode = closedWorld.find(
      item => item.missionId === closedMissionId
    );
    expect(closedNode?.visualState).toBe("closed");
    expect(closedNode?.verifiedAnnualValueCents).toBeNull();
    await expect(
      beginDriverRekindle({
        tenantId,
        actorId: driverId,
        missionId: closedMissionId,
      })
    ).rejects.toThrow("Closed opportunities cannot enter recovery");
    expect(
      (await listDriverGameWorld({ tenantId, actorId: driverId })).find(
        item => item.missionId === closedMissionId
      )?.visualState
    ).toBe("closed");

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
    expect(attributions.every(item => item.firstOrderId === orderId)).toBe(
      true
    );
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
    expect(finalPipeline?.values.realizedRevenueCents).toBe(24_000);
    expect(finalPipeline?.values.invoicedRevenueCents).toBe(0);
    assertNoFabricatedExternalTruth({
      invoicedRevenueCents: finalPipeline?.values.invoicedRevenueCents ?? -1,
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
  }, 60_000);
});
