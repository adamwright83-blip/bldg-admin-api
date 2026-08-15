import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

// Four complete traversal/mount cycles plus lazy archetype chunks can exceed
// Playwright's 30s default on a cold single-worker release server.
test.describe.configure({ timeout: 90_000 });

async function login(page: Page, fixture: string) {
  // First-entry explainer only shows once per player identity (see
  // onboardingProgress.ts) and would otherwise intercept pointer events
  // for every test that doesn't care about it.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "goldline:onboarding:v1",
      JSON.stringify(["first_entry_explained"])
    );
  });
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/driver?goldlineFixture=${fixture}`);
  await expect(page.getByTestId("goldline-world")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("canvas.goldline-game-canvas")).toHaveCount(1);
}

async function pulseForward(page: Page, ms = 140) {
  const box = await page.getByTestId("goldline-joystick").boundingBox();
  if (!box) throw new Error("Goldline joystick is unavailable");
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(70);
}

async function reachHumanScene(page: Page) {
  // JUMP/CLIMB/VAULT were removed as unsupported traversal gates. Approach
  // the real mission anchor with short, released joystick pulses instead of
  // a long hold. The former helper could see INTERACT for one animation frame
  // and then let avatar momentum carry past the staging radius before the
  // click, producing the detached-element/hidden-state flake seen in CI.
  const world = page.getByTestId("goldline-world");
  const interactButton = page
    .locator(".context-actions button")
    .filter({ hasText: "INTERACT" });

  for (let attempt = 0; attempt < 90; attempt += 1) {
    const state = await world.getAttribute("data-mission-spatial-state");
    if (state === "engage" && (await interactButton.isVisible().catch(() => false))) {
      // Joystick is already released. Require the state to remain stable for
      // a beat before clicking so this proves a real reachable engage zone,
      // not a transient overshoot frame.
      await page.waitForTimeout(180);
      if (
        (await world.getAttribute("data-mission-spatial-state")) === "engage" &&
        (await interactButton.isVisible().catch(() => false))
      ) {
        await interactButton.click({ timeout: 10_000 });
        return;
      }
    }
    await pulseForward(page);
  }

  await expect(world).toHaveAttribute("data-mission-spatial-state", "engage");
  await expect(interactButton).toBeVisible();
  await interactButton.click();
}

test.describe("inhabited world truth boundary", () => {
  test("six ambient figures coexist with exactly one authoritative mission embodiment", async ({
    page,
  }) => {
    await login(page, "CALL");
    const world = page.getByTestId("goldline-world");
    await expect(world).toHaveAttribute("data-ambient-population-count", "6");
    await expect(world).toHaveAttribute(
      "data-population-asset-stage",
      "production"
    );
    await expect(world).toHaveAttribute("data-mission-embodiment-id", "7801");
    await expect(world).toHaveAttribute("data-corridor-id", "corridor_01");
    await expect(world).toHaveAttribute("data-next-corridor-id", "corridor_02");
  });

  test("CI preview seam can still boot C02 directly for deterministic review", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "goldline:onboarding:v1",
        JSON.stringify(["first_entry_explained"])
      );
    });
    const response = await page.request.post("/api/auth/login", {
      data: { password: DRIVER_PASSWORD, role: "driver" },
    });
    expect(response.ok()).toBeTruthy();
    await page.goto(
      "/driver?goldlineFixture=CALL&goldlineCorridorPreview=corridor_02"
    );
    const world = page.getByTestId("goldline-world");
    await expect(world).toBeVisible({ timeout: 30_000 });
    await expect(world).toHaveAttribute("data-corridor-id", "corridor_02");
    await expect(world).toHaveAttribute(
      "data-population-asset-stage",
      "production"
    );
    await expect(world).toHaveAttribute("data-ambient-population-count", "6");
    await expect(page.locator("canvas.goldline-game-canvas")).toHaveCount(1);
  });

  test("Anchor, Gatekeeper, Ghost, and Staller use human behavioral staging", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fixtures = [
      ["CALL", ".anchor-encounter"],
      ["VISIT", ".gatekeeper-encounter"],
      ["FOLLOW_UP", ".ghost-encounter"],
      ["STALLER", ".staller-encounter"],
    ] as const;

    for (const [fixture, selector] of fixtures) {
      await login(page, fixture);
      await reachHumanScene(page);
      await expect(page.locator(selector)).toBeVisible();
      await expect(page.locator("canvas.goldline-game-canvas")).toHaveCount(1);
    }
  });

  test("reduced motion preserves the mission signal and physical action", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await login(page, "VISIT");
    await reachHumanScene(page);
    await expect(page.locator(".gatekeeper-encounter")).toBeVisible();
  });
});
