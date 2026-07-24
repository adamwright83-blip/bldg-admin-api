import { describe, expect, it } from "vitest";
import type { CommercialMissionDispatchRow } from "../../drizzle/schema";
import {
  SMS_NOT_CONFIGURED_REASON,
  dispatchCommercialMissionWith,
  openCommercialMissionDispatchWith,
  type CommercialMissionDispatchRepository,
  type CommercialMissionDispatchRuntime,
  type CommercialMissionDispatchTransaction,
  type NewCommercialMissionDispatch,
} from "./commercialMissionDispatchService";

type MemoryMission = Awaited<
  ReturnType<CommercialMissionDispatchTransaction["findMission"]>
>;

class MemoryDispatchRepository implements CommercialMissionDispatchRepository {
  readonly missions = new Map<string, NonNullable<MemoryMission>>();
  readonly activeFieldUsers = new Set<string>();
  readonly handoffs = new Map<string, {
    id: string;
    tenantId: string;
    missionId: number;
    assignedTo: string;
    channel: "secure_link" | "sms" | "email";
    expiresAt: Date;
    consumedAt: Date | null;
  }>();
  readonly dispatches: CommercialMissionDispatchRow[] = [];
  insertCalls = 0;

  addMission(input: NonNullable<MemoryMission>): void {
    this.missions.set(`${input.tenantId}:${input.id}`, input);
  }

  addActiveFieldUser(tenantId: string, userId: string): void {
    this.activeFieldUsers.add(`${tenantId}:${userId}`);
  }

  addHandoff(input: {
    id: string;
    tenantId: string;
    missionId: number;
    assignedTo: string;
    channel: "secure_link" | "sms" | "email";
    expiresAt: Date;
    consumedAt: Date | null;
  }): void {
    this.handoffs.set(`${input.tenantId}:${input.id}`, input);
  }

  async transaction<T>(
    work: (tx: CommercialMissionDispatchTransaction) => Promise<T>
  ): Promise<T> {
    const tx: CommercialMissionDispatchTransaction = {
      findMission: async input =>
        this.missions.get(`${input.tenantId}:${input.missionId}`) ?? null,
      isActiveFieldAssignee: async input =>
        this.activeFieldUsers.has(`${input.tenantId}:${input.assignedTo}`),
      findPhoneHandoff: async input =>
        this.handoffs.get(`${input.tenantId}:${input.handoffId}`) ?? null,
      findDispatchesByRequest: async input =>
        this.dispatches.filter(
          row =>
            row.tenantId === input.tenantId && row.requestId === input.requestId
        ),
      findDispatchById: async input =>
        this.dispatches.find(
          row => row.tenantId === input.tenantId && row.id === input.dispatchId
        ) ?? null,
      insertDispatch: async input => {
        this.insertCalls += 1;
        const duplicate = this.dispatches.some(
          row =>
            row.tenantId === input.tenantId &&
            row.requestId === input.requestId &&
            row.channel === input.channel
        );
        if (duplicate) return;
        this.dispatches.push(materializeDispatch(input));
      },
      markInAppOpened: async input => {
        const index = this.dispatches.findIndex(
          row =>
            row.tenantId === input.tenantId &&
            row.id === input.dispatchId &&
            row.channel === "in_app"
        );
        if (index < 0) return;
        this.dispatches[index] = {
          ...this.dispatches[index],
          status: "opened",
          openedAt: input.openedAt,
          updatedAt: input.openedAt,
        };
      },
    };
    return work(tx);
  }
}

function materializeDispatch(
  input: NewCommercialMissionDispatch
): CommercialMissionDispatchRow {
  const queuedAt = input.queuedAt as Date;
  return {
    id: input.id as string,
    tenantId: input.tenantId as string,
    missionId: input.missionId as number,
    assignedTo: input.assignedTo as string,
    handoffId: (input.handoffId as string | null | undefined) ?? null,
    dispatchPolicy:
      (input.dispatchPolicy as "manual" | "on_game_complete" | undefined) ??
      "manual",
    channel: input.channel as "in_app" | "sms",
    status:
      (input.status as CommercialMissionDispatchRow["status"] | undefined) ??
      "queued",
    destinationPath: input.destinationPath as string,
    queuedAt,
    sentAt: (input.sentAt as Date | null | undefined) ?? null,
    failedAt: (input.failedAt as Date | null | undefined) ?? null,
    openedAt: (input.openedAt as Date | null | undefined) ?? null,
    providerMessageId:
      (input.providerMessageId as string | null | undefined) ?? null,
    failureReason: (input.failureReason as string | null | undefined) ?? null,
    requestId: input.requestId as string,
    createdBy: input.createdBy as string,
    createdAt: queuedAt,
    updatedAt: queuedAt,
  };
}

function runtime(input?: {
  now?: string;
  ids?: string[];
  smsConfigured?: boolean;
}): CommercialMissionDispatchRuntime {
  const ids = [
    ...(input?.ids ?? [
      "00000000-0000-4000-8000-000000000101",
      "00000000-0000-4000-8000-000000000102",
    ]),
  ];
  return {
    now: () => new Date(input?.now ?? "2026-07-23T18:00:00.000Z"),
    createId: () => {
      const id = ids.shift();
      if (!id) throw new Error("Test ID queue exhausted");
      return id;
    },
    smsConfigured: input?.smsConfigured ?? false,
  };
}

function preparedRepository(): MemoryDispatchRepository {
  const repository = new MemoryDispatchRepository();
  repository.addMission({
    id: 42,
    tenantId: "tenant-a",
    assignedTo: "field-a",
    status: "phone_ready",
  });
  repository.addActiveFieldUser("tenant-a", "field-a");
  repository.addHandoff({
    id: "00000000-0000-4000-8000-000000000010",
    tenantId: "tenant-a",
    missionId: 42,
    assignedTo: "field-a",
    channel: "sms",
    expiresAt: new Date("2026-07-24T18:00:00.000Z"),
    consumedAt: null,
  });
  return repository;
}

