import { expect, test, type Page } from "@playwright/test";

/**
 * Extends the existing Pixel-class mobile gate (pixel9Layout.spec.ts) to cover
 * the expandable-world runtime: manifest-driven corridor loading, corridor
 * transitions, physical encounter staging, and Pixi lifecycle hygiene across
 * repeated mounts.
 *
 * The historical regression this suite continues to guard — a desktop 430px
 * preview constraint surviving into real mobile landscape and rendering
 * Goldline as a tiny centred rectangle — is asserted in pixel9Layout.spec.ts
 * and re-asserted here after corridor/encounter activity.
 */
const PORTRAIT = { width: 412, height: 923 };
const LANDSCAPE = { width: 923, height: 412 };
const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function login(page: Page, fixture?: "CALL") {
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith("goldline:checkpoint:v2:"))
      .forEach(key => window.localStorage.removeItem(key));
  });
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(fixture ? `/driver?goldlineFixture=${fixture}` : "/driver");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
}

async function assertWorldFills(
  page: Page,
  size: { width: number; height: number }
) {
  const [shell, world] = await Promise.all([
    page.getByTestId("goldline-shell").boundingBox(),
    page.getByTestId("goldline-world").boundingBox(),
  ]);
  expect(shell).not.toBeNull();
  expect(world).not.toBeNull();
  expect(world!.width).toBeGreaterThanOrEqual(size.width * 0.94);
  expect(world!.height).toBeGreaterThanOrEqual(size.height * 0.9);

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(2);
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

async function reachCorridorExit(page: Page) {
  for (const action of ["JUMP", "CLIMB", "VAULT"] as const) {
    await moveForwardUntil(page, action);
    await page
      .locator(".context-actions button")
      .filter({ hasText: action })
      .click();
  }
  const world = page.getByTestId("goldline-world");
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if ((await world.getAttribute("data-corridor-id")) === "corridor_02")
      return;
    const box = await page.getByTestId("goldline-joystick").boundingBox();
    if (!box) throw new Error("Goldline joystick is unavailable");
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
  }
}

test.describe("manifest-driven corridor runtime", () => {
  test("boots corridor_01 from its manifest and renders exactly one canvas", async ({
    page,
  }) => {
    await login(page);
    await page.waitForTimeout(1500);

    const canvasCount = await page
      .locator("canvas.goldline-game-canvas")
      .count();
    expect(canvasCount).toBe(1);
  });

  test("requests corridor_01's manifest — the world is addressed by id, not by asset URL", async ({
    page,
  }) => {
    const manifestRequests: string[] = [];
    page.on("request", request => {
      if (
        request.url().includes("/assets/goldline/") &&
        request.url().endsWith("manifest.json")
      ) {
        manifestRequests.push(request.url());
      }
    });

    await login(page);
    await page.waitForTimeout(1500);

    expect(
      manifestRequests.some(url => url.includes("corridor_01/manifest.json"))
    ).toBe(true);
  });

  test("does NOT preload every corridor at boot", async ({ page }) => {
    const corridorRequests: string[] = [];
    page.on("request", request => {
      const url = request.url();
      if (url.includes("/assets/goldline/corridor_"))
        corridorRequests.push(url);
    });

    await login(page);
    await page.waitForTimeout(2000);

    // corridor_02 is playable, but the runtime still loads exactly one world
    // at boot and waits for physical exit proximity before fetching the next.
    expect(corridorRequests.some(url => url.includes("corridor_02"))).toBe(
      false
    );
    const distinctCorridors = new Set(
      corridorRequests
        .map(url => /corridor_(\d+)/.exec(url)?.[1])
        .filter((id): id is string => Boolean(id))
    );
    expect(distinctCorridors.size).toBeLessThanOrEqual(1);
  });

  test("never blanks the canvas while the world is live", async ({ page }) => {
    await login(page);
    await page.waitForTimeout(1500);

    // The canvas element must remain mounted continuously — a transition that
    // unmounts it would read to the player as a black flash.
    for (let sample = 0; sample < 5; sample += 1) {
      expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
      await page.waitForTimeout(200);
    }
  });

  test("transitions from C01 to C02 through the real runtime without replacing the canvas", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const corridorTwoRequests: string[] = [];
    page.on("request", request => {
      if (request.url().includes("/assets/goldline/corridor_02/")) {
        corridorTwoRequests.push(request.url());
      }
    });
    await login(page, "CALL");
    const world = page.getByTestId("goldline-world");
    await expect(world).toHaveAttribute("data-corridor-id", "corridor_01");
    const canvas = page.locator("canvas.goldline-game-canvas");
    await canvas.evaluate(node =>
      node.setAttribute("data-transition-sentinel", "same-canvas")
    );

    await reachCorridorExit(page);

    await expect(world).toHaveAttribute("data-corridor-id", "corridor_02", {
      timeout: 30_000,
    });
    await expect(page.getByText("Loading world", { exact: false })).toHaveCount(
      0
    );
    await expect(page.getByText("Select level", { exact: false })).toHaveCount(
      0
    );
    await expect(world).toHaveAttribute(
      "data-corridor-transition-phase",
      "ready"
    );
    await expect(world).toHaveAttribute(
      "data-population-asset-stage",
      "production"
    );
    await expect(world).toHaveAttribute("data-ambient-population-count", "6");
    await expect(world).toHaveAttribute("data-mission-embodiment-id", /\d+/);
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toHaveAttribute(
      "data-transition-sentinel",
      "same-canvas"
    );
    expect(corridorTwoRequests.some(url => url.endsWith("manifest.json"))).toBe(
      true
    );
    expect(corridorTwoRequests.some(url => url.endsWith("mid.webp"))).toBe(
      true
    );

    const checkpoint = await page.evaluate(() => {
      const checkpointKey = Object.keys(window.localStorage).find(key =>
        key.startsWith("goldline:checkpoint:v2:")
      );
      const raw = checkpointKey
        ? window.localStorage.getItem(checkpointKey)
        : null;
      return raw ? JSON.parse(raw) : null;
    });
    expect(checkpoint).toMatchObject({
      corridorId: "corridor_02",
      progress: expect.any(Number),
      lateral: expect.any(Number),
      branch: expect.any(String),
      savedAt: expect.any(String),
    });
    expect(Object.keys(checkpoint).sort()).toEqual(
      ["branch", "corridorId", "lateral", "progress", "savedAt"].sort()
    );

    const box = await page.getByTestId("goldline-joystick").boundingBox();
    if (!box) throw new Error("Goldline joystick is unavailable after reveal");
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(350);
    await page.mouse.up();
    await expect
      .poll(async () =>
        Number(await world.getAttribute("data-player-progress"))
      )
      .toBeGreaterThan(0.06);
  });
});

