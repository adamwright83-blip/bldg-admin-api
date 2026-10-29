/* LEGACY DAYFORGE COMPATIBILITY: disposable historical SQL names only; current product is JOYSTICK. */
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { cleanupOwner, database, login, provisionOwner } from "../real/helpers";
import { createDaphneGoal } from "../../server/agents/daphne/goalsPreferences";
import { resolveCanonicalOperatorIdentity } from "../../server/agents/persistentOperator/identity";

const SHOTS = "artifacts/claire-strategy/acceptance/browser/desk-withhold";

test("Claire Desk withholds the call sheet when the CleanCloud import failed", async ({ browser }) => {
  const owner = await provisionOwner("Claire desk withhold");
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4187" });
  const db = await database();
  await mkdir(SHOTS, { recursive: true });
  try {
    const resolved = await resolveCanonicalOperatorIdentity({
      tenantId: owner.tenantId,
      source: { type: "open_id", value: owner.openId },
      subsystem: "acceptance.fixture",
    });
    if (!resolved.ok) throw new Error("Fixture owner unavailable");
    await createDaphneGoal({
      tenantId: owner.tenantId,
      canonicalOperatorId: resolved.identity.canonicalOperatorId,
      goalKey: "silver-lake-win-back",
      horizon: "current",
      statement: "Win back lapsed customers in Silver Lake",
      sourceObservationId: `obs-${randomUUID().replaceAll("-", "").slice(0, 12)}`,
    });
    await db.execute(
      "INSERT INTO cleancloud_browser_sync_bindings (tenantId,id,storeId,storeLabel,createdBy,lastSuccessAt) VALUES (?,?,?,?,?,NULL)",
      [owner.tenantId, randomUUID(), "fixture-store", "Fixture store", "acceptance"]
    );
    await db.execute(
      "INSERT INTO cleancloud_browser_sync_attempts (id,tenantId,outcome,message,rangeFrom,rangeTo,rowCount) VALUES (?,?,?,?,?,?,?)",
      [randomUUID(), owner.tenantId, "failed", "Disposable fixture import failed", "2026-10-01", "2026-10-14", 0]
    );

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await login(page, owner);
    await page.goto("/claire?desk=open", { waitUntil: "domcontentloaded" });

    const gate = page.getByRole("button", { name: "Sign in", exact: true });
    if (await gate.isVisible().catch(() => false)) {
      throw new Error("Admin password gate blocked /claire after the acceptance owner login");
    }

    const withheld = page.getByTestId("claire-desk-call-sheet-withheld");
    await expect(withheld).toBeVisible();
    await expect(withheld).toContainText("Call sheet withheld");
    await expect(withheld).toContainText("import_failed");
    await expect(withheld).not.toContainText(/zero dormant/i);
    await expect(withheld).not.toContainText(/0 dormant/i);
    await expect(withheld).not.toContainText(/no dormant customers/i);
    await expect(withheld).not.toContainText(/no lapsed/i);
    await expect(page.getByTestId("claire-desk-call-sheet")).toHaveCount(0);
    const text = await withheld.innerText();
    expect(text).not.toMatch(/\b0\b/);
    await page.screenshot({ path: `${SHOTS}/1-withheld.png`, fullPage: true });
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await cleanupOwner(owner).catch(() => undefined);
    await db.end();
  }
});
