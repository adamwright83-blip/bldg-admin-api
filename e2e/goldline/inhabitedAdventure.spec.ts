import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

// Four complete traversal/mount cycles plus lazy archetype chunks can exceed
// Playwright's 30s default on a cold single-worker release server.
test.describe.configure({ timeout: 90_000 });

async function login(page: Page, fixture: string) {
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

async function moveForwardUntil(page: Page, action: string) {
  const actionButton = page
    .locator(".context-actions button")
    .filter({ hasText: action });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await actionButton.isVisible().catch(() => false)) return;
    const box = await page.getByTestId("goldline-joystick").boundingBox();
    if (!box) throw new Error("Goldline joystick is unavailable");
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
  }
  await expect(actionButton).toBeVisible();
}

async function reachHumanScene(page: Page) {
  for (const action of ["JUMP", "CLIMB", "VAULT"] as const) {
    await moveForwardUntil(page, action);
    await page
      .locator(".context-actions button")
      .filter({ hasText: action })
      .click();
  }
  await moveForwardUntil(page, "INTERACT");
  await expect(page.getByTestId("goldline-world")).toHaveAttribute(
    "data-mission-spatial-state",
    "engage"
  );
  await page
    .locator(".context-actions button")
    .filter({ hasText: "INTERACT" })
    .click();
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
    // This single proof intentionally performs four authenticated world boots.
    // With the CI MySQL service active those logins are substantially slower
    // than the local synthetic-auth fallback, while every individual readiness
    // assertion still succeeds. Keep the normal 90s suite budget elsewhere.
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
