/**
 * Mutating campaign proofs run after world/territory smokes so they cannot
 * poison the tower-truth snapshot.
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
  };
  lastRevision: { reasonCodes: string[] } | null;
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

test.describe("Goldline campaign mutations", () => {
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
    const entitiesBefore = unwrapTrpc<
      Array<{
        id: string;
        pursuit?: { stage?: string | null } | null;
        events?: Array<{ eventType: string; classification: string }>;
      }>
    >(await (await page.request.get("/api/trpc/system.goldlineWorld.cityEntities")).json());

    let ready = (territories ?? []).find(
      item => item.state.confrontationReady && !item.state.cleared
    );
    if (!ready) {
      const uncleared = (territories ?? []).find(item => !item.state.cleared);
      expect(uncleared, "proof world must present an uncleared territory").toBeTruthy();
      await signIn(page, "driver");
      for (const memberId of uncleared!.state.remainingMemberIds) {
        const entity = entitiesBefore.find(row => row.id === memberId);
        const transcript =
          `Visited ${entity?.displayName ?? memberId} at ${entity?.pursuit?.address ?? entity?.displayName ?? memberId}. The desk took my card and I walked the lobby myself.`;
        const journal = await page.request.post(
          "/api/trpc/system.commercialMission.saveSalesJournal",
          {
            headers: { "content-type": "application/json" },
            data: {
              json: {
                journalDate: new Date().toISOString().slice(0, 10),
                clientRequestId: crypto.randomUUID(),
                transcript,
              },
            },
          }
        );
        expect(journal.ok(), await journal.text()).toBeTruthy();
        await expect
          .poll(
            async () => {
              const list = unwrapTrpc<typeof territories>(
                await (
                  await page.request.get("/api/trpc/system.goldlineWorld.territories")
                ).json()
              );
              return (list ?? []).some(item =>
                item.state.completedMemberIds?.includes(memberId)
              );
            },
            { timeout: 20_000 }
          )
          .toBe(true);
      }
      const refreshed = unwrapTrpc<typeof territories>(
        await (await page.request.get("/api/trpc/system.goldlineWorld.territories")).json()
      );
      ready = (refreshed ?? []).find(
        item => item.definition.id === uncleared!.definition.id
      );
    }
    expect(ready?.state.confrontationReady || ready?.state.cleared).toBe(true);

    if (!ready!.state.cleared) {
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
    }
    const after = await readCampaign(page);
    expect(after.campaign.id).toBe(before.campaign.id);
    expect(after.campaign.title).toBe(before.campaign.title);

    const entitiesAfter = unwrapTrpc<typeof entitiesBefore>(
      await (await page.request.get("/api/trpc/system.goldlineWorld.cityEntities")).json()
    );
    for (const member of ready!.definition.members ?? []) {
      const beforeEntity = entitiesBefore.find(row => row.id === member.physicalEntityId);
      const afterEntity = entitiesAfter.find(row => row.id === member.physicalEntityId);
      expect(afterEntity?.pursuit?.stage ?? null).toBe(beforeEntity?.pursuit?.stage ?? null);
    }
    const gameOnly = (entitiesAfter ?? []).flatMap(entity =>
      (entity.events ?? []).filter(
        event => event.eventType === "guardian_defeated" || event.eventType === "territory_cleared"
      )
    );
    expect(gameOnly.every(event => event.classification === "game_projection")).toBe(true);
  });
});
