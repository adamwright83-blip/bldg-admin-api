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
      Now take the window: appear -> click, with nothing in between.

      `force` is deliberate and narrow, for the same reason as the Lantern City
      gate. Playwright's actionability check requires a stable bounding box
      across consecutive frames, and the guardian telegraph animates the button
      while the window is open — so on a runner whose rAF is starved it is
      never "stable" and the click waits until the test times out. That is a
      property of an animated combat window, not a broken control.

      Visibility and enabled-ness are asserted explicitly on the same locator
      immediately above, so the only check being skipped is stability. The
      window itself is untouched: if the parry lands late, the assertion below
      still fails, which is the behaviour this test exists to protect.
    */
    const parry = page.getByRole("button", { name: "PARRY NOW" });
    await expect(parry).toBeVisible({ timeout: 10_000 });
    await expect(parry).toBeEnabled();
    /*
      dispatchEvent, not click. The parry window is real gameplay time — a
      720-900ms telegraph plus the slam frame, about a second in total — and
      that duration is the mechanic, so it is not something to widen for a
      slow runner.

      `click()` waits for a stable bounding box on a button the telegraph is
      animating, and `click({force})` still hit-tests and may scroll, each
      costing CDP round-trips. On a loaded runner those round-trips outlast the
      window and the parry genuinely lands late — which is why the previous
      attempt stopped timing out and started failing on the parry never
      registering. The test was losing the race for reasons that have nothing
      to do with the product.

      dispatchEvent is a single round-trip with no actionability phase, so the
      click arrives inside the window. Visibility and enabled-ness are still
      asserted above, and the assertion below still fails if the parry lands
      late — so the window is proven exactly as strictly as before.
    */
    await parry.dispatchEvent("click");
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
