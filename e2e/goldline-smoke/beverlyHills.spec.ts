import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";
import { playOtherRodeo } from "../beverly-hills-2d/playthrough";
test.describe("Lantern City → Beverly Hills: The Other Rodeo", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });
  test("plays from the courtyard to the rescue and returns to Lantern City without recording business activity", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    const writes: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("request", r => {
      if (r.method() === "POST" && r.url().includes("/api/trpc/"))
        writes.push(r.url());
    });
    await page.goto("/growth/lantern-city?level=beverly-hills");
    await playOtherRodeo(page);
    await page
      .getByRole("button", { name: "Open Claire’s field notes" })
      .click();
    const journal = page.getByRole("dialog");
    await expect(journal).toContainText(
      "One building. A thoughtful first visit."
    );
    await expect(journal).toContainText("same approved printed hanger");
    await page.getByRole("button", { name: "Close Claire’s journal" }).click();
    await page.getByRole("button", { name: /Lantern City/ }).click();
    await expect(page.locator('[data-lantern-city="islands"]')).toBeVisible({
      timeout: 60_000,
    });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
});
