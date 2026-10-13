/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/* Controlled provider transport; real MySQL, workers, policies, voice sessions,
 * proposal revisions, and Day Director writes. No real outbound phone call. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { setActiveMacroGoal } from "../claire/macroGoalService";
import {
  resolveCanonicalOperatorIdentity,
  type CanonicalOperatorIdentity,
} from "../agents/persistentOperator/identity";
import {
  activateMacroGoalAndQueue,
  enqueueGoalCycle,
} from "../agents/persistentOperator/goalCycleService";
import { startAutonomousPersistentOperatorWorkers } from "../agents/persistentOperator/autonomousWorkerService";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";
import {
  latestStrategicProposal,
  loadStrategicProposal,
} from "./strategicStore";
import {
  scheduleAuthorizedStrategicCall,
  grantStrategicCallAuthorization,
  readStrategicCallConsent,
  revokeStrategicCallAuthorization,
} from "../agents/persistentOperator/strategicCallAuthorization";
import { OperatorAppointmentStore } from "../agents/persistentOperator/operatorAppointmentStore";
import { OperatorAppointmentWorker } from "../agents/persistentOperator/operatorAppointmentWorker";
import { executeOperatorAppointment } from "../agents/persistentOperator/operatorAppointmentExecution";
import { issueClaireToken } from "../claire/claireToken";
import { runAuthoritativeClaireVoiceTurn } from "../claire/claireTwilio";
import {
  readVerifiedStrategicApprovalItemIds,
  respondToStrategicProposal,
} from "./strategicApproval";
import { prepareStrategicProposal } from "./strategicPreparation";
import { refreshStrategicDiagnosis } from "./strategicPreparation";
import { weekStartMonday } from "../../shared/weeklyMissionReadiness";
import { PERSISTENT_OPERATOR_ENTITLEMENT } from "../../shared/saasTenant";
import { recordGoalCycleOutcome } from "../agents/persistentOperator/outcomeStore";
import { latestStrategicDiagnosis } from "./strategicStore";
import { captureExplicitDaphnePreferenceCorrections } from "../agents/daphne/explicitPreferenceCorrection";
import { loadDaphneClaireGuidance } from "../agents/daphne/claireAdapter";
import { persistStrategicProposal } from "./strategicStore";
import { routeStrategicProposalTurn } from "../claire/weeklyMission/strategicProposalTurn";
import {
  newWeeklySession,
  saveWeeklySession,
  loadWeeklySession,
} from "../claire/weeklyMission/session";
import {
  emptyDraft,
  remainingWeekHorizon,
} from "../../shared/weeklyMissionReadiness";
import { buildStrategySnapshot } from "./snapshotBuilder";
import {
  generateCandidatePlays,
  loadStrategyPlayById,
  _clearPlayAndOfferStore,
} from "./playGenerator";
import { invalidateUnresolvedTemplateGeography } from "./geographyRemediation";
import { getDb } from "../db";
import { configureTenantStrategyVertical } from "./marketContext";
import { strategyPlays } from "../../drizzle/schema";
import { planForDate } from "../planning/missionDirector/missionDirectorService";

const controlledProvider = vi.hoisted(() => ({
  calls: [] as Array<{
    to: string;
    from: string;
    createOptions: Record<string, unknown>;
  }>,
}));
vi.mock("../twilioPlatform/claireCallProvider", () => ({
  placeClaireOutboundCall: async (
    request: (typeof controlledProvider.calls)[number]
  ) => {
    if (request.to !== "+15555550111" || request.from !== "+15555550112")
      throw new Error("Controlled provider refuses any non-test phone");
    controlledProvider.calls.push(request);
    return { callSid: `CA${randomUUID().replaceAll("-", "")}` };
  },
}));
const describeMysql = process.env.DATABASE_URL ? describe : describe.skip;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => Promise<boolean>, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(150);
  }
  throw new Error("Acceptance condition timed out");
}
describeMysql(
  "Claire connected strategic journey with real persistence",
  () => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
    const tenantId = `claire-strategy-${suffix}`;
    const operator = `claire-owner-${suffix}`;
    const zone = "America/Chicago";
    let sql: mysql.Connection;
    let pool: mysql.Pool;
    let identity: CanonicalOperatorIdentity;
    let stopWorkers: (() => Promise<void>) | undefined;
    let appointmentWorker: OperatorAppointmentWorker | undefined;
    let runId = "";
    const oldDaphneTenants = process.env.DAPHNE_V2_CLAIRE_TENANTS;
    const oldDaphneGlobal = process.env.DAPHNE_V2_CLAIRE_ENABLED;
    beforeAll(async () => {
      await mkdir("artifacts/claire-strategy", { recursive: true });
      process.env.DAPHNE_V2_CLAIRE_ENABLED = "false";
      process.env.DAPHNE_V2_CLAIRE_TENANTS = tenantId;
      sql = await mysql.createConnection(process.env.DATABASE_URL!);
      pool = mysql.createPool(process.env.DATABASE_URL!);
      await sql.execute(
        "INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?,?,?,?,?,?,?,'active','laundry_fluff_fold')",
        [
          tenantId,
          tenantId,
          "Iowa test laundry",
          "Iowa test laundry",
          "#123456",
          "Test operator",
          "operator@example.invalid",
          zone,
        ]
      );
      await sql.execute(
        "INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,?,?,'user','password')",
        [tenantId, operator, "Test operator", "operator@example.invalid"]
      );
      await sql.execute(
        "INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)",
        [tenantId, operator]
      );
      await sql.execute(
        "INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,?,'manual',true)",
        [tenantId, PERSISTENT_OPERATOR_ENTITLEMENT]
      );
      await sql.execute(
        "INSERT INTO dayforge_saas_tenant_locations (tenantId,locationKey,label,address,latitude,longitude,serviceRadiusMiles,maxPoundsPerDay,maxPoundsByWeekdayJson,openCapacityPoundsPerWeek,pickupDaysJson,routeWindowsJson,turnaroundHours,deliveryEnabled,isPrimary) VALUES (?,'primary','Des Moines test territory','Des Moines, IA',41.59,-93.62,5,100,'{}',300,'[1,2,3,4,5]','[]',48,true,true)",
        [tenantId]
      );
      process.env.CLAIRE_OPERATOR_PHONES = JSON.stringify({
        [operator]: "+15555550111",
      });
      const resolved = await resolveCanonicalOperatorIdentity({
        tenantId,
        source: { type: "open_id", value: operator },
        subsystem: "strategic_acceptance",
      });
      if (!resolved.ok)
        throw new Error("Test canonical identity did not resolve");
      identity = resolved.identity;
      expect(
        await configureTenantStrategyVertical({
          identity,
          verticalKey: "laundry_fluff_fold",
        })
      ).toEqual({ verticalKey: "laundry_fluff_fold" });
      expect(
        (await readStrategicCallConsent(identity)).authorization
      ).toBeNull();
      await setActiveMacroGoal({
        tenantId,
        operatorUserId: operator,
        objective:
          "Reach 100 paid orders while validating contribution economics",
        metricKey: "paid_orders_per_period",
        targetValue: 100,
        unit: "orders",
        targetDate: formatInTimeZone(
          new Date(Date.now() + 90 * 86400000),
          zone,
          "yyyy-MM-dd"
        ),
        source: "operator_attested",
        sourceNote: "Controlled acceptance goal",
      });
      const activated = await activateMacroGoalAndQueue({
        tenantId,
        identity,
        verticalKey: "laundry_fluff_fold",
        policyVersion: "v1",
        registry: defaultVerticalRegistry,
      });
      if (!activated) throw new Error("Test macro goal not activated");
      runId = activated.run.id;
    }, 30000);
    afterAll(async () => {
      await stopWorkers?.();
      await appointmentWorker?.stop();
      await pool?.end();
      await sql?.end();
      if (oldDaphneTenants == null) delete process.env.DAPHNE_V2_CLAIRE_TENANTS;
      else process.env.DAPHNE_V2_CLAIRE_TENANTS = oldDaphneTenants;
      if (oldDaphneGlobal == null) delete process.env.DAPHNE_V2_CLAIRE_ENABLED;
      else process.env.DAPHNE_V2_CLAIRE_ENABLED = oldDaphneGlobal;
    });

    // Weekday call authority stays enforced even in CI. On weekends this voice
    // journey is explicitly skipped, never made to pass with widened consent.
    it.skipIf(Number(formatInTimeZone(new Date(), zone, "i")) >= 6)(
      "existing worker prepares without a plan or call consent, then controlled voice revises and approves the exact stored revision",
      async () => {
        stopWorkers = startAutonomousPersistentOperatorWorkers({
          enabled: true,
          leaseOwnerPrefix: `acceptance-${suffix}`,
          goalCyclePollMs: 50,
          appointmentPollMs: 50,
          bootstrapIntervalMs: 3600000,
          learningDrainIntervalMs: 3600000,
        });
        await until(async () => {
          const [rows] = await sql.execute<mysql.RowDataPacket[]>(
            "SELECT * FROM goal_cycle_decisions WHERE tenantId = ? AND goalRunId = ?",
            [tenantId, runId]
          );
          return rows.length > 0;
        });
        await stopWorkers();
        stopWorkers = undefined;
        const date = formatInTimeZone(new Date(), zone, "yyyy-MM-dd");
        const p = await latestStrategicProposal(
          identity,
          weekStartMonday(date)
        );
        expect(p).not.toBeNull();
        expect(p!.items.length).toBeGreaterThan(0);
        expect(p!.diagnosis.market.territories[0]?.label).toBe(
          "Des Moines test territory"
        );
        expect(JSON.stringify(p)).not.toMatch(
          /Century City|wilshire-corridor|west-hollywood/
        );
        const [plans] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT * FROM mission_director_plans WHERE tenantId = ?",
          [tenantId]
        );
        expect(plans.length).toBeGreaterThan(0);
        const [decisions] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT * FROM goal_cycle_decisions WHERE tenantId = ? AND goalRunId = ?",
          [tenantId, runId]
        );
        expect(decisions[0]?.selectedReasonCode).toBe(
          "MISSION_DIRECTOR_PRIMARY"
        );
        const [before] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT * FROM day_director_commitments WHERE tenantId = ?",
          [tenantId]
        );
        expect(before).toHaveLength(0);
        // Test the real generation/storage path, not only the strategy narrative.
        const generated = await generateCandidatePlays(
          tenantId,
          await buildStrategySnapshot(tenantId, {
            operatorUserId: operator,
            timeZone: zone,
          })
        );
        expect(
          generated
            .filter(play => play.provenance.geographyRefs?.length)
            .every(play => play.geography === "Des Moines test territory")
        ).toBe(true);
        _clearPlayAndOfferStore();
        expect(
          (await loadStrategyPlayById(tenantId, generated[0]!.id))?.provenance
            .geographyVersion
        ).toBe("tenant-market-v1");
        expect(
          await loadStrategyPlayById("other-tenant", generated[0]!.id)
        ).toBeNull();
        const db = await getDb();
        if (!db) throw new Error("Database unavailable");
        const legacyIds = ["candidate", "active"].map(
          status => `legacy-${status}-${suffix}`
        );
        for (const [i, status] of ["candidate", "active"].entries())
          await db.insert(strategyPlays).values({
            id: legacyIds[i]!,
            tenantId,
            businessName: "Historical contaminated template fixture",
            worldName: "Historical template",
            hypothesis: "Unverified historical fixture",
            primaryMetric: "new_paying_customers",
            geography: "century-city",
            scoreBreakdownJson: {},
            status: status as "candidate" | "active",
            verticalKey: "laundry_fluff_fold",
            templateKey: "property_expansion",
            provenanceJson: { source: "verticalTemplate:laundry_fluff_fold" },
          });
        const remediation =
          await invalidateUnresolvedTemplateGeography(tenantId);
        expect(remediation.invalidated).toContain(legacyIds[0]);
        expect(remediation.approvedHistory).toContain(legacyIds[1]);
        expect(
          (await invalidateUnresolvedTemplateGeography(tenantId)).invalidated
        ).toEqual([]);
        const [legacy] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT id,status,geography,provenanceJson FROM strategy_plays WHERE tenantId = ? AND id IN (?,?)",
          [tenantId, ...legacyIds]
        );
        expect(legacy.find(row => row.id === legacyIds[0])?.status).toBe(
          "retired"
        );
        expect(legacy.find(row => row.id === legacyIds[1])?.status).toBe(
          "active"
        );
        expect(legacy.every(row => row.geography === "century-city")).toBe(
          true
        );
        const store = new OperatorAppointmentStore(pool);
        expect(
          await scheduleAuthorizedStrategicCall({
            identity,
            timeZone: zone,
            proposalId: p!.id,
            store,
          })
        ).toMatchObject({ scheduled: false, reason: "no_authorized_channel" });
        expect(controlledProvider.calls).toHaveLength(0);
        await expect(
          respondToStrategicProposal({
            identity,
            proposalId: p!.id,
            revision: "0".repeat(64),
            action: "approve",
            itemIds: p!.items.map(i => i.id),
            source: "authenticated_app",
          })
        ).rejects.toThrow("Exact proposal revision");

        const authorization = await grantStrategicCallAuthorization({
          identity,
          weekdays: [1, 2, 3, 4, 5],
          localStart: "00:00",
          localEnd: "23:59",
          timeZone: zone,
          dailyLimit: 1,
          sourceReference: "authenticated_app:controlled_test_consent",
        });
        expect(
          (await readStrategicCallConsent(identity)).authorization?.id
        ).toBe(authorization.id);
        const scheduled = await scheduleAuthorizedStrategicCall({
          identity,
          timeZone: zone,
          proposalId: p!.id,
          store,
        });
        expect(scheduled.scheduled).toBe(true);
        appointmentWorker = new OperatorAppointmentWorker(store, {
          leaseOwner: `voice-${suffix}`,
          leaseMs: 60000,
          pollMs: 50,
          concurrency: 1,
          retryBaseMs: 30000,
        });
        void appointmentWorker.start();
        await until(async () => {
          const [rows] = await sql.execute<mysql.RowDataPacket[]>(
            "SELECT * FROM operator_appointments WHERE tenantId = ? AND appointmentKind = 'weekday_strategic_planning' AND status = 'completed'",
            [tenantId]
          );
          return rows.length === 1;
        });
        await appointmentWorker.stop();
        appointmentWorker = undefined;
        expect(controlledProvider.calls).toHaveLength(1);
        const [states] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT * FROM claire_conversation_states WHERE tenantId = ? AND id LIKE 'claire-call:%'",
          [tenantId]
        );
        expect(states).toHaveLength(1);
        let conversation =
          typeof states[0]!.stateJson === "string"
            ? JSON.parse(states[0]!.stateJson)
            : states[0]!.stateJson;
        expect(conversation.strategicProposalId).toBe(p!.id);
        expect(conversation.brief).toBe(p!.opening);
        const conversationId = String(states[0]!.id).slice(
          "claire-call:".length
        );
        const token = issueClaireToken({
          kind: "pre_drive_conversation",
          tenantId,
          userId: operator,
          conversationId,
        });
        const revised = await runAuthoritativeClaireVoiceTurn({
          conversationId,
          conversation,
          utterance:
            "change item 1 to Email the documented business-driver audit",
          rawTranscript:
            "change item 1 to Email the documented business-driver audit",
          allowFragmentWait: false,
          token,
          sourceEventId: `revision-${suffix}`,
          webhookReceivedAtMs: Date.now(),
        });
        const p2 = await latestStrategicProposal(identity, p!.weekStart);
        expect(p2!.revision).not.toBe(p!.revision);
        expect(p2!.items[0]!.title).toBe(
          "Email the documented business-driver audit"
        );
        const [updated] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT * FROM claire_conversation_states WHERE id = ?",
          [states[0]!.id]
        );
        conversation =
          typeof updated[0]!.stateJson === "string"
            ? JSON.parse(updated[0]!.stateJson)
            : updated[0]!.stateJson;
        const approved = await runAuthoritativeClaireVoiceTurn({
          conversationId,
          conversation,
          utterance: "approve the plan",
          rawTranscript: "approve the plan",
          allowFragmentWait: false,
          token,
          sourceEventId: `approval-${suffix}`,
          webhookReceivedAtMs: Date.now(),
        });
        const [committed] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT * FROM day_director_commitments WHERE tenantId = ?",
          [tenantId]
        );
        expect(committed).toHaveLength(1);
        expect(committed[0]!.actorId).toBe(identity.dayDirectorActorId);
        const meta =
          typeof committed[0]!.metadataJson === "string"
            ? JSON.parse(committed[0]!.metadataJson)
            : committed[0]!.metadataJson;
        expect(meta.strategicApproval).toMatchObject({
          proposalId: p2!.id,
          revision: p2!.revision,
          approvedByUserId: operator,
        });
        expect(committed[0]!.title).toBe(p2!.items[0]!.title);
        const retried = await respondToStrategicProposal({
          identity,
          proposalId: p2!.id,
          revision: p2!.revision,
          action: "approve",
          itemIds: p2!.items.map(i => i.id),
          source: "authenticated_voice",
        });
        expect(retried.failedItems).toEqual([]);
        expect(retried.actionIds).toEqual([committed[0]!.id]);
        // Cross-channel retry preserves the first acceptance, with no duplicate write.
        const appRetry = await respondToStrategicProposal({
          identity,
          proposalId: p2!.id,
          revision: p2!.revision,
          action: "approve",
          itemIds: p2!.items.map(i => i.id),
          source: "authenticated_app",
        });
        expect(appRetry.failedItems).toEqual([]);
        expect(appRetry.actionIds).toEqual([committed[0]!.id]);
        expect(
          await readVerifiedStrategicApprovalItemIds(identity, p2!)
        ).toEqual(p2!.items.map(i => i.id));
        await sql.execute(
          "UPDATE day_director_commitments SET sourceText = ? WHERE tenantId = ? AND id = ?",
          ["tampered test source", tenantId, committed[0]!.id]
        );
        expect(
          await readVerifiedStrategicApprovalItemIds(identity, p2!)
        ).toEqual([]);
        await sql.execute(
          "UPDATE day_director_commitments SET sourceText = ? WHERE tenantId = ? AND id = ?",
          [p2!.items[0]!.objective, tenantId, committed[0]!.id]
        );
        await expect(
          readVerifiedStrategicApprovalItemIds(
            { ...identity, tenantId: "foreign-test-tenant" },
            p2!
          )
        ).rejects.toThrow("Proposal owner mismatch");
        const [objectives] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT * FROM goal_cycle_objectives WHERE tenantId = ? AND selectedRef = ?",
          [tenantId, p!.items[0]!.candidateId]
        );
        expect(objectives[0]?.status).toBe("accepted");
        const observed = await recordGoalCycleOutcome({
          tenantId,
          objectiveId: objectives[0]!.id,
          outcomeKind: "hypothesis_contradicted",
          impactClass: "operational_result",
          evidenceClass: "operator_attested",
          evidenceReference: `controlled_operator_review:${suffix}`,
          sourceSystem: "controlled_acceptance_operator_review",
          explanation:
            "Controlled operator review found that the proposed driver audit did not isolate the limiting mechanism; a different investigation is needed",
          observedAt: new Date(),
        });
        const nextCycle = await enqueueGoalCycle({
          tenantId,
          goalRunId: runId,
          triggerType: "human_result",
          triggerSourceReference: observed.outcome.id,
          idempotencyKey: `outcome-replan:${suffix}`,
        });
        stopWorkers = startAutonomousPersistentOperatorWorkers({
          enabled: true,
          leaseOwnerPrefix: `learning-${suffix}`,
          goalCyclePollMs: 50,
          appointmentPollMs: 50,
          bootstrapIntervalMs: 3600000,
          learningDrainIntervalMs: 3600000,
        });
        await until(async () => {
          const [rows] = await sql.execute<mysql.RowDataPacket[]>(
            "SELECT * FROM goal_cycle_decisions WHERE tenantId = ? AND cycleId = ?",
            [tenantId, nextCycle.id]
          );
          return rows.length > 0;
        });
        await stopWorkers();
        stopWorkers = undefined;
        const learnedDiagnosis = await latestStrategicDiagnosis(identity, date);
        expect(learnedDiagnosis?.id).not.toBe(p!.diagnosis.id);
        expect(learnedDiagnosis?.outcomeRefs).toContain(observed.outcome.id);
        expect(learnedDiagnosis?.selectedApproach).toContain(
          "contradicted strategic hypothesis"
        );
        const simultaneousPlans = await Promise.all(
          Array.from({ length: 4 }, () =>
            planForDate({
              tenantId,
              operatorId: identity.dayDirectorActorId,
              operatorIds: identity.dayDirectorActorIds,
              operatorUserId: operator,
              businessDate: date,
              timeZone: zone,
            })
          )
        );
        expect(new Set(simultaneousPlans.map(plan => plan.id)).size).toBe(1);
        const roleCorrection = await captureExplicitDaphnePreferenceCorrections(
          {
            tenantId,
            operatorUserId: operator,
            utterance: "You're supposed to be proactively preparing the work.",
            conversationId: `role-correction:${suffix}`,
            turnId: `role-correction:${suffix}:1`,
          }
        );
        expect(roleCorrection.readbackVerified).toBe(true);
        const nextInteractionGuidance = await loadDaphneClaireGuidance({
          tenantId,
          operatorUserId: operator,
        });
        expect(nextInteractionGuidance?.promptSection).toContain(
          "Declared proactive initiative: high"
        );
        const controlResults: Array<{ control: string; actionIds: string[] }> =
          [];
        for (const control of [
          "why",
          "reject the plan",
          "defer the decision",
          "approve item 1",
        ]) {
          const revision = createHash("sha256")
            .update(`${p2!.revision}:${control}`)
            .digest("hex");
          const proposal = await persistStrategicProposal({
            ...p2!,
            id: `proposal_${revision.slice(0, 40)}`,
            revision,
            items: p2!.items
              .map(i => ({
                ...i,
                id: `${i.id}:${control}`,
                title: `${i.title}: ${control}`,
              }))
              .concat({
                ...p2!.items[0]!,
                id: `second:${control}`,
                title: "Compare a reversible next experiment",
              }),
          });
          const draft = emptyDraft(
            remainingWeekHorizon({
              businessDate: date,
              localTime: formatInTimeZone(new Date(), zone, "HH:mm"),
            }),
            []
          );
          draft.pendingRecommendation = {
            proposalId: proposal.id,
            revision: proposal.revision,
            opening: proposal.opening,
          };
          const session = newWeeklySession({
            tenantId,
            operatorId: operator,
            dayDirectorActorId: identity.dayDirectorActorId,
            weekStart: proposal.weekStart,
            draft,
          });
          session.phase = "awaiting_confirmation";
          await saveWeeklySession(session);
          const result = await routeStrategicProposalTurn({
            session,
            utterance: control,
            intent: "weekly_continue",
            now: new Date(),
          });
          controlResults.push({ control, actionIds: result.actionIds });
          if (control === "approve item 1") {
            expect(result.actionIds).toHaveLength(1);
            expect(
              await loadWeeklySession({
                tenantId,
                operatorId: operator,
                weekStart: proposal.weekStart,
              })
            ).not.toBeNull();
            const [selectedRows] = await sql.execute<mysql.RowDataPacket[]>(
              "SELECT * FROM day_director_commitments WHERE tenantId = ? AND title = ?",
              [tenantId, proposal.items[1]!.title]
            );
            expect(selectedRows).toHaveLength(0);
          } else expect(result.actionIds).toEqual([]);
          if (control.startsWith("reject") || control.startsWith("defer"))
            expect(
              await loadWeeklySession({
                tenantId,
                operatorId: operator,
                weekStart: proposal.weekStart,
              })
            ).toBeNull();
        }
        const planningInput = {
          tenantId,
          operatorId: identity.dayDirectorActorId,
          operatorIds: identity.dayDirectorActorIds,
          operatorUserId: operator,
          businessDate: date,
          timeZone: zone,
        };
        const subprocessPlans = await Promise.all(
          [1, 2].map(async () => {
            const code = String.raw`const {planForDate}=await import('./server/planning/missionDirector/missionDirectorService.ts'); const plan=await planForDate(${JSON.stringify(planningInput)}); await new Promise(resolve=>process.stdout.write('PLAN_RESULT:'+JSON.stringify({id:plan.id,revision:plan.revision})+'\n',resolve)); process.exit(0);`;
            const { stdout } = await promisify(execFile)(
              process.execPath,
              ["--import", "tsx", "--input-type=module", "-e", code],
              { env: process.env, timeout: 20000, maxBuffer: 1024 * 1024 }
            );
            const line = stdout
              .split("\n")
              .find(line => line.startsWith("PLAN_RESULT:"));
            if (!line)
              throw new Error("No process-independent planning receipt");
            return JSON.parse(line.slice("PLAN_RESULT:".length)) as {
              id: string;
              revision: number;
            };
          })
        );
        expect(new Set(subprocessPlans.map(plan => plan.id)).size).toBe(1);
        await revokeStrategicCallAuthorization(identity);
        expect(
          (await readStrategicCallConsent(identity)).authorization
        ).toBeNull();
        const policyStep = {
          id: randomUUID(),
          tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: operator,
          appointmentKind: "weekday_strategic_planning" as const,
          weekStart: p!.weekStart,
          scheduledFor: new Date(),
          timeZone: zone,
          source: "standing_weekly_authorization" as const,
          sourceReference: `strategic_proposal:${p!.id}`,
          idempotencyKey: `revoked-test:${suffix}`,
          standingAuthorizationId: authorization.id,
          unprompted: true,
          attemptCount: 1,
          maxAttempts: 1,
          leaseOwner: "controlled",
        };
        await expect(
          executeOperatorAppointment(policyStep, new Date(), store)
        ).rejects.toThrow("standing_authorization_invalid");
        expect(controlledProvider.calls).toHaveLength(1);
        expect(
          await loadStrategicProposal(
            { ...identity, tenantId: "other-tenant" },
            p!.id
          )
        ).toBeNull();
        await writeFile(
          "artifacts/claire-strategy/mysql-journey.json",
          JSON.stringify(
            {
              testOnly: true,
              provider: "controlled transport; no real call",
              tenantId,
              runId,
              diagnosisId: p!.diagnosis.id,
              proposalId: p!.id,
              revisedProposalId: p2!.id,
              revision: p2!.revision,
              planIds: plans.map(row => row.id),
              canonicalCommitmentIds: committed.map(row => row.id),
              approvalLineage: meta.strategicApproval,
              noPermissionCalls: 0,
              controlledProviderCalls: controlledProvider.calls.length,
              observedOutcomeId: observed.outcome.id,
              updatedDiagnosisId: learnedDiagnosis!.id,
              updatedApproach: learnedDiagnosis!.selectedApproach,
              roleCorrectionReadback: roleCorrection.readbackVerified,
              nextInteractionGuidanceObserved: Boolean(
                nextInteractionGuidance?.promptSection
              ),
              controlResults,
              geographyGenerationIds: generated.map(play => play.id),
              geographyRemediation: remediation,
              processIndependentPlans: subprocessPlans,
              concurrentPlanIds: simultaneousPlans.map(plan => plan.id),
              liveVoiceAcceptance: "unperformed",
            },
            null,
            2
          )
        );
      },
      60000
    );
  }
);
