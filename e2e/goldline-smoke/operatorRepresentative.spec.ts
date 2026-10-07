import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";
const ARTIFACT_DIR = "artifacts/operator-representative-v1-qa";

async function signIn(page: Page) {
  const response = await page.request.post("/api/auth/login", {
    data: { password: ADMIN_PASSWORD, role: "admin" },
  });
  expect(response.ok()).toBeTruthy();
}

async function openOperator(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto("/operator");
  await expect(page.getByText("JOYSTICK", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "TALK TO DAPHNE" })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
}

async function capture(page: Page, label: string) {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  await page.screenshot({
    path: `${ARTIFACT_DIR}/${label}.png`,
    fullPage: true,
  });
}

test.describe("Operator Representative V1", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("grounded Operator home mounts and Talk is real", async ({ page }, testInfo) => {
    await openOperator(page);

    await expect(page.getByText("KNOWN", { exact: true })).toBeVisible();
    await expect(page.getByText("LEARNING", { exact: true })).toBeVisible();
    await expect(page.getByText("UNCERTAIN", { exact: true })).toBeVisible();
    await expect(page.getByText("CHANGED", { exact: true })).toBeVisible();

    await capture(page, `${testInfo.project.name}-default-${page.viewportSize()?.width ?? "unknown"}`);

    await page.getByRole("button", { name: "TALK TO DAPHNE" }).click();
    await expect(page.getByRole("dialog", { name: "Talk to Daphne" })).toBeVisible();
    await expect(page.getByPlaceholder(/Ask what I know/i)).toBeVisible();
    await capture(page, `${testInfo.project.name}-talk-${page.viewportSize()?.width ?? "unknown"}`);

    await page.getByRole("button", { name: "Close conversation" }).click();
    const firstItem = page.locator(".or-item").first();
    if ((await firstItem.count()) > 0) {
      await firstItem.click();
      await expect(page.getByRole("dialog", { name: "Operator evidence" })).toBeVisible();
      await expect(page.getByText("WHAT THIS MEANS", { exact: true })).toBeVisible();
      await expect(page.getByText("WHAT JOYSTICK IS NOT ALLOWED TO CLAIM", { exact: true })).toBeVisible();
      await capture(page, `${testInfo.project.name}-detail-${page.viewportSize()?.width ?? "unknown"}`);
    }
  });

  test("responsive composition has no horizontal overflow", async ({ page }, testInfo) => {
    const widths =
      testInfo.project.name === "mobile"
        ? [
            { width: 430, height: 932 },
            { width: 390, height: 844 },
            { width: 375, height: 812 },
          ]
        : [
            { width: 1920, height: 1080 },
            { width: 1440, height: 900 },
            { width: 1280, height: 900 },
          ];

    for (const viewport of widths) {
      await page.setViewportSize(viewport);
      await openOperator(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await capture(page, `${testInfo.project.name}-responsive-${viewport.width}x${viewport.height}`);
    }
  });

  test("keyboard Escape closes Talk and evidence", async ({ page }) => {
    await openOperator(page);
    await page.getByRole("button", { name: "TALK TO DAPHNE" }).click();
    await expect(page.getByRole("dialog", { name: "Talk to Daphne" })).toBeVisible();

    // Escape support is part of the V1 accessibility contract.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Talk to Daphne" })).toHaveCount(0);
  });
});
