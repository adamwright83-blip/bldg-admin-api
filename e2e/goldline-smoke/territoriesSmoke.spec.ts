/**
 * Fast Goldline territory / guardian smoke.
 *
 * Covers the territory contract without the 20-minute mobile regression:
 * stable compilation, view ≠ progress, journal visit opens the exact aperture,
 * pre-ready play cannot clear, derived readiness unlocks defeat, and defeat
 * writes only game-projection history.
 */

import { expect, test, type Page } from "@playwright/test";

const DRIVER_PASSWORD = process.env.DRIVER_PASSWORD ?? "pixel-driver-pass";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "goldline-proof-admin-pass";
const HUNT_ONE = "44444444-4444-4444-8444-444444444441";
const HUNT_FIXTURE = [
  {
    id: "44444444-4444-4444-8444-444444444441",
    name: "La Cienega Court",
    address: "1520 S La Cienega Blvd, Los Angeles, CA",
  },
  {
    id: "44444444-4444-4444-8444-444444444442",
    name: "The Marble Arms",
    address: "1530 S La Cienega Blvd, Los Angeles, CA",
  },
  {
    id: "44444444-4444-4444-8444-444444444443",
    name: "Sunwell House",
    address: "1540 S La Cienega Blvd, Los Angeles, CA",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Orchard Place",
    address: "1550 S La Cienega Blvd, Los Angeles, CA",
  },
] as const;

type PresentedTerritory = {
  definition: {
    id: string;
    guardianId: string;
    classification: string;
    members: Array<{ physicalEntityId: string }>;
  };
  state: {
    completedMemberIds: string[];
    remainingMemberIds: string[];
    confrontationReady: boolean;
    cleared: boolean;
    readiness: string;
  };
};

