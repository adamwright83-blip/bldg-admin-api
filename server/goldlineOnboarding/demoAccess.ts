/**
 * WRIGHT CONTRACTORS demo access — bypass login and onboarding reset.
 *
 * WHY THIS IS SAFE TO SHIP
 *
 * This module adds a door that skips authentication. That is only acceptable
 * because the door is nailed to one disposable room:
 *
 *   1. Every route is dark unless GOLDLINE_DEMO_BYPASS === "true". The flag is
 *      absent by default, so a normal deploy exposes nothing: the endpoints
 *      answer 404, and the client never renders the buttons because the
 *      capability endpoint reports disabled.
 *   2. The session it mints belongs to ONE hardcoded fixture user in ONE
 *      hardcoded fixture tenant. The tenant id is a compile-time constant, not
 *      a request parameter, so no request can steer this at another tenant.
 *   3. DEMO_TENANT_ID is asserted against the protected/legacy tenant ids at
 *      module load. If anyone ever edits it to a real tenant, the server
 *      refuses to boot rather than quietly opening a real business.
 *   4. Reset deletes only rows carrying the fixture tenant id.
 *
 * It therefore cannot weaken auth for any other user: a bypassed session is
 * scoped by the same ctx.tenantId mechanism every other session uses, and that
 * tenant owns nothing but demo fixtures.
 *
 * Turning GOLDLINE_DEMO_BYPASS on in production DOES mean anyone who knows the
 * URL can enter the WRIGHT CONTRACTORS demo tenant unauthenticated. That is the
 * intended trade for a click-to-demo, and it is why the blast radius is one
 * fixture tenant. Unset the flag when the demo period ends.
 */
import type express from "express";
import { sql } from "drizzle-orm";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";
import { getDb, upsertUser } from "../db";

export const DEMO_TENANT_ID = "goldline-dp-wright-contractors";
export const DEMO_BUSINESS_NAME = "WRIGHT CONTRACTORS";
const DEMO_OPEN_ID = "goldline-demo:wright-contractors";

/** Tenant ids this module must never be able to address, whatever it is edited to. */
export function protectedTenantIds(): Set<string> {
  return new Set(
    (process.env.DAYFORGE_LEGACY_TENANT_IDS ?? "default,laundry_farm")
      .split(",")
      .map(value => value.trim())
      .filter(Boolean)
  );
}

if (protectedTenantIds().has(DEMO_TENANT_ID))
  throw new Error(
    `Goldline demo tenant ${DEMO_TENANT_ID} collides with a real tenant. Refusing to start.`
  );

export function demoBypassEnabled(): boolean {
  return process.env.GOLDLINE_DEMO_BYPASS === "true";
}

/** Idempotently provision the fixture tenant, owner and entitlements. */
async function ensureDemoTenant() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.execute(sql`
    INSERT INTO dayforge_saas_tenants
      (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status,onboardingStep)
    VALUES
      (${DEMO_TENANT_ID},${DEMO_TENANT_ID},${DEMO_BUSINESS_NAME},${DEMO_BUSINESS_NAME},'#f3cc7e',
       'Design Partner Demo','demo@example.invalid','America/Los_Angeles','active','complete')
    ON DUPLICATE KEY UPDATE businessName=VALUES(businessName), brandName=VALUES(brandName)`);

  await upsertUser({
    openId: DEMO_OPEN_ID,
    tenantId: DEMO_TENANT_ID,
    name: DEMO_BUSINESS_NAME,
    loginMethod: "goldline_demo_bypass",
    role: "admin",
    lastSignedIn: new Date(),
  });

  await db.execute(sql`
    INSERT INTO dayforge_saas_memberships (tenantId,userOpenId,role,active)
    VALUES (${DEMO_TENANT_ID},${DEMO_OPEN_ID},'owner',1)
    ON DUPLICATE KEY UPDATE role=VALUES(role), active=VALUES(active)`);

  for (const entitlement of ["dayforge_core", "territory_intelligence", "dayforge_field"])
    await db.execute(sql`
      INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled)
      VALUES (${DEMO_TENANT_ID},${entitlement},'manual',1)
      ON DUPLICATE KEY UPDATE enabled=VALUES(enabled)`);

  return db;
}

/** Clear ONLY the fixture tenant's onboarding progress so the demo can replay. */
export async function resetDemoOnboarding() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (const table of [
    "goldline_onboarding_sessions",
    "goldline_vehicle_custody",
    "goldline_world_events",
  ])
    await db.execute(
      sql`DELETE FROM ${sql.raw(table)} WHERE tenantId=${DEMO_TENANT_ID}`
    );
  await db.execute(
    sql`DELETE FROM dayforge_saas_external_customers WHERE tenantId=${DEMO_TENANT_ID}`
  );
}

export function registerGoldlineDemoRoutes(app: express.Express) {
  // The capability endpoint is always mounted so the client can ask; it simply
  // reports disabled when the flag is off, and the buttons never render.
  app.get("/api/goldline/demo/capability", (_req, res) => {
    res.json({
      enabled: demoBypassEnabled(),
      tenantId: demoBypassEnabled() ? DEMO_TENANT_ID : null,
      businessName: demoBypassEnabled() ? DEMO_BUSINESS_NAME : null,
    });
  });

  // Every mutating route is 404 while the flag is off — indistinguishable from
  // a build that does not contain this module at all.
  const guard: express.RequestHandler = (_req, res, next) => {
    if (!demoBypassEnabled()) return res.status(404).json({ error: "Not found" });
    next();
  };

  app.post("/api/goldline/demo/bypass-login", guard, async (req, res) => {
    try {
      await ensureDemoTenant();
      const sessionToken = await sdk.createSessionToken(DEMO_OPEN_ID, {
        name: DEMO_BUSINESS_NAME,
        role: "admin",
        expiresInMs: ONE_YEAR_MS,
      });
      res.cookie(COOKIE_NAME, sessionToken, {
        ...getSessionCookieOptions(req),
        maxAge: ONE_YEAR_MS,
      });
      res.json({ ok: true, tenantId: DEMO_TENANT_ID, businessName: DEMO_BUSINESS_NAME });
    } catch (error) {
      console.error("[GoldlineDemo] bypass login failed:", error);
      res.status(500).json({ error: "Demo bypass login failed" });
    }
  });

  app.post("/api/goldline/demo/reset", guard, async (_req, res) => {
    try {
      await ensureDemoTenant();
      await resetDemoOnboarding();
      res.json({ ok: true, tenantId: DEMO_TENANT_ID });
    } catch (error) {
      console.error("[GoldlineDemo] reset failed:", error);
      res.status(500).json({ error: "Demo reset failed" });
    }
  });
}