test.describe("mobile viewport survives world activity", () => {
  test("world still fills the viewport after an orientation round-trip", async ({
    page,
  }) => {
    await login(page);

    await page.setViewportSize(PORTRAIT);
    await page.waitForTimeout(400);
    await assertWorldFills(page, PORTRAIT);

    await page.setViewportSize(LANDSCAPE);
    await page.waitForTimeout(400);
    await assertWorldFills(page, LANDSCAPE);

    await page.setViewportSize(PORTRAIT);
    await page.waitForTimeout(400);
    await assertWorldFills(page, PORTRAIT);
  });

  test("the Pixi renderer resizes with the viewport rather than keeping a stale backing size", async ({
    page,
  }) => {
    await login(page);
    await page.setViewportSize(PORTRAIT);
    await page.waitForTimeout(600);

    const portraitBox = await page
      .locator("canvas.goldline-game-canvas")
      .boundingBox();

    await page.setViewportSize(LANDSCAPE);
    await page.waitForTimeout(600);

    const landscapeBox = await page
      .locator("canvas.goldline-game-canvas")
      .boundingBox();

    expect(portraitBox).not.toBeNull();
    expect(landscapeBox).not.toBeNull();
    expect(landscapeBox!.width).toBeGreaterThan(portraitBox!.width);
    // The historical bug: a desktop-width cap surviving into mobile landscape.
    expect(landscapeBox!.width).toBeGreaterThan(430);
  });
});

test.describe("Pixi lifecycle stays clean across repeated mounts", () => {
  test("five navigations away and back leave exactly one renderer", async ({
    page,
  }) => {
    await login(page);
    await page.waitForTimeout(1200);

    for (let iteration = 0; iteration < 5; iteration += 1) {
      // Leave the Goldline route entirely, then return — the same teardown
      // path a real player triggers by navigating.
      await page.goto("/driver?view=away");
      await page.waitForTimeout(250);
      await page.goto("/driver");
      await expect(page.getByTestId("goldline-shell")).toBeVisible({
        timeout: 30_000,
      });
      await page.waitForTimeout(600);
    }

    // No accumulation: destroyed renderers must not leave their canvases behind.
    expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
    expect(await page.locator("canvas").count()).toBeLessThanOrEqual(2);
  });

  test("repeated mounts do not accumulate uncaught page errors", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));

    await login(page);
    for (let iteration = 0; iteration < 3; iteration += 1) {
      await page.goto("/driver?view=away");
      await page.waitForTimeout(200);
      await page.goto("/driver");
      await expect(page.getByTestId("goldline-shell")).toBeVisible({
        timeout: 30_000,
      });
      await page.waitForTimeout(400);
    }

    expect(errors).toEqual([]);
  });
});

test.describe("PWA scope stays driver-only", () => {
  test("manifest keeps /driver as start_url and scope", async ({ page }) => {
    await login(page);

    const manifestHref = await page.evaluate(() => {
      const link = document.querySelector<HTMLLinkElement>(
        'link[rel="manifest"]'
      );
      return link?.href ?? null;
    });
    expect(manifestHref).not.toBeNull();

    const response = await page.request.get(manifestHref!);
    expect(response.ok()).toBeTruthy();
    const manifest = (await response.json()) as {
      start_url?: string;
      scope?: string;
    };

    expect(manifest.start_url).toContain("/driver");
    expect(manifest.scope).toContain("/driver");
    // The admin surface must never be captured by the driver PWA.
    expect(manifest.scope).not.toBe("/");
  });
});
