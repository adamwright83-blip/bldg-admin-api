import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

test.describe.configure({ mode: "serial" });

test.describe("Lantern City Cozy Villager Outreach Playable Encounter", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });

  test("mounts 8-house cozy encounter with 4-sided clouds and truthful village layout", async ({
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

    // The mission read arrives after the cottages paint. Wait for the bound customer.
    await expect(page.locator("[data-customer-id]").first()).toBeVisible({
      timeout: 15000,
    });

    // Check that all 8 slots are accounted for (either active villager button or resting cottage)
    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    const restingSlots = page.getByText(/· Resting/);
    await expect(villagerButtons.first()).toBeVisible({ timeout: 15000 });
    const activeCount = await villagerButtons.count();
    const restingCount = await restingSlots.count();
    expect(activeCount + restingCount).toBe(8);
    expect(activeCount).toBeGreaterThanOrEqual(1);

    expect(errors).toEqual([]);
  });

  test("proves empty-village resting state for territory without dormant customers", async ({
    page,
  }) => {
    // Navigate to a territory without dormant customers
    await page.goto("/growth/lantern-city?cozy=1&territory=century-city");

    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    // All 8 houses show resting state
    const restingLabels = page.getByText(/· Resting/);
    await expect(restingLabels).toHaveCount(8);

    // Zero active selectable villager buttons
    const activeVillagers = page.locator('div[role="button"][aria-label^="Select "]');
    await expect(activeVillagers).toHaveCount(0);
  });

  test("full customer outreach lifecycle: Lantern City -> schedule -> Admin outbox -> edit -> reschedule -> cancel -> refresh", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");

    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    await expect(villagerButtons.first()).toBeVisible({ timeout: 10000 });

    // 1. Select genuine order-backed villager (Mei Lin / Fox Mei)
    const firstVillager = villagerButtons.first();
    const label = await firstVillager.getAttribute("aria-label");
    const customerName = label?.replace(/^Select\s+/, "") ?? "";
    expect(customerName.length).toBeGreaterThan(0);
    await firstVillager.click();

    // 2. Verify Composer drawer opens with real customer details
    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: customerName })).toBeVisible();

    const uniqueText = `Playwright outreach acceptance text ${Date.now()}`;
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

    await expect(drawer.getByText(/Scheduled — not sent/i)).toBeVisible({ timeout: 5000 });
    await expect(drawer).toHaveAttribute("data-communication-state", "scheduled");
    await expect(drawer.getByRole("button", { name: /✓ COMMITTED/i })).toBeVisible();
    await expect(drawer.getByText(/Simulated send observed/i)).toHaveCount(0);

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

    // 6. Reschedule outreach using dynamically computed date
    const rescheduleBtn = page.getByRole("button", { name: /Reschedule/i }).first();
    await expect(rescheduleBtn).toBeVisible();
    await rescheduleBtn.click();

    const dateInput = page.locator('input[type="datetime-local"]').first();
    await expect(dateInput).toBeVisible();

    // Dynamic future date: 5 days from now at 14:00
    const futureDate = new Date(Date.now() + 5 * 86400000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const dynamicDateIso = `${futureDate.getFullYear()}-${pad(futureDate.getMonth() + 1)}-${pad(futureDate.getDate())}T14:00`;
    await dateInput.fill(dynamicDateIso);

    const confirmRescheduleBtn = page.getByRole("button", { name: /Confirm Reschedule/i });
    await confirmRescheduleBtn.click();
    await expect(confirmRescheduleBtn).not.toBeVisible({ timeout: 5000 });

    // 7. Cancel outreach with reason (exact match 'Cancel' to avoid matching the 'Cancelled' filter tab)
    const cancelBtn = page.getByRole("button", { name: "Cancel", exact: true }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    await cancelBtn.click();

    const reasonInput = page.locator('input[placeholder*="Customer ordered today"]').first();
    await expect(reasonInput).toBeVisible({ timeout: 5000 });
    await reasonInput.fill("Cancelled during Playwright full acceptance test");

    const confirmCancelBtn = page.getByRole("button", { name: /Confirm Cancellation/i });
    await confirmCancelBtn.click();

    await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible({ timeout: 5000 });

    // 8. Refresh page to verify durable persistence of cancelled status
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Claire · Scheduled Outreach Outbox" })
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("CANCELLED", { exact: true })).toBeVisible();
  });

  test("selects villager and executes SEND NOW in Phase 1 awaiting Android setup", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");

    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    await expect(villagerButtons.first()).toBeVisible({ timeout: 10000 });

    const villager = villagerButtons.first();
    await villager.click();

    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();

    const sendNowBtn = drawer.getByRole("button", { name: /SEND NOW/i });
    await expect(sendNowBtn).toBeEnabled();
    await sendNowBtn.click();

    await expect(
      drawer.getByText(/Committed to Outbox \(Awaiting Phone Connection\)/i)
    ).toBeVisible({ timeout: 5000 });
    await expect(drawer).toHaveAttribute("data-communication-state", "awaiting_sender");
    await expect(drawer.getByRole("button", { name: /✓ COMMITTED/i })).toBeVisible();
    await expect(villager).toHaveAttribute("data-pose", "wave");
    await expect(drawer.getByText(/Simulated send observed/i)).toHaveCount(0);
  });

  test("Day Line card keeps the same objective-area customer open after a schedule", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      window.localStorage.setItem("goldline:day1:dismissed", "1");
      window.localStorage.setItem(
        "goldline:onboarding:v1",
        JSON.stringify(["first_entry_explained"])
      );
    });

    await page.goto("/growth/lantern-city?cozy=1");
    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible({ timeout: 15_000 });
    const villager = page.locator('div[role="button"][aria-label^="Select "]').first();
    await expect(villager).toBeVisible({ timeout: 10_000 });
    const customerId = await villager.getAttribute("data-customer-id");
    expect(customerId).toBeTruthy();
    await expect(villager).toHaveAttribute("data-communication-state", "draft_prepared");
    await villager.click();

    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("data-customer-id", customerId!);
    await expect(drawer).toHaveAttribute("data-communication-state", "draft_prepared");

    await page.goto("/driver");
    await expect(page.getByTestId("driver-day-home")).toBeVisible({ timeout: 30_000 });
    const card = page.getByTestId("recovery-outreach-day-line-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-objective-complete", "false");
    await expect(card).toHaveAttribute(
      "data-objective-id",
      "dgoal_proof_silver_lake_objective"
    );
    await expect(card).toHaveAttribute("data-customer-id", customerId!);
    await expect(card).toHaveAttribute("data-communication-state", "draft_prepared");
    await expect(card.locator(".gdp-card-kicker strong")).toHaveText("OPEN");

    await page.goto("/growth/lantern-city?cozy=1");
    await expect(encounter).toBeVisible({ timeout: 15_000 });
    await villager.click();
    await drawer.getByRole("button", { name: /SCHEDULE/i }).click();
    await drawer.getByRole("button", { name: /COMMIT/i }).click();
    await expect(drawer.getByText(/Scheduled — not sent/i)).toBeVisible({ timeout: 10_000 });
    await expect(drawer).toHaveAttribute("data-communication-state", "scheduled");
    await expect(villager).toHaveAttribute("data-communication-state", "scheduled");
    await expect(villager).toHaveAttribute("data-pose", "wave");

    await page.reload();
    await expect(encounter).toBeVisible({ timeout: 15_000 });
    await expect(villager).toHaveAttribute("data-customer-id", customerId!);
    await expect(villager).toHaveAttribute("data-communication-state", "scheduled");

    await page.goto("/driver");
    await expect(page.getByTestId("driver-day-home")).toBeVisible({ timeout: 30_000 });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-customer-id", customerId!);
    await expect(card).toHaveAttribute("data-communication-state", "scheduled");
    await expect(card).toHaveAttribute("data-objective-complete", "false");
    await expect(card.locator(".gdp-card-kicker strong")).toHaveText("OPEN");
    const messageId = await card.getAttribute("data-message-id");
    expect(messageId && messageId.length > 0).toBeTruthy();

    await page.reload();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-message-id", messageId!);
    await expect(card).toHaveAttribute("data-objective-complete", "false");
    await expect(card).toHaveAttribute("data-customer-id", customerId!);
  });

  test("supports mobile viewport with responsive bottom sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/growth/lantern-city?cozy=1");

    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible();

    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    await expect(villagerButtons.first()).toBeVisible({ timeout: 10000 });

    const first = villagerButtons.first();
    await first.click();

    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();

    const nextBtn = drawer.getByRole("button", { name: /Next ▶/i });
    if (await nextBtn.isEnabled()) {
      await nextBtn.click();
      await expect(drawer).toBeVisible();
    }
  });

  test("smoothly returns to the wide Lantern City map", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");
    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    const returnBtn = page.getByRole("button", { name: /Return to (Wide )?City/i });
    await expect(returnBtn).toBeVisible({ timeout: 10000 });
    await returnBtn.click();

    await expect(encounter).toHaveCount(0);
    await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible({ timeout: 10000 });
  });
});
