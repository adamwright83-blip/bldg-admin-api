import { expect, test, type Page } from "@playwright/test";

/**
 * Sign up and log in with Google (server/joystickAccount): an account before any workspace, straight into bringing your
 * world, the same journey on another browser, and signing out everywhere. Google is the local stand-in.
 */
const FAKE = "http://127.0.0.1:4999";
async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FAKE}/__reset`);
  await page.goto("/signup");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
});

async function signUp(page: Page) {
  await page.goto("/signup");
  await expect(page.getByTestId("account-signup").getByRole("heading", { level: 1 })).toHaveText("Welcome to JOYSTICK");
  await page.getByTestId("account-google").click();
  // Google proves who they are; they land straight on bringing their world, never on the invitation again
  await expect(page).toHaveURL(/\/joystick-start$/);
  await expect(page.getByTestId("first-ten-connect")).toBeVisible();
  await expect(page.getByTestId("first-ten-invitation")).toHaveCount(0);
}

test("sign up with Google, straight into bringing your world, then connect Gmail, Calendar and Drive", async ({ page }, testInfo) => {
  await page.goto("/signup");
  const card = page.getByTestId("account-signup");
  await expect(card.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  await expect(card.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
  await shots("signup-01-page", page, testInfo);
  await card.getByRole("button", { name: "JOYSTICK and your data" }).click();
  await expect(page.getByRole("dialog")).toContainText("read-only access to Gmail, Calendar and Drive");
  await expect(page.getByRole("dialog")).toContainText("Nothing is ever sent from your account unless you approve the exact message.");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await signUp(page);
  await shots("signup-02-bring-your-world", page, testInfo);
  await page.getByTestId("first-ten-connect-google").click();
  await expect(page).toHaveURL(/\/joystick-start$/);
  await expect(page.getByTestId("first-ten-google-account")).toHaveText("owner@first-ten.example · Gmail, Calendar and Drive");
  await expect(page.getByTestId("first-ten-understanding").or(page.getByTestId("first-ten-crew-scene"))).toBeVisible();
});

test("logging in on another browser opens the same journey; signing out closes it on every browser", async ({ page, browser }, testInfo) => {
  await signUp(page);
  await page.getByTestId("first-ten-connect-google").click();
  await expect(page.getByTestId("first-ten-google-account")).toBeVisible();

  const baseURL = testInfo.project.use.baseURL!;
  const other = await browser.newContext({ baseURL });
  const elsewhere = await other.newPage();
  await elsewhere.goto("/login");
  await expect(elsewhere.getByTestId("account-login").getByRole("heading", { level: 1 })).toHaveText("Welcome back");
  await elsewhere.getByTestId("account-google").click();
  await expect(elsewhere).toHaveURL(/\/joystick-start$/);
  // the journey this account already began, with the Google connection it already made
  await expect(elsewhere.getByTestId("first-ten-google-account")).toHaveText("owner@first-ten.example · Gmail, Calendar and Drive");

  // signed in already: /login offers to carry on, or to sign out
  await elsewhere.goto("/login");
  await expect(elsewhere.getByTestId("account-continue")).toBeVisible();
  await expect(elsewhere.getByText("You're signed in as owner@first-ten.example.")).toBeVisible();
  await shots("signup-03-signed-in", elsewhere, testInfo);
  await elsewhere.getByTestId("account-sign-out").click();
  await expect(elsewhere.getByTestId("account-google")).toBeVisible();
  await other.close();

  // the first browser's copy of the journey stopped working with the sign-out: it starts again from the invitation
  await page.goto("/joystick-start");
  await expect(page.getByTestId("first-ten-invitation")).toBeVisible({ timeout: 15_000 });
});

test("the privacy policy and terms are served", async ({ request }) => {
  // in development the SPA serves the files themselves; vercel.json rewrites /privacy and /terms to them in production
  for (const path of ["/joystick-home/privacy.html", "/joystick-home/terms.html"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain("Google");
  }
});
