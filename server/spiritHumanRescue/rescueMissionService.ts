import { nanoid } from "nanoid";
import {
  applyLaterConsequence,
  canClaimOutboundSend,
  canCompleteRescue,
  CLAIMABLE_SEND_STATES,
  composeReactivationDraft,
  emptySendRecord,
  isAmbiguousSend,
  isSendClaimLocked,
  missionLifecycleFromSend,
  publicMissionHasNoPhone,
  selectVillagerIndependentOfCustomer,
  SEND_CLAIMABLE_LIFECYCLES,
  SEND_EVIDENCE_NAME,
  SPIRIT_HUMAN_RESCUE_KIND,
  type RescueConsequenceKind,
  type RescueSendEvidenceName,
  type RescueSendRecord,
  type SpiritHumanRescueMission,
} from "../../shared/spiritHumanRescue";
import type { LedgerEventInput } from "../../shared/behavioralLedger";
import type { DormantEligibleCustomer } from "../strategy/snapshotDormantCustomers";
import { checkCommunicationPermission, recordOutreachAttempt } from "../strategy/communicationPermissionService";
import { recordBehavioralLedgerEvent } from "../behavioralLedger/behavioralLedger";
import { createOpsTask, updateOpsTaskStatus, type OpsTaskStore } from "../opsTasks";
import { listDormantRescueCandidates } from "./listCandidates";
import {
  freezeFactsFromCandidate,
  resolveSendContact as resolveSendContactFromDb,
  type SendContactResolution,
} from "./resolveDormantContact";
import {
  createFakeOutboundSendAdapter,
  twilioOutboundSendAdapter,
  type OutboundSendAdapter,
} from "./outboundSendAdapter";
import {
  MemoryRescueMissionStore,
  requireDurableRescueStore,
  type RescueMissionStore,
} from "./rescueMissionStore";

export type RescueServiceDeps = {
  store?: RescueMissionStore;
  sendAdapter?: OutboundSendAdapter;
  now?: () => Date;
  loadCandidates?: (input: { tenantId: string; now?: Date }) => Promise<DormantEligibleCustomer[]>;
  resolveSendContact?: (input: {
    tenantId: string;
    snapshotCustomerId: string;
    now?: Date;
  }) => Promise<SendContactResolution>;
  permissionCheck?: typeof checkCommunicationPermission;
  recordOutreach?: typeof recordOutreachAttempt;
  recordLedger?: (input: LedgerEventInput) => Promise<unknown>;
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
      deferred: mission.deferredAt != null && mission.send.status !== "cancelled",
      superseded: mission.lifecycle === "superseded",
    }),
  };
}

async function persistIfCurrent(
  store: RescueMissionStore,
  expected: SpiritHumanRescueMission,
  next: SpiritHumanRescueMission
): Promise<{ claimed: boolean; mission: SpiritHumanRescueMission }> {
  const claimed = await store.compareAndSet({
    tenantId: expected.tenantId,
    missionId: expected.missionId,
    fromStatuses: [expected.send.status],
    fromLifecycles: [expected.lifecycle],
    next,
  });
  if (claimed === "claimed") return { claimed: true, mission: next };
  const latest = await store.get(expected.tenantId, expected.missionId);
  return { claimed: false, mission: latest ?? expected };
}

function refuseIfSendLocked(mission: SpiritHumanRescueMission): SpiritHumanRescueMission | null {
  if (canCompleteRescue(mission.send) || isSendClaimLocked(mission.send)) return publicize(mission);
  if (mission.lifecycle === "superseded" || mission.lifecycle === "skipped") return publicize(mission);
  return null;
}

async function resolveStore(deps: RescueServiceDeps): Promise<RescueMissionStore> {
  if (deps.store) return deps.store;
  return requireDurableRescueStore();
}

