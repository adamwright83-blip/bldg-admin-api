import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

/**
 * The short recording for review: one failed attempt (the junction as found), a retry, and the whole circuit, ending
 * on the opened invitation and the labelled sample draft. Desktop only; the video lands in tmp/prototypes-results.
 */
test.use({ video: { mode: "on", size: { width: 1280, height: 800 } } });

const PAGE = `file://${resolve("tmp/friday-circuit/friday-circuit.local.html")}`;
const courier = (page: Page) => page.getByTestId("courier");

async function setJunction(page: Page, to: string) {
  const junction = page.getByTestId("junction");
  for (let i = 0; i < 3 && (await junction.getAttribute("data-junction")) !== to; i += 1) {
    await junction.click();
    await page.waitForTimeout(450);
  }
  await expect(junction).toHaveAttribute("data-junction", to);
}

async function docksAt(page: Page, pad: string) {
  await expect(courier(page)).toHaveAttribute("data-at", pad, { timeout: 15_000 });
  await expect(courier(page)).toHaveAttribute("data-moment", "idle", { timeout: 15_000 });
}

test("demo: one failed attempt, then the whole circuit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one recording is enough");
  test.setTimeout(180_000);
  await page.goto(`${PAGE}#letters`);
  await page.evaluate(() => window.localStorage.clear());
  await page.goto(`${PAGE}#letters`);
  await page.waitForTimeout(1800);

  // a first try with the junction as found: the courier bumps its nose, the envelope flips upright
  await page.getByTestId("wind").click();
  await expect(courier(page)).toHaveAttribute("data-moment", "bump", { timeout: 10_000 });
  await page.waitForTimeout(2600);
  await page.getByTestId("retry").click();
  await docksAt(page, "S");
  await page.waitForTimeout(900);

  // the circuit: out on THEN, round the hotel on NOW, home on THEN
  await setJunction(page, "west-north");
  await page.waitForTimeout(600);
  await page.getByTestId("wind").click();
  await docksAt(page, "P");
  await page.waitForTimeout(700);
  await page.getByTestId("layer-now").click();
  await page.waitForTimeout(1500);
  await page.getByTestId("wind").click();
  await docksAt(page, "Q");
  await page.waitForTimeout(900);
  await page.getByTestId("layer-then").click();
  await page.waitForTimeout(1500);
  await setJunction(page, "west-east");
  await page.waitForTimeout(600);
  await page.getByTestId("wind").click();
  await docksAt(page, "S");
  await expect(page.getByTestId("completion")).toBeVisible();
  await page.waitForTimeout(1600);
  await page.getByTestId("completion").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1400);
  await page.getByTestId("choice-reply").click();
  await page.waitForTimeout(2800);
});
