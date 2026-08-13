import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function login(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/driver");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
}

test("external-action resume burst keeps the world mounted and performs no action write", async ({
  page,
}) => {
  const authoritativeWrites: string[] = [];
  page.on("request", request => {
    if (request.method() !== "POST") return;
    const url = request.url();
    if (
      /logCallAttempt|field(StartPreparation|Depart|Arrive|Outcome)|completeFollowUp|rescheduleFollowUp|beginRekindle|runScout/.test(
        url
      )
    ) {
      authoritativeWrites.push(url);
    }
  });

  await login(page);
  await page.waitForTimeout(1_000);
  authoritativeWrites.length = 0;

  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new PageTransitionEvent("pageshow"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(500);

  expect(authoritativeWrites).toEqual([]);
  expect(await page.locator("canvas.goldline-game-canvas").count()).toBe(1);
  await expect(page.getByTestId("goldline-joystick")).toBeVisible();
});