const request = {
  tenantId: "tenant-a",
  missionId: 42,
  actorId: "owner-a",
  requestId: "00000000-0000-4000-8000-000000000001",
  dispatchPolicy: "manual" as const,
  includeSms: true,
  handoffId: "00000000-0000-4000-8000-000000000010",
};

describe("commercial mission dispatch foundation", () => {
  it("persists honest in-app and unconfigured-SMS state exactly once", async () => {
    const repository = preparedRepository();
    const first = await dispatchCommercialMissionWith(
      repository,
      request,
      runtime()
    );
    const replay = await dispatchCommercialMissionWith(
      repository,
      request,
      runtime({
        now: "2026-07-24T18:00:00.000Z",
        ids: [
          "00000000-0000-4000-8000-000000000201",
          "00000000-0000-4000-8000-000000000202",
        ],
      })
    );

    expect(replay).toEqual(first);
    expect(repository.dispatches).toHaveLength(2);
    expect(repository.insertCalls).toBe(2);
    expect(first.destinationPath).toBe("/driver/sales-mission/42");
    expect(first.dispatches).toEqual([
      expect.objectContaining({
        channel: "in_app",
        status: "queued",
        queuedAt: "2026-07-23T18:00:00.000Z",
        sentAt: null,
        failedAt: null,
        openedAt: null,
      }),
      expect.objectContaining({
        channel: "sms",
        status: "not_configured",
        failureReason: SMS_NOT_CONFIGURED_REASON,
        sentAt: null,
        failedAt: null,
      }),
    ]);
  });

  it("queues SMS without claiming it was sent when credentials exist", async () => {
    const result = await dispatchCommercialMissionWith(
      preparedRepository(),
      request,
      runtime({ smsConfigured: true })
    );
    expect(result.dispatches.find(row => row.channel === "sms")).toMatchObject({
      status: "queued",
      sentAt: null,
      providerMessageId: null,
      failureReason: null,
    });
  });

  it("defaults to durable in-app only and rejects SMS without a validated handoff", async () => {
    const repository = preparedRepository();
    const inAppOnly = await dispatchCommercialMissionWith(
      repository,
      {
        ...request,
        requestId: "00000000-0000-4000-8000-000000000003",
        includeSms: undefined,
        handoffId: null,
      },
      runtime(),
    );
    expect(inAppOnly.dispatches.map(item => item.channel)).toEqual(["in_app"]);

    await expect(
      dispatchCommercialMissionWith(
        repository,
        {
          ...request,
          requestId: "00000000-0000-4000-8000-000000000004",
          handoffId: null,
        },
        runtime({ smsConfigured: true }),
      ),
    ).rejects.toThrow(/requires a validated SMS phone handoff/);
  });

  it("rejects reuse of a request ID for different dispatch semantics", async () => {
    const repository = preparedRepository();
    await dispatchCommercialMissionWith(repository, request, runtime());
    await expect(
      dispatchCommercialMissionWith(
        repository,
        { ...request, includeSms: false },
        runtime()
      )
    ).rejects.toThrow(/different channel set/);
    expect(repository.dispatches).toHaveLength(2);
  });

  it("cannot read a mission or create a dispatch through another tenant", async () => {
    const repository = preparedRepository();
    repository.addActiveFieldUser("tenant-b", "field-a");

    await expect(
      dispatchCommercialMissionWith(
        repository,
        { ...request, tenantId: "tenant-b" },
        runtime()
      )
    ).rejects.toThrow("Commercial mission not found");
    expect(repository.dispatches).toHaveLength(0);
  });

  it("does not accept an assignee membership from another tenant", async () => {
    const repository = new MemoryDispatchRepository();
    repository.addMission({
      id: 42,
      tenantId: "tenant-a",
      assignedTo: "field-a",
      status: "phone_ready",
    });
    repository.addActiveFieldUser("tenant-b", "field-a");

    await expect(
      dispatchCommercialMissionWith(repository, request, runtime())
    ).rejects.toThrow(/not an active field user for this tenant/);
    expect(repository.dispatches).toHaveLength(0);
  });

  it("opens only the assigned tenant's in-app dispatch, idempotently", async () => {
    const repository = preparedRepository();
    const created = await dispatchCommercialMissionWith(
      repository,
      request,
      runtime()
    );
    const inApp = created.dispatches.find(row => row.channel === "in_app");
    if (!inApp) throw new Error("Expected in-app dispatch");

    await expect(
      openCommercialMissionDispatchWith(
        repository,
        {
          tenantId: "tenant-b",
          dispatchId: inApp.id,
          actorId: "field-a",
        },
        new Date("2026-07-23T18:05:00.000Z")
      )
    ).rejects.toThrow("Commercial mission dispatch not found");

    const opened = await openCommercialMissionDispatchWith(
      repository,
      {
        tenantId: "tenant-a",
        dispatchId: inApp.id,
        actorId: "field-a",
      },
      new Date("2026-07-23T18:05:00.000Z")
    );
    const replay = await openCommercialMissionDispatchWith(
      repository,
      {
        tenantId: "tenant-a",
        dispatchId: inApp.id,
        actorId: "field-a",
      },
      new Date("2026-07-23T19:05:00.000Z")
    );

    expect(opened.status).toBe("opened");
    expect(opened.openedAt).toBe("2026-07-23T18:05:00.000Z");
    expect(replay).toEqual(opened);
  });
});
