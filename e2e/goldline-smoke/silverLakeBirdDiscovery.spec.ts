import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

test.describe.configure({ mode: "serial" });

test.describe("Silver Lake Bird's-Eye Discovery Experience", () => {
  test.beforeAll(async ({ request }) => {
    await resetGoldlineProofWorld(request);
  });

  test.beforeEach(async ({ page }) => {
    const login = await page.request.post("/api/auth/login", {
      data: { password: ADMIN_PASSWORD, role: "admin" },
    });
    expect(login.status()).toBe(200);
  });

  test("reveals warm amber lantern and golden messenger bird in Lantern City", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));

    await page.goto("/growth/lantern-city?scene=v6");
    await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-scene-world]")).toBeVisible();

    // 1. Warm amber lantern with recovery opportunity
    const opportunity = page.locator('[data-testid="silver-lake-recovery-opportunity"]');
    await expect(opportunity).toBeVisible({ timeout: 10_000 });
    await expect(opportunity).toHaveAttribute("data-recovery-opportunity", "true");

    // 2. Golden messenger bird host and asset
    const messenger = opportunity.locator('[data-testid="golden-messenger-bird"]');
    await expect(messenger).toBeVisible();
    const messengerImg = messenger.locator("img");
    await expect(messengerImg).toHaveAttribute(
      "src",
      "/assets/lantern-villager-outreach/golden-messenger.png"
    );

    // 3. No obstructive popups, modals, or dialogs on initial opening
    await expect(page.locator("dialog")).not.toBeVisible();

    const artifactDir =
      "/Users/adamwrightpfi/.gemini/antigravity/brain/4225332e-ba0b-4c4e-a6da-8387ff1eea60";
    if (page.viewportSize()?.width === 1440) {
      await page.screenshot({
        path: `${artifactDir}/lantern_city_discovery_bird_eye.png`,
      });
    }

    // 4. On hover or focus, contextual invitation pill is revealed
    const invitationPill = opportunity.locator('[data-testid="recovery-invitation-pill"]');
    await expect(invitationPill).toContainText("Silver Lake — A neighbor to reconnect with.");

    await opportunity.hover();
    await expect(invitationPill).toBeVisible();

    if (page.viewportSize()?.width === 1440) {
      await page.screenshot({
        path: `${artifactDir}/lantern_city_discovery_invitation_hover.png`,
      });
    }

    // 5. One tap goes straight into the walkable 3D Silver Lake, without administrative routing
    await opportunity.click();

    await expect(page.locator('[data-testid="silver-lake-3d"]')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/cozy=1/);
    await expect(page).toHaveURL(/territory=silver-lake/);
    // the archived 2D encounter never appears
    await expect(page.locator('[data-testid="cozy-neighborhood-encounter"]')).toHaveCount(0);

    // Allow encounter transition to fully settle
    await page.waitForTimeout(600);

    if (page.viewportSize()?.width === 1440) {
      await page.screenshot({
        path: `${artifactDir}/lantern_city_discovery_one_tap_encounter.png`,
      });
    }

    // Avoided Tower Wars or administrative TerritoryRoom dialog
    await expect(page.locator("dialog")).not.toBeVisible();

    expect(errors).toEqual([]);
  });

  test("respects prefers-reduced-motion for bird entrance and breathing animations", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/growth/lantern-city?scene=v6");
    await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible({ timeout: 10_000 });

    const opportunity = page.locator('[data-testid="silver-lake-recovery-opportunity"]');
    await expect(opportunity).toBeVisible({ timeout: 10_000 });

    const messenger = opportunity.locator('[data-testid="golden-messenger-bird"]');
    await expect(messenger).toBeVisible();

    // In reduced motion, animation is none !important
    const animation = await messenger.evaluate(el => window.getComputedStyle(el).animationName);
    expect(animation === "none" || animation === "").toBe(true);
  });
});
