import { expect, test, type Page } from "@playwright/test";

/**
 * Slice 3: the crew gets acquainted, on Nina's example. The person's words open on a nearly empty desk; Sable asks;
 * the answer persists and folds Sunday closed; each companion points at something of Nina's; every object opens to its
 * source and can be corrected.
 */
const FAKE = "http://127.0.0.1:4999";

async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `tmp/first-ten-e2e-shots/${testInfo.project.name}-${name}.png`, fullPage: true });
}

async function openExample(page: Page) {
  await page.goto("/joystick-start");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto("/joystick-start");
  await page.getByRole("button", { name: "Let's find out" }).click();
  await page.getByTestId("first-ten-example").click();
  await expect(page.getByTestId("first-ten-crew-scene")).toBeVisible({ timeout: 60_000 });
}

// the line being said now (a line leaving can overlap the next for a moment)
const line = (page: Page) => page.getByTestId("first-ten-crew-line").last();

test.beforeEach(async ({ request }) => {
  await request.post(`${FAKE}/__reset`);
});

test("Nina's words, Sable's question, Sunday folds closed, and the crew in turn", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await openExample(page);
  const scene = page.getByTestId("first-ten-crew-scene");

  // a nearly empty desk: only her own words
  await expect(scene.getByTestId("first-ten-object-rule")).toContainText("No more Sunday deliveries.");
  await expect(scene.getByTestId("first-ten-object-rule")).toContainText("You, to Jules Moreau");
  await expect(scene.locator("[data-testid^='first-ten-object-']")).toHaveCount(1);
  await expect(line(page)).toContainText("Still true?");
  await expect(page.getByTestId("first-ten-crew").locator("[data-crew]")).toHaveCount(1);
  await shots("20-still-true", page, testInfo);

  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  await expect(line(page)).toContainText("Then we'll work around it.");
  await expect(page.getByTestId("first-ten-week").locator('[data-day="Sunday"]')).toHaveAttribute("data-state", "closed");
  await shots("21-sunday-folds", page, testInfo);

  await expect(line(page)).toContainText("That's a small map with quite a lot happening on it.", { timeout: 20_000 });
  const map = scene.getByTestId("first-ten-object-map");
  for (const hotel of ["The Larkspur Hotel", "Hotel Wren", "The Alder House"]) await expect(map.locator(`[data-pin="${hotel}"]`)).toBeVisible();
  await expect(map).toContainText("Elena asked, April");
  await shots("22-mara", page, testInfo);

  await expect(line(page)).toContainText("You tend to finish with a real question.", { timeout: 20_000 });
  await expect(scene.getByTestId("first-ten-object-strips")).toContainText("Would Friday suit");
  await expect(line(page)).toContainText("I can work with that.", { timeout: 10_000 });

  await expect(line(page)).toContainText("Your wedding clients ask for a spectacular day.", { timeout: 20_000 });
  await expect(line(page)).toContainText("The hotels keep asking for something they can count on every week.", { timeout: 10_000 });
  await shots("23-bront", page, testInfo);

  await expect(line(page)).toContainText("This one keeps coming back. Three proposals. Same blue jug.", { timeout: 20_000 });
  await expect(scene.getByTestId("first-ten-object-photo").locator("img")).toHaveAttribute("src", "/assets/first-ten/example/blue-jug.webp");
  await shots("24-luma", page, testInfo);

  await expect(line(page)).toContainText("Your Friday deliveries already pass this street.", { timeout: 25_000 });
  await expect(scene.locator('[data-route="drawn"]')).toBeVisible();
  await shots("25-orren", page, testInfo);

  await expect(line(page)).toContainText("There's an older conversation we should put beside this.", { timeout: 25_000 });
  await expect(scene.getByTestId("first-ten-object-notebook")).toContainText("Elena Ruiz · April 18");
  await expect(page.getByTestId("first-ten-thread")).toBeVisible();
  await shots("26-ilex", page, testInfo);

  await expect(page.getByTestId("first-ten-look-closer")).toBeVisible({ timeout: 20_000 });
  for (const who of ["sable", "mara", "rook", "bront", "luma", "orren", "ilex"]) {
    await expect(page.getByTestId("first-ten-crew").locator(`[data-crew="${who}"]`)).toBeVisible();
  }

  // the answer persisted: after a reload Sunday stays closed
  await page.reload();
  await expect(page.getByTestId("first-ten-week").locator('[data-day="Sunday"]')).toHaveAttribute("data-state", "closed", { timeout: 60_000 });
});

test("“That's changed” keeps Nina's new words, crosses the old ones out, and leaves Sunday open", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openExample(page);
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "That's changed" }).click();
  await page.getByLabel("What's true now?").fill("Sundays are fine in wedding season.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(line(page)).toContainText("Then I'll cross it out.");
  await expect(page.getByTestId("first-ten-object-rule")).toHaveAttribute("data-corrected", "yes");
  await expect(page.getByTestId("first-ten-week").locator('[data-day="Sunday"]')).toHaveAttribute("data-state", "open");

  // open the rule's source: Nina's own words, with what she said now
  await page.getByTestId("first-ten-object-rule").click();
  const note = page.getByTestId("first-ten-finding-note");
  await expect(note).toContainText("No more Sunday deliveries.");
  await expect(note).toContainText("You said: “Sundays are fine in wedding season.”");
});

test("any object opens to its source, and a correction takes it off the desk", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openExample(page);
  await page.getByTestId("first-ten-sable-answers").getByRole("button", { name: "Still the rule" }).click();
  const strips = page.getByTestId("first-ten-object-strips");
  await expect(strips).toBeVisible({ timeout: 30_000 });
  await strips.click();
  const note = page.getByTestId("first-ten-finding-note");
  await expect(note).toContainText("You, to Sam Okafor");
  await expect(note).toContainText("“Would Friday suit?”");
  await note.getByRole("button", { name: "Not quite right?" }).click();
  await note.getByRole("button", { name: "That's not right" }).click();
  // it moves from the stage to the side of the desk; once settled there is one, greyed
  await expect(strips).toHaveCount(1);
  await expect(strips).toHaveAttribute("data-corrected", "yes");
  await expect(line(page)).toContainText("Struck.");
});
