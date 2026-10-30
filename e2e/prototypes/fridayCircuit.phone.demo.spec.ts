import { test } from "@playwright/test";
import { circuit, fresh, recorder, tapAlong } from "./fridayCircuitDemo";

/** The recording for review at phone size: the circuit, the ending tapped along, then "Not for me", all in view. */
test.use({ video: { mode: "on", size: { width: 390, height: 844 } } });

test("demo 3: on a phone, the ending tapped along, then not for me", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "recorded at phone size");
  test.setTimeout(180_000);
  const mark = recorder("not_for_me");
  await fresh(page);
  await page.waitForTimeout(800);
  await circuit(page, mark);
  await tapAlong(page);
  await page.waitForTimeout(1600);
  await page.getByTestId("choice-not_for_me").click();
  await page.waitForTimeout(2800);
});
