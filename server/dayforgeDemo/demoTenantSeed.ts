import { and, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { getDb } from "../db";
import { ENV } from "../_core/env";
import {
  commercialMissions,
  dayforgeSaasEntitlements,
  dayforgeSaasMemberships,
  dayforgeSaasSubscriptions,
  dayforgeSaasTenantLocations,
  dayforgeSaasTenants,
  dayforgeSaasUserCredentials,
  orders,
  users,
} from "../../drizzle/schema";
import {
  normalizeSaasEmail,
  normalizeSaasTenantSlug,
} from "../../shared/saasTenant";
import {
  createCommercialMission,
  getCommercialMissionByIdempotencyKey,
} from "../commercialMissions/commercialMissionStore";
import type { CommercialMission } from "@shared/commercialMission";

export const DEMO_MISSION_IDEMPOTENCY_KEY = "dayforge-demo-mission-042";
export const DEMO_TENANT_BUSINESS_NAME = "Sunset Laundry Demo";
export const DEMO_OWNER_OPEN_ID = "dayforge-demo-owner";
export const DEMO_FIELD_OPEN_ID = "dayforge-demo-field";
export const DEMO_CHURN_CUSTOMER_NAME = "Sarah Johnson";
export const DEMO_OWNER_EMAIL = "demo-owner@sunsetlaundry.example";
export const DEMO_FIELD_EMAIL = "demo-field@sunsetlaundry.example";
/**
 * Fixed, publicly-documented boss-demo password (docs/dayforge-boss-demo.md).
 * This only ever unlocks the DAYFORGE_DEMO_ENABLED-gated demo tenant's owner
 * and field logins via /dayforge-login — never a production tenant — so a
 * well-known value here is intentional, not a leaked secret.
 */
export const DEMO_TENANT_PASSWORD = "SunsetDemo2026!";

export function demoTenantSlug(): string {
  return ENV.dayforgeDemoTenantSlug;
}

/** Deterministic tenant id derived from the demo slug so seeding is idempotent across runs. */
export function demoTenantId(): string {
  return `demo-${demoTenantSlug()}`;
}

function assertDemoEnabled() {
  if (!ENV.dayforgeDemoEnabled) {
    throw new Error(
      "DAYFORGE_DEMO_ENABLED is not true; refusing to touch the demo tenant"
    );
  }
}

async function upsertDemoTenant(): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tenantId = demoTenantId();
  const slug = normalizeSaasTenantSlug(demoTenantSlug());

  await db
    .insert(dayforgeSaasTenants)
    .values({
      id: tenantId,
      slug,
      businessName: DEMO_TENANT_BUSINESS_NAME,
      brandName: DEMO_TENANT_BUSINESS_NAME,
      primaryColor: "#1d4ed8",
      contactName: "Demo Owner",
      contactEmail: "demo-owner@sunsetlaundry.example",
      contactPhone: "+15555550100",
      timeZone: "America/Los_Angeles",
      status: "active",
      onboardingStep: "complete",
      onboardingCompletedAt: new Date(),
      billingStateUpdatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({
      set: {
        businessName: DEMO_TENANT_BUSINESS_NAME,
        brandName: DEMO_TENANT_BUSINESS_NAME,
        status: "active",
        onboardingStep: "complete",
      },
    });

  // Store profile / pricing-capacity config / routes / service radius, reusing
  // the same production onboarding location table.
  await db
    .insert(dayforgeSaasTenantLocations)
    .values({
      tenantId,
      locationKey: "primary",
      label: "Sunset Laundry HQ",
      address: "1200 Sunset Blvd, Los Angeles, CA",
      latitude: "34.0900000",
      longitude: "-118.3200000",
      serviceRadiusMiles: "8.00",
      maxPoundsPerDay: 1200,
      maxPoundsByWeekdayJson: {
        mon: 1200,
        tue: 1200,
        wed: 1200,
        thu: 1200,
        fri: 1200,
        sat: 800,
        sun: 0,
      },
      openCapacityPoundsPerWeek: 6800,
      pickupDaysJson: ["mon", "tue", "wed", "thu", "fri", "sat"],
      routeWindowsJson: [
        { day: "mon", window: "08:00-12:00" },
        { day: "wed", window: "08:00-12:00" },
        { day: "fri", window: "08:00-12:00" },
      ],
      turnaroundHours: 48,
      deliveryEnabled: true,
      isPrimary: true,
    })
    .onDuplicateKeyUpdate({
      set: {
        maxPoundsPerDay: 1200,
        serviceRadiusMiles: "8.00",
        openCapacityPoundsPerWeek: 6800,
      },
    });

  return tenantId;
}

async function upsertDemoUsers(tenantId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .insert(users)
    .values({
      tenantId,
      openId: DEMO_OWNER_OPEN_ID,
      name: "Demo Owner",
      email: "demo-owner@sunsetlaundry.example",
      loginMethod: "demo",
      role: "admin",
    })
    .onDuplicateKeyUpdate({ set: { tenantId, role: "admin" } });

  await db
    .insert(users)
    .values({
      tenantId,
      openId: DEMO_FIELD_OPEN_ID,
      name: "Demo Field Driver",
      email: "demo-field@sunsetlaundry.example",
      loginMethod: "demo",
      role: "driver",
    })
    .onDuplicateKeyUpdate({ set: { tenantId, role: "driver" } });

  await db
    .insert(dayforgeSaasMemberships)
    .values({
      tenantId,
      userOpenId: DEMO_OWNER_OPEN_ID,
      role: "owner",
      active: true,
    })
    .onDuplicateKeyUpdate({ set: { role: "owner", active: true } });

  await db
    .insert(dayforgeSaasMemberships)
    .values({
      tenantId,
      userOpenId: DEMO_FIELD_OPEN_ID,
      role: "field",
      active: true,
    })
    .onDuplicateKeyUpdate({ set: { role: "field", active: true } });

  // Without a credentials row, /dayforge-login (POST /api/dayforge/auth/login)
  // has nothing to authenticate against and the demo tenant's owner/field
  // logins are unreachable through the actual product UI.
  const passwordHash = await bcrypt.hash(DEMO_TENANT_PASSWORD, 12);
  await db
    .insert(dayforgeSaasUserCredentials)
    .values({
      tenantId,
      userOpenId: DEMO_OWNER_OPEN_ID,
      emailNormalized: normalizeSaasEmail(DEMO_OWNER_EMAIL),
      passwordHash,
    })
    .onDuplicateKeyUpdate({
      set: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });

  await db
    .insert(dayforgeSaasUserCredentials)
    .values({
      tenantId,
      userOpenId: DEMO_FIELD_OPEN_ID,
      emailNormalized: normalizeSaasEmail(DEMO_FIELD_EMAIL),
      passwordHash,
    })
    .onDuplicateKeyUpdate({
      set: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    });
}

/**
 * The demo story is told through a stable public code, "MISSION 042" —
 * every presentation surface (Radar, BORESLAY, Field, proposal, pipeline,
 * timeline) reads `mission.code`, never the internal `mission.id`. The
 * internal id is free to change on every reset (it's the real primary key
 * used for joins/authorization/events); the code must not.
 *
 * commercial_missions.code normally defaults to `formatMissionCode(id)`
 * (server/commercialMissions/commercialMissionStore.ts) — fine for real
 * tenants, where a mission is created once and never regenerated. The demo
 * tenant is different: demoTenantReset.ts deletes and recreates this row on
 * every reset, so left alone its code would drift ("MISSION 029", "MISSION
 * 033", ...) even though the story is always the same account. Overwrite it
 * here, once, right after creation.
 */
export const DEMO_MISSION_PUBLIC_CODE = "MISSION 042";

/** MISSION 042 / Westview Property Management — the canonical demo storyline mission. */
async function ensureDemoMission(tenantId: string): Promise<CommercialMission> {
  const existing = await getCommercialMissionByIdempotencyKey({
    tenantId,
    idempotencyKey: DEMO_MISSION_IDEMPOTENCY_KEY,
  });
  if (existing) return existing;

  const created = await createCommercialMission({
    tenantId,
    assignedTo: DEMO_FIELD_OPEN_ID,
    actor: { type: "system", id: "dayforge-demo-seed" },
    idempotencyKey: DEMO_MISSION_IDEMPOTENCY_KEY,
    account: {
      name: "Westview Property Management",
      accountType: "property_management",
      address: "500 Westview Terrace, Los Angeles, CA",
      latitude: 34.0522,
      longitude: -118.2437,
      locationCount: 15,
      decisionMaker: { name: "Dana R.", title: "Portfolio Manager" },
    },
    opportunity: {
      estimatedAnnualValueCents: 24_800_00,
      estimateConfidence: "high",
      score: 88,
      primarySignal: "Expanded to 15 buildings",
      reasons: ["Expanded to 15 buildings", "No current commercial laundry vendor"],
      risks: [],
    },
    brief: {
      laundryOpportunity:
        "Westview Property Management recently expanded to 15 buildings and has no incumbent commercial laundry vendor.",
      salesAngle: "Position Sunset Laundry as the single vendor across the expanded portfolio.",
      openingLine:
        "Hi Dana, congrats on the portfolio expansion to 15 buildings — I'd love to talk about consolidating laundry service.",
      discoveryQuestions: [
        "How is laundry currently handled across the new buildings?",
        "Who owns the vendor decision for facilities services?",
      ],
      objections: ["Already have a vendor for some buildings", "Budget cycle timing"],
    },
    steps: [
      { key: "research", label: "Research", detail: "Confirm portfolio size and current vendor.", status: "completed", position: 1 },
      { key: "outreach", label: "Outreach", detail: "Call Dana R. to open the conversation.", status: "ready", position: 2 },
      { key: "visit", label: "Site Visit", detail: "Walk the largest building in the portfolio.", status: "locked", position: 3 },
      { key: "proposal", label: "Proposal", detail: "Send pricing for portfolio-wide service.", status: "locked", position: 4 },
    ],
  });

  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(commercialMissions)
    .set({ code: DEMO_MISSION_PUBLIC_CODE })
    .where(
      and(
        eq(commercialMissions.tenantId, tenantId),
        eq(commercialMissions.id, created.id)
      )
    );

  return { ...created, code: DEMO_MISSION_PUBLIC_CODE };
}

/** Sarah Johnson — a second demo customer with order history tuned for Churn Radar. */
async function ensureChurnCustomer(tenantId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.tenantId, tenantId))
    .limit(1);
  // Idempotent: only seed the churn order history once per tenant reset cycle;
  // demoTenantReset.ts deletes these rows before demoTenantSeed re-creates them.
  if (existing.length > 0) return;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  // 14-day cadence, most recent order 30 days ago (now overdue), with a
  // declining weight trend across the history.
  const cadenceDays = 14;
  const weights = [42, 38, 31, 22];
  const ordersToInsert = weights.map((weightLbs, index) => {
    const daysAgo = 30 + (weights.length - 1 - index) * cadenceDays;
    const pickupDate = new Date(now - daysAgo * dayMs).toISOString().slice(0, 10);
    return {
      tenantId,
      serviceType: "wash_fold" as const,
      pickupDate,
      pickupTimeWindow: "09:00-12:00",
      address: "88 Ocean Ave, Los Angeles, CA",
      firstName: "Sarah",
      lastName: "Johnson",
      phone: "+15555550111",
      email: "sarah.johnson@example.com",
      status: "delivered" as const,
      weightLbs: String(weightLbs),
      bagCount: 1,
      subtotal: String((weightLbs * 1.75).toFixed(2)),
      total: String((weightLbs * 1.75).toFixed(2)),
    };
  });

  await db.insert(orders).values(ordersToInsert);
}

