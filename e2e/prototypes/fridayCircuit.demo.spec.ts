import { expect, test } from "@playwright/test";
import { circuit, courier, docksAt, fresh, recorder, tapAlong } from "./fridayCircuitDemo";

/**
 * The recordings for review, desktop: (1) one failed attempt, a retry, the whole circuit, the full ending untouched,
 * then "Prepare a reply"; (2) the circuit, the ending tapped along, then "Keep for later". The phone recording ("Not
 * for me") is fridayCircuit.phone.demo.spec.ts. Videos land in tmp/prototypes-results.
 */
test.use({ video: { mode: "on", size: { width: 1280, height: 800 } } });

test("demo 1: a failed attempt, the whole circuit, the full ending, then prepare a reply", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "recorded on desktop");
  test.setTimeout(180_000);
  const mark = recorder("reply");
  await fresh(page);
  await page.waitForTimeout(1600);

  // a first try with the junction as found: the courier bumps its nose, the envelope flips upright
  await page.getByTestId("wind").click();
  await expect(courier(page)).toHaveAttribute("data-moment", "bump", { timeout: 10_000 });
  await page.waitForTimeout(2400);
  await page.getByTestId("retry").click();
  await docksAt(page, "S");
  await page.waitForTimeout(800);

  await circuit(page, mark);
  // the ending plays untouched: home and lit, chapter complete, the hotel's envelope, the desk
  const desk = page.getByTestId("desk");
  await expect(desk).toHaveAttribute("data-stage", "4", { timeout: 20_000 });
  await page.waitForTimeout(2200);
  await desk.getByTestId("choice-reply").click();
  await expect(desk.getByTestId("joystick-note")).toBeVisible();
  await page.waitForTimeout(4200);
});

test("demo 2: the ending tapped along, then keep for later", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "recorded on desktop");
  test.setTimeout(180_000);
  const mark = recorder("later");
  await fresh(page);
  await page.waitForTimeout(800);
  await circuit(page, mark);
  await tapAlong(page);
  await page.waitForTimeout(1600);
  await page.getByTestId("choice-later").click();
  await page.waitForTimeout(2800);
});
