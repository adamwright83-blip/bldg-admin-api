import { test, expect } from "@playwright/test";
test.use({
  viewport: { width: 393, height: 852 },
  isMobile: true,
  hasTouch: true,
});
test.beforeEach(async ({ context }) => {
  await context.route("https://www.google.com/maps/**", route =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Maps route fixture</h1>",
    })
  );
});
test("first pickup tap opens its exact Maps destination and retains the counts panel", async ({
  page,
  context,
}) => {
  await page.goto("/driver?goldlineDayPlanFixture=pickup-bridge");
  await expect(page.locator(".gdp-illustrated-world")).toHaveAttribute(
    "data-art-ready",
    "true"
  );
  await expect(page.locator(".gdp-object--pickup")).toHaveCount(3);
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: /PICKUP: Avery Example/ }).click();
  const maps = await popup;
  await maps.waitForLoadState();
  expect(new URL(maps.url()).searchParams.get("destination")).toBe(
    "42 Example Street, Los Angeles, CA"
  );
  expect(new URL(maps.url()).searchParams.get("dir_action")).toBe("navigate");
  await maps.close();
  await expect(page.getByRole("dialog")).toContainText("Avery Example");
  const picked = page.getByRole("button", { name: "PICKED UP", exact: true });
  await expect(picked).toBeDisabled();
  await page.getByLabel("Bags picked up").fill("2");
  await page.getByLabel("Garments picked up").fill("3");
  await picked.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Pickup saved · CleanCloud sync pending"
  );
  await expect(page.getByRole("dialog")).toContainText("2 bags · 3 garments");
  expect(await page.locator("body").getAttribute("data-pickup-mutation")).toBe(
    JSON.stringify({
      id: "fixture-pickup-0",
      counts: { bagCount: 2, garmentCount: 3 },
    })
  );
  await page.getByRole("button", { name: "Close stop" }).click();
  const before = context.pages().length;
  await page.getByRole("button", { name: /PICKUP: Avery Example/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Pickup saved");
  expect(context.pages().length).toBe(before);
  await expect(
    page.getByRole("button", { name: "PICKED UP", exact: true })
  ).toHaveCount(0);
});
test("an uncertain CleanCloud result preserves the pickup and can be retried without collecting again", async ({
  page,
  context,
}) => {
  await page.goto("/driver?goldlineDayPlanFixture=pickup-bridge-failed");
  const popup = context.waitForEvent("page");
  await page.getByRole("button", { name: /PICKUP: Briar Example/ }).click();
  await (await popup).close();
  await page.getByLabel("Garments picked up").fill("5");
  await page.getByRole("button", { name: "PICKED UP", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Pickup saved · CleanCloud needs attention"
  );
  await page.getByRole("button", { name: "RETRY CLEANCLOUD SYNC" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Pickup saved · CleanCloud sync pending"
  );
});
