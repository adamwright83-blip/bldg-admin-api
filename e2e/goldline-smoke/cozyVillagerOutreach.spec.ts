import { expect, test } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

test.describe.configure({ mode: "serial" });

test.describe("Lantern City Cozy Villager Outreach Playable Encounter", () => {
  test.beforeEach(async ({ page }) => {
    await resetGoldlineProofWorld(page.request);
  });

  test("Silver Lake opens as the walkable 3D courtyard with its real neighbours", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/growth/lantern-city?cozy=1");

    const world = page.locator('[data-testid="silver-lake-3d"]');
    await expect(world).toBeVisible({ timeout: 10000 });
    // The courtyard renders, or says plainly that this device cannot run 3D; either way the neighbours stay reachable.
    await expect(
      page.locator('[data-testid="silver-lake-3d-canvas"], [data-testid="silver-lake-3d-unavailable"]').first()
    ).toBeVisible({ timeout: 30000 });
    // The painted 2D encounter is archived and never mounts.
    await expect(page.locator('[data-testid="cozy-neighborhood-encounter"]')).toHaveCount(0);

    // The mission read arrives after the courtyard starts. Every real neighbour has a doorstep (at most 8).
    const villagers = page.getByTestId("silver-lake-villager");
    await expect(villagers.first()).toBeVisible({ timeout: 15000 });
    const count = await villagers.count();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(8);

    expect(errors).toEqual([]);
  });

  test("proves an empty courtyard for a territory without dormant customers", async ({ page }) => {
    await page.goto("/growth/lantern-city?cozy=1&territory=century-city");

    const world = page.locator('[data-testid="silver-lake-3d"]');
    await expect(world).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("silver-lake-no-villagers")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("silver-lake-villager")).toHaveCount(0);
  });

  test("full customer outreach lifecycle: Lantern City -> schedule -> Admin outbox -> edit -> reschedule -> cancel -> refresh", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");

    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    const villagerButtons = page.getByTestId("silver-lake-villager");
    await expect(villagerButtons.first()).toBeVisible({ timeout: 10000 });

    // 1. Select genuine order-backed villager (Mei Lin / Fox Mei)
    const firstVillager = villagerButtons.first();
    const label = await firstVillager.getAttribute("aria-label");
    const customerName = label?.replace(/^Visit\s+/, "") ?? "";
    expect(customerName.length).toBeGreaterThan(0);
    await firstVillager.click();

    // 2. Verify Composer drawer opens with real customer details
    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: customerName })).toBeVisible();

    const uniqueText = `Playwright outreach acceptance text ${Date.now()}. Reply STOP if you don't want these texts.`;
    const textarea = drawer.getByTestId("cozy-message-draft-textarea");
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

    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    const villagerButtons = page.getByTestId("silver-lake-villager");
    await expect(villagerButtons.first()).toBeVisible({ timeout: 10000 });

    const villager = villagerButtons.first();
    await villager.click();

    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();

    const sendNowBtn = drawer.getByRole("button", { name: /SEND NOW/i });
    await expect(sendNowBtn).toBeEnabled();
    await sendNowBtn.click();

    await expect(drawer.getByText(/Saved for your phone\. Not sent\./i)).toBeVisible({
      timeout: 5000,
    });
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
    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible({ timeout: 15_000 });
    const villager = page.getByTestId("silver-lake-villager").first();
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

    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible();

    const villagerButtons = page.getByTestId("silver-lake-villager");
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
    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible({ timeout: 10000 });

    const returnBtn = page.getByRole("button", { name: /Return to (Wide )?City/i });
    await expect(returnBtn).toBeVisible({ timeout: 10000 });
    await returnBtn.click();

    await expect(encounter).toHaveCount(0);
    await expect(page.locator('[data-lantern-city="islands"]')).toBeVisible({ timeout: 15000 });
  });

  test("opens the named Silver Lake customer and hands the exact text to Google Messages", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      viewport: { width: 390, height: 844 },
      timezoneId: "America/Los_Angeles",
    });
    const page = await context.newPage();
    await resetGoldlineProofWorld(page.request);
    await page.addInitScript(() => {
      window.localStorage.setItem("goldline.silverLake.legacy", "1");
      window.localStorage.setItem("goldline:day1:dismissed", "1");
      window.localStorage.setItem(
        "goldline:onboarding:v1",
        JSON.stringify(["first_entry_explained"])
      );
    });

    await page.goto(
      "/growth/lantern-city?cozy=1&territory=silver-lake&customer=phone%3A3105550141"
    );
    const encounter = page.locator('[data-testid="silver-lake-3d"]');
    await expect(encounter).toBeVisible({ timeout: 15_000 });
    const villagers = page.getByTestId("silver-lake-villager");
    await expect(villagers).toHaveCount(1, { timeout: 15_000 });
    const villager = villagers.first();
    await expect(villager).toHaveAttribute("data-customer-id", "phone:3105550141");
    await expect(villager).toHaveAttribute("data-house-title", /Cottage/);
    await expect(villager).not.toHaveAttribute("data-pose", "acknowledged");
    await expect(page.locator('[data-customer-id="phone:3105550199"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Visit Rex Out" })).toHaveCount(0);

    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(drawer).toHaveAttribute("data-customer-id", "phone:3105550141");
    await expect(drawer.getByText(/orders \(\$/)).toBeVisible();
    await expect(drawer.getByText(/days since last order/)).toBeVisible();

    const textarea = drawer.getByTestId("cozy-message-draft-textarea");
    const suggested = await textarea.inputValue();
    expect(suggested).toMatch(/Hey Mei/i);
    expect(suggested).toMatch(/Reply STOP/i);
    const approved = suggested.replace(
      "We can take laundry off your plate when you want.",
      "We can take laundry off your plate this week when you want."
    );
    expect(approved).toMatch(/Reply STOP/i);
    expect(approved).not.toBe(suggested);
    await textarea.fill(approved);
    await drawer.getByRole("button", { name: "APPROVE" }).click();
    await expect(drawer.locator("[data-sms-approval='current']")).toBeVisible();
    await drawer.getByRole("button", { name: "OPEN IN SMS" }).click();

    const link = drawer.locator("[data-sms-open='google-messages']");
    await expect(link).toBeVisible({ timeout: 15_000 });
    const href = await link.getAttribute("href");
    expect(href).toContain("intent://");
    expect(href).toContain("com.google.android.apps.messaging");
    expect(href).toContain("action=android.intent.action.VIEW");
    expect(href).not.toContain("sms_body");
    expect(href).not.toContain("body=");
    await expect(drawer.locator("[data-sms-copy-fallback]")).toHaveValue(approved);
    await expect(drawer.locator("[data-verified-sent='false']")).toBeVisible();
    await expect(drawer.locator("[data-body-prefill-claimed='false']")).toBeVisible();
    await expect(drawer.locator("[data-villager-pose='idle']")).toBeVisible();
    await expect(villager).not.toHaveAttribute("data-pose", "acknowledged");
    await expect(villager).not.toHaveAttribute("data-communication-state", "send_observed");

    await page.reload();
    await expect(encounter).toBeVisible({ timeout: 15_000 });
    // the neighbours list fills once the mission read returns, while the 3D courtyard loads alongside it
    await expect(villager).toHaveAttribute("data-customer-id", "phone:3105550141", { timeout: 15_000 });
    await expect(villager).not.toHaveAttribute("data-communication-state", "send_observed");

    await page.goto("/driver");
    await expect(page.getByTestId("driver-day-home")).toBeVisible({ timeout: 30_000 });
    const card = page.getByTestId("recovery-outreach-day-line-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toHaveAttribute("data-customer-id", "phone:3105550141");
    await expect(card).toHaveAttribute("data-objective-complete", "false");
    await expect(card).not.toHaveAttribute("data-communication-state", "send_observed");
    await expect(card.locator(".gdp-card-kicker strong")).toHaveText("OPEN");
    const messageId = await card.getAttribute("data-message-id");
    expect(messageId && messageId.length > 0).toBeTruthy();
    await page.reload();
    await expect(card).toHaveAttribute("data-message-id", messageId!);
    await expect(card).toHaveAttribute("data-customer-id", "phone:3105550141");
    await expect(card).toHaveAttribute("data-objective-complete", "false");
    await context.close();
  });

  test("refuses an opt-out and a phone that is not a relationship", async ({ page }) => {
    const scheduledFor = new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString();
    const body = "Hey there. Reply STOP if you don't want these texts.";
    const optOut = await page.request.post("/api/trpc/system.goldlineWorld.scheduleCozyOutreach", {
      data: {
        json: {
          customerId: "phone:3105550199",
          messageBody: body,
          scheduledFor,
          timezone: "America/Los_Angeles",
          territoryId: "silver-lake",
          idempotencyKey: "day-line-recovery:negative:phone:3105550199",
        },
      },
    });
    const optOutBody = await optOut.text();
    expect(optOut.ok(), optOutBody).toBeFalsy();
    expect(optOutBody).toMatch(/opt-out/i);
    expect(optOutBody).toMatch(/never bypassed/i);

    const stranger = await page.request.post("/api/trpc/system.goldlineWorld.scheduleCozyOutreach", {
      data: {
        json: {
          customerId: "phone:3105550100",
          messageBody: body,
          scheduledFor,
          timezone: "America/Los_Angeles",
          territoryId: "silver-lake",
          idempotencyKey: "day-line-recovery:negative:phone:3105550100",
        },
      },
    });
    const strangerBody = await stranger.text();
    expect(stranger.ok(), strangerBody).toBeFalsy();
    expect(strangerBody).toMatch(/not an existing relationship/i);
    expect(strangerBody).toMatch(/not proof that nobody is inactive/i);

    const listed = await page.request.get("/api/trpc/system.goldlineWorld.listScheduledOutreach");
    expect(listed.ok(), await listed.text()).toBeTruthy();
    const listedText = JSON.stringify(await listed.json());
    expect(listedText).not.toContain("phone:3105550199");
    expect(listedText).not.toContain("phone:3105550100");
  });
});
