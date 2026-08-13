import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function openFixture(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/driver?goldlineProgressionFixture=1");
  await expect(page.getByTestId("goldline-progression-harness")).toBeVisible();
  return page.getByTestId("goldline-progression-harness");
}

test.describe("reality-generated progression release proof", () => {
  test("covers the authoritative A-L fixtures without XP, levels, or random quests", async ({
    page,
  }) => {
    const proof = await openFixture(page);
    await expect(proof).toHaveAttribute("data-first-capture", "true");
    await expect(proof).toHaveAttribute("data-scout", "true");
    await expect(proof).toHaveAttribute("data-fake-arcade-capture", "false");
    await expect(proof).toHaveAttribute("data-follow-up-agent", "true");
    await expect(proof).toHaveAttribute("data-verified-recovery", "true");
    await expect(proof).toHaveAttribute("data-gatekeeper", "DEEPENED");
    await expect(proof).toHaveAttribute("data-arcade-gatekeeper", "LOCKED");
    await expect(proof).toHaveAttribute("data-unseen-staller", "LOCKED");
    await expect(proof).toHaveAttribute("data-content-only", "LOCKED");
    await expect(proof).toHaveAttribute("data-stale", "STALE");
    await expect(proof).toHaveAttribute("data-zero-source-candidates", "0");
    await expect(proof).toHaveAttribute(
      "data-identity-b-first-capture",
      "false"
    );
    await expect(proof).toHaveAttribute(
      "data-director-primary",
      "real-recovery"
    );
    await expect(proof).toHaveAttribute("data-challenge-depth", "deepened");
    await expect(proof).toHaveAttribute("data-rule-version", "1");
  });

  test("clearing or tampering with local playback state cannot change the projection", async ({
    page,
  }) => {
    let proof = await openFixture(page);
    await expect(proof).toHaveAttribute("data-scout", "true");

    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "goldline-progression",
        JSON.stringify({
          XP: 999999,
          agentUnlocked: true,
          skillLevel: 99,
          capturedMissionIds: ["fake"],
        })
      );
    });
    await page.reload();
    proof = page.getByTestId("goldline-progression-harness");
    await expect(proof).toHaveAttribute("data-scout", "true");
    await expect(proof).toHaveAttribute("data-fake-arcade-capture", "false");
    await expect(proof).toHaveAttribute(
      "data-identity-b-first-capture",
      "false"
    );
    await expect(proof).toHaveAttribute("data-gatekeeper", "DEEPENED");
  });
});
