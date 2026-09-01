/**
 * Mutating campaign proofs. Isolation is a proof-world reset, not file order.
 */

import { expect, test, type Page } from "@playwright/test";
import { resetGoldlineProofWorld } from "./proofWorld";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";

type CampaignPresentation = {
  campaign: {
    id: string;
    title: string;
    revision: number;
    inputFingerprint: string;
    campaignArchetypeId: string;
    currentChapterId: string | null;
    completedChapterIds: string[];
    chapters: Array<{
      stableChapterId: string;
      chapterKind: string;
      territoryId: string | null;
    }>;
  };
  lastRevision: { reasonCodes: string[] } | null;
};

type GuardianDefeatResult = {
  recorded: boolean;
  reason: string;
  campaignChapterCompleted: boolean;
  completedCampaignChapterId: string | null;
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

async function defeatGuardian(
  page: Page,
  input: { territoryId: string; guardianId: string; confrontationReady: boolean }
): Promise<GuardianDefeatResult> {
  const response = await page.request.post("/api/trpc/system.goldlineWorld.recordGuardianDefeat", {
    data: { json: input },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return unwrapTrpc<GuardianDefeatResult>(await response.json());
}

test.describe("Goldline campaign mutations", () => {
  test.beforeEach(async ({ request }) => {
    await resetGoldlineProofWorld(request);
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

  test("guardian defeat is server-authoritative, ordered, retry-safe, and never invents a sale", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates the proof world once");
    await signIn(page, "admin");
    const before = await readCampaign(page);
    type Presented = {
      definition: {
        id: string;
        guardianId: string;
        members: Array<{ physicalEntityId: string }>;
      };
      state: {
        confrontationReady: boolean;
        cleared: boolean;
        remainingMemberIds: string[];
        completedMemberIds: string[];
      };
    };
    const territories = unwrapTrpc<Presented[]>(
      await (
        await page.request.get("/api/trpc/system.goldlineWorld.territories")
      ).json()
    );
    const entitiesBefore = unwrapTrpc<
      Array<{
        id: string;
        displayName?: string;
        pursuit?: { stage?: string | null; address?: string | null } | null;
        events?: Array<{ eventType: string; classification: string }>;
      }>
    >(await (await page.request.get("/api/trpc/system.goldlineWorld.cityEntities")).json());

    let ready = (territories ?? []).find(
      item => item.state.confrontationReady && !item.state.cleared
    );
    const uncleared = (territories ?? []).find(item => !item.state.cleared);
    if (!ready && uncleared) {
      await signIn(page, "driver");
      for (const memberId of uncleared.state.remainingMemberIds) {
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
              const list = unwrapTrpc<Presented[]>(
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
      const refreshed = unwrapTrpc<Presented[]>(
        await (await page.request.get("/api/trpc/system.goldlineWorld.territories")).json()
      );
      ready = (refreshed ?? []).find(
        item => item.definition.id === uncleared.definition.id
      );
    }
    expect(ready, "proof world must present an uncleared territory to prove Guardian ordering").toBeTruthy();
    expect(ready?.state.confrontationReady).toBe(true);
    expect(ready?.state.cleared).toBe(false);

    await signIn(page, "admin");
    const campaignAtFinale = await readCampaign(page);
    const finale = campaignAtFinale.campaign.chapters.find(
      chapter => chapter.chapterKind === "guardian_finale" && chapter.territoryId === ready!.definition.id
    );
    expect(finale, "derived-ready territory must produce a persisted campaign finale").toBeTruthy();
    expect(campaignAtFinale.campaign.completedChapterIds).not.toContain(finale!.stableChapterId);

    // Invalid defeat cannot complete the campaign finale.
    const rejected = await defeatGuardian(page, {
      territoryId: ready!.definition.id,
      guardianId: ready!.definition.guardianId,
      confrontationReady: false,
    });
    expect(rejected.recorded).toBe(false);
    expect(rejected.campaignChapterCompleted).toBe(false);
    const afterRejected = await readCampaign(page);
    expect(afterRejected.campaign.completedChapterIds).not.toContain(finale!.stableChapterId);

    // The client intentionally supplies no campaignChapterId. Server resolves it.
    const defeated = await defeatGuardian(page, {
      territoryId: ready!.definition.id,
      guardianId: ready!.definition.guardianId,
      confrontationReady: true,
    });
    expect(defeated.recorded).toBe(true);
    expect(defeated.campaignChapterCompleted).toBe(true);
    expect(defeated.completedCampaignChapterId).toBe(finale!.stableChapterId);

    const afterDefeat = await readCampaign(page);
    expect(afterDefeat.campaign.completedChapterIds).toContain(finale!.stableChapterId);

    // Retry after territory is already cleared repairs/retains campaign history.
    const retry = await defeatGuardian(page, {
      territoryId: ready!.definition.id,
      guardianId: ready!.definition.guardianId,
      confrontationReady: true,
    });
    expect(retry.recorded).toBe(true);
    expect(retry.campaignChapterCompleted).toBe(true);
    expect(retry.completedCampaignChapterId).toBe(finale!.stableChapterId);

    const after = await readCampaign(page);
    expect(after.campaign.id).toBe(before.campaign.id);
    expect(after.campaign.title).toBe(before.campaign.title);

    const entitiesAfterResponse = await page.request.get(
      "/api/trpc/system.goldlineWorld.cityEntities"
    );
    expect(entitiesAfterResponse.ok(), await entitiesAfterResponse.text()).toBeTruthy();
    const entitiesAfter =
      unwrapTrpc<typeof entitiesBefore>(await entitiesAfterResponse.json()) ?? [];
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
