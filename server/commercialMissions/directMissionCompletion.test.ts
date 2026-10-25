import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CommercialMission } from "@shared/commercialMission";
import { assertDriverCanReadMission } from "./commercialMissionAuthorization";
import {
  completeDirectMissionPathWith,
  type DirectCompletionRepository,
  type DirectCompletionTransaction,
  type DirectCompletionWrite,
} from "./directMissionCompletion";

function mission(overrides: Partial<CommercialMission> = {}): CommercialMission {
  return {
    id: 41,
    tenantId: "tenant-a",
    code: "MISSION 041",
    status: "game_ready",
    version: 3,
    assignedTo: "ada",
    opsTaskId: 9,
    account: {
      accountId: 7,
      name: "Lost Creek",
      accountType: "multifamily",
      address: "1 Creek",
      latitude: null,
      longitude: null,
      locationCount: 1,
      decisionMaker: {
        name: null,
        title: null,
        email: null,
        phone: null,
        relationshipType: "unknown",
        preferredChannel: "unknown",
      },
    },
    opportunity: {
      opportunityId: 11,
      estimatedAnnualValueCents: 100,
      estimateConfidence: "low",
      score: 1,
      primarySignal: "operator",
      reasons: [],
      risks: [],
    },
    brief: {
      laundryOpportunity: "",
      salesAngle: "",
      openingLine: "",
      discoveryQuestions: [],
      objections: [],
    },
    steps: [
      {
        key: "visit",
        label: "Visit",
        detail: "",
        type: "field_visit",
        status: "ready",
        position: 1,
      },
    ],
    expiresAt: null,
    createdAt: "2026-10-25T00:00:00.000Z",
    updatedAt: "2026-10-25T00:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

class MemoryDirectRepository implements DirectCompletionRepository {
  mission = {
    id: 41,
    version: 3,
    status: "game_ready" as CommercialMission["status"],
    opsTaskId: 9,
    opportunityId: 11,
  };
  events: { missionId: number; idempotencyKey: string; write: DirectCompletionWrite }[] = [];

  async transaction<T>(work: (tx: DirectCompletionTransaction) => Promise<T>): Promise<T> {
    const snapshot = { ...this.mission };
    const events = this.events.map(event => ({ ...event }));
    const tx: DirectCompletionTransaction = {
      readMission: async () => ({ ...this.mission }),
      findEvent: async input => {
        const found = this.events.find(
          event => event.idempotencyKey === input.idempotencyKey
        );
        return found ? { missionId: found.missionId } : null;
      },
      write: async input => {
        if (this.mission.version !== input.expectedVersion) {
          throw new Error("Commercial mission transition lost an optimistic concurrency race");
        }
        this.events.push({
          missionId: input.mission.id,
          idempotencyKey: input.idempotencyKey,
          write: input,
        });
        this.mission = {
          ...this.mission,
          status: "phone_ready",
          version: this.mission.version + 1,
        };
      },
    };
    try {
      return await work(tx);
    } catch (error) {
      this.mission = snapshot;
      this.events = events;
      throw error;
    }
  }
}

const fieldRouterSource = readFileSync(
  new URL("../field/fieldRouter.ts", import.meta.url),
  "utf8"
);
const playRouterSource = readFileSync(
  new URL("./commercialMissionRouter.ts", import.meta.url),
  "utf8"
);
const commandCenterSource = readFileSync(
  new URL(
    "../../client/src/components/driver/CommandCenter.tsx",
    import.meta.url
  ),
  "utf8"
);

describe("direct mission completion", () => {
  it("uses the same read permission as the play path", () => {
    expect(playRouterSource).toContain(
      "gameComplete: legacyDayforgeMissionFieldProcedure"
    );
    expect(playRouterSource).toContain(
      'isAdmin: ctx.legacyDayforgeMembership.role !== "field"'
    );
    expect(fieldRouterSource).toContain(
      "completeMissionDirectly: legacyDayforgeMissionFieldProcedure"
    );
    expect(fieldRouterSource).toContain("assertDriverCanReadMission");
    expect(fieldRouterSource).toContain(
      'isAdmin: ctx.legacyDayforgeMembership.role !== "field"'
    );
    expect(commandCenterSource).toContain("Play to unlock");
    expect(commandCenterSource).toContain("Do this quickly");
    expect(commandCenterSource).toContain(
      "trpc.system.field.completeMissionDirectly.useMutation"
    );
    const owned = mission();
    expect(() =>
      assertDriverCanReadMission({
        mission: owned,
        userId: "ada",
        isAdmin: false,
      })
    ).not.toThrow();
    expect(() =>
      assertDriverCanReadMission({
        mission: owned,
        userId: "someone-else",
        isAdmin: false,
      })
    ).toThrow(/not assigned/);
  });

  it("writes the direct ledger, the shared objective, and the same dispatch gate", async () => {
    const repo = new MemoryDirectRepository();
    const dispatch = vi.fn(async () => ({ ok: true }));
    const current = mission();
    const result = await completeDirectMissionPathWith(
      repo,
      {
        tenantId: "tenant-a",
        mission: current,
        expectedVersion: 3,
        requestId: "11111111-1111-4111-8111-111111111111",
        actor: { type: "operator", id: "ada" },
      },
      { dispatch }
    );

    expect(result).toMatchObject({
      missionId: 41,
      objectiveStatus: "phone_ready",
      pipelineStage: "field_ready",
      worldVisualState: "active",
      completionPath: "direct",
      awardsXp: false,
      awardsStreak: false,
      replayed: false,
      dispatched: true,
    });
    expect(repo.mission.status).toBe("phone_ready");
    expect(repo.events).toHaveLength(1);
    expect(repo.events[0]?.write.metadata).toMatchObject({
      completionPath: "direct",
      objectiveStatus: "phone_ready",
      gameXpAwarded: false,
      streakAwarded: false,
      worldVisualState: "active",
    });
    expect(repo.events[0]?.write.opsTaskId).toBe(9);
    expect(dispatch).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      missionId: 41,
      actorId: "ada",
      requestId: "11111111-1111-4111-8111-111111111111",
      dispatchPolicy: "on_game_complete",
      includeSms: false,
    });
  });

  it("replays the same request without a second ledger row", async () => {
    const repo = new MemoryDirectRepository();
    const dispatch = vi.fn(async () => ({ ok: true }));
    const input = {
      tenantId: "tenant-a",
      mission: mission(),
      expectedVersion: 3,
      requestId: "22222222-2222-4222-8222-222222222222",
      actor: { type: "driver" as const, id: "ada" },
    };
    await completeDirectMissionPathWith(repo, input, { dispatch });
    const replay = await completeDirectMissionPathWith(
      repo,
      { ...input, mission: mission({ status: "phone_ready", version: 4 }) },
      { dispatch }
    );
    expect(replay.replayed).toBe(true);
    expect(repo.events).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("does not dispatch or write when the mission has no field step", async () => {
    const repo = new MemoryDirectRepository();
    const dispatch = vi.fn(async () => ({ ok: true }));
    const result = await completeDirectMissionPathWith(
      repo,
      {
        tenantId: "tenant-a",
        mission: mission({
          assignedTo: "ada",
          steps: [
            {
              key: "note",
              label: "Note",
              detail: "",
              type: "generic",
              status: "ready",
              position: 1,
            },
          ],
        }),
        expectedVersion: 3,
        requestId: "33333333-3333-4333-8333-333333333333",
        actor: { type: "operator", id: "ada" },
      },
      { dispatch }
    );
    expect(result.dispatched).toBe(false);
    expect(result.objectiveStatus).toBe("phone_ready");
    expect(dispatch).not.toHaveBeenCalled();
    expect(repo.mission.status).toBe("phone_ready");
  });

  it("refuses a mission that is not on the play gate and writes nothing", async () => {
    const repo = new MemoryDirectRepository();
    repo.mission.status = "selected";
    const dispatch = vi.fn();
    await expect(
      completeDirectMissionPathWith(
        repo,
        {
          tenantId: "tenant-a",
          mission: mission({ status: "selected" }),
          expectedVersion: 3,
          requestId: "44444444-4444-4444-8444-444444444444",
          actor: { type: "operator", id: "ada" },
        },
        { dispatch }
      )
    ).rejects.toThrow(/cannot be completed directly/);
    expect(repo.events).toHaveLength(0);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
