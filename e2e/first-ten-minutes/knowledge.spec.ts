import { expect, test } from "@playwright/test";
import { FAKE, begin, connectOwn } from "./journey";

/**
 * Onboarding intelligence in the browser, with JOYSTICK_ONBOARDING_INTELLIGENCE on (the CI pass that sets
 * FIRST_TEN_E2E_INTELLIGENCE=on): the person's own account is investigated during the reading; before the page,
 * Claire asks how two business names relate, one question at a time; a nuanced answer gets one follow-up; she says
 * back what she understood; the page is written from that understanding; and the game goes on exactly as before.
 */
test.skip(process.env.FIRST_TEN_E2E_INTELLIGENCE !== "on", "runs in the onboarding-intelligence pass");

test("Claire asks before the page, keeps the person's words, and the page and game follow", async ({ page, request }, testInfo) => {
  test.setTimeout(240_000);
  await begin(page, request);
  // recent mail from Nina's own Gmail under a second, related name
  await request.post(`${FAKE}/__send-from-gmail`, {
    data: {
      to: "events@hawthorne.example",
      toName: "Hawthorne events",
      subject: "Installations for your venue",
      body: "Hi,\n\nWe now do full installations for venues.\n\nNina Vale\nWildroot Events",
      daysAgo: 3,
    },
  });
  await connectOwn(page, request);
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 90_000 });
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();

  const card = page.getByTestId("first-ten-claire-question");
  await expect(card).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("first-ten-portrait")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-claire-question-text")).toContainText(/I found recent work under Wildroot (Flowers|Events) and Wildroot (Events|Flowers)\. Are these separate businesses, or two names for the same operation\?/);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-40-claire-question.png`, fullPage: true });

  await page.getByTestId("first-ten-claire-answer").fill("Yes, but it's complicated.");
  await page.getByTestId("first-ten-claire-reply").click();
  await expect(page.getByTestId("first-ten-claire-question-text")).toContainText("fit together", { timeout: 20_000 });
  await expect(page.getByTestId("first-ten-claire-their-answer")).toContainText("Yes, but it's complicated.");
  await page.getByTestId("first-ten-claire-answer").fill("Events is the installation side. Same studio, separate invoices.");
  await page.getByTestId("first-ten-claire-reply").click();

  // any further question can be left; then the page
  const portrait = page.getByTestId("first-ten-portrait");
  await expect(page.getByTestId("first-ten-claire-understood").or(portrait)).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 3 && !(await portrait.isVisible()); i += 1) {
    const notNow = page.getByTestId("first-ten-claire-not-now");
    if (await notNow.isVisible()) await notNow.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(1500);
  }
  await expect(portrait).toBeVisible({ timeout: 90_000 });
  await expect(portrait).toContainText("are related, but not one company.");
  await expect(portrait).not.toContainText("same company");
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-41-portrait-from-understanding.png`, fullPage: true });

  // the approved game is untouched: keeping the page leads into the chapter as before
  await page.getByRole("button", { name: "That sounds like me" }).click();
  await expect(page.getByTestId("first-ten-impossible-machine").or(page.getByTestId("first-ten-chapter-threshold"))).toBeVisible({ timeout: 30_000 });

  const calls = (await (await request.get(`${FAKE}/__model-calls`)).json()).calls as string[];
  expect(calls.indexOf("investigator")).toBeGreaterThan(-1);
  expect(calls.indexOf("investigator")).toBeLessThan(calls.indexOf("portrait"));
});
