/* LEGACY DAYFORGE COMPATIBILITY: retained historical table/API literals only; canonical product is JOYSTICK. */
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLegacyDayforgeSubscriptionCheckout,
  processLegacyDayforgeBillingWebhook,
} from "./saasBilling";
import {
  activateOnboardingOwner,
  generateJoystickDraftPreview,
  saveJoystickDraftAnswer,
  saveJoystickOnboardingIdentity,
  startJoystickOnboardingDraft,
} from "./saasStore";

const enabled = process.env.JOYSTICK_ACQUISITION_EXAM === "1";
const suite = enabled ? describe : describe.skip;

function fakeStripe(state: { event: any; subscription: any; created?: any }) {
  return {
    checkout: {
      sessions: {
        create: async (params: any, options: any) => {
          state.created = { params, options };
          return {
            id: "cs_test_joystick_acquisition",
            url: "https://example.invalid/checkout",
          };
        },
        retrieve: async () => ({
          id: "cs_test_joystick_acquisition",
          url: "https://example.invalid/checkout",
        }),
      },
    },
    webhooks: {
      constructEvent: () => state.event,
    },
    subscriptions: {
      retrieve: async () => state.subscription,
    },
  } as never;
}

suite("JOYSTICK acquisition draft → paid tenant lifecycle", () => {
  let db: Connection;
  let sessionId = "";
  let resumeToken = "";
  let tenantId = "";
  const suffix = Date.now().toString(36);
  const planKey = `joystick-acquisition-${suffix}`;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    db = await mysql.createConnection(process.env.DATABASE_URL);
    const [databaseRows] = await db.query<RowDataPacket[]>(
      "SELECT DATABASE() AS name"
    );
    const name = String(databaseRows[0]?.name ?? "");
    if (!name.includes("acquisition_funnel")) {
      throw new Error(`Refusing acquisition exam outside disposable DB: ${name}`);
    }

    await db.execute(
      `INSERT INTO dayforge_saas_billing_plans
        (planKey,displayName,stripePriceId,trialDays,rulesJson,entitlementsJson,active)
       VALUES (?,?,?,7,?,?,true)`,
      [
        planKey,
        "JOYSTICK Acquisition Test",
        `price_${planKey}`,
        JSON.stringify({}),
        JSON.stringify(["dayforge_core", "dayforge_field"]),
      ]
    );
  });

  async function tableExists(table: string): Promise<boolean> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table]
    );
    return Number(rows[0]?.count ?? 0) === 1;
  }

  afterAll(async () => {
    if (!db) return;
    if (tenantId) {
      for (const table of [
        "dayforge_saas_user_credentials",
        "dayforge_saas_memberships",
        "dayforge_saas_entitlements",
        "dayforge_saas_subscriptions",
        "dayforge_saas_tenant_services",
        "dayforge_saas_tenant_locations",
        "territory_operator_profiles",
      ]) {
        if (await tableExists(table)) {
          await db.execute(`DELETE FROM \`${table}\` WHERE tenantId = ?`, [tenantId]);
        }
      }
      await db.execute("DELETE FROM users WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM goldline_onboarding_sessions WHERE tenantId = ?", [tenantId]);
      await db.execute("DELETE FROM dayforge_saas_tenants WHERE id = ?", [tenantId]);
    }
    if (sessionId) {
      await db.execute(
        "DELETE FROM dayforge_saas_checkout_sessions WHERE onboardingSessionId = ?",
        [sessionId]
      );
      await db.execute(
        "DELETE FROM dayforge_saas_onboarding_sessions WHERE id = ?",
        [sessionId]
      );
    }
    await db.execute(
      "DELETE FROM dayforge_saas_billing_events WHERE objectId LIKE ?",
      [`sub_acquisition_${suffix}%`]
    );
    await db.execute(
      "DELETE FROM dayforge_saas_billing_plans WHERE planKey = ?",
      [planKey]
    );
    await db.end();
  });

  it("persists three anonymous answers and a truthful draft without creating a tenant", async () => {
    const started = await startJoystickOnboardingDraft({
      requestId: crypto.randomUUID(),
    });
    sessionId = started.session.id;
    resumeToken = started.resumeToken!;
    expect(started.session).toMatchObject({
      onboardingMode: "joystick_generic",
      businessName: null,
      ownerEmail: null,
      tenantId: null,
    });

    let session = await saveJoystickDraftAnswer({
      sessionId,
      resumeToken,
      expectedVersion: 1,
      questionKey: "daily_work",
      answer: "I run plumbing calls and quote jobs",
    });
    session = await saveJoystickDraftAnswer({
      sessionId,
      resumeToken,
      expectedVersion: session.version,
      questionKey: "service_area",
      answer: "Pasadena",
    });
    session = await saveJoystickDraftAnswer({
      sessionId,
      resumeToken,
      expectedVersion: session.version,
      questionKey: "avoidance",
      answer: "following up on estimates",
    });
    session = await generateJoystickDraftPreview({
      sessionId,
      resumeToken,
      expectedVersion: session.version,
    });

    expect(session.currentStep).toBe("draft_reveal");
    expect(session.draftAnswersJson).toMatchObject({
      daily_work: "I run plumbing calls and quote jobs",
      service_area: "Pasadena",
      avoidance: "following up on estimates",
    });
    expect(session.draftPreviewJson).toMatchObject({
      kind: "joystick_draft_preview",
      work: { provenance: "operator_declared" },
      avoidance: { provenance: "operator_declared" },
    });

    const [tenantRows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenants"
    );
    const [goldlineRows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM goldline_onboarding_sessions"
    );
    expect(Number(tenantRows[0]?.count ?? 0)).toBe(0);
    expect(Number(goldlineRows[0]?.count ?? 0)).toBe(0);
  });

  it("requires truthful identity, then uses canonical checkout without laundry configuration", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT version FROM dayforge_saas_onboarding_sessions WHERE id = ?",
      [sessionId]
    );
    const identity = await saveJoystickOnboardingIdentity({
      sessionId,
      resumeToken,
      expectedVersion: Number(rows[0]?.version),
      businessName: "Pasadena Pipeworks",
      contactName: "Test Owner",
      ownerEmail: `owner-${suffix}@example.invalid`,
      timeZone: "America/Los_Angeles",
    });

    const configuration = identity.configurationJson as {
      kind?: string;
      locations?: unknown[];
      services?: unknown[];
      importProviderKey?: string | null;
    };
    expect(configuration).toMatchObject({
      kind: "joystick_generic",
      locations: [],
      services: [],
      importProviderKey: null,
    });

    const state = { event: null as any, subscription: null as any, created: undefined as any };
    const stripe = fakeStripe(state);
    const checkout = await createLegacyDayforgeSubscriptionCheckout({
      sessionId,
      resumeToken,
      planKey,
      requestId: `checkout-${suffix}`,
      stripe,
    });
    expect(checkout.url).toBe("https://example.invalid/checkout");
    expect(state.created.params.customer_email).toBe(`owner-${suffix}@example.invalid`);
    expect(state.created.params.success_url).toContain("/joystick-start?");

    const [beforeProvision] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenants"
    );
    expect(Number(beforeProvision[0]?.count ?? 0)).toBe(0);
  });

  it("provisions exactly one tenant and seeds only the three declared Goldline answers", async () => {
    process.env.DAYFORGE_BILLING_STRIPE_WEBHOOK_SECRET = "whsec_acquisition_test";
    const created = 1_800_010_000;
    const subscription = {
      id: `sub_acquisition_${suffix}`,
      customer: `cus_acquisition_${suffix}`,
      status: "trialing",
      cancel_at_period_end: false,
      current_period_end: created + 86400 * 30,
      trial_end: created + 86400 * 7,
      latest_invoice: `in_acquisition_${suffix}`,
      metadata: {
        legacyDayforgeOnboardingSessionId: sessionId,
        legacyDayforgePlanKey: planKey,
      },
    };
    const event = {
      id: `evt_acquisition_${suffix}`,
      type: "checkout.session.completed",
      livemode: false,
      created,
      data: {
        object: {
          id: "cs_test_joystick_acquisition",
          subscription: subscription.id,
          metadata: subscription.metadata,
        },
      },
    };
    const state = { event, subscription };
    const stripe = fakeStripe(state);

    const first = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from("joystick-acquisition"),
      signature: "test-signature",
      stripe,
    });
    expect(first.status).toBe("processed");
    const duplicate = await processLegacyDayforgeBillingWebhook({
      rawBody: Buffer.from("joystick-acquisition"),
      signature: "test-signature",
      stripe,
    });
    expect(duplicate).toMatchObject({ status: "ignored", reason: "duplicate_event" });

    const [sessions] = await db.execute<RowDataPacket[]>(
      "SELECT tenantId,status FROM dayforge_saas_onboarding_sessions WHERE id = ?",
      [sessionId]
    );
    tenantId = String(sessions[0]?.tenantId ?? "");
    expect(tenantId).toMatch(/^df_[0-9a-f]{24}$/);
    expect(sessions[0]?.status).toBe("provisioned");

    const [tenantRows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenants WHERE id = ?",
      [tenantId]
    );
    const [locations] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenant_locations WHERE tenantId = ?",
      [tenantId]
    );
    const [services] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM dayforge_saas_tenant_services WHERE tenantId = ?",
      [tenantId]
    );
    const laundryProfiles = (await tableExists("territory_operator_profiles"))
      ? (await db.execute<RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM territory_operator_profiles WHERE tenantId = ?",
          [tenantId]
        ))[0]
      : ([{ count: 0 }] as RowDataPacket[]);
    expect(Number(tenantRows[0]?.count ?? 0)).toBe(1);
    expect(Number(locations[0]?.count ?? 0)).toBe(0);
    expect(Number(services[0]?.count ?? 0)).toBe(0);
    expect(Number(laundryProfiles[0]?.count ?? 0)).toBe(0);

    const [goldline] = await db.execute<RowDataPacket[]>(
      "SELECT payload FROM goldline_onboarding_sessions WHERE tenantId = ?",
      [tenantId]
    );
    expect(goldline).toHaveLength(1);
    const payload =
      typeof goldline[0]?.payload === "string"
        ? JSON.parse(goldline[0].payload)
        : goldline[0]?.payload;
    expect(payload).toMatchObject({
      tenantId,
      status: "INTERVIEW",
      currentQuestion: 2,
      acquisitionSessionId: sessionId,
      answersByKey: {
        daily_work: "I run plumbing calls and quote jobs",
        service_area: "Pasadena",
        avoidance: "following up on estimates",
      },
      world: null,
      mission: null,
    });
    expect(payload.answersByKey.customer_source).toBeUndefined();
    expect(payload.answersByKey.objective_90_day).toBeUndefined();

    const activated = await activateOnboardingOwner({
      sessionId,
      resumeToken,
      name: "Test Owner",
      passwordHash: "not-a-real-password-hash",
    });
    expect(activated.tenantId).toBe(tenantId);
  });
});
