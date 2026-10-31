import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FAKE, begin, connectOwn, toTheTable } from "./journey";

/**
 * The investor walkthrough, end to end against the real server: a new customer's first ten minutes with their own
 * Gmail (the local stand-in), the first message sent from inside JOYSTICK, their workspace provisioned (the Stripe
 * webhook's result seeded in the local database: Stripe isn't reachable here), a password, and the workspace they
 * come back to: Claire Desk knows what the crew learned, where that first message stands, who they're waiting to hear
 * back from, and prepares a follow-up they approve, sent once from their own Gmail.
 */
const databaseUrl = process.env.E2E_DATABASE_URL ?? "";
// The signup tables, entitlement and sign-in keep their historical names (docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md).
const LEGACY_DAYFORGE_TABLE = (name: string) => `dayforge_saas_${name}`; // legacy table prefix
const LEGACY_DAYFORGE_WORKSPACE_ENTITLEMENT = "dayforge_core"; // legacy entitlement key

async function shot(page: Page, name: string, project: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${project}-walkthrough-${name}.png`, fullPage: true });
}

async function apiSends(request: APIRequestContext) {
  return ((await (await request.get(`${FAKE}/__api-sends`)).json()) as { sends: Array<{ to: string; subject: string; body: string }> }).sends;
}

test("a new customer: onboarding, the first message, a paid workspace, and coming back to a Claire who knows", async ({ page, request, context }, testInfo) => {
  test.setTimeout(420_000);
  expect(databaseUrl, "E2E_DATABASE_URL (scripts/first-ten-e2e.sh)").toMatch(/127\.0\.0\.1|localhost/);
  const project = testInfo.project.name;

  // 1. the first ten minutes, with her own Gmail: the crew reads, the portrait, the courtyard, the table
  await begin(page, request);
  await connectOwn(page, request);
  await toTheTable(page);
  await shot(page, "01-the-table", project);

  // 2. the first message leaves from inside JOYSTICK, once Google allows sending
  await page.getByTestId("first-ten-allow-send").click();
  await expect(page.getByTestId("first-ten-send-start")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("first-ten-send-start").click();
  await page.getByTestId("first-ten-send-now").click();
  await expect(page.getByTestId("first-ten-send-status")).toContainText("Sent from your Gmail at", { timeout: 30_000 });
  expect(await apiSends(request)).toHaveLength(1);
  await shot(page, "02-sent", project);

  // 3. checkout (Stripe's webhook result, seeded), then her password at the table: signed in to her own workspace
  const credentials = await page.evaluate(() => JSON.parse(localStorage.getItem("joystick_first_ten_credentials") ?? sessionStorage.getItem("joystick_first_ten_credentials") ?? "null"));
  const tenantId = `df_${randomBytes(12).toString("hex")}`;
  const ownerEmail = `nina-${tenantId.slice(3, 11)}@wildrootflowers.example`;
  const db = await mysql.createConnection(databaseUrl);
  try {
    await db.execute(
      `INSERT INTO ${LEGACY_DAYFORGE_TABLE("tenants")} (id,slug,businessName,brandName,primaryColor,contactName,contactEmail,timeZone,status) VALUES (?,?,?,?,?,?,?,?, 'active')`,
      [tenantId, tenantId, "Wildroot Flowers", "Wildroot Flowers", "#111111", "Nina Vale", ownerEmail, "America/Los_Angeles"]
    );
    await db.execute(
      `INSERT INTO ${LEGACY_DAYFORGE_TABLE("subscriptions")} (tenantId,planKey,stripeCustomerId,stripeSubscriptionId,status,currentPeriodEnd,lastStripeEventId,lastStripeEventCreatedAt)
       VALUES (?, 'joystick-growth-standard', ?, ?, 'active', DATE_ADD(NOW(), INTERVAL 30 DAY), ?, NOW())`,
      [tenantId, `cus_e2e_${tenantId}`, `sub_e2e_${tenantId}`, `evt_e2e_${tenantId}`]
    );
    await db.execute(`INSERT INTO ${LEGACY_DAYFORGE_TABLE("entitlements")} (tenantId,entitlementKey,source,enabled) VALUES (?, ?, 'plan', true)`, [tenantId, LEGACY_DAYFORGE_WORKSPACE_ENTITLEMENT]);
    await db.execute(
      `UPDATE ${LEGACY_DAYFORGE_TABLE("onboarding_sessions")}
       SET tenantId = ?, status = 'provisioned', currentStep = 'owner_activation', businessName = 'Wildroot Flowers', ownerEmail = ?,
           configurationJson = JSON_OBJECT('kind', 'first_ten', 'businessName', 'Wildroot Flowers', 'contactName', 'Nina Vale', 'contactEmail', ?, 'timeZone', 'America/Los_Angeles')
       WHERE id = ?`,
      [tenantId, ownerEmail, ownerEmail, credentials.sessionId]
    );
    await page.reload();
    const key = page.getByTestId("first-ten-workspace");
    await expect(key).toHaveAttribute("data-owner", "needs_password", { timeout: 60_000 });
    await key.getByLabel("Password").fill("a long first-ten password");
    await page.getByTestId("first-ten-workspace-create").click();
    await page.waitForURL(url => new URL(url).pathname === "/onboarding", { timeout: 60_000 });
    await shot(page, "03-signed-in", project);

    // days later: she'd written to Teo five days ago and he hasn't answered
    await request.post(`${FAKE}/__send-from-gmail`, {
      data: { to: "teo@marsh.example", toName: "Teo Marsh", subject: "Standing order", body: "Shall I keep the Friday order going?", daysAgo: 5, threadId: "t-teo" },
    });

    // 4. she comes back: Claire Desk knows what the crew learned and where that first message stands
    await page.goto("/claire");
    const signup = page.getByTestId("claire-desk-signup");
    await expect(signup).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("claire-desk-signup-message")).toHaveText("Your note to Elena Ruiz went today; I haven't seen a reply.");
    await expect(page.getByTestId("claire-desk-signup-opportunity")).toContainText("Elena Ruiz asked about");
    await page.getByTestId("claire-desk-signup-facts").locator("summary").click();
    await expect(page.getByTestId("claire-desk-signup-facts").locator("li").first()).toBeVisible();
    await shot(page, "04-claire-knows", project);

    // 5. who she's waiting on, from her own Sent folder; a follow-up she approves goes once, from her Gmail
    const awaiting = page.getByTestId("claire-desk-awaiting");
    await expect(awaiting).toBeVisible({ timeout: 60_000 });
    const teo = awaiting.getByTestId("claire-desk-awaiting-item").filter({ hasText: "Teo Marsh" });
    await expect(teo).toContainText("5 days");
    await expect(teo).toContainText("you asked a question");
    await teo.getByTestId("claire-desk-follow-up-prepare").click();
    const body = teo.getByTestId("claire-desk-follow-up-body");
    await expect(body).toHaveValue(/^Hi Teo,\n\nFollowing up on my note from .+ about "Standing order"\. Did you have a chance to look\?\n$/);
    await body.fill("Hi Teo, shall I keep the Friday order going this month?");
    // Gmail's own compose window carries the words as edited, not the first draft
    const compose = new URL((await teo.getByTestId("claire-desk-follow-up-gmail").getAttribute("href")) ?? "");
    expect(compose.searchParams.get("body")).toBe("Hi Teo, shall I keep the Friday order going this month?");
    expect(compose.searchParams.get("to")).toBe("teo@marsh.example");
    await shot(page, "05-follow-up-ready", project);
    await teo.getByTestId("claire-desk-follow-up-send").click();
    await expect(teo.getByTestId("claire-desk-follow-up-outcome")).toContainText("Sent from your Gmail at", { timeout: 30_000 });
    const sends = await apiSends(request);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toMatchObject({ to: '"Teo Marsh" <teo@marsh.example>', subject: "Re: Standing order", body: "Hi Teo, shall I keep the Friday order going this month?" });
    await shot(page, "06-follow-up-sent", project);

    // nothing in the account crossed into anyone else's: the knowledge is this tenant's own
    const [journeys] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM first_ten_journeys WHERE tenant_id = ?", [tenantId]);
    expect(journeys[0].n).toBe(1);
    expect((await context.cookies()).length).toBeGreaterThan(0);
  } finally {
    for (const table of [...["entitlements", "subscriptions", "memberships", "user_credentials"].map(LEGACY_DAYFORGE_TABLE), "users"]) {
      await db.execute(`DELETE FROM ${table} WHERE tenantId = ?`, [tenantId]).catch(() => undefined);
    }
    await db.execute(`DELETE FROM ${LEGACY_DAYFORGE_TABLE("tenants")} WHERE id = ?`, [tenantId]).catch(() => undefined);
    await db.end();
  }
});
