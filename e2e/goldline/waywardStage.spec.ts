import { expect, test } from "@playwright/test";

const fixture = (capture: string) =>
  `/driver?goldlineStageFixture=wayward&waywardCapture=${capture}`;

test.describe("Wayward authored player truth", () => {
  test("asset failure leaves a visible retry instead of a blank deck", async ({ page }) => {
    await page.route("**/assets/goldline/wayward/bridge-to-mooring-city.webp", route => route.abort());
    await page.goto(fixture("guardian"));
    await expect(page.getByRole("alert")).toContainText("THE DECK DID NOT LOAD");
    await expect(page.getByRole("button", { name: "RETRY APPROACH" })).toBeVisible();
  });

  test("guardian telegraphs and must be parried in its combat window", async ({ page }) => {
    await page.goto(fixture("guardian"));
    const stage = page.getByTestId("wayward-stage");
    await expect(stage).toBeVisible();
    await expect(stage).toHaveAttribute("data-runtime-ready", "true", {
      timeout: 30_000,
    });
    await expect(page.getByText("PARRY · BRONZE BREAKS", { exact: false })).toHaveCount(0);

    /*
      Asset assertions run BEFORE the parry window opens, deliberately.

      They used to sit between "PARRY NOW appeared" and `parry.click()` — a
      page.evaluate plus five loop assertions performed inside a time-limited
      combat window. On a loaded CI runner that unrelated work outlasted the
      window, the button stopped being actionable, and the click waited until
      the test timed out. The gameplay was correct; the test was spending the
      player's parry window on bookkeeping.

      Nothing about the window is widened and no product timing is touched.
      These checks never depended on the guardian's state — they only read
      resources the stage already loaded — so they belong outside it.
    */
    const loadedResources = await page.evaluate(() =>
      performance.getEntriesByType("resource").map(entry => entry.name)
    );
    for (const asset of [
      "bridge-to-mooring-city.webp",
      "awakening-ship-deck.webp",
      "ship-deck-foreground.webp",
      "broken-span-tether-ring.webp",
      "tether-guardian.webp",
    ]) {
      expect(loadedResources.some(resource => resource.includes(asset))).toBe(true);
    }

    /*
      The PARRY NOW label exists only while the product says the guardian is
      parryable, and that window is intentionally short. Keep the readiness
      check and the click in one browser-side polling turn so CI/CDP latency
      cannot spend the player's combat window between separate assertions.

      This does not widen or bypass the mechanic: the button must exist with
      the authored PARRY NOW label and be enabled in the real window. If that
      never occurs, waitForFunction times out and the test fails. The click is
      then dispatched immediately from that same browser turn, after which the
      normal product outcome below must still appear.
    */
    await page.waitForFunction(() => {
      const parry = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find(button => button.textContent?.includes("PARRY NOW"));
      if (!parry || parry.disabled) return false;
      parry.click();
      return true;
    }, undefined, { timeout: 10_000 });

    await expect(page.getByText("PARRY · BRONZE BREAKS", { exact: false })).toBeVisible();
  });

  test("the broken span exposes Linehook as its authored crossing", async ({ page }) => {
    await page.goto(fixture("hook"));
    await expect(page.getByText("The deck ends here", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "LINEHOOK" }).click();
    await expect(page.getByText("THE LINEHOOK BITES", { exact: false })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("MOORING CITY")).toBeVisible({ timeout: 10_000 });
  });

  test("Gold Line and ship machinery visibly progress dormant to waking to active", async ({ page }) => {
    await page.goto(fixture("barrier"));
    await expect(page.getByText("GOLD LINE DORMANT", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "WAKE THE LINE" }).click();
    await expect(page.getByText("GOLD LINE WAKING", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "TETHER WAKING" })).toBeDisabled();
    await expect(page.getByText("GOLD LINE ACTIVE", { exact: false })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "TETHER ACTIVE" })).toBeDisabled();
  });
});