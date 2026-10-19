import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

// Silver Lake now opens as the walkable 3D courtyard. These specs cover the painted encounter, which
// stays in the code dormant; they opt into it explicitly.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("goldline.silverLake.legacy", "1"));
});

test("Silver Lake handoff leaves Home and Driver on the same Day Line", async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  try {
  await resetGoldlineProofWorld(page.request);
  await page.addInitScript(() => {
    window.localStorage.setItem("goldline:day1:dismissed", "1");
    window.localStorage.setItem(
      "goldline:onboarding:v1",
      JSON.stringify(["first_entry_explained"])
    );
  });

  await page.goto("/home");
  const homeLine = page.getByTestId("home-day-line");
  await expect(homeLine).toBeVisible({ timeout: 30_000 });
  await expect(homeLine.locator("h2")).not.toHaveText(/Reading today's Day Line/i, { timeout: 30_000 });
  const homeTitle = (await homeLine.locator("h2").innerText()).trim();
  const homeStopId = await homeLine.getAttribute("data-day-line-id");
  expect(homeTitle.length).toBeGreaterThan(0);
  expect(homeTitle).not.toMatch(/No executable Day Line stop/i);
  expect(homeStopId && homeStopId.length > 0).toBeTruthy();

  const driverStop = () => page.getByTestId(`day-plan-stop-${homeStopId}`);
  await page.goto("/driver");
  await expect(page.getByTestId("driver-day-home")).toBeVisible({ timeout: 30_000 });
  await expect(driverStop()).toBeVisible({ timeout: 20_000 });
  await expect(driverStop()).toContainText(homeTitle);

  await page.goto("/play");
  await expect(page.getByTestId("driver-day-home")).toBeVisible({ timeout: 30_000 });
  await expect(driverStop()).toBeVisible({ timeout: 20_000 });
  await expect(driverStop()).toContainText(homeTitle);

  await page.goto("/home");
  const silverLake = page.locator(
    '[data-testid="home-click-silver-lake"][data-customer-id="phone:3105550141"]'
  );
  await expect(silverLake).toBeVisible({ timeout: 30_000 });
  await silverLake.click();
  await expect(page).toHaveURL(/cozy=1/);
  await expect(page).toHaveURL(/territory=silver-lake/);
  await expect(page).toHaveURL(/customer=phone%3A3105550141/);

  const villager = page.locator('div[role="button"][aria-label^="Select "]');
  await expect(villager).toHaveCount(1, { timeout: 15_000 });
  await expect(villager).toHaveAttribute("data-customer-id", "phone:3105550141");
  const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
  await expect(drawer).toBeVisible({ timeout: 15_000 });
  await expect(drawer).toHaveAttribute("data-customer-id", "phone:3105550141");

  const textarea = drawer.getByTestId("cozy-message-draft-textarea");
  const suggested = await textarea.inputValue();
  expect(suggested).toMatch(/Reply STOP/i);
  const approved = suggested.includes("this week")
    ? suggested
    : suggested.replace(
        "We can take laundry off your plate when you want.",
        "We can take laundry off your plate this week when you want."
      );
  expect(approved).not.toBe(suggested);
  await textarea.fill(approved);
  await drawer.getByRole("button", { name: "APPROVE" }).click();
  await expect(drawer.locator("[data-sms-approval='current']")).toBeVisible();
  await drawer.getByRole("button", { name: "OPEN IN SMS" }).click();

  const link = drawer.locator("[data-sms-open='google-messages']");
  await expect(link).toBeVisible({ timeout: 15_000 });
  const href = await link.getAttribute("href");
  expect(href).toContain("com.google.android.apps.messaging");
  expect(href).not.toContain("sms_body");
  expect(href).not.toContain("body=");
  await expect(drawer.locator("[data-sms-copy-fallback]")).toHaveValue(approved);
  await expect(drawer.locator("[data-verified-sent='false']")).toBeVisible();
  await expect(drawer.locator("[data-body-prefill-claimed='false']")).toBeVisible();
  await expect(page.getByText(/Simulated send observed/i)).toHaveCount(0);

  await page.goto("/driver");
  await expect(page.getByTestId("driver-day-home")).toBeVisible({ timeout: 30_000 });
  await expect(driverStop()).toContainText(homeTitle);
  const card = page.getByTestId("recovery-outreach-day-line-card");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute("data-customer-id", "phone:3105550141");
  await expect(card).toHaveAttribute("data-objective-complete", "false");
  await expect(card).not.toHaveAttribute("data-communication-state", "send_observed");

  await page.goto("/home");
  await expect(homeLine).toBeVisible({ timeout: 30_000 });
  await expect(homeLine).toHaveAttribute("data-day-line-id", homeStopId!);
  await expect(homeLine.locator("h2")).toHaveText(homeTitle);
  } finally {
    await context.close();
  }
});
