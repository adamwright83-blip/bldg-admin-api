import { expect, test, type Page } from "@playwright/test";

const PORTRAIT = { width: 412, height: 923 };
const LANDSCAPE = { width: 923, height: 412 };
const KEYBOARD_LIKE = { width: 412, height: 560 };
const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";

async function login(page: Page) {
  // First-entry explainer only shows once per player identity (see
  // onboardingProgress.ts) and would otherwise intercept pointer events
  // for every test that doesn't care about it.
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "goldline:onboarding:v1",
      JSON.stringify(["first_entry_explained"])
    );
  });
  const response = await page.request.post("/api/auth/login", {
    data: { password: DRIVER_PASSWORD, role: "driver" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/driver");
  await expect(page.getByTestId("goldline-shell")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("goldline-shell")).toHaveAttribute(
    "data-goldline-mobile-viewport",
    "true"
  );
}

async function assertViewportFill(
  page: Page,
  size: { width: number; height: number }
) {
  await page.setViewportSize(size);
  await page.waitForTimeout(350);

  const [shell, world, joystick] = await Promise.all([
    page.getByTestId("goldline-shell").boundingBox(),
    page.getByTestId("goldline-world").boundingBox(),
    page.getByTestId("goldline-joystick").boundingBox(),
  ]);

  expect(shell).not.toBeNull();
  expect(world).not.toBeNull();
  expect(joystick).not.toBeNull();
  expect(shell!.width).toBeGreaterThanOrEqual(size.width * 0.94);
  expect(shell!.height).toBeGreaterThanOrEqual(size.height * 0.9);
  expect(world!.width).toBeGreaterThanOrEqual(size.width * 0.94);
  expect(world!.height).toBeGreaterThanOrEqual(size.height * 0.9);
  expect(joystick!.width).toBeGreaterThanOrEqual(48);
  expect(joystick!.height).toBeGreaterThanOrEqual(48);

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

test("Pixel-class viewport survives portrait, landscape, and recovery", async ({
  page,
}) => {
  await login(page);
  await assertViewportFill(page, PORTRAIT);
  await assertViewportFill(page, LANDSCAPE);
  await assertViewportFill(page, PORTRAIT);
});

test("visual viewport shrink and recovery does not leave Goldline collapsed", async ({
  page,
}) => {
  await login(page);
  await assertViewportFill(page, PORTRAIT);
  await assertViewportFill(page, KEYBOARD_LIKE);
  await assertViewportFill(page, PORTRAIT);
});
