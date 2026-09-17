import { nanoid } from "nanoid";
import {
  applyLaterConsequence,
  canCompleteRescue,
  composeReactivationDraft,
  emptySendRecord,
  isDuplicateSendBlocked,
  missionLifecycleFromSend,
  publicMissionHasNoPhone,
  selectVillagerIndependentOfCustomer,
  SEND_EVIDENCE_NAME,
  SPIRIT_HUMAN_RESCUE_KIND,
  type FrozenRescueFacts,
  type RescueConsequenceKind,
  type RescueSendRecord,
  type SpiritHumanRescueMission,
} from "../../shared/spiritHumanRescue";
import { buildingFromSlug } from "../../shared/buildings";
import { checkCommunicationPermission, recordOutreachAttempt } from "../strategy/communicationPermissionService";
import { createOpsTask, updateOpsTaskStatus, type OpsTaskStore } from "../opsTasks";
import {
  freezeFactsFromContact,
  resolveDormantContact,
  type ResolvedDormantContact,
} from "./resolveDormantContact";
import {
  createFakeOutboundSendAdapter,
  twilioOutboundSendAdapter,
  type OutboundSendAdapter,
} from "./outboundSendAdapter";

export type RescueMissionStore = {
  get(tenantId: string, missionId: string): Promise<SpiritHumanRescueMission | null>;
  listForOperator(tenantId: string, operatorUserId: string): Promise<SpiritHumanRescueMission[]>;
  save(mission: SpiritHumanRescueMission): Promise<SpiritHumanRescueMission>;
};

export class MemoryRescueMissionStore implements RescueMissionStore {
  private readonly rows = new Map<string, SpiritHumanRescueMission>();

  private key(tenantId: string, missionId: string): string {
    return `${tenantId}:${missionId}`;
  }

  async get(tenantId: string, missionId: string): Promise<SpiritHumanRescueMission | null> {
    return this.rows.get(this.key(tenantId, missionId)) ?? null;
  }

  async listForOperator(tenantId: string, operatorUserId: string): Promise<SpiritHumanRescueMission[]> {
    return [...this.rows.values()].filter(
      row => row.tenantId === tenantId && row.operatorUserId === operatorUserId
    );
  }

  async save(mission: SpiritHumanRescueMission): Promise<SpiritHumanRescueMission> {
    this.rows.set(this.key(mission.tenantId, mission.missionId), mission);
    return mission;
  }
}

const defaultMemoryStore = new MemoryRescueMissionStore();

export type RescueServiceDeps = {
  store?: RescueMissionStore;
  sendAdapter?: OutboundSendAdapter;
  now?: () => Date;
  resolveContact?: typeof resolveDormantContact;
  permissionCheck?: typeof checkCommunicationPermission;
  recordOutreach?: typeof recordOutreachAttempt;
  opsTaskStore?: OpsTaskStore;
  persistOpsTask?: boolean;
};

function cloneMission(mission: SpiritHumanRescueMission): SpiritHumanRescueMission {
  return JSON.parse(JSON.stringify(mission)) as SpiritHumanRescueMission;
}

function publicize(mission: SpiritHumanRescueMission): SpiritHumanRescueMission {
  const copy = cloneMission(mission);
  if (!publicMissionHasNoPhone(copy)) {
    throw new Error("Spirit Human public mission leaked contact PII.");
  }
  return copy;
}

function refreshLifecycle(mission: SpiritHumanRescueMission): SpiritHumanRescueMission {
  return {
    ...mission,
    lifecycle: missionLifecycleFromSend({
      entered: mission.lifecycle === "active" || mission.lifecycle === "problem" || mission.lifecycle === "completed",
      sendStatus: mission.send.status,
      deferred: mission.lifecycle === "skipped",
      superseded: mission.lifecycle === "superseded",
    }),
  };
}

