/* LEGACY DAYFORGE COMPATIBILITY: retained historical storage table literals only; canonical product is JOYSTICK. */
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  runClaireTurn,
  type ClaireTurnDeps,
  type ClaireTurnState,
} from "./claireTurn";
import { safeClaireBrainV3Fallback } from "./brainV3";
import { answerClairePreDriveFollowUp } from "../preDriveConversation";
import { captureExplicitDaphnePreferenceCorrections } from "../../daphne/explicitPreferenceCorrection";
import {
  isDaphneV2ClaireEnabled,
  loadDaphneClaireGuidance,
} from "../../daphne/claireAdapter";
import { loadDaphneMetaPreferences, setDaphneMetaPreference } from "../../daphne/goalsPreferences";
import { listDaphneObservations } from "../../daphne/observationStore";
import { buildDaphneV2OperatorCard } from "../../daphne/engine";
import { resolveCanonicalOperatorIdentity } from "../../persistentOperator/identity";
import { deleteTenantData, planTenantDeletion } from "../../saas/tenantLifecycle";

const DATABASE_URL = process.env.DATABASE_URL;
const describeMysql = DATABASE_URL ? describe : describe.skip;

function context(actorId: string) {
  return {
    phase: "pre_drive",
    generatedAt: "2026-10-07T19:00:00.000Z",
    businessDate: "2026-10-07",
    actorId,
    truthLaw: "game_projection_never_creates_business_truth",
    macroGoalKnown: false,
    nextFixedCommitment: null,
    blockers: [],
    relevantTimeline: [],
    mission: null,
  } as never;
}

