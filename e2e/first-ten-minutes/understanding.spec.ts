import { expect, test, type Page } from "@playwright/test";

/**
 * Slice 2: the crew's reading. Nina's example reads her invented corpus; an own account reads the same corpus through
 * the stand-in Gmail, Calendar, Drive and Anthropic, so the real readers, the model call and the quote checks all run.
 */
const FAKE = "http://127.0.0.1:4999";

async function shots(name: string, page: Page, testInfo: { project: { name: string } }) {
  await page.waitForTimeout(900);
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
  await page.getByRole("button", { name: "Let's find out" }).click();
});

test("the example: Nina's world is read, and the crew steps in with her own words", async ({ page }, testInfo) => {
  await page.getByTestId("first-ten-example").click();
  const scene = page.getByTestId("first-ten-crew-scene");
  await expect(scene.getByTestId("first-ten-object-rule")).toContainText("No more Sunday deliveries.", { timeout: 60_000 });
  await shots("10-reading-done", page, testInfo);

  // a source on tap: where Nina's words came from
  await scene.getByTestId("first-ten-object-rule").click();
  const note = page.getByTestId("first-ten-finding-note");
  await expect(note).toContainText("You, to Jules Moreau");
  await expect(note).toContainText("No more Sunday deliveries.");
});

test("your own account: the reading works in the open, and only verified words come back", async ({ page, request }, testInfo) => {
  await request.post(`${FAKE}/__control`, { data: { googleEmail: "nina@wildrootflowers.example", conversationsDelayMs: 6000 } });
  await page.getByTestId("first-ten-connect-google").click();

  // while the model reads the conversations the line says so, and names from the sent mail are already on the objects
  const reading = page.getByTestId("first-ten-understanding");
  await expect(reading).toContainText("Following the conversations you keep coming back to.", { timeout: 30_000 });
  await expect(reading.locator('[data-object="notebook"]')).toContainText("Jules Moreau");
  await expect(reading.locator('[data-object="photograph"]')).toContainText("blue jug");
  await shots("12-own-reading", page, testInfo);

  // then the crew steps in with Nina's own words, checked against her mail, after exactly two model calls
  const scene = page.getByTestId("first-ten-crew-scene");
  await expect(scene.getByTestId("first-ten-object-rule")).toContainText("No more Sunday deliveries.", { timeout: 60_000 });
  await expect
    .poll(async () => (await (await request.get(`${FAKE}/__model-calls`)).json()).calls, { timeout: 30_000 })
    .toEqual(["conversations", "work"]);
});

test("when the model is down, the crew still steps in with what it can count, and says so", async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await request.post(`${FAKE}/__control`, { data: { googleEmail: "nina@wildrootflowers.example", modelFails: true } });
  await page.getByTestId("first-ten-connect-google").click();
  const scene = page.getByTestId("first-ten-crew-scene");
  // Rook's habit is counted from the sent mail, no model needed; with no rule read, Sable waits
  await expect(scene.getByTestId("first-ten-object-strips")).toContainText("Would Friday suit", { timeout: 60_000 });
  await expect(scene.getByTestId("first-ten-object-rule")).toHaveCount(0);
  await expect(page.getByTestId("first-ten-reading-notes")).toContainText("Some of your conversations couldn't be read closely just now.", {
    timeout: 90_000,
  });
});
