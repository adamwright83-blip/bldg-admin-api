import { expect, test } from "@playwright/test";

/**
 * Boss demo presentational smoke test. This complements
 * dayforgeBossDemoAcceptance.integration.test.ts, which asserts business
 * logic; this spec only asserts that the presentational surfaces of the
 * journey render without crashing across desktop and mobile viewports.
 *
 * Several of these routes require an authenticated session
 * (admin or driver). Without seeding a session, they render their sign-in
 * gate instead of live data — that gate rendering cleanly (rather than a
 * blank page, a 404, or a console error) is itself the smoke assertion for
 * those routes.
 */

function trackConsoleErrors(page: import("@playwright/test").Page) {
  const consoleErrors: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", error => consoleErrors.push(error.message));
  return consoleErrors;
}

test.describe("Boss demo journey — desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("landing through territory preview, mission trigger, and admin surfaces render", async ({
    page,
  }) => {
    const consoleErrors = trackConsoleErrors(page);

    // ---- landing ----
    await page.goto("/boreslay");
    await expect(page.locator("body")).toBeVisible();

    // ---- territory-preview loads ----
    // Submitting a scan is rate-limited (server/territory/territoryRateLimit.ts,
    // 5/hour/key) and is already exercised end-to-end by
    // e2e/dayforge/territoryPreview.spec.ts; duplicating a real submission here
    // shares that same budget within one CI job and starves the other spec.
    // This spec only proves the page itself renders across viewports.
    await page.goto("/territory-preview?utm_source=boss_demo&utm_content=desktop");
    await expect(page.getByTestId("dayforge-territory-preview")).toBeVisible();
    await expect(page.getByLabel(/store address or business name/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /map my territory/i })).toBeVisible();

    // ---- boreslay-rally page loads ----
    await page.goto("/boreslay-rally");
    await expect(page.locator("body")).toBeVisible();

    // ---- commercial-proposal page loads (unauthenticated -> print shell) ----
    await page.goto("/commercial-proposal/1");
    await expect(page.locator("body")).toBeVisible();

    // ---- commercial-pipeline page loads (unauthenticated -> admin sign-in gate) ----
    await page.goto("/commercial-pipeline");
    await expect(
      page.getByRole("heading", { name: /admin sign in/i })
    ).toBeVisible({ timeout: 15_000 });

    // ---- churn-radar page loads (unauthenticated -> admin sign-in gate) ----
    await page.goto("/churn-radar");
    await expect(
      page.getByRole("heading", { name: /admin sign in/i })
    ).toBeVisible({ timeout: 15_000 });

    // ---- /julydemo is the canonical boss-demo control route; /dayforge-demo
    // redirects to it for backward compatibility ----
    await page.goto("/dayforge-demo");
    await page.waitForURL(/\/julydemo$/, { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: /admin sign in/i })
    ).toBeVisible({ timeout: 15_000 });

    expect(consoleErrors).toEqual([]);
  });
});

test.describe("Boss demo journey — mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("landing, territory preview, and driver sales-mission page render on a mobile viewport", async ({
    page,
  }) => {
    const consoleErrors = trackConsoleErrors(page);

    // ---- landing ----
    await page.goto("/boreslay");
    await expect(page.locator("body")).toBeVisible();

    // ---- territory-preview loads (see desktop test above for why this
    // doesn't also submit a scan) ----
    await page.goto("/territory-preview?utm_source=boss_demo&utm_content=mobile");
    await expect(page.getByTestId("dayforge-territory-preview")).toBeVisible();
    await expect(page.getByLabel(/store address or business name/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /map my territory/i })).toBeVisible();

    // ---- driver/sales-mission page loads on mobile viewport ----
    await page.goto("/driver/sales-mission/1");
    await expect(
      page.getByRole("heading", { name: /driver sign in/i })
    ).toBeVisible({ timeout: 15_000 });

    expect(consoleErrors).toEqual([]);
  });
});
