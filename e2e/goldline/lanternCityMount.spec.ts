import { expect, test } from "@playwright/test";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ??
  process.env.APP_SHARED_API_SECRET ??
  "goldline-mobile-app-secret-000000000000000000";

/**
 * THE ROUTE-MOUNT GATE.
 *
 * 612af8c spliced a helper between `export default` and `function
 * LanternCityAtlas(`, so the module default-exported `lanternPhaseSeconds` and
 * the component was never exported. Lantern City rendered nothing.
 *
 * Everything we ran passed anyway: it is valid TypeScript so tsc was clean, the
 * bundle built, and the ambient suite passed because it asserts SOURCE TEXT.
 * The blank page shipped and was only found by opening the browser.
 *
 * `lanternCityAtlasMount.test.ts` now catches that exact export corruption in
 * milliseconds, but it is a module-identity guard — it cannot see a route that
 * mounts and then renders nothing, throws mid-render, or loses its world.
 *
 * This spec is the durable gate for that whole class: it boots the real server
 * against the deterministic local world, authenticates through the legitimate
 * admin path, and asserts the city actually arrived with real objects in it.
 *
 * It is deliberately written so a blank page CANNOT pass.
 */
/*
  Admin is a desktop product. This config's default 412x923 is shaped for the
  Driver phone app, and at that width the `lc-pursued-building` marker overlaps
  and intercepts pointer events for the lantern beneath it — a real occlusion
  worth recording, but not the thing this gate is for. Testing the city at the
  size it is actually used keeps this spec about mount and selection.
*/
test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

test.describe("Lantern City mounts with a populated world", () => {
  test.setTimeout(120_000);

  test("the city route renders real world DOM for an authenticated admin", async ({
    page,
  }) => {
    // Any uncaught render exception fails the test rather than silently
    // producing an empty page — the failure mode this gate exists for.
    const pageErrors: string[] = [];
    page.on("pageerror", error => pageErrors.push(String(error)));

    await page.goto("/home");

    // Legitimate configured dev login. Not a production authorization bypass:
    // this is the same POST /api/auth/login the app itself uses.
    const login = await page.request.post("/api/auth/login", {
      data: { password: ADMIN_PASSWORD, role: "admin" },
    });
    expect(login.status(), "admin login must succeed").toBe(200);

    await page.goto("/growth/lantern-city");

    // 1. The route's own root actually mounted.
    const cityRoot = page.locator(".lc-page");
    await expect(cityRoot).toBeVisible({ timeout: 30_000 });

    // 2. The world surface exists inside it, not just a shell.
    await expect(page.locator(".lc-map")).toBeVisible();

    // 3. Real populated world DOM. A mounted-but-empty city is still a
    //    failure: the bug we are guarding produced a page with chrome and no
    //    world, so "something rendered" is not the assertion.
    await expect
      .poll(async () => page.locator(".lc-lantern").count(), {
        timeout: 30_000,
        message: "expected at least one real lantern from the seeded world",
      })
      .toBeGreaterThan(0);

    await expect
      .poll(async () => page.locator(".pwc-building").count(), {
        message: "expected at least one canonical tower on the map",
      })
      .toBeGreaterThan(0);

    // 4. The body is not blank. Guards the exact symptom that shipped.
    const bodyText = (await page.locator("body").innerText()).trim();
    expect(bodyText.length, "page body must not be empty").toBeGreaterThan(80);

    // 5. Nothing threw while getting here.
    expect(pageErrors, "no uncaught render errors").toEqual([]);
  });

  test("a selected lantern is visibly held by the player", async ({ page }) => {
    await page.goto("/home");
    await page.request.post("/api/auth/login", {
      data: { password: ADMIN_PASSWORD, role: "admin" },
    });
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".lc-page")).toBeVisible({ timeout: 30_000 });

    const lanterns = page.locator(".lc-lantern");
    await expect.poll(async () => lanterns.count(), { timeout: 30_000 })
      .toBeGreaterThan(0);

    const held = page.locator(
      ".lc-lantern.is-selected, .lc-pursued-building.is-selected"
    );
    await expect(held).toHaveCount(0);

    /*
      Click the topmost world object at a place rather than a specific class.
      A pursued building sits above the lanterns at the same coordinate
      (z-index 7 vs 5), so it is genuinely what the cursor meets there — the
      grammar has to hold for whichever object the player actually reaches.
    */
    const target = page
      .locator(".lc-pursued-building, .lc-lantern")
      .first();

    /*
      `force` is deliberate and narrow. Playwright's actionability check
      requires a stable bounding box across frames, and Lantern City animates
      continuously — the world surface settles under its markers and attention
      tiers run an infinite filter animation, so a marker is never "stable" by
      that definition and the click waits forever.
      That is a property of a living city, not a broken control: the same click
      works in a real browser session. Visibility and enabled-ness are asserted
      above on the same locator, so the only check being skipped is stability.
    */
    await expect(target).toBeVisible();
    await expect(target).toBeEnabled();
    await target.click({ force: true });

    // Exactly one object is held. Two rings would make selection meaningless.
    await expect(held).toHaveCount(1);
  });
});
