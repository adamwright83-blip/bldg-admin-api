import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DriverGameWorldNode } from "../../../../shared/driverGameWorld";
import {
  checkpointStorageKey,
  clearCheckpoint,
  loadAnyCheckpoint,
  saveCheckpoint,
} from "../session/checkpointStorage";
import {
  projectPersistentHistory,
  projectPlayableMissions,
} from "./WorldProjection";

describe("server-projected Goldline world memory", () => {
  const values = new Map<string, string>();
  const localStorage: Storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: key => values.get(key) ?? null,
    key: index => Array.from(values.keys())[index] ?? null,
    removeItem: key => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
  const node = (
    missionId: number,
    visualState: DriverGameWorldNode["visualState"]
  ) =>
    ({
      missionId,
      accountName: `Mission ${missionId}`,
      visualState,
      isHistorical: visualState === "captured" || visualState === "closed",
      resolvedAt: "2026-08-12T18:00:00.000Z",
      verifiedAnnualValueCents: visualState === "captured" ? 2_400_000 : null,
      realizedRevenueCents: 0,
      contestedUntil: null,
      unlockedPath: visualState === "recovery_active" ? "recovery-path" : null,
      lossReason: visualState === "closed" ? "Authoritative loss" : null,
    }) as DriverGameWorldNode;

  beforeEach(() => {
    values.clear();
    (globalThis as { window?: unknown }).window = { localStorage };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("reconstructs captured, closed, and recovery world state after position is cleared", () => {
    const serverTruth = [
      node(1, "captured"),
      node(2, "closed"),
      node(3, "recovery_active"),
    ];
    const missions = [
      {
        id: 3,
        status: "follow_up",
        account: {
          name: "Mission 3",
          address: "3 Goldline Way",
          decisionMaker: { phone: null },
        },
        opportunity: {
          estimatedAnnualValueCents: null,
          estimateConfidence: "unknown",
        },
        expiresAt: null,
      },
    ] as never;
    const project = () => ({
      history: projectPersistentHistory(serverTruth),
      active: projectPlayableMissions({
        missions,
        worldNodes: serverTruth,
      }),
    });
    saveCheckpoint(
      {
        corridorId: "corridor_01",
        progress: 0.64,
        lateral: 0.12,
        branch: "intel",
        savedAt: "2026-08-12T18:00:00.000Z",
      },
      "driver-a"
    );
    const before = project();

    clearCheckpoint("driver-a");
    const after = project();

    expect(loadAnyCheckpoint("driver-a")).toBeNull();
    expect(after).toEqual(before);
    expect(after.history.map(item => item.state)).toEqual([
      "captured",
      "closed",
    ]);
    expect(after.active.map(item => item.state)).toEqual(["recovery_active"]);
  });

  it("cannot resurrect business memory from a forged local checkpoint", () => {
    localStorage.setItem(
      checkpointStorageKey("driver-a"),
      JSON.stringify({
        corridorId: "corridor_01",
        progress: 0.64,
        lateral: 0.12,
        branch: "intel",
        savedAt: "2026-08-12T18:00:00.000Z",
        capturedMissionIds: [99],
        recoveryOwned: true,
      })
    );

    expect(projectPersistentHistory([])).toEqual([]);
    expect(loadAnyCheckpoint("driver-a")).not.toHaveProperty(
      "capturedMissionIds"
    );
    expect(loadAnyCheckpoint("driver-a")).not.toHaveProperty("recoveryOwned");
  });
});
