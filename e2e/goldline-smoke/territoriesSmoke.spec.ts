import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

async function signIn(page: Page, role: "driver" | "admin") {
  const response = await page.request.post("/api/auth/login", {
    data: { password: role === "driver" ? DRIVER_PASSWORD : ADMIN_PASSWORD, role },
  });
  expect(response.ok()).toBeTruthy();
}

test.describe("Goldline territories smoke", () => {
  test("compiler publishes a stable real-member territory", async ({ page }) => {
    await signIn(page, "admin");
    const first = await page.request.get("/api/trpc/system.goldlineWorld.territories");
    expect(first.ok()).toBeTruthy();
    const payload = await first.json();
    const rows = Array.isArray(payload.result?.data) ? payload.result.data : payload.result?.data?.json ?? payload;
    const list = Array.isArray(rows) ? rows : [];
    expect(list.length).toBeGreaterThan(0);
    const territory = list[0];
    expect(territory.definition.members.length).toBeGreaterThanOrEqual(3);
    expect(territory.definition.classification).toBe("game_projection");
    const ids = territory.definition.members.map((member: { physicalEntityId: string }) => member.physicalEntityId);
    expect(new Set(ids).size).toBe(ids.length);

    const second = await page.request.get("/api/trpc/system.goldlineWorld.territories");
    const again = await second.json();
    const list2 = Array.isArray(again.result?.data) ? again.result.data : again.result?.data?.json ?? [];
    expect(list2[0].definition.id).toBe(territory.definition.id);
    expect(list2[0].definition.guardianId).toBe(territory.definition.guardianId);
  });

  test("Lantern City mounts the veil and guardian without treating view as progress", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".gl-territory-veil").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(/goldline-guardian-/).first()).toBeVisible();

    const before = await page.request.get("/api/trpc/system.goldlineWorld.territories");
    const beforeJson = await before.json();
    const beforeState = (Array.isArray(beforeJson.result?.data)
      ? beforeJson.result.data
      : beforeJson.result?.data?.json ?? [])[0]?.state;

    await page.locator(".gl-territory-veil").first().hover({ force: true }).catch(() => undefined);
    await page.reload();
    await expect(page.locator(".gl-territory-veil").first()).toBeVisible({ timeout: 20_000 });

    const after = await page.request.get("/api/trpc/system.goldlineWorld.territories");
    const afterJson = await after.json();
    const afterState = (Array.isArray(afterJson.result?.data)
      ? afterJson.result.data
      : afterJson.result?.data?.json ?? [])[0]?.state;
    expect(afterState?.completedMemberIds ?? []).toEqual(beforeState?.completedMemberIds ?? []);
  });

  test("Driver Overland shows the same guardian presence", async ({ page }) => {
    await signIn(page, "driver");
    await page.addInitScript(() => {
      window.localStorage.setItem("goldline:day1:dismissed", "1");
      window.localStorage.setItem(
        "goldline:onboarding:v1",
        JSON.stringify(["first_entry_explained"])
      );
    });
    await page.goto("/driver");
    await expect(page.getByRole("region", { name: "Goldline global overworld" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("goldline-driver-territory-guardian")).toBeVisible({
      timeout: 20_000,
    });
  });

  test("guardian roster renders six distinct actors", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/growth/guardians");
    await expect(page.getByTestId("goldline-guardian-roster")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Thunder King" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cloud Duchess" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sleepy One-Eye" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tiny Emperor" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gust Jester" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drizzle Detective" })).toBeVisible();
  });
});