type CityEntity = {
  id: string;
  displayName: string;
  pursuit?: { stage?: string; address?: string | null } | null;
  obligations?: { count?: number } | null;
  events?: Array<{ eventType: string; classification: string }>;
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

async function readTerritories(page: Page): Promise<PresentedTerritory[]> {
  const response = await page.request.get("/api/trpc/system.goldlineWorld.territories");
  expect(response.ok(), await response.text()).toBeTruthy();
  const rows = unwrapTrpc<PresentedTerritory[]>(await response.json());
  return Array.isArray(rows) ? rows : [];
}

async function readEntities(page: Page): Promise<CityEntity[]> {
  const response = await page.request.get("/api/trpc/system.goldlineWorld.cityEntities");
  expect(response.ok(), await response.text()).toBeTruthy();
  const rows = unwrapTrpc<CityEntity[]>(await response.json());
  return Array.isArray(rows) ? rows : [];
}

async function mutate(page: Page, path: string, json: unknown) {
  const response = await page.request.post(`/api/trpc/${path}`, {
    headers: { "content-type": "application/json" },
    data: { json },
  });
  return { response, payload: await response.json() };
}

async function recordVisitJournal(
  page: Page,
  input: { name: string; address: string }
) {
  const transcript =
    `Visited ${input.name} at ${input.address}. The desk took my card and I walked the lobby myself.`;
  const { response, payload } = await mutate(page, "system.commercialMission.saveSalesJournal", {
    journalDate: new Date().toISOString().slice(0, 10),
    clientRequestId: crypto.randomUUID(),
    transcript,
  });
  expect(response.ok(), JSON.stringify(payload)).toBeTruthy();
}

async function waitForMemberCompleted(page: Page, physicalEntityId: string) {
  await expect
    .poll(
      async () => {
        const list = await readTerritories(page);
        return list.some(item => item.state.completedMemberIds.includes(physicalEntityId));
      },
      { timeout: 20_000 }
    )
    .toBe(true);
}

test.describe("Goldline territories smoke", () => {
  test("compiler publishes a stable real-member territory", async ({ page }) => {
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });
    const list = await readTerritories(page);
    expect(list.length).toBeGreaterThan(0);
    const territory = list[0]!;
    expect(territory.definition.members.length).toBeGreaterThanOrEqual(3);
    expect(territory.definition.classification).toBe("game_projection");
    const ids = territory.definition.members.map(member => member.physicalEntityId);
    expect(new Set(ids).size).toBe(ids.length);

    const again = await readTerritories(page);
    expect(again[0]?.definition.id).toBe(territory.definition.id);
    expect(again[0]?.definition.guardianId).toBe(territory.definition.guardianId);
  });

  test("Lantern City mounts the veil and guardian without treating view as progress", async ({
    page,
  }) => {
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".gl-territory-veil").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(/goldline-guardian-/).first()).toBeVisible();

    const before = (await readTerritories(page))[0]?.state;

    await page.locator(".gl-territory-veil").first().hover({ force: true }).catch(() => undefined);
    await page.reload();
    await expect(page.locator(".gl-territory-veil").first()).toBeVisible({ timeout: 20_000 });

    const after = (await readTerritories(page))[0]?.state;
    expect(after?.completedMemberIds ?? []).toEqual(before?.completedMemberIds ?? []);
  });

  test("Driver Overland shows the same guardian presence", async ({ page }) => {
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

  test("a real Field Journal visit opens only that member's aperture", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates the proof world once");
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    const before = (await readTerritories(page))[0];
    expect(before).toBeTruthy();
    const targetId =
      before!.state.remainingMemberIds.find(id => id === HUNT_ONE) ??
      before!.state.remainingMemberIds[0]!;
    expect(before!.state.completedMemberIds.includes(targetId)).toBe(false);
    const target = HUNT_FIXTURE.find(item => item.id === targetId) ?? HUNT_FIXTURE[0]!;

    await signIn(page, "driver");
    await recordVisitJournal(page, {
      name: target.name,
      address: target.address,
    });
    await waitForMemberCompleted(page, targetId);

    const after = (await readTerritories(page))[0]!;
    expect(after.state.completedMemberIds).toContain(targetId);
    const othersStillClosed = after.definition.members
      .map(member => member.physicalEntityId)
      .filter(id => id !== targetId)
      .every(
        id =>
          !after.state.completedMemberIds.includes(id) ||
          before!.state.completedMemberIds.includes(id)
      );
    expect(othersStillClosed).toBe(true);

    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });
    const aperture = page.locator(`[data-aperture="${targetId}"]`);
    await expect(aperture).toHaveAttribute("data-opened", "true", { timeout: 20_000 });
  });

  test("boss cannot permanently clear before derived readiness, and play does not mutate business truth", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates the proof world once");
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    const territory = (await readTerritories(page)).find(item => !item.state.cleared);
    expect(territory).toBeTruthy();
    const entitiesBefore = await readEntities(page);
    const stagesBefore = Object.fromEntries(
      territory!.definition.members.map(member => {
        const entity = entitiesBefore.find(row => row.id === member.physicalEntityId);
        return [member.physicalEntityId, entity?.pursuit?.stage ?? null];
      })
    );

    await expect(page.locator(".cr-world-camera")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /over /i }).first().click();
    await expect(page.getByTestId("goldline-guardian-encounter")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("goldline-guardian-linehook")).toBeVisible();
    await expect
      .poll(async () => page.getByTestId("goldline-guardian-tell").innerText(), { timeout: 8_000 })
      .not.toBe("");

    const refused = await mutate(page, "system.goldlineWorld.recordGuardianDefeat", {
      territoryId: territory!.definition.id,
      guardianId: territory!.definition.guardianId,
      confrontationReady: false,
    });
    const refusedBody = unwrapTrpc<{ recorded: boolean }>(refused.payload);
    if (territory!.state.confrontationReady === false) {
      expect(refusedBody.recorded).toBe(false);
    }

    const entitiesAfter = await readEntities(page);
    for (const member of territory!.definition.members) {
      const entity = entitiesAfter.find(row => row.id === member.physicalEntityId);
      expect(entity?.pursuit?.stage ?? null).toBe(stagesBefore[member.physicalEntityId] ?? null);
    }
  });

  test("derived readiness then defeat is game-projection only, and the tether survives", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "mutates the proof world once");
    await signIn(page, "admin");
    await page.goto("/growth/lantern-city");
    let territory = (await readTerritories(page)).find(item => !item.state.cleared);
    expect(territory).toBeTruthy();
    const entities = await readEntities(page);
    const tetherBefore =
      entities.find(entity => entity.id === HUNT_ONE)?.obligations?.count ?? 0;

    await signIn(page, "driver");
    for (const memberId of territory!.state.remainingMemberIds) {
      const fixture = HUNT_FIXTURE.find(item => item.id === memberId);
      if (!fixture) continue;
      await recordVisitJournal(page, {
        name: fixture.name,
        address: fixture.address,
      });
      await waitForMemberCompleted(page, memberId);
    }

    territory = (await readTerritories(page)).find(
      item => item.definition.id === territory!.definition.id
    );
    expect(territory?.state.confrontationReady || territory?.state.cleared).toBe(true);

    await signIn(page, "admin");
    const entitiesBefore = await readEntities(page);
    const stagesBefore = Object.fromEntries(
      territory!.definition.members.map(member => {
        const entity = entitiesBefore.find(row => row.id === member.physicalEntityId);
        return [member.physicalEntityId, entity?.pursuit?.stage ?? null];
      })
    );

    if (!territory!.state.cleared) {
      const defeat = await mutate(page, "system.goldlineWorld.recordGuardianDefeat", {
        territoryId: territory!.definition.id,
        guardianId: territory!.definition.guardianId,
        confrontationReady: true,
      });
      expect(defeat.response.ok(), JSON.stringify(defeat.payload)).toBeTruthy();
      const body = unwrapTrpc<{ recorded: boolean; reason: string }>(defeat.payload);
      expect(body.recorded).toBe(true);
      expect(body.reason).toMatch(/game projection/i);
    }

    const cleared = (await readTerritories(page)).find(
      item => item.definition.id === territory!.definition.id
    );
    expect(cleared?.state.cleared).toBe(true);

    const entitiesAfter = await readEntities(page);
    for (const member of territory!.definition.members) {
      const entity = entitiesAfter.find(row => row.id === member.physicalEntityId);
      expect(entity?.pursuit?.stage ?? null).toBe(stagesBefore[member.physicalEntityId] ?? null);
      const gameOnly = (entity?.events ?? []).filter(event =>
        event.eventType === "guardian_defeated" || event.eventType === "territory_cleared"
      );
      expect(gameOnly.every(event => event.classification === "game_projection")).toBe(true);
    }
    const tetherAfter =
      entitiesAfter.find(entity => entity.id === HUNT_ONE)?.obligations?.count ?? 0;
    expect(tetherAfter).toBeGreaterThanOrEqual(tetherBefore);

    const reloaded = await readTerritories(page);
    expect(
      reloaded.find(item => item.definition.id === territory!.definition.id)?.state.cleared
    ).toBe(true);
  });
});
