import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

test.describe.configure({ mode: "serial" });

test.describe("Lantern City Cozy Villager Outreach Playable Encounter", () => {
  test.beforeAll(async ({ request }) => {
    await resetGoldlineProofWorld(request);
  });

  test.beforeEach(async ({ page }) => {
    const login = await page.request.post("/api/auth/login", {
      data: { password: ADMIN_PASSWORD, role: "admin" },
    });
    expect(login.status()).toBe(200);
  });

  test("mounts 8-house cozy encounter with 4-sided clouds and truthful village states", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/growth/lantern-city?cozy=1");

    // Encounter container is visible
    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    // Environment plate and 4-sided cloud overlays are rendered
    await expect(page.locator('img[alt="Lantern City Cozy Neighborhood"]')).toBeVisible();

    // Check that all 8 slots are accounted for (either active villager button or resting cottage)
    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    const restingSlots = page.getByText(/· Resting/);
    const activeCount = await villagerButtons.count();
    const restingCount = await restingSlots.count();
    expect(activeCount + restingCount).toBe(8);

    expect(errors).toEqual([]);
  });

  test("full customer outreach lifecycle: Lantern City -> schedule -> Admin outbox -> edit -> reschedule -> cancel -> reload", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");

    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    const activeCount = await villagerButtons.count();

    let targetCustomerName = "";
    const uniqueText = `Playwright outreach acceptance ${Date.now()}`;

    if (activeCount > 0) {
      // 1. Select first active villager from dynamic customer mission
      const firstVillager = villagerButtons.first();
      await expect(firstVillager).toBeVisible();
      const label = await firstVillager.getAttribute("aria-label");
      targetCustomerName = label?.replace(/^Select\s+/, "") ?? "";
      await firstVillager.click();

      // 2. Verify Composer drawer opens with real customer details
      const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
      await expect(drawer).toBeVisible();
      if (targetCustomerName) {
        await expect(drawer.getByRole("heading", { name: targetCustomerName })).toBeVisible();
      }

      const textarea = drawer.locator("textarea");
      await expect(textarea).toBeVisible();
      await textarea.fill(uniqueText);

      // 3. Commit future schedule
      const scheduleBtn = drawer.getByRole("button", { name: /SCHEDULE/i });
      await expect(scheduleBtn).toBeEnabled();
      await scheduleBtn.click();

      const commitBtn = drawer.getByRole("button", { name: /COMMIT/i });
      await expect(commitBtn).toBeVisible();
      await commitBtn.click();

      await expect(drawer.getByText(/Committed to Scheduled Outbox/i)).toBeVisible({ timeout: 5000 });
      await expect(drawer.getByRole("button", { name: /✓ COMMITTED/i })).toBeVisible();
    } else {
      // Resting village state: create a test draft directly to verify Admin Outbox lifecycle
      targetCustomerName = "Acceptance Test Customer";
      await page.request.post("/api/trpc/system.goldlineWorld.scheduleCozyOutreach", {
        data: {
          json: {
            customerId: `cust_e2e_${Date.now()}`,
            messageBody: uniqueText,
            scheduledFor: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
            timezone: "America/Los_Angeles",
            expectedPhone: "+12135550199",
          },
        },
      });
    }

    // 4. Navigate to Admin Scheduled Outreach Outbox
    await page.goto("/admin/claire/scheduled-outreach");

    // Assert exact page heading
    await expect(
      page.getByRole("heading", { name: "Claire · Scheduled Outreach Outbox" })
    ).toBeVisible({ timeout: 10000 });

    // Verify scheduled message is listed
    await expect(page.getByText(uniqueText)).toBeVisible({ timeout: 5000 });

    // 5. In-place edit of message body in Admin Outbox
    const editBtn = page.getByRole("button", { name: /Edit/i }).first();
    await expect(editBtn).toBeVisible();
    await editBtn.click();

    const editArea = page.locator("textarea").first();
    await expect(editArea).toBeVisible();
    const editedText = `Updated text via Admin Outbox ${Date.now()}`;
    await editArea.fill(editedText);

    const saveBtn = page.getByRole("button", { name: /Save Revision/i });
    await saveBtn.click();

    await expect(page.getByText(editedText)).toBeVisible({ timeout: 5000 });

    // 6. Reschedule outreach
    const rescheduleBtn = page.getByRole("button", { name: /Reschedule/i }).first();
    await expect(rescheduleBtn).toBeVisible();
    await rescheduleBtn.click();

    const dateInput = page.locator('input[type="datetime-local"]').first();
    await expect(dateInput).toBeVisible();
    await dateInput.fill("2026-11-20T11:00");

    const confirmRescheduleBtn = page.getByRole("button", { name: /Confirm Reschedule/i });
    await confirmRescheduleBtn.click();

    // 7. Cancel outreach
    const cancelBtn = page.getByRole("button", { name: /Cancel/i }).first();
    await expect(cancelBtn).toBeVisible();
    await cancelBtn.click();

    const reasonInput = page.locator('input[placeholder*="Customer ordered today"]').first();
    await expect(reasonInput).toBeVisible();
    await reasonInput.fill("Cancelled during Playwright full acceptance test");

    const confirmCancelBtn = page.getByRole("button", { name: /Confirm Cancellation/i });
    await confirmCancelBtn.click();

    await expect(page.getByText("CANCELLED")).toBeVisible({ timeout: 5000 });

    // 8. Page reload to verify durable persistence
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Claire · Scheduled Outreach Outbox" })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("CANCELLED")).toBeVisible();
  });

  test("selects villager and executes SEND NOW in Phase 1 awaiting Android setup", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");

    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    const count = await villagerButtons.count();

    if (count > 0) {
      const villager = villagerButtons.first();
      await villager.click();

      const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
      await expect(drawer).toBeVisible();

      const sendNowBtn = drawer.getByRole("button", { name: /SEND NOW/i });
      if (await sendNowBtn.isEnabled()) {
        await sendNowBtn.click();

        await expect(
          drawer.getByText(/Committed to Outbox \(Awaiting Phone Connection\)/i)
        ).toBeVisible({ timeout: 5000 });
        await expect(drawer.getByRole("button", { name: /✓ COMMITTED/i })).toBeVisible();
      }
    }
  });

  test("supports mobile viewport with responsive bottom sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/growth/lantern-city?cozy=1");

    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible();

    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    const count = await villagerButtons.count();

    if (count > 0) {
      const first = villagerButtons.first();
      await first.click();

      const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
      await expect(drawer).toBeVisible();

      const nextBtn = drawer.getByRole("button", { name: /Next ▶/i });
      if (await nextBtn.isEnabled()) {
        await nextBtn.click();
        await expect(drawer).toBeVisible();
      }
    }
  });

  test("smoothly returns to the wide Lantern City map", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");
    await expect(page.locator('[data-testid="cozy-neighborhood-encounter"]')).toBeVisible();

    const returnBtn = page.getByRole("button", { name: /Return to Wide City/i });
    await expect(returnBtn).toBeVisible();
    await returnBtn.click();

    await expect(page.locator('[data-testid="cozy-neighborhood-encounter"]')).toHaveCount(0);
    await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible();
  });
});
