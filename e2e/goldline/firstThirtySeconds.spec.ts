import { expect, test, type Page } from "@playwright/test";

/**
 * The first 30 seconds must produce an actual next action, not merely explain
 * that Goldline has no work. A fresh player first gets the compact product
 * explanation. If authoritative work exists the world points to it; if the
 * real day is empty, Open Channel immediately asks the operator to brief
 * today/tomorrow so the next mission can be created from user-confirmed truth.
 */
test.describe.configure({ timeout: 90_000 });

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function loginFresh(page: Page) {
  await page.addInitScript(() => {
    Object.keys(window.localStorage)
      .filter(key => key.startsWith("goldline:"))
      .forEach(key => window.localStorage.removeItem(key));
  });
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  // Use the deterministic empty-day fixture here because it is the failure
  // mode that previously left the user walking around with nothing to do.
  await page.goto("/driver?goldlineFixture=NEUTRALIZE&goldlineEmptyDay=1");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({ timeout: 30_000 });
}

test.describe("first 30 seconds produce a real next action", () => {
  test("fresh empty day explains the game, then immediately asks for the real-day briefing", async ({ page }) => {
    await loginFresh(page);

    const explainer = page.getByTestId("first-entry-explainer");
    await expect(explainer).toBeVisible();
    await expect(explainer).toContainText("YOUR BUSINESS IS THE ADVENTURE");
    await expect(explainer).toContainText("Follow the Gold Line");
    await expect(explainer).toContainText("Do the real action");
    await expect(explainer).toContainText("Goldline updates from the real result");

    await explainer.getByRole("button", { name: "GOT IT" }).click();
    await expect(explainer).toHaveCount(0);

    // The previous version considered NO ACTIVE OBJECTIVE sufficient. It is
    // not. With no real work loaded, the player must immediately receive the
    // action that creates a truthful plan from their own briefing.
    const briefing = page.getByTestId("empty-day-briefing");
    await expect(briefing).toBeVisible();
    await expect(briefing).toContainText("BRIEF ME");
    await expect(page.locator(".open-channel-dialogue")).toContainText(/today and tomorrow/i);
    await expect(page.locator(".open-channel-dialogue")).toContainText(/duties|promises|goals/i);

    // The world behind the briefing remains honest: the briefing is an input
    // mechanic for creating a proposed mission, not a fabricated objective.
    await expect(page.getByTestId("no-active-objective")).toContainText(
      "NO ACTIVE OBJECTIVE"
    );
    await expect(page.getByText("MOVE TO NEXT ACTION ZONE")).toHaveCount(0);
  });
});