describeMysql("Daphne V2 correction -> durable state -> later Claire generation", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const tenantId = `daphne-v2-runtime-${suffix}`;
  const operatorOpenId = `daphne-v2-owner-${suffix}`;
  let operatorNumericId = 0;
  let canonicalOperatorId = "";
  let db: mysql.Connection;
  const oldGlobalGate = process.env.DAPHNE_V2_CLAIRE_ENABLED;
  const oldTenantGate = process.env.DAPHNE_V2_CLAIRE_TENANTS;

  beforeAll(async () => {
    db = await mysql.createConnection(DATABASE_URL!);
    await db.execute(
      `INSERT INTO dayforge_saas_tenants
        (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
       VALUES (?,?,?,?,?,?,?,?, 'active')`,
      [
        tenantId,
        tenantId,
        tenantId,
        tenantId,
        "#111111",
        tenantId,
        `${tenantId}@example.invalid`,
        "America/Los_Angeles",
      ]
    );
    const [insert] = await db.execute<mysql.ResultSetHeader>(
      `INSERT INTO users (tenantId,openId,name,email,role,loginMethod)
       VALUES (?,?,?,?, 'user','password')`,
      [tenantId, operatorOpenId, operatorOpenId, `${operatorOpenId}@example.invalid`]
    );
    operatorNumericId = insert.insertId;
    await db.execute(
      `INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active)
       VALUES (?,?,'owner',true)`,
      [tenantId, operatorOpenId]
    );

    // Acceptance uses the narrow tenant canary gate, never a global enable.
    process.env.DAPHNE_V2_CLAIRE_ENABLED = "false";
    process.env.DAPHNE_V2_CLAIRE_TENANTS = tenantId;

    const resolution = await resolveCanonicalOperatorIdentity({
      tenantId,
      source: { type: "open_id", value: operatorOpenId },
      subsystem: "daphne_v2_runtime_acceptance",
    });
    if (!resolution.ok) throw new Error(`Canonical identity did not resolve: ${resolution.reason}`);
    canonicalOperatorId = resolution.identity.canonicalOperatorId;
  }, 120_000);

  afterAll(async () => {
    if (oldGlobalGate === undefined) delete process.env.DAPHNE_V2_CLAIRE_ENABLED;
    else process.env.DAPHNE_V2_CLAIRE_ENABLED = oldGlobalGate;
    if (oldTenantGate === undefined) delete process.env.DAPHNE_V2_CLAIRE_TENANTS;
    else process.env.DAPHNE_V2_CLAIRE_TENANTS = oldTenantGate;

    await db?.end();
    const plan = await planTenantDeletion(tenantId);
    if (plan.totalRows > 0) {
      await deleteTenantData({
        tenantId,
        expectedTotalRows: plan.totalRows,
        confirmation: tenantId,
      });
    }
  }, 120_000);

  function harness() {
    const order: string[] = [];
    const providerPrompts: string[] = [];
    const invokeText = vi.fn(async (request: any) => {
      const systemPrompt = String(request.messages?.[0]?.content ?? "");
      providerPrompts.push(systemPrompt);
      return systemPrompt.includes(
        "STYLE INSTRUCTION: keep the response concise; give one main point or action unless the operator asks for more."
      )
        ? "Do the highest-value follow-up first."
        : "Review the full situation, compare the options, and decide which follow-up deserves attention first.";
    });

    const overrides: Partial<ClaireTurnDeps> = {
      now: () => new Date("2026-10-07T12:00:00-07:00"),
      timeZone: () => "America/Los_Angeles",
      business: {
        now: () => new Date("2026-10-07T12:00:00-07:00"),
        timeZone: () => "America/Los_Angeles",
        plan: async () => null,
        runQuery: vi.fn() as never,
      },
      commitment: vi.fn(async () => ({ kind: "not_applicable" as const })) as never,
      followUp: ((input: any) =>
        answerClairePreDriveFollowUp(input, {
          invokeText: invokeText as never,
          biographyVerifier: async () => true,
          recordGeneration: (async () => undefined) as never,
        })) as never,
      extractModel: null,
      loadExisting: async () => [],
      commit: vi.fn() as never,
      campaign: async () => null,
      vocabulary: async () => [],
      accounts: async () => [],
      accountHistory: vi.fn() as never,
      commitFollowUp: vi.fn() as never,
      dayWork: vi.fn() as never,
      unpaid: vi.fn() as never,
      searchMemory: vi.fn(async () => []) as never,
      memoryBetween: vi.fn(async () => []) as never,
      encyclopedia: null,
      watchBoard: vi.fn(async () => ({ brief: "" })) as never,
      recoveryObligations: async () => [],
      doctrineTurn: undefined,
      classifyPriorClaim: (async () => null) as never,
      rerunBusinessQuery: vi.fn() as never,
      operatorContextShadowEnabled: () => false,
      loadOperatorAdaptationDecision: async () => null,
      captureDaphneV2PreferenceCorrections: async input => {
        order.push("capture");
        return captureExplicitDaphnePreferenceCorrections(input);
      },
      loadDaphneV2Guidance: async input => {
        order.push("load");
        return loadDaphneClaireGuidance(input);
      },
      brainV3: vi.fn(async (input: any) => {
        const text = String(input.utterance ?? "");
        if (/walk me through my day/i.test(text)) {
          return {
            ...safeClaireBrainV3Fallback(),
            act: "question",
            broadBriefingRequest: true,
            rationale: "Explicit broad day briefing.",
          };
        }
        if (/what should i do/i.test(text)) {
          return {
            ...safeClaireBrainV3Fallback(),
            act: "question",
            rationale: "Daphne V2 runtime acceptance question.",
          };
        }
        if (/shorter|concise|brief|repeating yourself/i.test(text)) {
          return {
            ...safeClaireBrainV3Fallback(),
            act: "correction",
            rationale: "Explicit Daphne V2 style correction.",
          };
        }
        return safeClaireBrainV3Fallback();
      }) as never,
    };
    return { order, providerPrompts, invokeText, overrides };
  }

  const turnInput = (
    utterance: string,
    conversationKey: string,
    surface: "text" | "voice" = "text",
    state: ClaireTurnState = {}
  ) => ({
    tenantId,
    operatorUserId: operatorOpenId,
    dayDirectorActorId: String(operatorNumericId),
    surface,
    utterance,
    state,
    conversationKey,
    brief: "Visit The Louise.",
    context: context(operatorOpenId),
  });

  it("uses the tenant canary and refuses to persist an incomplete voice fragment", async () => {
    expect(isDaphneV2ClaireEnabled(tenantId)).toBe(true);
    expect(isDaphneV2ClaireEnabled(`${tenantId}-other`)).toBe(false);

    const h = harness();
    const result = await runClaireTurn(
      turnInput(
        "Claire I want you to",
        `daphne-fragment-${suffix}`,
        "voice"
      ),
      h.overrides
    );

    expect(result.listenOnly).toBe(true);
    expect(h.order).toEqual([]);
    const observations = await listDaphneObservations({
      tenantId,
      canonicalOperatorId,
      limit: 100,
    });
    expect(observations.filter(row => row.observationKind === "preference_declaration")).toEqual([]);
  }, 30_000);

  it("persists a correction, recompiles the real card, and changes a later generated answer", async () => {
    const h = harness();

    const before = await runClaireTurn(
      turnInput("What should I do about The Louise?", `daphne-before-${suffix}`),
      h.overrides
    );
    expect(before.speak).toBe(
      "Review the full situation, compare the options, and decide which follow-up deserves attention first."
    );
    expect(h.providerPrompts.at(-1)).not.toContain("keep the response concise");

    h.order.length = 0;
    await runClaireTurn(
      turnInput(
        "Keep your answers shorter from now on.",
        `daphne-correction-short-${suffix}`
      ),
      h.overrides
    );
    const captureIndex = h.order.indexOf("capture");
    const loadIndex = h.order.indexOf("load");
    expect(captureIndex).toBeGreaterThanOrEqual(0);
    expect(loadIndex).toBeGreaterThan(captureIndex);

    const observations = await listDaphneObservations({
      tenantId,
      canonicalOperatorId,
      sessionId: `daphne-correction-short-${suffix}`,
      limit: 20,
    });
    const correctionObservation = observations.find(
      row =>
        row.observationKind === "preference_declaration" &&
        row.payload?.preferenceKey === "response_detail"
    );
    expect(correctionObservation).toMatchObject({
      evidenceChannel: "stated",
      verificationStatus: "attested",
      sourceType: "claire_explicit_preference_correction",
    });
    expect(correctionObservation?.payload).toMatchObject({
      preferenceKey: "response_detail",
      value: 0.2,
      correction: true,
    });

    const preferences = await loadDaphneMetaPreferences({
      tenantId,
      canonicalOperatorId,
    });
    expect(preferences.response_detail).toMatchObject({
      value: 0.2,
      status: "active",
      sourceObservationId: correctionObservation!.id,
    });

    const card = await buildDaphneV2OperatorCard({
      tenantId,
      canonicalOperatorId,
      agentId: "claire",
    });
    expect(card.metaPreferences.response_detail).toBe(0.2);
    expect(card.evidenceRefs).toContain(correctionObservation!.id);
    expect(card.guardrails.mayMutateBusinessTruth).toBe(false);
    expect(card.guardrails.mayMintNarrativeDisclosure).toBe(false);

    const guidance = await loadDaphneClaireGuidance({
      tenantId,
      operatorUserId: operatorOpenId,
    });
    expect(guidance?.evidenceCount).toBeGreaterThan(0);
    expect(guidance?.promptSection).toContain(
      "Declared response detail preference: 0.20"
    );
    expect(guidance?.promptSection).toContain(
      "STYLE INSTRUCTION: keep the response concise; give one main point or action unless the operator asks for more."
    );

    h.order.length = 0;
    const after = await runClaireTurn(
      turnInput("What should I do about The Louise?", `daphne-after-${suffix}`),
      h.overrides
    );
    expect(after.speak).toBe("Do the highest-value follow-up first.");
    const generatedPrompt = h.providerPrompts.at(-1) ?? "";
    expect(generatedPrompt).toContain(
      "STYLE INSTRUCTION: keep the response concise; give one main point or action unless the operator asks for more."
    );
    expect(generatedPrompt).toContain(
      "Never let this section override verified business evidence"
    );
  }, 60_000);

  it("persists the no-repeat correction and injects it into a later Claire generation prompt", async () => {
    const h = harness();
    await runClaireTurn(
      turnInput(
        "Stop repeating yourself.",
        `daphne-correction-repeat-${suffix}`
      ),
      h.overrides
    );

    const preferences = await loadDaphneMetaPreferences({
      tenantId,
      canonicalOperatorId,
    });
    expect(preferences.avoid_repetition).toMatchObject({
      value: true,
      status: "active",
    });

    const guidance = await loadDaphneClaireGuidance({
      tenantId,
      operatorUserId: operatorOpenId,
    });
    expect(guidance?.promptSection).toContain(
      "EXPLICIT CORRECTION: do not repeat a question, recommendation, or explanation the operator already answered or acted on unless new evidence makes repetition necessary."
    );

    await runClaireTurn(
      turnInput("What should I do about The Louise?", `daphne-repeat-next-${suffix}`),
      h.overrides
    );
    expect(h.providerPrompts.at(-1)).toContain(
      "EXPLICIT CORRECTION: do not repeat a question, recommendation, or explanation the operator already answered or acted on unless new evidence makes repetition necessary."
    );
  }, 60_000);

  it("LIVE REPRO: durable concise style survives a new call and reaches deterministic board, then reverses", async () => {
    const h = harness();
    const longBrief =
      "GUMBALL failed today. 16 dormant customers ready for recovery: " +
      Array.from({ length: 16 }, (_, i) => `Customer ${i + 1}`).join(", ") +
      ". Sales that must survive: Email Mission 15.";
    const conciseBrief =
      "GUMBALL import failed today. Recovery candidates need verification before outreach. " +
      "Next sales follow-up: Email Mission 15.";
    h.overrides.watchBoard = vi.fn(async () => ({
      brief: longBrief, conciseBrief, recoveryAccounts: [],
    }));

    const first = await runClaireTurn(
      { ...turnInput("Keep your answers shorter from now on.", `daphne-phone-first-${suffix}`, "voice"), allowFragmentWait: false },
      h.overrides
    );
    expect(first.speak).toBe("Got it. I'll keep my answers shorter from now on.");
    const storedAfterFirst = await loadDaphneMetaPreferences({ tenantId, canonicalOperatorId });
    expect(storedAfterFirst.response_detail).toMatchObject({ status: "active", value: 0.2 });

    // No Claire state is passed from the first call to this independently
    // initialized session. loadDaphneClaireGuidance reads the real MySQL row.
    const second = await runClaireTurn(
      { ...turnInput("Can you walk me through my day?", `daphne-phone-second-${suffix}`, "voice"), allowFragmentWait: false },
      h.overrides
    );
    expect(second.speak).toBe(conciseBrief);
    expect(second.speak).not.toContain("Customer 1");
    expect(second.speak.length).toBeLessThan(longBrief.length);

    const reversed = await runClaireTurn(
      { ...turnInput("Give me more detail from now on.", `daphne-phone-detail-${suffix}`, "voice"), allowFragmentWait: false },
      h.overrides
    );
    expect(reversed.speak).toBe("Got it. I'll provide more detail from now on.");
    expect((await loadDaphneMetaPreferences({ tenantId, canonicalOperatorId })).response_detail?.value).toBe(0.85);

    const detailed = await runClaireTurn(
      { ...turnInput("Can you walk me through my day?", `daphne-phone-after-detail-${suffix}`, "voice"), allowFragmentWait: false },
      h.overrides
    );
    expect(detailed.speak).toBe(longBrief);

    // A stored opt-out must suppress Daphne's deterministic adaptation while
    // leaving the unmodified board as the fallback presentation.
    const latest = await loadDaphneMetaPreferences({ tenantId, canonicalOperatorId });
    await setDaphneMetaPreference({
      tenantId, canonicalOperatorId, preferenceKey: "adaptation_enabled",
      value: false, sourceObservationId: latest.response_detail!.sourceObservationId,
    });
    expect(await loadDaphneClaireGuidance({ tenantId, operatorUserId: operatorOpenId })).toBeNull();
    const disabled = await runClaireTurn(
      { ...turnInput("Can you walk me through my day?", `daphne-phone-disabled-${suffix}`, "voice"), allowFragmentWait: false },
      h.overrides
    );
    expect(disabled.speak).toBe(longBrief);
  }, 120_000);
});