export async function instantiateRescueMission(
  input: {
    tenantId: string;
    operatorUserId: string;
    snapshotCustomerId: string;
  },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = await resolveStore(deps);
  const now = (deps.now ?? (() => new Date()))();
  const existingRows = await store.listForOperator(input.tenantId, input.operatorUserId);
  const loadCandidates = deps.loadCandidates ?? listDormantRescueCandidates;
  const candidates = await loadCandidates({ tenantId: input.tenantId, now });
  const candidate = candidates.find(row => row.id === input.snapshotCustomerId);

  if (!candidate) {
    const existing = existingRows.find(
      row =>
        row.spiritHuman.snapshotCustomerId === input.snapshotCustomerId &&
        row.lifecycle !== "skipped" &&
        row.lifecycle !== "superseded"
    );
    if (existing) return publicize(existing);
    throw Object.assign(new Error("Dormant customer could not be resolved from the Strategy snapshot."), {
      code: "UNKNOWN_CUSTOMER",
    });
  }

  const existingEpisode = existingRows.find(
    row =>
      row.spiritHuman.snapshotCustomerId === input.snapshotCustomerId &&
      row.spiritHuman.lastOrderAt === candidate.lastOrderAt
  );
  if (existingEpisode) return publicize(existingEpisode);

  const frozen = freezeFactsFromCandidate(candidate);
  const missionId = `shr_${nanoid(12)}`;
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
    opsTaskId: null,
    deferredAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const episodeClaim = await store.createForDormancyEpisode(mission);
  if (episodeClaim.mission.operatorUserId !== input.operatorUserId) {
    throw Object.assign(new Error("This dormant customer episode is already assigned to another operator."), {
      code: "TARGET_ALREADY_CLAIMED",
    });
  }
  if (!episodeClaim.created) return publicize(episodeClaim.mission);

  let authoritative = episodeClaim.mission;
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
            missionId: authoritative.missionId,
            snapshotCustomerId: frozen.snapshotCustomerId,
          },
        },
        deps.opsTaskStore
      );
      const withTask: SpiritHumanRescueMission = {
        ...authoritative,
        opsTaskId: task.id,
        updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
      };
      authoritative = (await persistIfCurrent(store, authoritative, withTask)).mission;
    } catch {
      // Mission creation is authoritative. Ops-task projection is secondary.
    }
  }
  return publicize(authoritative);
}

