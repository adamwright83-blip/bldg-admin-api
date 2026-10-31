import { expect, test, type Page } from "@playwright/test";

/**
 * Slice 4: Claire's portrait. When the crew has had its say, the scene settles and one page appears: Astra's portrait
 * for Nina, word for word, every line resting on her records. "Let me change something" puts the person's words in
 * place of a line; "That sounds like me" keeps it, and the chapter follows; a reload goes on from there.
 */
const FAKE = "http://127.0.0.1:4999";

async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FAKE}/__reset`);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/joystick-start");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/joystick-start");
  await page.getByRole("button", { name: "Let's find out" }).click();
});

async function throughTheCrew(page: Page, sable: "Still the rule" | "That's changed", newRule?: string) {
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: sable }).click();
  if (newRule) {
    await page.getByLabel("What's true now?").fill(newRule);
    await page.getByRole("button", { name: "Save" }).click();
  }
  const portrait = page.getByTestId("first-ten-portrait");
  await expect(portrait).toBeVisible({ timeout: 90_000 });
  return portrait;
}

const NINA = [
  "Weddings fill your weekends.",
  "You're building a steadier weekday business around hotel flowers.",
  "Jules handles the installations.",
  "You carry the promises: what arrives, when it arrives, and what the client actually agreed to.",
  "You've added Friday deliveries and kept Sundays for yourself.",
  "The next hotel conversation should fit the business you're building now.",
];

test("Nina's portrait: Astra's page, changed in Nina's own hand, and kept", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.getByTestId("first-ten-example").click();
  const portrait = await throughTheCrew(page, "Still the rule");
  await expect(portrait).toHaveAttribute("data-status", "ready");
  await expect(portrait).toContainText("Nina, here's where you are.");
  for (const line of NINA) await expect(portrait).toContainText(line);
  await expect(portrait).toContainText("There's one I'd like to show you.");
  await expect(portrait).toContainText("Claire");
  await expect(page.getByTestId("first-ten-portrait-controls")).toContainText("That sounds like me");
  await shots("30-portrait", page, testInfo);

  // "Let me change something": a line opens to where it came from, and the person's words take its place
  await page.getByRole("button", { name: "Let me change something" }).click();
  await portrait.locator('[data-line="p2.s1"]').click();
  const editor = page.getByTestId("first-ten-portrait-editor");
  await expect(editor).toContainText("Jules");
  await editor.getByLabel("What's true instead?").fill("Jules builds the big pieces. I do the rest.");
  await editor.getByRole("button", { name: "Change it" }).click();
  await expect(editor).toHaveCount(0);
  const line = portrait.locator('[data-line="p2.s1"]');
  await expect(line).toContainText("Jules handles the installations.");
  await expect(line).toContainText("Jules builds the big pieces. I do the rest.");
  await shots("31-portrait-changed", page, testInfo);

  await page.getByRole("button", { name: "That sounds like me" }).click();
  await expect(portrait).toHaveAttribute("data-status", "kept");
  await expect(page.getByTestId("first-ten-portrait-kept")).toBeVisible();
  await expect(page.getByTestId("first-ten-portrait-controls")).toHaveCount(0);
  await shots("32-portrait-kept", page, testInfo);

  // kept, the page gives way to what Claire wanted to show: The Impossible Machine; a reload goes on from there,
  // the crew not introducing itself again (the kept page, with Nina's words, is checked on MySQL in portrait.mysql.integration.test.ts)
  await expect(page.getByTestId("first-ten-impossible-machine")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("machine-board-stage")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("first-ten-impossible-machine")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("machine-board-stage")).toBeVisible();
  await expect(page.getByTestId("first-ten-crew-line")).toHaveCount(0);
});

test("a changed Sunday rule changes the page", async ({ page }) => {
  await page.getByTestId("first-ten-example").click();
  const portrait = await throughTheCrew(page, "That's changed", "Sundays are fine in wedding season.");
  await expect(portrait).toContainText("You've added Friday deliveries.");
  await expect(portrait).not.toContainText("kept Sundays for yourself");
});

test("your own account: Claire's page holds only what the records hold", async ({ page, request }) => {
  await request.post(`${FAKE}/__control`, { data: { googleEmail: "nina@wildrootflowers.example" } });
  await page.getByTestId("first-ten-connect-google").click();
  const portrait = await throughTheCrew(page, "Still the rule");
  await expect(portrait).toContainText("Nina, here's where you are.");
  await expect(portrait).toContainText("Jules handles the installations.");
  // the stand-in model also wrote about someone who isn't in Nina's records; that line is struck before it's shown
  await expect(portrait).not.toContainText("Marta");
  const calls = await (await request.get(`${FAKE}/__model-calls`)).json();
  expect(calls.calls).toEqual(["conversations", "work", "portrait"]);
});
