import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { expect, test } from "@playwright/test";
import { begin, connectOwn, toTheTable } from "./journey";

/**
 * After paying, the person can get into the workspace they bought. Provisioning (the Stripe webhook) creates a tenant
 * with no one who can sign in to it; the owner makes a password at the table, and goes in signed in. The webhook's
 * result is seeded straight into the local database (Stripe isn't reachable here); the owner activation, the sign-in
 * and the landing are the real server's.
 */
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";

test("a paid first-ten workspace: create a password at the table, go in signed in; later, the way back in", async ({ page, request, context }) => {
  test.setTimeout(300_000);
  expect(databaseUrl, "E2E_DATABASE_URL (scripts/first-ten-e2e.sh)").toMatch(/127\.0\.0\.1|localhost/);
  await begin(page, request);
  await connectOwn(page, request);
  await toTheTable(page);
  await expect(page.getByTestId("first-ten-send-from")).toBeVisible({ timeout: 30_000 });
  // nothing to open before there is a workspace
  await expect(page.getByTestId("first-ten-workspace")).toHaveCount(0);

  const credentials = await page.evaluate(() => JSON.parse(localStorage.getItem("joystick_first_ten_credentials") ?? sessionStorage.getItem("joystick_first_ten_credentials") ?? "null"));
  expect(credentials?.sessionId).toBeTruthy();
  const tenantId = `df_${randomBytes(12).toString("hex")}`;
  const ownerEmail = `nina-${tenantId.slice(3, 11)}@wildrootflowers.example`;
  const db = await mysql.createConnection(databaseUrl);
  try {
    // what processLegacyDayforgeBillingWebhook leaves behind for a first-ten signup: an active tenant on a trial, its
    // entitlement, and the signup marked provisioned (server/saas/saasStore.ts)
    await db.execute(
      `INSERT INTO dayforge_saas_tenants (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
       VALUES (?,?,?,?,?,?,?,?, 'active')`,
      [tenantId, tenantId, "Wildroot Flowers", "Wildroot Flowers", "#111111", "Nina Vale", ownerEmail, "America/Los_Angeles"]
    );
    await db.execute(
      `INSERT INTO dayforge_saas_subscriptions (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status,trialEnd,lastStripeEventId,lastStripeEventCreatedAt)
       VALUES (?, 'first-ten-e2e', ?, ?, 'trialing', DATE_ADD(NOW(), INTERVAL 7 DAY), ?, NOW())`,
      [tenantId, `cus_e2e_${tenantId}`, `sub_e2e_${tenantId}`, `evt_e2e_${tenantId}`]
    );
    await db.execute(`INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?, 'dayforge_core', 'plan', true)`, [tenantId]);
    await db.execute(
      `UPDATE dayforge_saas_onboarding_sessions
       SET tenantId = ?, status = 'provisioned', currentStep = 'owner_activation', businessName = 'Wildroot Flowers', ownerEmail = ?,
           configurationJson = JSON_OBJECT('kind', 'first_ten', 'businessName', 'Wildroot Flowers', 'contactName', 'Nina Vale', 'contactEmail', ?)
       WHERE id = ?`,
      [tenantId, ownerEmail, ownerEmail, credentials.sessionId]
    );

    // back at the table: the workspace exists, and the owner makes the password that opens it
    await page.reload();
    await expect(page.getByTestId("first-ten-send-from")).toBeVisible({ timeout: 60_000 });
    const key = page.getByTestId("first-ten-workspace");
    await expect(key).toHaveAttribute("data-owner", "needs_password", { timeout: 30_000 });
    await expect(key).toContainText("Your workspace is ready.");
    await expect(key).toContainText(ownerEmail);
    await expect(page.getByTestId("first-ten-workspace-create")).toBeDisabled();
    await key.getByLabel("Password").fill("a long first-ten password");
    await page.getByTestId("first-ten-workspace-create").click();
    await page.waitForURL(url => new URL(url).pathname === "/onboarding", { timeout: 60_000 });

    // signed in, as the owner of that workspace
    const me = await (await context.request.get("/api/trpc/auth.me")).json();
    expect(JSON.stringify(me)).toContain(ownerEmail);
    const [owners] = await db.query<mysql.RowDataPacket[]>(
      `SELECT m.role FROM dayforge_saas_memberships m JOIN dayforge_saas_user_credentials c ON c.tenantId = m.tenantId AND c.userOpenId = m.userOpenId WHERE m.tenantId = ?`,
      [tenantId]
    );
    expect(owners.map(row => row.role)).toEqual(["owner"]);

    // later, at the table again: the way back in, not a second password
    await page.goto("/joystick-start");
    await expect(page.getByTestId("first-ten-workspace")).toHaveAttribute("data-owner", "ready", { timeout: 60_000 });
    await expect(page.getByTestId("first-ten-workspace-open")).toHaveAttribute("href", "/dayforge-login?returnTo=%2Fonboarding");
  } finally {
    for (const table of ["dayforge_saas_entitlements", "dayforge_saas_subscriptions", "dayforge_saas_memberships", "dayforge_saas_user_credentials", "users"]) {
      await db.execute(`DELETE FROM ${table} WHERE tenantId = ?`, [tenantId]).catch(() => undefined);
    }
    await db.execute(`DELETE FROM dayforge_saas_tenants WHERE id = ?`, [tenantId]).catch(() => undefined);
    await db.end();
  }
});
