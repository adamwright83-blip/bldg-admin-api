/**
 * Fast Goldline Smoke.
 *
 * The inner whole-system gate: the handful of things that, if broken, mean
 * nothing else is worth running. Kept to a couple of minutes so it can be run
 * on every change, unlike the full mobile regression.
 *
 * It deliberately covers the seams this program introduced *and* the entry law
 * recovered in #107, because those are the two places a regression would be
 * most expensive and least obvious.
 */

import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

async function signIn(page: Page, role: "driver" | "admin") {
  const response = await page.request.post("/api/auth/login", {
    data: { password: role === "driver" ? DRIVER_PASSWORD : ADMIN_PASSWORD, role },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("Goldline smoke — the world opens, thinks and plays", () => {
  test("a fresh driver session opens directly into Overland", async ({ page }) => {
    await signIn(page, "driver");
    await page.addInitScript(() => {
      window.localStorage.setItem("goldline:day1:dismissed", "1");
      window.localStorage.setItem(
        "goldline:onboarding:v1",
        JSON.stringify(["first_entry_explained"])
      );
    });
    await page.goto("/driver");

    // The law recovered in #107: you are already in the world.
    await expect(
      page.getByRole("region", { name: "Goldline global overworld" })
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("goldline-shell")).toHaveCount(0);
  });

  test("the day briefing opens over the world and returns to it", async ({ page }) => {
    await signIn(page, "driver");
    await page.addInitScript(() => {
      window.localStorage.setItem("goldline:day1:dismissed", "1");
      window.localStorage.setItem(
        "goldline:onboarding:v1",
        JSON.stringify(["first_entry_explained"])
      );
    });
    await page.goto("/driver");
    const world = page.getByRole("region", { name: "Goldline global overworld" });
    await expect(world).toBeVisible({ timeout: 30_000 });

    const open = page.getByRole("button", { name: /READ TODAY'S BRIEFING/i });
    if ((await open.count()) === 0) test.skip(true, "No objectives today in this fixture");
    await open.first().click();

    const briefing = page.getByRole("dialog", { name: "Today's briefing" });
    await expect(briefing).toBeVisible({ timeout: 15_000 });
    // The world is never torn down to show the day.
    await expect(world).toBeVisible();

    await page.getByRole("button", { name: /CLOSE BRIEFING/i }).click();
    await expect(briefing).toHaveCount(0);
    await expect(world).toBeVisible();
  });

  test("Lantern City mounts, and the HUD is never inside the camera", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });

    // Controls are interface, not world: they must sit outside the transform,
    // or a pan drags them and an explosion shakes them. True on every device.
    const controlsInside = await page.evaluate(() => {
      const space = document.querySelector(".cr-world-space");
      const controls = document.querySelector(".cr-world-camera-controls");
      return Boolean(space && controls && space.contains(controls));
    });
    expect(controlsInside).toBe(false);
  });

  test("the camera pans and zooms the world", async ({ page }, testInfo) => {
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });
    const space = page.locator(".cr-world-space");
    const before = await space.getAttribute("style");

    if (testInfo.project.name === "mobile") {
      // Touch owns the gesture here; a wheel does not exist on this device.
      const box = (await page.locator(".cr-world-camera").boundingBox())!;
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await page.evaluate(() => {
        const host = document.querySelector(".cr-world-camera")!;
        const send = (type: string, x: number, y: number) =>
          host.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 1,
              pointerType: "touch",
              clientX: x,
              clientY: y,
              bubbles: true,
              cancelable: true,
              button: 0,
            })
          );
        // Zoom in first: at rest the whole scene fits and the view is pinned.
        host.dispatchEvent(
          new WheelEvent("wheel", { deltaY: -500, clientX: 190, clientY: 300, bubbles: true, cancelable: true })
        );
        send("pointerdown", 190, 300);
        for (let step = 1; step <= 8; step += 1) send("pointermove", 190 - step * 9, 300 - step * 6);
        send("pointerup", 118, 252);
      });
    } else {
      await page.mouse.move(700, 420);
      await page.mouse.wheel(0, -500);
      await page.waitForTimeout(300);
      await page.mouse.down();
      for (let step = 1; step <= 8; step += 1) {
        await page.mouse.move(700 - step * 12, 420 - step * 7);
      }
      await page.mouse.up();
    }

    await page.waitForTimeout(700);
    expect(await space.getAttribute("style")).not.toBe(before);
  });

  test("firing a tower damages it, rebuilds it, and changes nothing real", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });

    const building = page.locator(".lc-pursued-building").first();
    if ((await building.count()) === 0) test.skip(true, "No pursued building in this fixture");
    await expect(building).toBeVisible();

    const truthBefore = await page.evaluate(async () =>
      (await fetch("/api/trpc/system.goldlineWorld.cityEntities", { credentials: "include" })).text()
    );

    const peak = await page.evaluate(async () => {
      const shooter = document.querySelector(".lc-pursued-building")!;
      shooter.dispatchEvent(
        new PointerEvent("pointerdown", {
          altKey: true,
          bubbles: true,
          cancelable: true,
          pointerId: 7,
          button: 0,
        })
      );
      let damage = 0;
      let debris = 0;
      for (let frame = 0; frame < 18; frame += 1) {
        await new Promise(resolve => setTimeout(resolve, 170));
        for (const node of Array.from(document.querySelectorAll(".lc-arcade"))) {
          const layer = node.querySelector<HTMLElement>(".lc-arcade-damage");
          damage = Math.max(damage, parseFloat(layer?.style.opacity || "0"));
          debris = Math.max(debris, node.querySelectorAll(".lc-arcade-debris i").length);
        }
      }
      return { damage, debris };
    });

    // Visible, legible damage — not a flash.
    expect(peak.damage).toBeGreaterThan(0);
    expect(peak.debris).toBeGreaterThan(0);

    const healed = await page.evaluate(async () => {
      for (let frame = 0; frame < 55; frame += 1) {
        await new Promise(resolve => setTimeout(resolve, 140));
      }
      return Array.from(document.querySelectorAll(".lc-arcade")).every(node => {
        const layer = node.querySelector<HTMLElement>(".lc-arcade-damage");
        return parseFloat(layer?.style.opacity || "0") === 0;
      });
    });
    expect(healed).toBe(true);

    const truthAfter = await page.evaluate(async () =>
      (await fetch("/api/trpc/system.goldlineWorld.cityEntities", { credentials: "include" })).text()
    );
    // The whole point: the toy cannot write to the save file.
    expect(truthAfter).toBe(truthBefore);
  });

  test("an unfinished promise is worn by the building and survives combat", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });

    const tether = page.locator(".lc-tether").first();
    if ((await tether.count()) === 0) test.skip(true, "No outstanding promise in this fixture");

    // Never colour alone: the restraint says what it means.
    const label = await tether.getAttribute("aria-label");
    expect(label).toMatch(/promise/i);

    await page.evaluate(async () => {
      const shooter = document.querySelector(".lc-pursued-building");
      shooter?.dispatchEvent(
        new PointerEvent("pointerdown", {
          altKey: true,
          bubbles: true,
          cancelable: true,
          pointerId: 8,
          button: 0,
        })
      );
      await new Promise(resolve => setTimeout(resolve, 2500));
    });

    await expect(page.locator(".lc-tether").first()).toBeAttached();
  });
});
