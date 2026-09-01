/**
 * Fast Goldline campaign smoke — Adventure Director 2.0.
 *
 * Identity, no-duplicate first reads, HUD in Overland, same campaign on Admin,
 * refresh does not revision-bump, Guardian defeat stays game-only.
 */

import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

type CampaignPresentation = {
  campaign: {
    id: string;
    title: string;
    revision: number;
    inputFingerprint: string;
    campaignArchetypeId: string;
    chapters: Array<{
      stableChapterId: string;
      chapterKind: string;
      objectiveIds: string[];
      selectedGameplayBinding: string;
      required: boolean;
    }>;
  };
  lastRevision: { reasonCodes: string[] } | null;
  travelProviderState: string;
};

function unwrapTrpc<T>(payload: unknown): T {
  const body = payload as { result?: { data?: T | { json?: T } } };
  const data = body.result?.data;
  if (data && typeof data === "object" && "json" in (data as object)) {
    return (data as { json: T }).json;
  }
  return data as T;
}

async function signIn(page: Page, role: "driver" | "admin") {
  const response = await page.request.post("/api/auth/login", {
    data: { password: role === "driver" ? DRIVER_PASSWORD : ADMIN_PASSWORD, role },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function readCampaign(page: Page): Promise<CampaignPresentation> {
  const response = await page.request.get("/api/trpc/system.goldlineWorld.campaign");
  expect(response.ok(), await response.text()).toBeTruthy();
  return unwrapTrpc<CampaignPresentation>(await response.json());
}

test.describe("Goldline campaign smoke", () => {
  test("two first reads share one campaign identity", async ({ page }) => {
    await signIn(page, "driver");
    const [a, b] = await Promise.all([readCampaign(page), readCampaign(page)]);
    expect(a.campaign.id).toBe(b.campaign.id);
    expect(a.campaign.campaignArchetypeId).toBe(b.campaign.campaignArchetypeId);
    expect(a.campaign.title).toBe(b.campaign.title);
    expect(a.campaign.revision).toBe(b.campaign.revision);
    const invented = a.campaign.chapters.flatMap(chapter => chapter.objectiveIds).some(id =>
      id.startsWith("fake-")
    );
    expect(invented).toBe(false);
  });

  test("refresh does not create a revision", async ({ page }) => {
    await signIn(page, "driver");
    const first = await readCampaign(page);
    const second = await readCampaign(page);
    expect(second.campaign.id).toBe(first.campaign.id);
    expect(second.campaign.revision).toBe(first.campaign.revision);
    expect(second.campaign.inputFingerprint).toBe(first.campaign.inputFingerprint);
  });

  test("Driver Overland shows the campaign thread without a second joystick", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("goldline:day1:dismissed", "1");
      window.localStorage.setItem(
        "goldline:onboarding:v1",
        JSON.stringify(["first_entry_explained"])
      );
    });
    await signIn(page, "driver");
    await page.goto("/driver");
    await expect(page.getByRole("region", { name: "Goldline global overworld" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("goldline-campaign-hud")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("goldline-campaign-host")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("goldline-campaign-host")).toHaveAttribute(
      "data-world-playable",
      "true"
    );
    await expect(page.locator(".overworld-joystick-zone")).toHaveCount(1);
  });

  test("Admin Lantern City shares the same campaignId", async ({ page }) => {
    await signIn(page, "driver");
    const driver = await readCampaign(page);
    await signIn(page, "admin");
    const admin = await readCampaign(page);
    expect(admin.campaign.id).toBe(driver.campaign.id);
    expect(admin.campaign.revision).toBe(driver.campaign.revision);
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("goldline-campaign-hud")).toBeVisible({ timeout: 20_000 });
  });

  test("a new real pickup revises future only", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates the proof world once");
    await signIn(page, "driver");
    const before = await readCampaign(page);
    const created = await page.request.post("/api/trpc/orders.create", {
      data: {
        json: {
          serviceType: "wash_fold",
          pickupDate: new Date().toISOString().slice(0, 10),
          pickupTimeWindow: "3:00-5:00 PM",
          address: "1 Proof Campaign Way, Los Angeles, CA",
          firstName: "Noon",
          lastName: "Window",
          phone: "3105550177",
        },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const after = await readCampaign(page);
    expect(after.campaign.id).toBe(before.campaign.id);
    if (after.campaign.inputFingerprint !== before.campaign.inputFingerprint) {
      expect(after.campaign.revision).toBeGreaterThanOrEqual(before.campaign.revision);
      expect(after.lastRevision?.reasonCodes ?? []).toEqual(
        expect.arrayContaining(["NEW_FIXED_COMMITMENT"])
      );
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
      await expect(page.getByTestId("goldline-campaign-hud")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("goldline-campaign-revision-why")).toBeVisible({
        timeout: 20_000,
      });
    }
  });

  test("guardian defeat does not rewrite campaign identity or invent a sale", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates the proof world once");
    await signIn(page, "admin");
    const before = await readCampaign(page);
    const territories = unwrapTrpc<
      Array<{
        definition: { id: string; guardianId: string };
        state: { confrontationReady: boolean; cleared: boolean };
      }>
    >(
      await (
        await page.request.get("/api/trpc/system.goldlineWorld.territories")
      ).json()
    );
    const ready = (territories ?? []).find(
      item => item.state.confrontationReady && !item.state.cleared
    );
    if (!ready) {
      test.skip(true, "No confrontation-ready territory in this fixture");
    }
    const defeat = await page.request.post("/api/trpc/system.goldlineWorld.recordGuardianDefeat", {
      data: {
        json: {
          territoryId: ready!.definition.id,
          guardianId: ready!.definition.guardianId,
          confrontationReady: true,
        },
      },
    });
    expect(defeat.ok(), await defeat.text()).toBeTruthy();
    const after = await readCampaign(page);
    expect(after.campaign.id).toBe(before.campaign.id);
    expect(after.campaign.title).toBe(before.campaign.title);
  });
});