const DEMO_ENTITLEMENT_KEYS = [
  "territory_intelligence",
  "boreslay",
  "dayforge_field",
  "commercial_pipeline",
  "churn_radar",
] as const;

/**
 * Grants the demo tenant the entitlements every other tenant only gets from
 * a real paid Stripe subscription. This is a SIMULATED billing state, never
 * a live charge — server/dayforgeDemo/providerStatus.ts independently reports
 * Stripe as NOT_CONFIGURED/TEST based on real env vars regardless of this.
 */
async function ensureDemoEntitlements(tenantId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .insert(dayforgeSaasSubscriptions)
    .values({
      tenantId,
      planKey: "demo",
      stripeCustomerId: `demo_cus_${tenantId}`,
      stripeSubscriptionId: `demo_sub_${tenantId}`,
      status: "trialing",
      lastStripeEventId: `demo_evt_${tenantId}`,
      lastStripeEventCreatedAt: new Date(),
    })
    .onDuplicateKeyUpdate({ set: { status: "trialing" } });

  for (const entitlementKey of DEMO_ENTITLEMENT_KEYS) {
    await db
      .insert(dayforgeSaasEntitlements)
      .values({
        tenantId,
        entitlementKey,
        source: "manual",
        enabled: true,
      })
      .onDuplicateKeyUpdate({ set: { enabled: true } });
  }
}

export type DemoSeedResult = {
  tenantId: string;
  slug: string;
  mission: CommercialMission;
};

/** Idempotently creates/updates the entire demo tenant. Safe to call repeatedly. */
export async function seedDemoTenant(): Promise<DemoSeedResult> {
  assertDemoEnabled();
  const tenantId = await upsertDemoTenant();
  await upsertDemoUsers(tenantId);
  await ensureDemoEntitlements(tenantId);
  const mission = await ensureDemoMission(tenantId);
  await ensureChurnCustomer(tenantId);
  return { tenantId, slug: demoTenantSlug(), mission };
}
