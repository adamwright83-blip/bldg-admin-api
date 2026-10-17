/* LEGACY DAYFORGE COMPATIBILITY: disposable historical SQL names only; current product is JOYSTICK. */
import { test, expect } from "@playwright/test";
import { cleanupOwner, database, login, provisionOwner } from "../real/helpers";
import { resolveCanonicalOperatorIdentity } from "../../server/agents/persistentOperator/identity";

/**
 * The operator's own consent for Daphne's presentation comparisons, through the real
 * Claire Desk and server, read back from MySQL. Both choices start off; comparisons
 * need adaptation first; stopping adaptation stops comparisons.
 */
test("Claire Desk: Daphne presentation consent is off by default, separately affirmative, persisted and revocable", async ({ browser }) => {
  const owner = await provisionOwner("Daphne consent acceptance");
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:4187" });
  const db = await database();
  try {
    await db.execute("INSERT INTO dayforge_saas_entitlements (tenantId,entitlementKey,source,enabled) VALUES (?,'persistent_operator','manual',true)", [owner.tenantId]);
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId: owner.tenantId, source: { type: "open_id", value: owner.openId }, subsystem: "acceptance.fixture" });
    if (!resolved.ok) throw new Error("Fixture owner unavailable");
    const stored = async () => {
      const [rows]: any = await db.execute(
        "SELECT preferenceKey, valueJson, status FROM daphne_meta_preferences WHERE tenantId=? AND canonicalOperatorId=? AND preferenceKey IN ('adaptation_enabled','safe_experimentation') ORDER BY preferenceKey, version",
        [owner.tenantId, resolved.identity.canonicalOperatorId]
      );
      // The newest row per key is the current choice.
      const latest = new Map<string, boolean>();
      for (const row of rows) latest.set(row.preferenceKey, (typeof row.valueJson === "string" ? JSON.parse(row.valueJson) : row.valueJson) === true && row.status === "active");
      return Object.fromEntries(latest);
    };

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", e => pageErrors.push(e.message));
    await login(page, owner);
    await page.goto("/claire", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("daphne-presentation-consent");
    const adaptation = card.getByTestId("consent-adaptation");
    const experimentation = card.getByTestId("consent-experimentation");

    // Off by default, and comparisons cannot be allowed before adaptation.
    await expect(adaptation).toHaveAttribute("data-on", "false");
    await expect(experimentation).toHaveAttribute("data-on", "false");
    await expect(experimentation.getByTestId("consent-experimentation-allow")).toBeDisabled();
    await expect(experimentation).toContainText("Needs the choice above first.");
    expect(await stored()).toEqual({});

    await adaptation.getByTestId("consent-adaptation-allow").click();
    await expect(card.getByTestId("consent-result")).toContainText("Saved: Daphne may adapt how missions are shown.");
    await expect(adaptation).toHaveAttribute("data-on", "true");
    await expect(experimentation).toHaveAttribute("data-on", "false");
    expect(await stored()).toEqual({ adaptation_enabled: true });

    await experimentation.getByTestId("consent-experimentation-allow").click();
    await expect(card.getByTestId("consent-result")).toContainText("Saved: Daphne may compare presentation styles with you.");
    await expect(experimentation).toHaveAttribute("data-on", "true");
    // The acceptance server runs with GOLDLINE_BEHAVIORAL_MRT unset: the page says comparisons are paused.
    await expect(card.getByTestId("consent-experiments-paused")).toBeVisible();
    expect(await stored()).toEqual({ adaptation_enabled: true, safe_experimentation: true });

    // Survives a reload: the page shows what the server stored.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(experimentation).toHaveAttribute("data-on", "true");

    // Stopping adaptation stops comparisons too.
    await adaptation.getByTestId("consent-adaptation-stop").click();
    await expect(card.getByTestId("consent-result")).toContainText("comparisons are off");
    await expect(adaptation).toHaveAttribute("data-on", "false");
    await expect(experimentation).toHaveAttribute("data-on", "false");
    expect(await stored()).toEqual({ adaptation_enabled: false, safe_experimentation: false });

    await page.setViewportSize({ width: 375, height: 812 });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await cleanupOwner(owner).catch(() => undefined);
    await db.end();
  }
});
