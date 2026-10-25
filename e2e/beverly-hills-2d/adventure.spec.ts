import { test, expect } from "@playwright/test";
import { playOtherRodeo } from "./playthrough";
test("complete adventure and reload resume preserve fiction without business writes", async ({
  page,
}) => {
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("request", r => {
    if (r.method() === "POST" && r.url().includes("/api/trpc/"))
      writes.push(r.url());
  });
  await page.goto("/growth/lantern-city?level=beverly-hills");
  await playOtherRodeo(page);
  await page.reload();
  await page.getByRole("button", { name: "Continue the afternoon" }).click();
  await expect(page.getByTestId("beverly-hills-2d")).toHaveAttribute(
    "data-chapter",
    "home"
  );
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
test("journal submission stays pending, does not add orders or grow a ranch plot", async ({
  page,
}) => {
  let posted = false;
  let records: unknown[] = [];
  const data = () => ({
    tenantId: "laundry_farm",
    operatorId: "fixture-operator",
    canReview: false,
    brandName: "Laundry Farm",
    readable: true,
    buildings: [
      {
        id: "acct:fixture",
        name: "Fixture apartment — not a real address",
        address: "100 Example Street",
        kind: "apartment building",
        recordedOrders: 3,
        evidence: "Test fixture",
        navigationUrl: null,
      },
    ],
    records,
    restoredPlots: 0,
    hangerId: "laundry-farm-standard-hanger-v1",
  });
  await page.route("**/api/trpc/**", async route => {
    const url = route.request().url();
    let result: unknown = [];
    if (url.includes("submitBeverlyHillsOutreach")) {
      const body = route.request().postDataJSON();
      const v = body["0"]?.json ?? body.json;
      posted = true;
      records = [
        {
          ...v,
          id: v.requestId,
          address: "100 Example Street",
          operatorId: "fixture-operator",
          status: "submitted",
          reviewerId: null,
          reviewNote: null,
        },
      ];
      result = [{ result: { data: { json: { ok: true } } } }];
    } else if (url.includes("beverlyHillsOutreach"))
      result = [{ result: { data: { json: data() } } }];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(result),
    });
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "joystick.other-rodeo.fiction.v1",
      JSON.stringify({
        version: 1,
        chapter: "home",
        x: 640,
        rescued: true,
        nuzzled: true,
      })
    )
  );
  await page.goto("/growth/lantern-city?level=beverly-hills");
  await page.getByRole("button", { name: "Continue the afternoon" }).click();
  const hud = page.locator("header");
  expect((await hud.boundingBox())!.height).toBeLessThan(100);
  await page.getByRole("button", { name: "Open Claire’s field notes" }).click();
  await expect(
    page.getByText("3 recorded customer orders at this address")
  ).toBeVisible();
  await page.getByText("Record a completed, permitted visit").click();
  await page.getByLabel("Date", { exact: true }).fill("2026-01-10");
  await page.getByLabel("Hangers placed").fill("35");
  await page
    .getByLabel("Permission received from")
    .fill("Fixture manager approved the lobby");
  await page.getByLabel("Evidence link").fill("https://example.com/fixture");
  await page
    .getByLabel("Visit notes")
    .fill("Fixture report for the permitted area.");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Submit activity for review" })
    .click();
  await expect(page.getByText("Awaiting review")).toBeVisible();
  expect(posted).toBe(true);
  await expect(page.getByText("0 of 6 ranch plots restored")).toBeVisible();
  await expect(
    page.getByText("3 recorded customer orders at this address")
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  ).toBe(false);
});
