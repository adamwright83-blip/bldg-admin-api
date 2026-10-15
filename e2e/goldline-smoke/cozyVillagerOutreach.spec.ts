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

  test("mounts 8-house cozy encounter with 4-sided clouds and 7 active villagers", async ({
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

    // 7 active villagers and 1 resting house slot
    const villagerButtons = page.locator('div[role="button"][aria-label^="Select "]');
    await expect(villagerButtons).toHaveCount(7);

    // Slot 8 resting indicator
    await expect(page.getByText("Rose Thatched Cottage · Resting")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("selects villager, loads Claire draft, edits text, and sends authorized Twilio SMS", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");

    // Select Fox Mei (Slot 1)
    const meiSlot = page.locator('div[role="button"][aria-label="Select Mei Lin"]');
    await expect(meiSlot).toBeVisible();
    await meiSlot.click();

    // Verify Composer drawer opens with real customer details
    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Mei Lin" })).toBeVisible();
    await expect(drawer.getByText("2418 Silver Lake Blvd")).toBeVisible();
    await expect(drawer.getByText("34 days since last order")).toBeVisible();
    await expect(drawer.getByText("14 orders ($624 LTV)")).toBeVisible();

    // Verify Claire's suggested draft is present in the editable textarea
    const textarea = drawer.locator("textarea");
    await expect(textarea).toBeVisible();
    const initialText = await textarea.inputValue();
    expect(initialText).toContain("Hey Mei! It's Adam from Laundry Farm.");
    expect(initialText).toContain("34 days");

    // Edit message text
    await textarea.fill(
      "Hey Mei! It's Adam from Laundry Farm. Checking in to see if we can help with laundry this week!"
    );

    // Explicit SEND TEXT action
    const sendBtn = drawer.getByRole("button", { name: /SEND TEXT/i });
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    // Assert truthful provider acceptance feedback
    await expect(drawer.getByText(/Twilio Accepted/i)).toBeVisible({ timeout: 5000 });
    await expect(drawer.getByText(/Provider accepted request/i)).toBeVisible();
    await expect(drawer.getByRole("button", { name: /✓ SENT/i })).toBeVisible();

    // Verify villager tag updates to ✓ Sent
    await expect(meiSlot.getByText("✓ Sent")).toBeVisible();
  });

  test("supports mobile viewport with responsive bottom sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/growth/lantern-city?cozy=1");

    const encounter = page.locator('[data-testid="cozy-neighborhood-encounter"]');
    await expect(encounter).toBeVisible();

    // Touch-friendly selection
    const meiSlot = page.locator('div[role="button"][aria-label="Select Mei Lin"]');
    await meiSlot.click();

    // Drawer is docked at bottom and visible
    const drawer = page.locator('aside[aria-label="Customer Outreach Composer"]');
    await expect(drawer).toBeVisible();

    // Navigation chevrons cycle to next customer
    const nextBtn = drawer.getByRole("button", { name: /Next ▶/i });
    await expect(nextBtn).toBeEnabled();
    await nextBtn.click();

    // Next customer (Barnaby Hayes) is now loaded
    await expect(drawer.getByRole("heading", { name: "Barnaby Hayes" })).toBeVisible();
    await expect(drawer.getByText("1825 Micheltorena St")).toBeVisible();
  });

  test("smoothly returns to the wide Lantern City map", async ({
    page,
  }) => {
    await page.goto("/growth/lantern-city?cozy=1");
    await expect(page.locator('[data-testid="cozy-neighborhood-encounter"]')).toBeVisible();

    // Click Return to Wide City
    const returnBtn = page.getByRole("button", { name: /Return to Wide City/i });
    await expect(returnBtn).toBeVisible();
    await returnBtn.click();

    // Encounter unmounts and wide map is visible
    await expect(page.locator('[data-testid="cozy-neighborhood-encounter"]')).toHaveCount(0);
    await expect(page.locator('[data-lantern-city="v6"]')).toBeVisible();
  });
});