export async function instantiateRescueMission(
  input: {
    tenantId: string;
    operatorUserId: string;
    snapshotCustomerId: string;
  },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = deps.store ?? defaultMemoryStore;
  const now = (deps.now ?? (() => new Date()))();
  const existing = (await store.listForOperator(input.tenantId, input.operatorUserId)).find(
    row =>
      row.spiritHuman.snapshotCustomerId === input.snapshotCustomerId &&
      row.lifecycle !== "skipped" &&
      row.lifecycle !== "superseded"
  );
  if (existing) return publicize(existing);

  const resolve = deps.resolveContact ?? resolveDormantContact;
  const contact = await resolve({
    tenantId: input.tenantId,
    snapshotCustomerId: input.snapshotCustomerId,
    now,
  });
  if (!contact) {
    throw Object.assign(new Error("Dormant customer could not be resolved."), { code: "UNKNOWN_CUSTOMER" });
  }
  const frozen = freezeSafeFacts(contact, now);
  const missionId = `shr_${nanoid(12)}`;
  let opsTaskId: number | null = null;
  if (deps.persistOpsTask) {
    try {
      const task = await createOpsTask(
        {
          tenantId: input.tenantId,
          lane: "lane_3",
          level: "3",
          taskType: "stale_customer",
          title: `Spirit Human rescue — ${frozen.firstName}`,
          source: "system_detected",
          assignedTo: input.operatorUserId,
          createdBy: input.operatorUserId,
          metadataJson: {
            kind: SPIRIT_HUMAN_RESCUE_KIND,
            missionId,
            snapshotCustomerId: frozen.snapshotCustomerId,
          },
        },
        deps.opsTaskStore
      );
      opsTaskId = task.id;
    } catch {
      opsTaskId = null;
    }
  }
  const mission: SpiritHumanRescueMission = {
    missionId,
    tenantId: input.tenantId,
    operatorUserId: input.operatorUserId,
    kind: SPIRIT_HUMAN_RESCUE_KIND,
    lifecycle: "available",
    villager: selectVillagerIndependentOfCustomer(missionId),
    spiritHuman: frozen,
    draft: null,
    send: emptySendRecord(missionId),
    consequences: [],
    opsTaskId,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await store.save(mission);
  return publicize(mission);
}

function freezeSafeFacts(contact: Omit<ResolvedDormantContact, "phone">, now: Date): FrozenRescueFacts {
  const facts = freezeFactsFromContact(contact, now);
  const building = contact.buildingSlug ? buildingFromSlug(contact.buildingSlug) : null;
  return {
    ...facts,
    ...(building?.name ? { buildingName: building.name } : {}),
  };
}

export async function enterRescueMission(
  input: { tenantId: string; operatorUserId: string; missionId: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = deps.store ?? defaultMemoryStore;
  const mission = await requireOwnedMission(store, input);
  if (mission.lifecycle === "completed") return publicize(mission);
  const next = {
    ...mission,
    lifecycle: "active" as const,
    updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  await store.save(next);
  return publicize(next);
}

export async function prepareRescueDraft(
  input: { tenantId: string; operatorUserId: string; missionId: string; editedDraft?: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = deps.store ?? defaultMemoryStore;
  const mission = await requireOwnedMission(store, input);
  if (canCompleteRescue(mission.send)) return publicize(mission);
  const draft = (input.editedDraft ?? composeReactivationDraft(mission.spiritHuman)).trim();
  if (!draft) throw Object.assign(new Error("Draft is empty."), { code: "EMPTY_DRAFT" });
  const next: SpiritHumanRescueMission = {
    ...mission,
    draft,
    send: {
      ...mission.send,
      status: mission.send.status === "sent" ? mission.send.status : "draft_ready",
    },
    lifecycle: mission.lifecycle === "available" ? "active" : mission.lifecycle,
    updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  await store.save(refreshLifecycle(next));
  return publicize((await store.get(input.tenantId, input.missionId)) ?? next);
}

export async function cancelRescueMission(
  input: { tenantId: string; operatorUserId: string; missionId: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = deps.store ?? defaultMemoryStore;
  const mission = await requireOwnedMission(store, input);
  if (canCompleteRescue(mission.send)) return publicize(mission);
  const next: SpiritHumanRescueMission = {
    ...mission,
    send: { ...mission.send, status: "cancelled" },
    lifecycle: "skipped",
    updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  await store.save(next);
  return publicize(next);
}

export async function deferRescueMission(
  input: { tenantId: string; operatorUserId: string; missionId: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  return cancelRescueMission(input, deps);
}

const inFlight = new Map<string, Promise<SpiritHumanRescueMission>>();

export async function approveAndSendRescue(
  input: {
    tenantId: string;
    operatorUserId: string;
    missionId: string;
    approvedByUserId: string | null | undefined;
    operatorAuthorizedSend: boolean;
    editedDraft?: string;
  },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  if (!input.operatorAuthorizedSend) {
    throw Object.assign(new Error("Operator must explicitly authorize the outbound send."), {
      code: "APPROVAL_REQUIRED",
    });
  }
  if (!input.approvedByUserId) {
    throw Object.assign(new Error("Human approval is required before this action can run."), {
      code: "APPROVAL_REQUIRED",
    });
  }
  const key = `${input.tenantId}:${input.missionId}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const run = sendOnce(
    {
      tenantId: input.tenantId,
      operatorUserId: input.operatorUserId,
      missionId: input.missionId,
      approvedByUserId: input.approvedByUserId,
      editedDraft: input.editedDraft,
    },
    deps
  ).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, run);
  return run;
}

async function sendOnce(
  input: {
    tenantId: string;
    operatorUserId: string;
    missionId: string;
    approvedByUserId: string;
    editedDraft?: string;
  },
  deps: RescueServiceDeps
): Promise<SpiritHumanRescueMission> {
  const store = deps.store ?? defaultMemoryStore;
  const now = (deps.now ?? (() => new Date()))();
  const mission = await requireOwnedMission(store, input);
  if (isDuplicateSendBlocked(mission.send) && canCompleteRescue(mission.send)) {
    return publicize(mission);
  }
  if (mission.send.status === "cancelled") {
    throw Object.assign(new Error("Cancelled missions cannot send."), { code: "CANCELLED" });
  }
  const draft = (input.editedDraft ?? mission.draft ?? composeReactivationDraft(mission.spiritHuman)).trim();
  const sending: SpiritHumanRescueMission = {
    ...mission,
    draft,
    send: {
      ...mission.send,
      status: "sending",
      approvedByUserId: input.approvedByUserId,
      attemptedAt: now.toISOString(),
    },
    lifecycle: "active",
    updatedAt: now.toISOString(),
  };
  await store.save(sending);

  const permissionCheck = deps.permissionCheck ?? checkCommunicationPermission;
  const permission = await permissionCheck({
    tenantId: input.tenantId,
    subjectType: "customer",
    subjectId: mission.spiritHuman.snapshotCustomerId,
    channel: "sms",
    now,
  });
  if (!permission.allowed) {
    return persistFailure(store, sending, now, permission.reason ?? "Communication is not permitted.");
  }

  const resolve = deps.resolveContact ?? resolveDormantContact;
  const contact = await resolve({
    tenantId: input.tenantId,
    snapshotCustomerId: mission.spiritHuman.snapshotCustomerId,
    now,
  });
  if (!contact?.phone) {
    return persistFailure(store, sending, now, "Customer contact could not be resolved.");
  }

  const adapter = deps.sendAdapter ?? twilioOutboundSendAdapter;
  const receipt = await adapter.send({
    to: contact.phone,
    body: draft,
    idempotencyKey: mission.send.idempotencyKey,
  });

  if (!receipt.accepted || !receipt.providerMessageId) {
    return persistFailure(
      store,
      sending,
      now,
      receipt.evidenceName === "provider_unconfigured"
        ? "Outbound SMS is not configured."
        : "Provider rejected the outbound request."
    );
  }

  const sentRecord: RescueSendRecord = {
    ...sending.send,
    status: "sent",
    acceptedAt: now.toISOString(),
    providerMessageId: receipt.providerMessageId,
    providerStatus: receipt.providerStatus,
    evidenceName: SEND_EVIDENCE_NAME,
    failureReason: null,
  };
  if (!canCompleteRescue(sentRecord)) {
    return persistFailure(store, sending, now, "Send receipt was not authoritative.");
  }
  const completed: SpiritHumanRescueMission = {
    ...sending,
    send: sentRecord,
    lifecycle: "completed",
    updatedAt: now.toISOString(),
  };
  await store.save(completed);
  const recordOutreach = deps.recordOutreach ?? recordOutreachAttempt;
  await recordOutreach({
    tenantId: input.tenantId,
    subjectType: "customer",
    subjectId: mission.spiritHuman.snapshotCustomerId,
    channel: "sms",
    at: now,
  });
  if (completed.opsTaskId != null) {
    try {
      await updateOpsTaskStatus(
        {
          tenantId: input.tenantId,
          taskId: completed.opsTaskId,
          status: "completed",
          actorId: input.approvedByUserId,
          note: "provider_accepted outbound send",
        },
        deps.opsTaskStore
      );
    } catch {
      // Mission send truth is already persisted; ops-task mirror is best-effort.
    }
  }
  return publicize(completed);
}

async function persistFailure(
  store: RescueMissionStore,
  sending: SpiritHumanRescueMission,
  now: Date,
  reason: string
): Promise<SpiritHumanRescueMission> {
  const failed: SpiritHumanRescueMission = {
    ...sending,
    send: {
      ...sending.send,
      status: "send_failed",
      failedAt: now.toISOString(),
      evidenceName: "provider_rejected",
      failureReason: reason,
    },
    lifecycle: "problem",
    updatedAt: now.toISOString(),
  };
  await store.save(failed);
  return publicize(failed);
}

export async function recordRescueConsequence(
  input: {
    tenantId: string;
    missionId: string;
    kind: RescueConsequenceKind;
    evidenceId: string;
    observedAt?: Date;
  },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission | null> {
  const store = deps.store ?? defaultMemoryStore;
  const mission = await store.get(input.tenantId, input.missionId);
  if (!mission) return null;
  const next = applyLaterConsequence(mission, {
    kind: input.kind,
    evidenceId: input.evidenceId,
    observedAt: (input.observedAt ?? (deps.now ?? (() => new Date()))()).toISOString(),
  });
  await store.save(next);
  return publicize(next);
}

export async function listRescueMissions(
  input: { tenantId: string; operatorUserId: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission[]> {
  const store = deps.store ?? defaultMemoryStore;
  const rows = await store.listForOperator(input.tenantId, input.operatorUserId);
  return rows.map(publicize);
}

async function requireOwnedMission(
  store: RescueMissionStore,
  input: { tenantId: string; operatorUserId: string; missionId: string }
): Promise<SpiritHumanRescueMission> {
  const mission = await store.get(input.tenantId, input.missionId);
  if (!mission || mission.tenantId !== input.tenantId) {
    throw Object.assign(new Error("Rescue mission not found."), { code: "NOT_FOUND" });
  }
  if (mission.operatorUserId !== input.operatorUserId) {
    throw Object.assign(new Error("Rescue mission is not available to this operator."), {
      code: "FORBIDDEN",
    });
  }
  return mission;
}

export function defaultTestRescueDeps(overrides: RescueServiceDeps = {}): RescueServiceDeps & {
  store: MemoryRescueMissionStore;
  sendAdapter: ReturnType<typeof createFakeOutboundSendAdapter>;
} {
  const store = (overrides.store as MemoryRescueMissionStore | undefined) ?? new MemoryRescueMissionStore();
  const sendAdapter =
    (overrides.sendAdapter as ReturnType<typeof createFakeOutboundSendAdapter> | undefined) ??
    createFakeOutboundSendAdapter();
  return {
    permissionCheck: async () => ({ allowed: true, permissionStatus: "unspecified" as const }),
    recordOutreach: async () => undefined,
    ...overrides,
    store,
    sendAdapter,
  };
}

export { defaultMemoryStore };
