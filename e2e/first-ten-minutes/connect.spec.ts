import { expect, test, type Page } from "@playwright/test";

/**
 * Slice 1: the invitation, bringing your world (Google, Slack), what connecting includes, and the labelled example.
 * Google and Slack are the local stand-in (fakeProviders.mjs); everything else is the real server and database.
 */
const FAKE = "http://127.0.0.1:4999";
async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(900); // let the paper settle
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FAKE}/__reset`);
  await page.goto("/joystick-start");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/joystick-start");
});

test("the invitation, then bringing your world, with nothing that reads like a landing page", async ({ page }, testInfo) => {
  const card = page.getByTestId("first-ten-invitation");
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading")).toHaveText("Could your business be a game?");
  await expect(card).toContainText("Let your crew get acquainted with the business you've already built.");
  await shots("01-invitation", page, testInfo);

  // One sheet of paper and one quiet link: no cards grid, no step counter, no cast list.
  await expect(page.locator("main button")).toHaveCount(1);
  await expect(page.getByText(/step \d|\d of \d/i)).toHaveCount(0);

  await page.getByRole("button", { name: "Let's find out" }).click();
  const sheet = page.getByTestId("first-ten-connect");
  await expect(sheet.getByRole("heading")).toHaveText("Bring your world with you.");
  await expect(sheet).toContainText("Your conversations, projects, and plans give your crew somewhere to begin.");
  await expect(sheet.getByRole("button", { name: "Connect Google" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Add Slack" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Explore an example" })).toBeVisible();
  await shots("02-bring-your-world", page, testInfo);

  await sheet.getByRole("button", { name: "What connecting includes" }).click();
  const includes = page.getByTestId("first-ten-includes-sheet");
  await expect(includes).toContainText("Access is read-only.");
  await expect(includes).toContainText("Anthropic");
  await expect(includes).toContainText("myaccount.google.com/permissions");
  await shots("03-what-connecting-includes", page, testInfo);
  await includes.getByRole("button", { name: "Close" }).click();
  await expect(includes).toHaveCount(0);
});

test("connecting Google comes back connected, survives a reload, and disconnects", async ({ page, request }, testInfo) => {
  await page.getByRole("button", { name: "Let's find out" }).click();
  await page.getByTestId("first-ten-connect-google").click();
  await expect(page).toHaveURL(/\/joystick-start$/);
  const connected = page.getByTestId("first-ten-connected");
  await expect(connected.getByRole("heading")).toHaveText("Your world is here.");
  await expect(page.getByTestId("first-ten-google-account")).toHaveText("owner@first-ten.example · Gmail, Calendar and Drive");
  await shots("04-connected", page, testInfo);

  await page.reload();
  await expect(page.getByTestId("first-ten-google-account")).toBeVisible();

  await page.getByTestId("first-ten-disconnect-google").click();
  await expect(page.getByTestId("first-ten-connect")).toBeVisible();
  const revoked = await (await request.get(`${FAKE}/__revoked`)).json();
  expect(revoked.revoked).toContainEqual({ provider: "google", token: "fake-google-refresh" });
});

test("an unticked Gmail box or a cancelled consent says so plainly and keeps nothing", async ({ page, request }) => {
  await request.post(`${FAKE}/__control`, {
    data: { googleScopes: ["openid", "https://www.googleapis.com/auth/drive.readonly"] },
  });
  await page.getByRole("button", { name: "Let's find out" }).click();
  await page.getByTestId("first-ten-connect-google").click();
  await expect(page.getByRole("alert")).toContainText("without Gmail");
  await expect(page.getByTestId("first-ten-connected")).toHaveCount(0);

  await request.post(`${FAKE}/__control`, { data: { deny: true } });
  await page.getByTestId("first-ten-connect-google").click();
  await expect(page.getByRole("alert")).toContainText("You didn't finish connecting. Nothing was shared.");
});

test("Slack and Google can be connected in either order", async ({ page }) => {
  await page.getByRole("button", { name: "Let's find out" }).click();
  await page.getByTestId("first-ten-add-slack").click();
  await expect(page.getByTestId("first-ten-connected")).toContainText("Slack · First Ten Workspace");
  await page.getByTestId("first-ten-connect-google").click();
  await expect(page.getByTestId("first-ten-google-account")).toHaveText("owner@first-ten.example · Gmail, Calendar and Drive");
  await expect(page.getByTestId("first-ten-connected")).toContainText("Slack · First Ten Workspace");
});

test("a failed request keeps the draft; only an expired draft is forgotten", async ({ page }) => {
  await page.getByRole("button", { name: "Let's find out" }).click();
  await page.getByTestId("first-ten-connect-google").click();
  await expect(page.getByTestId("first-ten-google-account")).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem("joystick_first_ten_credentials"));
  // the server is unreachable for a moment: the journey request fails, and the draft is kept
  await page.route("**/api/trpc/system.firstTenMinutes.journey**", route => route.abort("connectionreset"));
  await page.reload();
  await page.waitForTimeout(4000);
  expect(await page.evaluate(() => localStorage.getItem("joystick_first_ten_credentials"))).toBe(saved);
  await page.unroute("**/api/trpc/system.firstTenMinutes.journey**");
  await page.reload();
  await expect(page.getByTestId("first-ten-google-account")).toBeVisible();
});

test("the example is labelled on screen and can be left for your own world", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Let's find out" }).click();
  await page.getByTestId("first-ten-example").click();
  await expect(page.getByTestId("first-ten-example-label")).toContainText("Example: Nina's flower studio, invented. Nothing here is yours.");
  await expect(page.getByTestId("first-ten-connected").getByRole("heading")).toHaveText("Nina's world is here.");
  await expect(page.getByTestId("first-ten-google-account")).toContainText("nina@wildrootflowers.example");
  await shots("05-example", page, testInfo);

  await page.getByRole("button", { name: "Bring your own" }).click();
  await expect(page.getByTestId("first-ten-connect")).toBeVisible();
  await expect(page.getByTestId("first-ten-example-label")).toHaveCount(0);
});
