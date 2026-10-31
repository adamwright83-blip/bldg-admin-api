import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { expect, test } from "@playwright/test";
import { FAKE, begin, connectOwn } from "./journey";

/**
 * A real account whose crew found no conversation. Signup, a paid workspace, and the way back in
 * do not require a draft. The webhook is seeded the way workspace.spec.ts seeds it: Stripe is not called.
 */
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";
const LEGACY_DAYFORGE_TABLE = (name: string) => `dayforge_saas_${name}`;
const LEGACY_DAYFORGE_WORKSPACE_ENTITLEMENT = "dayforge_core";
const LEGACY_DAYFORGE_SIGN_IN_PAGE = "/dayforge-login";

test("no qualifying opportunity: signup is on the kept page, and a paid workspace opens without a draft", async ({ page, request, context }, testInfo) => {
  test.setTimeout(300_000);
  expect(databaseUrl, "E2E_DATABASE_URL (scripts/first-ten-e2e.sh)").toMatch(/127\.0\.0\.1|localhost/);
  await begin(page, request);
  await request.post(`${FAKE}/__control`, { data: { noOpportunities: true } });
  await connectOwn(page, request);
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  const portrait = page.getByTestId("first-ten-portrait");
  await expect(portrait).toBeVisible({ timeout: 90_000 });
  await expect(portrait).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  await page.getByRole("button", { name: "That sounds like me" }).click();
  await expect(portrait).toHaveAttribute("data-status", "kept");

  const threshold = page.getByTestId("first-ten-chapter-threshold");
  await expect(threshold).toHaveAttribute("data-state", "no_opportunity", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-draft")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-signup")).toBeVisible();
  await expect(page.getByTestId("first-ten-workspace")).toHaveCount(0);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-37-no-opportunity-signup.png`, fullPage: true });

  const credentials = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("joystick_first_ten_credentials") ?? sessionStorage.getItem("joystick_first_ten_credentials") ?? "null")
  );
  expect(credentials?.sessionId).toBeTruthy();
  const tenantId = `df_${randomBytes(12).toString("hex")}`;
  const ownerEmail = `ada-${tenantId.slice(3, 11)}@northsideplumbing.example`;
  const db = await mysql.createConnection(databaseUrl);
  try {
    await db.execute(
      `INSERT INTO ${LEGACY_DAYFORGE_TABLE("tenants")} (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status)
       VALUES (?,?,?,?,?,?,?,?, 'active')`,
      [tenantId, tenantId, "Northside Plumbing", "Northside Plumbing", "#111111", "Ada Moss", ownerEmail, "America/Los_Angeles"]
    );
    await db.execute(
      `INSERT INTO ${LEGACY_DAYFORGE_TABLE("subscriptions")} (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status,trialEnd,lastStripeEventId,lastStripeEventCreatedAt)
       VALUES (?, 'first-ten-e2e', ?, ?, 'trialing', DATE_ADD(NOW(), INTERVAL 7 DAY), ?, NOW())`,
      [tenantId, `cus_e2e_${tenantId}`, `sub_e2e_${tenantId}`, `evt_e2e_${tenantId}`]
    );
    await db.execute(
      `INSERT INTO ${LEGACY_DAYFORGE_TABLE("entitlements")} (tenantId,entitlementKey,source,enabled) VALUES (?, ?, 'plan', true)`,
      [tenantId, LEGACY_DAYFORGE_WORKSPACE_ENTITLEMENT]
    );
    await db.execute(
      `UPDATE ${LEGACY_DAYFORGE_TABLE("onboarding_sessions")}
       SET tenantId = ?, status = 'provisioned', currentStep = 'owner_activation', businessName = 'Northside Plumbing', ownerEmail = ?,
           configurationJson = JSON_OBJECT('kind', 'first_ten', 'businessName', 'Northside Plumbing', 'contactName', 'Ada Moss', 'contactEmail', ?)
       WHERE id = ?`,
      [tenantId, ownerEmail, ownerEmail, credentials.sessionId]
    );

    await page.reload();
    const key = page.getByTestId("first-ten-workspace");
    await expect(key).toHaveAttribute("data-owner", "needs_password", { timeout: 60_000 });
    await expect(page.getByTestId("first-ten-draft")).toHaveCount(0);
    await expect(page.getByTestId("first-ten-chapter-threshold")).toHaveAttribute("data-state", "no_opportunity");
    await key.getByLabel("Password").fill("a long first-ten password");
    await page.getByTestId("first-ten-workspace-create").click();
    await page.waitForURL(url => new URL(url).pathname === "/onboarding", { timeout: 60_000 });
    await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-38-workspace-without-draft.png`, fullPage: true });

    const me = await (await context.request.get("/api/trpc/auth.me")).json();
    expect(JSON.stringify(me)).toContain(ownerEmail);
    const [owners] = await db.query<mysql.RowDataPacket[]>(
      `SELECT m.role FROM ${LEGACY_DAYFORGE_TABLE("memberships")} m
       JOIN ${LEGACY_DAYFORGE_TABLE("user_credentials")} c ON c.tenantId = m.tenantId AND c.userOpenId = m.userOpenId
       WHERE m.tenantId = ?`,
      [tenantId]
    );
    expect(owners.map(row => row.role)).toEqual(["owner"]);

    await page.goto("/joystick-start");
    await expect(page.getByTestId("first-ten-workspace")).toHaveAttribute("data-owner", "ready", { timeout: 60_000 });
    await expect(page.getByTestId("first-ten-workspace-open")).toHaveAttribute("href", `${LEGACY_DAYFORGE_SIGN_IN_PAGE}?returnTo=%2Fonboarding`);
    await expect(page.getByTestId("first-ten-draft")).toHaveCount(0);
    const [ownersAgain] = await db.query<mysql.RowDataPacket[]>(
      `SELECT m.role FROM ${LEGACY_DAYFORGE_TABLE("memberships")} m WHERE m.tenantId = ?`,
      [tenantId]
    );
    expect(ownersAgain.map(row => row.role)).toEqual(["owner"]);
  } finally {
    for (const table of [...["entitlements", "subscriptions", "memberships", "user_credentials"].map(LEGACY_DAYFORGE_TABLE), "users"]) {
      await db.execute(`DELETE FROM ${table} WHERE tenantId = ?`, [tenantId]).catch(() => undefined);
    }
    await db.execute(`DELETE FROM ${LEGACY_DAYFORGE_TABLE("tenants")} WHERE id = ?`, [tenantId]).catch(() => undefined);
    await db.end();
  }
});
