import { expect, test, type Page } from "@playwright/test";
import { FAKE, begin, connectOwn } from "./journey";

/**
 * What follows "That sounds like me". Found in Adam's live preview: a page edited and kept, sealed, the journey moved on
 * on the server, and the screen stayed on the page with nothing to do next, because the chapter opened only when the
 * crew had found an opportunity. A kept page now always leads somewhere visible: the chapter, an honest word that
 * there's no conversation to pick up (never an invented one), or a way to try again when the chapter couldn't be read.
 */

async function throughTheCrew(page: Page) {
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  const portrait = page.getByTestId("first-ten-portrait");
  await expect(portrait).toBeVisible({ timeout: 90_000 });
  await expect(portrait).toHaveAttribute("data-status", "ready", { timeout: 30_000 });
  return portrait;
}

/** "Let me change something": one line in the person's own words, then "That sounds like me". */
async function editAndKeep(page: Page) {
  const portrait = page.getByTestId("first-ten-portrait");
  await page.getByRole("button", { name: "Let me change something" }).click();
  await portrait.locator("[data-line]").first().click();
  const editor = page.getByTestId("first-ten-portrait-editor");
  await editor.getByLabel("What's true instead?").fill("I do this my own way now.");
  await editor.getByRole("button", { name: "Change it" }).click();
  await expect(editor).toHaveCount(0);
  await expect(portrait).toContainText("I do this my own way now.");
  await page.getByRole("button", { name: "That sounds like me" }).click();
  await expect(portrait).toHaveAttribute("data-status", "kept");
  await expect(page.getByTestId("first-ten-portrait-kept")).toBeVisible();
}

test.beforeEach(async ({ page, request }) => {
  await begin(page, request);
});

test("an edited page, kept, with a conversation to pick up: the chapter opens", async ({ page, request }) => {
  test.setTimeout(180_000);
  await connectOwn(page, request);
  await throughTheCrew(page);
  await editAndKeep(page);
  await expect(page.getByTestId("first-ten-revelation")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("first-ten-chapter-threshold")).toHaveCount(0);
});

test("an edited page, kept, with no conversation to pick up: says so, invents nothing, and offers what's next", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  await request.post(`${FAKE}/__control`, { data: { noOpportunities: true } });
  await connectOwn(page, request);
  await throughTheCrew(page);
  await editAndKeep(page);

  const threshold = page.getByTestId("first-ten-chapter-threshold");
  await expect(threshold).toHaveAttribute("data-state", "no_opportunity", { timeout: 20_000 });
  await expect(threshold).toBeVisible();
  await expect(threshold).toContainText("Your page is kept.");
  await expect(threshold).toContainText("there's no letter to write today");
  await expect(threshold).toContainText("Nothing has to be sent.");
  await expect(page.getByTestId("first-ten-revelation")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-letter")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-draft")).toHaveCount(0);
  const signup = page.getByTestId("first-ten-signup");
  await expect(signup).toBeVisible();
  await expect(signup.getByTestId("first-ten-activation")).toBeVisible();
  await expect(signup.getByTestId("first-ten-offer-closed")).toHaveText("JOYSTICK isn't taking payment yet. Everything here is saved.");
  await expect(page.getByTestId("first-ten-workspace")).toHaveCount(0);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-35-kept-no-opportunity.png`, fullPage: true });

  // a next action that does something: the crew's findings, as they stand
  await page.getByTestId("first-ten-chapter-look-closer").click();
  const findings = page.getByTestId("first-ten-findings");
  await expect(findings).toBeVisible();
  await findings.getByRole("button", { name: "Close" }).click();
  await expect(findings).toHaveCount(0);

  // checking again asks the server again, and the answer is the same honest one
  await page.getByTestId("first-ten-chapter-retry").click();
  await expect(threshold).toHaveAttribute("data-state", "no_opportunity");

  // and the same on a return visit: the kept page, and the plain word under it
  await page.reload();
  await expect(page.getByTestId("first-ten-portrait-kept")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("first-ten-chapter-threshold")).toHaveAttribute("data-state", "no_opportunity", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-signup")).toBeVisible();
  await expect(page.getByTestId("first-ten-revelation")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-draft")).toHaveCount(0);

  // a cancelled return keeps the offer and does not open a workspace
  await page.goto("/joystick-start?checkout=cancelled");
  await expect(page.getByTestId("first-ten-checkout-cancelled")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("first-ten-signup")).toBeVisible();
  await expect(page.getByTestId("first-ten-workspace")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-draft")).toHaveCount(0);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-36-signup-without-draft.png`, fullPage: true });
});

test("a chapter that couldn't be read: the kept page says so and tries again", async ({ page }) => {
  test.setTimeout(180_000);
  await page.getByTestId("first-ten-example").click();
  await throughTheCrew(page);

  let failing = true;
  await page.route(/\/api\/trpc\/[^?]*firstTenMinutes\.chapter(?!Step)/, route => (failing ? route.abort("failed") : route.continue()));
  await editAndKeep(page);

  const threshold = page.getByTestId("first-ten-chapter-threshold");
  await expect(threshold).toHaveAttribute("data-state", "error", { timeout: 20_000 });
  await expect(threshold).toContainText("Your page is kept.");
  await expect(page.getByTestId("first-ten-revelation")).toHaveCount(0);

  failing = false;
  await page.getByTestId("first-ten-chapter-retry").click();
  await expect(page.getByTestId("first-ten-revelation")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("first-ten-chapter-threshold")).toHaveCount(0);
});