export async function enterRescueMission(
  input: { tenantId: string; operatorUserId: string; missionId: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = await resolveStore(deps);
  const mission = await requireOwnedMission(store, input);
  const locked = refuseIfSendLocked(mission);
  if (locked) return locked;
  const next = {
    ...mission,
    lifecycle: "active" as const,
    updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  const persisted = await persistIfCurrent(store, mission, next);
  return publicize(persisted.mission);
}

export async function prepareRescueDraft(
  input: { tenantId: string; operatorUserId: string; missionId: string; editedDraft?: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = await resolveStore(deps);
  const mission = await requireOwnedMission(store, input);
  const locked = refuseIfSendLocked(mission);
  if (locked) return locked;
  const draft = (input.editedDraft ?? composeReactivationDraft(mission.spiritHuman)).trim();
  if (!draft) throw Object.assign(new Error("Draft is empty."), { code: "EMPTY_DRAFT" });
  const next: SpiritHumanRescueMission = {
    ...mission,
    draft,
    send: {
      ...mission.send,
      status: "draft_ready",
    },
    lifecycle: mission.lifecycle === "available" ? "active" : mission.lifecycle,
    updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  const persisted = await persistIfCurrent(store, mission, refreshLifecycle(next));
  return publicize(persisted.mission);
}

export async function cancelRescueMission(
  input: { tenantId: string; operatorUserId: string; missionId: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = await resolveStore(deps);
  const mission = await requireOwnedMission(store, input);
  const locked = refuseIfSendLocked(mission);
  if (locked) return locked;
  const next: SpiritHumanRescueMission = {
    ...mission,
    send: { ...mission.send, status: "cancelled" },
    lifecycle: "skipped",
    updatedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  const persisted = await persistIfCurrent(store, mission, next);
  return publicize(persisted.mission);
}

export async function deferRescueMission(
  input: { tenantId: string; operatorUserId: string; missionId: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission> {
  const store = await resolveStore(deps);
  const mission = await requireOwnedMission(store, input);
  const locked = refuseIfSendLocked(mission);
  if (locked) return locked;
  const now = (deps.now ?? (() => new Date()))();
  const next: SpiritHumanRescueMission = {
    ...mission,
    deferredAt: now.toISOString(),
    lifecycle: "available",
    updatedAt: now.toISOString(),
  };
  const persisted = await persistIfCurrent(store, mission, next);
  if (persisted.claimed) {
    await emitOperatorLedger(persisted.mission, "DEFERRED", now, deps);
  }
  return publicize(persisted.mission);
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
  const store = await resolveStore(deps);
  const startedAt = (deps.now ?? (() => new Date()))();
  const mission = await requireOwnedMission(store, input);
  if (canCompleteRescue(mission.send)) {
    return publicize(mission);
  }
  if (mission.send.status === "cancelled" || mission.lifecycle === "skipped") {
    throw Object.assign(new Error("Cancelled missions cannot send."), { code: "CANCELLED" });
  }
  if (mission.lifecycle === "superseded") {
    return publicize(mission);
  }
  if (isAmbiguousSend(mission.send)) {
    return markSendOutcomeUnknown(store, mission, startedAt);
  }
  if (!canClaimOutboundSend(mission)) {
    throw Object.assign(new Error("This send attempt cannot be retried."), { code: "NOT_RETRYABLE" });
  }

  const draft = (input.editedDraft ?? mission.draft ?? composeReactivationDraft(mission.spiritHuman)).trim();
  const permissionCheck = deps.permissionCheck ?? checkCommunicationPermission;
  const permission = await permissionCheck({
    tenantId: input.tenantId,
    subjectType: "customer",
    subjectId: mission.spiritHuman.snapshotCustomerId,
    channel: "sms",
    now: startedAt,
  });
  if (!permission.allowed) {
    return persistFailure(store, mission, startedAt, "permission_denied", permission.reason ?? "Communication is not permitted.");
  }

  const resolve = deps.resolveSendContact ?? resolveSendContactFromDb;
  const contact = await resolve({
    tenantId: input.tenantId,
    snapshotCustomerId: mission.spiritHuman.snapshotCustomerId,
    now: startedAt,
  });
  if (contact.kind === "no_longer_dormant") {
    return supersedeMission(store, mission, startedAt, deps);
  }
  if (contact.kind !== "ready" || !contact.contact.phone) {
    return persistFailure(store, mission, startedAt, "contact_unresolved", "Customer contact could not be resolved.");
  }

  const sending: SpiritHumanRescueMission = {
    ...mission,
    draft,
    send: {
      ...mission.send,
      status: "sending",
      approvedByUserId: input.approvedByUserId,
      attemptedAt: startedAt.toISOString(),
    },
    lifecycle: "active",
    updatedAt: startedAt.toISOString(),
  };
  const claimed = await store.compareAndSet({
    tenantId: input.tenantId,
    missionId: input.missionId,
    fromStatuses: CLAIMABLE_SEND_STATES,
    fromLifecycles: SEND_CLAIMABLE_LIFECYCLES,
    next: sending,
  });
  if (claimed !== "claimed") {
    const latest = await store.get(input.tenantId, input.missionId);
    if (latest && canCompleteRescue(latest.send)) return publicize(latest);
    if (latest && isAmbiguousSend(latest.send) && latest.send.status === "send_outcome_unknown") {
      return publicize(latest);
    }
    if (latest?.send.status === "sending") {
      return publicize(latest);
    }
    return publicize(latest ?? sending);
  }

  const adapter = deps.sendAdapter ?? twilioOutboundSendAdapter;
  let receipt;
  try {
    receipt = await adapter.send({
      to: contact.contact.phone,
      body: draft,
      idempotencyKey: mission.send.idempotencyKey,
    });
  } catch {
    return markSendOutcomeUnknown(store, sending, deps.now?.() ?? new Date());
  }
  const acceptedAt = (deps.now ?? (() => new Date()))();

  if (receipt.evidenceName === "send_outcome_unknown") {
    return markSendOutcomeUnknown(store, sending, acceptedAt);
  }

  if (!receipt.accepted || !receipt.providerMessageId) {
    const evidence: RescueSendEvidenceName =
      receipt.evidenceName === "provider_unconfigured" ? "provider_unconfigured" : "provider_rejected";
    const reason =
      evidence === "provider_unconfigured"
        ? "Outbound SMS is not configured."
        : "Provider rejected the outbound request.";
    return persistFailure(store, sending, acceptedAt, evidence, reason, ["sending"]);
  }

  const sentRecord: RescueSendRecord = {
    ...sending.send,
    status: "sent",
    acceptedAt: acceptedAt.toISOString(),
    providerMessageId: receipt.providerMessageId,
    providerStatus: receipt.providerStatus,
    evidenceName: SEND_EVIDENCE_NAME,
    failureReason: null,
  };
  if (!canCompleteRescue(sentRecord)) {
    return persistFailure(store, sending, acceptedAt, "provider_rejected", "Send receipt was not authoritative.", [
      "sending",
    ]);
  }
  const completed: SpiritHumanRescueMission = {
    ...sending,
    send: sentRecord,
    lifecycle: "completed",
    updatedAt: acceptedAt.toISOString(),
  };
  const completedClaim = await store.compareAndSet({
    tenantId: input.tenantId,
    missionId: input.missionId,
    fromStatuses: ["sending", "send_outcome_unknown"],
    fromLifecycles: ["active", "problem"],
    next: completed,
  });
  let authoritative: SpiritHumanRescueMission = completed;
  if (completedClaim !== "claimed") {
    const latest = await store.get(input.tenantId, input.missionId);
    if (latest && canCompleteRescue(latest.send)) {
      authoritative = latest;
    } else {
      const retried = await store.compareAndSet({
        tenantId: input.tenantId,
        missionId: input.missionId,
        fromStatuses: ["sending", "send_outcome_unknown"],
        fromLifecycles: ["active", "problem"],
        next: completed,
      });
      if (retried === "claimed") {
        authoritative = completed;
      } else {
        const again = await store.get(input.tenantId, input.missionId);
        if (again && canCompleteRescue(again.send)) {
          authoritative = again;
        } else {
          console.warn(
            "[SpiritHumanRescue] provider accepted a send but the receipt could not be claimed onto the expected sending/unknown row"
          );
          authoritative = again ?? completed;
        }
      }
    }
  }

  const recordOutreach = deps.recordOutreach ?? recordOutreachAttempt;
  try {
    await recordOutreach({
      tenantId: input.tenantId,
      subjectType: "customer",
      subjectId: mission.spiritHuman.snapshotCustomerId,
      channel: "sms",
      at: acceptedAt,
    });
  } catch (error) {
    console.warn("[SpiritHumanRescue] outreach bookkeeping failed after provider-accepted send", error);
  }
  if (authoritative.opsTaskId != null) {
    try {
      await updateOpsTaskStatus(
        {
          tenantId: input.tenantId,
          taskId: authoritative.opsTaskId,
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
  return publicize(authoritative);
}

async function markSendOutcomeUnknown(
  store: RescueMissionStore,
  mission: SpiritHumanRescueMission,
  now: Date
): Promise<SpiritHumanRescueMission> {
  if (mission.send.status === "send_outcome_unknown") return publicize(mission);
  const next: SpiritHumanRescueMission = {
    ...mission,
    send: {
      ...mission.send,
      status: "send_outcome_unknown",
      failedAt: now.toISOString(),
      evidenceName: "send_outcome_unknown",
      failureReason:
        "Send outcome is unknown. A prior attempt may still be in flight. Do not retry automatically.",
    },
    lifecycle: "problem",
    updatedAt: now.toISOString(),
  };
  const claimed = await store.compareAndSet({
    tenantId: mission.tenantId,
    missionId: mission.missionId,
    fromStatuses: ["sending"],
    next,
  });
  if (claimed !== "claimed") {
    const latest = await store.get(mission.tenantId, mission.missionId);
    return publicize(latest ?? next);
  }
  return publicize(next);
}

async function persistFailure(
  store: RescueMissionStore,
  mission: SpiritHumanRescueMission,
  now: Date,
  evidenceName: RescueSendEvidenceName,
  reason: string,
  fromStatuses: readonly ("sending" | "draft_ready" | "awaiting_approval" | "send_failed")[] = [
    ...CLAIMABLE_SEND_STATES,
  ]
): Promise<SpiritHumanRescueMission> {
  const failed: SpiritHumanRescueMission = {
    ...mission,
    send: {
      ...mission.send,
      status: "send_failed",
      failedAt: now.toISOString(),
      evidenceName,
      failureReason: reason,
    },
    lifecycle: "problem",
    updatedAt: now.toISOString(),
  };
  const claimed = await store.compareAndSet({
    tenantId: mission.tenantId,
    missionId: mission.missionId,
    fromStatuses,
    next: failed,
  });
  if (claimed !== "claimed") {
    const latest = await store.get(mission.tenantId, mission.missionId);
    if (latest && canCompleteRescue(latest.send)) return publicize(latest);
    return publicize(latest ?? failed);
  }
  return publicize(failed);
}

async function supersedeMission(
  store: RescueMissionStore,
  mission: SpiritHumanRescueMission,
  now: Date,
  deps: RescueServiceDeps
): Promise<SpiritHumanRescueMission> {
  const next: SpiritHumanRescueMission = {
    ...mission,
    lifecycle: "superseded",
    send: {
      ...mission.send,
      evidenceName: "no_longer_dormant",
      failureReason: "Customer is no longer dormant. Rescue outreach is unnecessary.",
    },
    updatedAt: now.toISOString(),
  };
  const persisted = await persistIfCurrent(store, mission, next);
  if (persisted.claimed) {
    await emitOperatorLedger(persisted.mission, "SUPERSEDED", now, deps);
  }
  return publicize(persisted.mission);
}

async function emitOperatorLedger(
  mission: SpiritHumanRescueMission,
  eventType: "DEFERRED" | "SUPERSEDED",
  now: Date,
  deps: RescueServiceDeps
): Promise<void> {
  if (!mission.opsTaskId) return;
  const recordLedger = deps.recordLedger ?? recordBehavioralLedgerEvent;
  try {
    await recordLedger({
      tenantId: mission.tenantId,
      operatorUserId: mission.operatorUserId,
      correlationId: `ops_task:${mission.opsTaskId}`,
      sourceSystem: "ops_task",
      sourceEntityType: "ops_task",
      sourceEntityId: String(mission.opsTaskId),
      eventType,
      occurredAt: now,
      verificationClass: "ATTESTED",
      provenance: `spirit_human_rescue.${eventType.toLowerCase()}`,
      evidenceSource: `spirit_human_rescue:${mission.missionId}:${eventType.toLowerCase()}`,
      idempotencyKey: `spirit-human:${mission.missionId}:${eventType}`,
    });
  } catch (error) {
    console.warn("[SpiritHumanRescue] ledger bookkeeping failed after durable mission write", error);
  }
}

/**
 * Records a later verified consequence. The caller must already have
 * provider-accepted send plus the matching inbound/paid-order evidence.
 * Absence of a reply is not a consequence.
 */
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
  const store = await resolveStore(deps);
  const mission = await store.get(input.tenantId, input.missionId);
  if (!mission) return null;
  const next = applyLaterConsequence(mission, {
    kind: input.kind,
    evidenceId: input.evidenceId,
    observedAt: (input.observedAt ?? (deps.now ?? (() => new Date()))()).toISOString(),
  });
  const first = await persistIfCurrent(store, mission, next);
  if (first.claimed) return publicize(first.mission);
  const latest = first.mission;
  const retried = applyLaterConsequence(latest, {
    kind: input.kind,
    evidenceId: input.evidenceId,
    observedAt: (input.observedAt ?? (deps.now ?? (() => new Date()))()).toISOString(),
  });
  const second = await persistIfCurrent(store, latest, retried);
  return publicize(second.mission);
}

export async function listRescueMissions(
  input: { tenantId: string; operatorUserId: string },
  deps: RescueServiceDeps = {}
): Promise<SpiritHumanRescueMission[]> {
  const store = await resolveStore(deps);
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

export { MemoryRescueMissionStore };
export type { RescueMissionStore };
