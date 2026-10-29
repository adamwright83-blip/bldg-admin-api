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

async function expectNamesOnTheObjects(page: Page) {
  const scene = page.getByTestId("first-ten-understanding");
  await expect(scene).toHaveAttribute("data-status", "complete", { timeout: 60_000 });
  await expect(scene.locator('[data-object="map"]')).toContainText("Wildroot Flowers");
  await expect(scene.locator('[data-object="notebook"]')).toContainText("Jules Moreau");
  await expect(scene.locator('[data-object="folder"]')).toContainText("Weekly Friday delivery");
  await expect(scene.locator('[data-object="photograph"]')).toContainText("blue jug");
  for (const who of ["sable", "rook", "mara", "luma"]) await expect(scene.locator(`[data-crew="${who}"]`)).toBeVisible();
}

test("the example: the crew reads Nina's world and real names land on their objects", async ({ page }, testInfo) => {
  await page.getByTestId("first-ten-example").click();
  await expectNamesOnTheObjects(page);
  await shots("10-reading-done", page, testInfo);

  // a source on tap: where the map's name came from
  await page.locator('[data-object="map"]').click();
  const source = page.getByTestId("first-ten-source");
  await expect(source).toContainText("You, to Sam Okafor");
  await expect(source).toContainText("Wildroot Flowers · Silver Lake");
  await source.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("first-ten-look-closer").click();
  const found = page.getByTestId("first-ten-findings");
  await expect(found).toContainText("Your rule: No more Sunday deliveries.");
  await expect(found).toContainText("Elena Ruiz asked in April, before you offered weekly Friday delivery. You offer it now.");
  await expect(found).toContainText("You tend to finish with a real question: “Would Friday suit?” “Shall I bring two?”");
  await shots("11-what-the-crew-found", page, testInfo);
});

test("your own account: Gmail, Calendar, Drive and the model are read, and only verified words come back", async ({ page, request }, testInfo) => {
  await request.post(`${FAKE}/__control`, { data: { googleEmail: "nina@wildrootflowers.example" } });
  await page.getByTestId("first-ten-connect-google").click();
  await expectNamesOnTheObjects(page);
  await shots("12-own-reading-done", page, testInfo);
  const calls = await (await request.get(`${FAKE}/__model-calls`)).json();
  expect(calls.calls).toEqual(["conversations", "work"]);
  await page.getByTestId("first-ten-look-closer").click();
  await expect(page.getByTestId("first-ten-findings")).toContainText("Friday delivery: Café Lumen, Juniper Yoga, Mercer");
});

test("when the model is down, the crew still finishes with what it can count, and says so", async ({ page, request }) => {
  await request.post(`${FAKE}/__control`, { data: { googleEmail: "nina@wildrootflowers.example", modelFails: true } });
  await page.getByTestId("first-ten-connect-google").click();
  const scene = page.getByTestId("first-ten-understanding");
  await expect(scene).toHaveAttribute("data-status", "complete", { timeout: 60_000 });
  await expect(scene).toContainText("Some of your conversations couldn't be read closely just now.");
  await expect(scene.locator('[data-object="notebook"]')).toContainText("Jules Moreau");
  await expect(scene.locator('[data-object="photograph"]')).toContainText("blue jug");
  await expect(scene.locator('[data-object="map"]')).toHaveAttribute("data-named", "no");
});
