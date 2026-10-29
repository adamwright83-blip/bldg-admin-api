import { assembleClaireDriveContext } from "../claire/contextAssembler";
import { claireConversationStateStore } from "../claire/turn/conversationStateStore";
import { beginWeeklyMission } from "../claire/weeklyMission/driver";
import {
  strategicResponses,
  requireCallableStrategicProposal,
} from "./strategicStore";
import { reviseStrategicProposal } from "./strategicApproval";
import {
  acceptProposalWithReceipt,
  designateDayDirectorPrimary,
} from "../planning/dayDirector/dayDirectorService";
import { emptyCommandMetadata } from "../../shared/claireWorkdayCommand";
import { operatorInstructionAdmission } from "../planning/dayDirector/dayLineAdmission";
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
  targetWeekHorizon,
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
/** Approval speech says "verified" only for an item linked to a goal objective (Stage 1 Phase 3 c). */
async function expectHonestApprovalSpeech(sql: mysql.Connection, tenantId: string, itemId: string, speech: string) {
  const [rows] = await sql.execute<mysql.RowDataPacket[]>(
    "SELECT metadataJson FROM day_director_commitments WHERE tenantId=? AND JSON_UNQUOTE(JSON_EXTRACT(metadataJson,'$.strategicApproval.itemId'))=?",
    [tenantId, itemId]
  );
  expect(rows).toHaveLength(1);
  const metadata = typeof rows[0]!.metadataJson === "string" ? JSON.parse(rows[0]!.metadataJson) : rows[0]!.metadataJson;
  expect(metadata.objectiveLineage).toBeDefined();
  if (metadata.objectiveLineage.objectiveId) expect(speech).toContain("verified");
  else {
    expect(speech).toContain("Not linked to a goal objective");
    expect(speech).not.toContain("added and verified");
  }
}
async function until(check: () => Promise<boolean>, timeout = 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await sleep(150);
  }
  throw new Error("Acceptance condition timed out");
}
describeMysql(
  "Claire release acceptance: actual voice and final authority fences",
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

    it("ordinary voice controls preserve proposal scope, receipts, memory, and date referents", async () => {
      const base = await prepareStrategicProposal({ identity, timeZone: zone });
      expect(base.items.length).toBeGreaterThan(0);
      const context = await assembleClaireDriveContext({
        tenantId,
        actorId: operator,
        phase: "pre_drive",
        timeZone: zone,
      });
      const controls = [
        "Why did you recommend this?",
        "What numbers are you basing that on?",
        "Only add the second one.",
        "Actually, move that mission to Thursday.",
        "No, I don't want to do that.",
        "Not now. We'll discuss it tomorrow.",
        "Didn't I already tell you that?",
        "What was our original plan?",
        "You should be preparing these decisions for me.",
        "What's the alternative?",
        "How do you know this will make money?",
        "make item 2 a mission",
        "make the second item a mission",
        "yes",
      ];
      const evidence: unknown[] = [];
      async function fresh(label: string) {
        const revision = createHash("sha256")
          .update(base.revision + label + randomUUID())
          .digest("hex");
        return persistStrategicProposal({
          ...base,
          id: `proposal_${revision.slice(0, 40)}`,
          revision,
          items: [1, 2].map(n => ({
            ...base.items[0]!,
            id: `release-${n}-${revision.slice(0, 12)}`,
            title: `Release fixture item ${n}: ${label}`,
            objective: `Bounded acceptance fixture ${n}: ${label}`,
          })),
          uncertainty: [
            ...base.uncertainty,
            "Two-item conversational fixture; not proof of two independently ranked opportunities.",
          ],
        });
      }
      const protectedResult = await acceptProposalWithReceipt({
        tenantId,
        actorId: identity.dayDirectorActorId,
        actorIds: identity.dayDirectorActorIds,
        businessDate: base.businessDate,
        proposal: {
          promptKey: `protected:${suffix}`,
          title: "Protected acceptance primary",
          kind: "growth",
          quantity: null,
          sourceText: "Explicit synthetic test approval",
          prerequisites: [],
          question: null,
          intelligence: "manual_fallback",
          targetBusinessDate: base.businessDate,
          command: emptyCommandMetadata(),
          executionType: "mission",
        },
        admission: operatorInstructionAdmission({
          operatorUserId: identity.canonicalOpenId,
          surface: "day_line_ui",
          sourceRef: `protected:${suffix}`,
        }),
      });
      expect(protectedResult.stored?.id).toBeTruthy();
      await designateDayDirectorPrimary({
        tenantId,
        actorId: identity.dayDirectorActorId,
        actorIds: identity.dayDirectorActorIds,
        businessDate: base.businessDate,
        commitmentId: protectedResult.stored!.id,
        nowIso: new Date().toISOString(),
      });
      for (const utterance of controls) {
        const proposal = await fresh(utterance);
        const draft = emptyDraft(
          targetWeekHorizon({
            weekStart: base.weekStart,
            businessDate: base.businessDate,
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
        const conversationId = randomUUID();
        let conversation: any = {
          tenantId,
          actorId: operator,
          dayDirectorActorId: identity.dayDirectorActorId,
          brief: proposal.opening,
          context,
          turns: 0,
          touchedAt: Date.now(),
          sessionKind: "weekly_planning",
          weeklyPlanningWeekStart: proposal.weekStart,
          strategicProposalId: proposal.id,
          appointmentTimeZone: zone,
          inboundContextReady: true,
          history: [
            { speaker: "claire", text: proposal.opening, at: Date.now() },
          ],
        };
        await claireConversationStateStore().save(
          `claire-call:${conversationId}`,
          { tenantId, operatorUserId: operator, surface: "voice" },
          conversation,
          3600000
        );
        const token = issueClaireToken({
          kind: "pre_drive_conversation",
          tenantId,
          userId: operator,
          conversationId,
        });
        if (utterance.startsWith("Actually")) {
          const referent =
            "change item 2 to The explicitly referenced second mission";
          await runAuthoritativeClaireVoiceTurn({
            conversationId,
            conversation,
            utterance: referent,
            rawTranscript: referent,
            allowFragmentWait: false,
            token,
            sourceConfirmed: true,
            sourceEventId: `reference-${randomUUID()}`,
            webhookReceivedAtMs: Date.now(),
          });
          const stored = await claireConversationStateStore().load<any>(
            `claire-call:${conversationId}`
          );
          conversation = stored!.state;
        }
        const [beforeRows] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM day_director_commitments WHERE tenantId=?",
          [tenantId]
        );
        const result = await runAuthoritativeClaireVoiceTurn({
          conversationId,
          conversation,
          utterance,
          rawTranscript: utterance,
          allowFragmentWait: false,
          token,
          sourceConfirmed: true,
          sourceEventId: `release-${randomUUID()}`,
          webhookReceivedAtMs: Date.now(),
        });
        const [afterRows] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS n FROM day_director_commitments WHERE tenantId=?",
          [tenantId]
        );
        const delta = Number(afterRows[0]!.n) - Number(beforeRows[0]!.n);
        expect(delta).toBe(
          [
            "Only add the second one.",
            "make item 2 a mission",
            "make the second item a mission",
          ].includes(utterance)
            ? 1
            : 0
        );
        const decisions = await strategicResponses(identity, proposal.id);
        const [rows] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT * FROM day_director_commitments WHERE tenantId=? AND title IN (?,?)",
          [tenantId, ...proposal.items.map(i => i.title)]
        );
        if (
          [
            "Only add the second one.",
            "make item 2 a mission",
            "make the second item a mission",
          ].includes(utterance)
        ) {
          expect(rows).toHaveLength(1);
          expect(rows[0]!.title).toBe(proposal.items[1]!.title);
          expect(decisions.find(r => r.action === "approve")?.itemIds).toEqual([
            proposal.items[1]!.id,
          ]);
          await expectHonestApprovalSpeech(sql, tenantId, proposal.items[1]!.id, result.speak);
          const metadata =
            typeof rows[0]!.metadataJson === "string"
              ? JSON.parse(rows[0]!.metadataJson)
              : rows[0]!.metadataJson;
          expect(metadata.strategicApproval).toMatchObject({
            proposalId: proposal.id,
            revision: proposal.revision,
            itemId: proposal.items[1]!.id,
          });
        } else {
          expect(rows).toHaveLength(0);
          if (utterance.startsWith("Not now"))
            expect(decisions.map(r => r.action)).toEqual(["defer"]);
          else if (utterance.startsWith("No,"))
            expect(decisions.map(r => r.action)).toEqual(["reject"]);
          else if (utterance.startsWith("Actually")) {
            // Only while Thursday is still ahead: on Thursday itself, whether the move stands depends on the hour
            // (the server refuses a day whose time has passed), so the outcome isn't fixed.
            if (
              base.businessDate <
              new Date(Date.parse(base.weekStart + "T00:00:00Z") + 3 * 86400000)
                .toISOString()
                .slice(0, 10)
            ) {
              const revised = await latestStrategicProposal(
                identity,
                base.weekStart
              );
              expect(revised!.id).not.toBe(proposal.id);
              expect(revised!.items[1]!.businessDate).toBe(
                new Date(
                  Date.parse(base.weekStart + "T00:00:00Z") + 3 * 86400000
                )
                  .toISOString()
                  .slice(0, 10)
              );
              expect(revised!.items[0]).toEqual(proposal.items[0]);
              expect(result.speak).toContain("Revised pending proposal");
            } else expect(decisions.map(r => r.action)).toEqual(["revise"]); // Title changed, date never backdated on Friday.
          } else expect(decisions).toEqual([]);
          if (utterance.startsWith("What numbers"))
            expect(result.speak).toContain(
              base.diagnosis.evidence[0]!.description
            );
          if (utterance.startsWith("How do"))
            expect(result.speak).toContain(
              "do not know that this will make money"
            );
          if (utterance.startsWith("What's"))
            expect(result.speak).toContain("alternative");
          if (utterance.startsWith("What was"))
            expect(result.speak).toContain("original stored proposal");
          if (utterance.startsWith("You should"))
            expect(
              (
                await loadDaphneClaireGuidance({
                  tenantId,
                  operatorUserId: operator,
                })
              )?.promptSection
            ).toContain("Declared proactive initiative: high");
        }
        const [protectedRows] = await sql.execute<mysql.RowDataPacket[]>(
          "SELECT metadataJson FROM day_director_commitments WHERE tenantId=? AND id=?",
          [tenantId, protectedResult.stored!.id]
        );
        const protectedMeta =
          typeof protectedRows[0]!.metadataJson === "string"
            ? JSON.parse(protectedRows[0]!.metadataJson)
            : protectedRows[0]!.metadataJson;
        expect(protectedMeta.command.role).toBe("primary");
        evidence.push({
          utterance,
          proposalId: proposal.id,
          revision: proposal.revision,
          speech: result.speak,
          decisions,
          canonicalIds: rows.map(r => r.id),
        });
      }
      async function voiceFixture(p: typeof base) {
        const draft = emptyDraft(
          targetWeekHorizon({
            weekStart: base.weekStart,
            businessDate: base.businessDate,
            localTime: "08:00",
          }),
          []
        );
        draft.pendingRecommendation = {
          proposalId: p.id,
          revision: p.revision,
          opening: p.opening,
        };
        const session = newWeeklySession({
          tenantId,
          operatorId: operator,
          dayDirectorActorId: identity.dayDirectorActorId,
          weekStart: p.weekStart,
          draft,
        });
        session.phase = "awaiting_confirmation";
        await saveWeeklySession(session);
        const id = randomUUID();
        const token = issueClaireToken({
          kind: "pre_drive_conversation",
          tenantId,
          userId: operator,
          conversationId: id,
        });
        const state: any = {
          tenantId,
          actorId: operator,
          dayDirectorActorId: identity.dayDirectorActorId,
          brief: p.opening,
          context,
          turns: 0,
          touchedAt: Date.now(),
          sessionKind: "weekly_planning",
          weeklyPlanningWeekStart: p.weekStart,
          strategicProposalId: p.id,
          strategicProposalRevision: p.revision,
          appointmentTimeZone: zone,
          inboundContextReady: true,
          history: [{ speaker: "claire", text: p.opening, at: Date.now() }],
        };
        await claireConversationStateStore().save(
          `claire-call:${id}`,
          { tenantId, operatorUserId: operator, surface: "voice" },
          state,
          3600000
        );
        return { id, token, state };
      }
      async function say(
        call: Awaited<ReturnType<typeof voiceFixture>>,
        text: string,
        allowFragmentWait = false
      ) {
        const stored = await claireConversationStateStore().load<any>(
          `claire-call:${call.id}`
        );
        return runAuthoritativeClaireVoiceTurn({
          conversationId: call.id,
          conversation: stored!.state,
          utterance: text,
          rawTranscript: text,
          allowFragmentWait,
          token: call.token,
          sourceConfirmed: true,
          sourceEventId: `actual-${randomUUID()}`,
          webhookReceivedAtMs: Date.now(),
        });
      }
      // as above: only while Thursday is still ahead, never on Thursday itself, when the hour decides
      if (base.businessDate < new Date(Date.parse(base.weekStart + "T00:00:00Z") + 3 * 86400000).toISOString().slice(0,10)) {
        const untouched = await fresh("untouched date-only objective");
        const call = await voiceFixture(untouched);
        await say(call, "move item 2 to Thursday");
        const moved = await latestStrategicProposal(identity, untouched.weekStart);
        expect(moved!.items[1]).toEqual({...untouched.items[1],businessDate:new Date(Date.parse(base.weekStart + "T00:00:00Z") + 3 * 86400000).toISOString().slice(0,10)});
        expect(moved!.items[0]).toEqual(untouched.items[0]);
        evidence.push({boundary:"date-only revision",originalObjective:untouched.items[1]!.objective,revisedObjective:moved!.items[1]!.objective,allNonDateFieldsPreserved:true});
      }
      const shared = await fresh("two held conversations");
      const a = await voiceFixture(shared);
      const b = await voiceFixture(shared);
      await say(b, "change item 2 to Revision heard only by conversation B");
      const revisedShared = await latestStrategicProposal(
        identity,
        shared.weekStart
      );
      const denied = await say(a, "approve the plan");
      expect(denied.speak).toContain("held by this conversation");
      expect(
        await readVerifiedStrategicApprovalItemIds(identity, revisedShared!)
      ).toEqual([]);
      const bApproval = await say(b, "Only add the second one.");
      await expectHonestApprovalSpeech(sql, tenantId, shared.items[1]!.id, bApproval.speak);
      expect(
        await readVerifiedStrategicApprovalItemIds(identity, revisedShared!)
      ).toEqual([shared.items[1]!.id]);
      const postApprovalMove = await say(
        b,
        "Actually, move that mission to Thursday."
      );
      expect(postApprovalMove.speak).toContain(
        "Change those commitments through the Day Line"
      );
      evidence.push({
        boundary: "two conversations holding one shared weekly session",
        oldHeldId: shared.id,
        newHeldId: revisedShared!.id,
        deniedSpeech: denied.speak,
        heardRevisionApproval: bApproval.speak,
        acceptedMoveRequiresDayDirector: postApprovalMove.speak,
      });
      const fragmented = await fresh("fragmented Gather");
      const fragmentedCall = await voiceFixture(fragmented);
      const held = await say(fragmentedCall, "make the", true);
      expect(held.listenOnly).toBe(true);
      const completed = await say(fragmentedCall, "second item a mission");
      await expectHonestApprovalSpeech(sql, tenantId, fragmented.items[1]!.id, completed.speak);
      expect(
        await readVerifiedStrategicApprovalItemIds(identity, fragmented)
      ).toEqual([fragmented.items[1]!.id]);
      const [fragmentRows] = await sql.execute<mysql.RowDataPacket[]>(
        "SELECT title FROM day_director_commitments WHERE tenantId=? AND title IN ('The second item','Item 2')",
        [tenantId]
      );
      expect(fragmentRows).toHaveLength(0);
      evidence.push({
        boundary: "assembled Gather referent",
        fragments: ["make the", "second item a mission"],
        proposalId: fragmented.id,
        approvedItemIds: [fragmented.items[1]!.id],
        speech: completed.speak,
      });
      // Independent processes compete at the same current-proposal response boundary.
      const stale = await fresh("stale browser");
      const current = await fresh("new evidence");
      await expect(
        respondToStrategicProposal({
          identity,
          proposalId: stale.id,
          revision: stale.revision,
          action: "approve",
          itemIds: [stale.items[0]!.id],
          source: "authenticated_app",
        })
      ).rejects.toThrow("superseded");
      await expect(
        respondToStrategicProposal({
          identity: { ...identity, tenantId: "foreign" },
          proposalId: current.id,
          revision: current.revision,
          action: "approve",
          itemIds: [current.items[0]!.id],
          source: "authenticated_app",
        })
      ).rejects.toThrow("Exact proposal revision");
      const expired = await persistStrategicProposal({
        ...(await fresh("expired")),
        id: `expired_${suffix}`,
        revision: createHash("sha256")
          .update(`expired-${suffix}`)
          .digest("hex"),
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      await expect(
        respondToStrategicProposal({
          identity,
          proposalId: expired.id,
          revision: expired.revision,
          action: "approve",
          itemIds: [expired.items[0]!.id],
          source: "authenticated_app",
        })
      ).rejects.toThrow("stale");
      const authorization = await grantStrategicCallAuthorization({
        identity,
        weekdays: [1, 2, 3, 4, 5],
        localStart: "00:00",
        localEnd: "23:59",
        timeZone: zone,
        dailyLimit: 3,
        sourceReference: "authenticated_app:release_fixture",
      });
      const store = new OperatorAppointmentStore(pool);
      async function queued(p: typeof base) {
        const input = {
          tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: operator,
          appointmentKind: "weekday_strategic_planning" as const,
          weekStart: p.weekStart,
          scheduledFor: new Date(),
          timeZone: zone,
          source: "standing_weekly_authorization" as const,
          sourceReference: `strategic_proposal:${p.id}`,
          standingAuthorizationId: authorization.id,
          unprompted: true,
          idempotencyKey: `dispatch-${randomUUID()}`,
        };
        const saved = await store.enqueue(input);
        await sql.execute(
          "UPDATE operator_appointments SET status='running',leaseOwner='release-test',leaseExpiresAt=DATE_ADD(CURRENT_TIMESTAMP(3),INTERVAL 1 MINUTE),attemptCount=1 WHERE tenantId=? AND id=?",
          [tenantId, saved.id]
        );
        return {
          ...input,
          id: saved.id,
          leaseOwner: "release-test",
          attemptCount: 1,
          maxAttempts: 3,
        };
      }
      for (const action of [
        "defer",
        "reject",
        "approve",
        "revise",
        "supersede",
      ] as const) {
        const p = await fresh(`queued-${action}`);
        const step = await queued(p);
        const draft = emptyDraft(
          targetWeekHorizon({
            weekStart: base.weekStart,
            businessDate: base.businessDate,
            localTime: "08:00",
          }),
          []
        );
        draft.pendingRecommendation = {
          proposalId: p.id,
          revision: p.revision,
          opening: p.opening,
        };
        await saveWeeklySession(
          newWeeklySession({
            tenantId,
            operatorId: operator,
            dayDirectorActorId: identity.dayDirectorActorId,
            weekStart: p.weekStart,
            draft,
          })
        );
        if (action === "revise")
          await reviseStrategicProposal({
            identity,
            proposalId: p.id,
            revision: p.revision,
            itemId: p.items[0]!.id,
            title: "Revised queued fixture",
          });
        else if (action === "supersede")
          await fresh("superseding queued fixture");
        else
          await respondToStrategicProposal({
            identity,
            proposalId: p.id,
            revision: p.revision,
            action,
            itemIds: action === "approve" ? p.items.map(i => i.id) : [],
            source: "authenticated_app",
          });
        await expect(
          requireCallableStrategicProposal(identity, p.id)
        ).rejects.toThrow();
        await expect(
          beginWeeklyMission({
            tenantId,
            operatorId: operator,
            dayDirectorActorId: identity.dayDirectorActorId,
            timeZone: zone,
            weekStartOverride: p.weekStart,
            preparedProposalIdOverride: p.id,
          })
        ).rejects.toThrow();
        expect(await store.beginCallDispatch(step)).toBe(false);
        for (const kind of [
          "sunday_weekly_planning",
          "weekly_planning_callback",
        ] as const)
          expect(
            await store.beginCallDispatch(
              { ...step, appointmentKind: kind },
              p.id
            )
          ).toBe(false);
        evidence.push({
          queuedProposalId: p.id,
          postEnqueueDecision: action,
          dispatchAdmitted: false,
        });
      }
      const race = await fresh("independent admission retry");
      const approvalInput = {
        identity,
        proposalId: race.id,
        revision: race.revision,
        action: "approve",
        itemIds: [race.items[1]!.id],
        source: "authenticated_app",
      };
      const processes = await Promise.all(
        [1, 2].map(async () => {
          const code = `const {respondToStrategicProposal}=await import('./server/strategy/strategicApproval.ts');const r=await respondToStrategicProposal(${JSON.stringify(approvalInput)});console.log('RECEIPT:'+JSON.stringify(r));process.exit(0);`;
          const { stdout } = await promisify(execFile)(
            process.execPath,
            ["--import", "tsx", "--input-type=module", "-e", code],
            { env: process.env, timeout: 30000, maxBuffer: 1048576 }
          );
          return JSON.parse(
            stdout
              .split("\n")
              .find(l => l.startsWith("RECEIPT:"))!
              .slice(8)
          );
        })
      );
      expect(processes[0].failedItems).toEqual([]);
      expect(processes[1].actionIds).toEqual(processes[0].actionIds);
      const [duplicates] = await sql.execute<mysql.RowDataPacket[]>(
        "SELECT * FROM day_director_commitments WHERE tenantId=? AND title=?",
        [tenantId, race.items[1]!.title]
      );
      expect(duplicates).toHaveLength(1);
      if (Number(formatInTimeZone(new Date(), zone, "i")) <= 5) {
        const p = await fresh("independent dispatch fence");
        const step = await queued(p);
        const results = await Promise.all(
          [1, 2].map(async () => {
            const code = `const mysql=(await import('mysql2/promise')).default;const {OperatorAppointmentStore}=await import('./server/agents/persistentOperator/operatorAppointmentStore.ts');const pool=mysql.createPool(process.env.DATABASE_URL);const r=await new OperatorAppointmentStore(pool).beginCallDispatch(${JSON.stringify(step)});console.log('FENCE:'+JSON.stringify(r));await pool.end();process.exit(0);`;
            const { stdout } = await promisify(execFile)(
              process.execPath,
              ["--import", "tsx", "--input-type=module", "-e", code],
              { env: process.env, timeout: 30000, maxBuffer: 1048576 }
            );
            return JSON.parse(
              stdout
                .split("\n")
                .find(l => l.startsWith("FENCE:"))!
                .slice(6)
            );
          })
        );
        expect(results.filter(Boolean)).toHaveLength(1);
        evidence.push({ independentDispatchFences: results, providerCalls: 0 });
      }
      const activationFixtures = [];
      for (const n of [1,2]) {
        const tenant = `activation-${suffix}-${n}`; const openId = `activation-owner-${suffix}-${n}`;
        await sql.execute("INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,strategyVerticalKey) VALUES (?,?, 'Parallel activation fixture','Parallel activation fixture','#123456','Fixture','fixture@example.invalid',?,'active','laundry_fluff_fold')",[tenant,tenant,zone]);
        await sql.execute("INSERT INTO users (tenantId,openId,name,email,role,loginMethod) VALUES (?,?,'Fixture','fixture@example.invalid','user','password')",[tenant,openId]);
        await sql.execute("INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active) VALUES (?,?,'owner',true)",[tenant,openId]);
        await setActiveMacroGoal({tenantId:tenant,operatorUserId:openId,objective:"Synthetic parallel activation",metricKey:"paid_orders_per_period",targetValue:100,unit:"orders",source:"operator_attested",sourceNote:"Acceptance fixture"});
        activationFixtures.push({tenant,openId});
      }
      const activations = await Promise.all(activationFixtures.flatMap(fixture => [1,2].map(async () => {
        const code = `const {resolveCanonicalOperatorIdentity}=await import('./server/agents/persistentOperator/identity.ts');const {activateMacroGoalAndQueue}=await import('./server/agents/persistentOperator/goalCycleService.ts');const {defaultVerticalRegistry}=await import('./server/strategy/verticalTemplates/defaultRegistry.ts');const identity=await resolveCanonicalOperatorIdentity({tenantId:${JSON.stringify(fixture.tenant)},source:{type:'open_id',value:${JSON.stringify(fixture.openId)}},subsystem:'acceptance.activation'});if(!identity.ok)throw Error('identity');const result=await activateMacroGoalAndQueue({tenantId:${JSON.stringify(fixture.tenant)},identity:identity.identity,verticalKey:'laundry_fluff_fold',policyVersion:'v1',registry:defaultVerticalRegistry});console.log('ACTIVATION:'+JSON.stringify({tenantId:result.run.tenantId,id:result.run.id}));process.exit(0);`;
        const {stdout}=await promisify(execFile)(process.execPath,["--import","tsx","--input-type=module","-e",code],{env:process.env,timeout:30000,maxBuffer:1048576});return JSON.parse(stdout.split('\n').find(l=>l.startsWith('ACTIVATION:'))!.slice(11));
      })));
      for(const fixture of activationFixtures) expect(new Set(activations.filter(r=>r.tenantId===fixture.tenant).map(r=>r.id)).size).toBe(1);
      evidence.push({boundary:"parallel first activation across tenants and independent processes",results:activations});
      const callbackProposal = await fresh("valid explicit callback");
      const callbackStep = await queued(callbackProposal);
      await sql.execute(
        "UPDATE operator_appointments SET appointmentKind='weekly_planning_callback',standingAuthorizationId=NULL,sourceReference='explicit_operator_request:acceptance' WHERE tenantId=? AND id=?",
        [tenantId, callbackStep.id]
      );
      expect(
        await store.beginCallDispatch(
          {
            ...callbackStep,
            appointmentKind: "weekly_planning_callback",
            standingAuthorizationId: null,
            sourceReference: "explicit_operator_request:acceptance",
          },
          callbackProposal.id
        )
      ).toBe(true);
      expect(
        await store.beginCallDispatch(
          {
            ...callbackStep,
            appointmentKind: "weekly_planning_callback",
            standingAuthorizationId: null,
            sourceReference: "explicit_operator_request:acceptance",
          },
          callbackProposal.id
        )
      ).toBe(false);
      expect(controlledProvider.calls).toHaveLength(0);
      await revokeStrategicCallAuthorization(identity);
      await mkdir("artifacts/claire-strategy/acceptance", { recursive: true });
      await writeFile(
        "artifacts/claire-strategy/acceptance/voice-authority.json",
        JSON.stringify(
          {
            testOnly: true,
            providerCalls: 0,
            voice:
              "production authoritative routing; providers unavailable; durable synthetic conversation fixtures",
            tenantId,
            controls: evidence,
            independentApprovalProcesses: processes,
          },
          null,
          2
        )
      );
    }, 120000);
  }
);
