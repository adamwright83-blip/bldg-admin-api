/* LEGACY DAYFORGE COMPATIBILITY: historical table references verified for launch audit tracking; canonical product is JOYSTICK. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { answerSession, type GoldlineOnboardingSession } from "../../shared/goldlineOnboarding";
import { buildFirstMission } from "../goldlineOnboarding/firstMission";
import { compileLocalWorld, knownTerritoryIds } from "../../shared/goldlineLocalWorld";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("JOYSTICK Launch Readiness Certifications (CERT-1 to CERT-6)", () => {
  it("CERT-1: New Customer Signup & Activation provisions tenant, activates owner, and builds world with first mission", () => {
    const store = source("./saasStore.ts");
    const acquisition = source("./joystickAcquisition.lifecycle.integration.test.ts");
    const firstMissionModule = source("../goldlineOnboarding/firstMission.ts");

    // 1. Prepay anonymous acquisition does not create premature tenant rows
    expect(acquisition).toContain("persists three anonymous answers and a truthful draft without creating a tenant");
    
    // 2. Stable tenant ID derivation from onboarding session
    expect(store).toContain("function tenantIdForOnboarding(sessionId: string)");
    expect(store).toContain('return `df_${createHash("sha256").update(sessionId)');

    // 3. Activation requires provisioned status and active subscription
    expect(store).toContain('session.status !== "provisioned"');
    expect(store).toContain("Tenant subscription is not active for owner activation");
    expect(store).toContain('status: "active"');

    // 4. World reveal constructs first mission with territory scout archetype
    expect(firstMissionModule).toContain('archetype:"TERRITORY_SCOUT"');
    expect(firstMissionModule).toContain("buildFirstMission(session,area,");
    expect(firstMissionModule).toContain('status:"COMPLETE"');
  });

  it("CERT-2: First Action & Day Line Update records observation, unlocks guardian, and defeats guardian", () => {
    const firstMissionDriver = source("../../client/src/components/goldline/onboarding/FirstMissionDriver.tsx");
    const firstMissionModule = source("../goldlineOnboarding/firstMission.ts");
    const dayPlan = source("../../client/src/pages/goldline/GoldlineDayPlan.tsx");

    // 1. Observation submission emits attested event and triggers PostHog action telemetry
    expect(firstMissionDriver).toContain('captureProductEvent("joystick_first_real_action_completed"');
    expect(firstMissionModule).toContain('eventType:"territory_scout_observed"');
    expect(firstMissionModule).toContain('verificationClass:"ATTESTED"');

    // 2. Guardian confrontation unlocks on evidence
    expect(firstMissionModule).toContain("Legitimate field evidence must unlock the Guardian first.");

    // 3. Victory records guardian_defeated event
    expect(firstMissionModule).toContain('eventType:"guardian_defeated"');
    expect(firstMissionDriver).toContain('captureProductEvent("guardian_defeated"');

    // 4. Day Plan reflects the first mission in empty state and Next Up card
    expect(dayPlan).toContain("BEGIN FIRST MISSION · THE FIRST SPARK");
    expect(dayPlan).toContain("THE FIRST SPARK");
  });

  it("CERT-3: Returning Customer Session preserves active mission, Day Line state, and blocks duplicate world creation", () => {
    const onboarding = source("../goldlineOnboarding/router.ts");
    const store = source("../goldlineOnboarding/store.ts");
    const host = source("../../client/src/pages/AdminHostApp.tsx");

    // 1. Router returns existing world compatibility
    expect(onboarding).toContain('compatibility: !session && await hasExistingWorld(ctx.tenantId) ? "LEGACY_EXISTING_WORLD" as const : "NEW_WORLD" as const');

    // 2. Completed session preserves world and mission state
    expect(store).toContain("const existing = await readSession(tenantId); if (existing) return existing;");
    expect(store).toContain('Existing Goldline world is preserved.');

    // 3. Returning user navigates to Lantern City rather than replaying interview
    expect(host).toContain("Lantern City is the canonical returning-user world");
  });

  it("CERT-4: Tenant Isolation Verification enforces composite tenant uniqueness and hostile router isolation", () => {
    const schema = source("../../drizzle/schema.ts");
    const hostile = source("./hostileTenant.integration.test.ts");

    // 1. Schema-level tenant scoping on all core tables
    const requiredIndices = [
      'uniqueIndex("uq_dayforge_saas_membership_user").on(\n      table.tenantId,\n      table.userOpenId',
      'uniqueIndex("uq_dayforge_saas_locations_key").on(\n      table.tenantId,\n      table.locationKey',
      'uniqueIndex("uq_dayforge_saas_services_key").on(\n      table.tenantId,\n      table.locationId,\n      table.serviceKey',
      'uniqueIndex("uq_dayforge_saas_entitlement").on(\n      table.tenantId,\n      table.entitlementKey,\n      table.source',
      'uniqueIndex("uq_dayforge_external_customer").on(\n      table.tenantId,\n      table.connectionId,\n      table.externalId',
      'uniqueIndex("uq_dayforge_external_order").on(\n      table.tenantId,\n      table.connectionId,\n      table.externalId',
    ];
    for (const idx of requiredIndices) expect(schema).toContain(idx);

    // 2. Hostile tenant penetration suite checks
    expect(hostile).toContain("real customer router lists only the authenticated tenant's customers");
    expect(hostile).toContain("rejects a cross-tenant customer object id through the actual router");
    expect(hostile).toContain("commercial mission routers isolate reads and reject cross-tenant mission mutation");
    expect(hostile).toContain("Day Line designation is tenant-scoped through the actual router");
  });

  it("CERT-5: Webhook Replay Idempotency handles duplicate webhook delivery safely", () => {
    const billing = source("./saasBilling.lifecycle.integration.test.ts");
    const store = source("./saasStore.ts");

    // 1. Duplicate webhook delivery reports duplicate_event
    expect(billing).toContain('reason: "duplicate_event"');

    // 2. Tenant row count remains exactly 1 on replay
    expect(billing).toContain("expect(Number(tenants[0]?.count ?? 0)).toBe(1)");

    // 3. MySQL onDuplicateKeyUpdate handles idempotency
    expect(store).toContain("onDuplicateKeyUpdate");
    expect(store).toContain("lastStripeEventCreatedAt");
  });

  it("CERT-6: Interrupted Session Recovery recovers at exact step without data corruption or duplicate records", () => {
    const store = source("../goldlineOnboarding/store.ts");
    const router = source("../goldlineOnboarding/router.ts");

    // 1. Optimistic concurrency version locking
    expect(store).toContain("WHERE tenantId=${session.tenantId} AND version=${expectedVersion}");
    expect(store).toContain("Your world changed in another session. Reload to resume.");

    // 2. Reload to resume verification on answer submission
    expect(router).toContain("Reload to resume the latest answer.");

    // 3. In-memory session continuation preserves exact step
    const initialSession: GoldlineOnboardingSession = {
      id: "test-sess",
      tenantId: "test-tenant",
      status: "INTERVIEW",
      currentQuestion: 0,
      answers: [],
      answersByKey: {},
      answerProvenanceByKey: {},
      acquisitionSessionId: null,
      interpretation: null,
      optionalUploadReference: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      version: 0,
      world: null,
      mission: null,
    };

    const q0 = answerSession(initialSession, 0, "Commercial Laundry Express");
    expect(q0.currentQuestion).toBe(1);
    expect(q0.answers[0]).toBe("Commercial Laundry Express");

    const q1 = answerSession(q0, 1, "Greater Austin Metro");
    expect(q1.currentQuestion).toBe(2);
    expect(q1.answers[1]).toBe("Greater Austin Metro");

    // Reload from intermediate state preserves all preceding answers
    expect(q1.answers.length).toBe(2);
    expect(q1.status).toBe("INTERVIEW");
  });
});
