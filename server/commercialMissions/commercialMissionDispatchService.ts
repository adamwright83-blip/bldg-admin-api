import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  commercialMissionDispatches,
  commercialMissionPhoneHandoffs,
  commercialMissions,
  dayforgeSaasMemberships,
  type CommercialMissionDispatchRow,
  users,
} from "../../drizzle/schema";
import { getDb } from "../db";

export const SMS_NOT_CONFIGURED_REASON = "TWILIO_SMS_NOT_CONFIGURED";

export type CommercialMissionDispatchChannel = "in_app" | "sms";
export type CommercialMissionDispatchPolicy = "manual" | "on_game_complete";

type DispatchableMission = {
  id: number;
  tenantId: string;
  assignedTo: string | null;
  status:
    | "candidate"
    | "selected"
    | "game_ready"
    | "game_active"
    | "game_completed"
    | "phone_ready"
    | "preparing"
    | "en_route"
    | "arrived"
    | "visit_completed"
    | "follow_up"
    | "won"
    | "lost";
};

type PhoneHandoffBinding = {
  id: string;
  tenantId: string;
  missionId: number;
  assignedTo: string;
  channel: "secure_link" | "sms" | "email";
  expiresAt: Date;
  consumedAt: Date | null;
};

export type NewCommercialMissionDispatch =
  typeof commercialMissionDispatches.$inferInsert;

export type CommercialMissionDispatchTransaction = {
  findMission(input: {
    tenantId: string;
    missionId: number;
  }): Promise<DispatchableMission | null>;
  isActiveFieldAssignee(input: {
    tenantId: string;
    assignedTo: string;
  }): Promise<boolean>;
  findPhoneHandoff(input: {
    tenantId: string;
    handoffId: string;
  }): Promise<PhoneHandoffBinding | null>;
  findDispatchesByRequest(input: {
    tenantId: string;
    requestId: string;
  }): Promise<CommercialMissionDispatchRow[]>;
  findDispatchById(input: {
    tenantId: string;
    dispatchId: string;
  }): Promise<CommercialMissionDispatchRow | null>;
  insertDispatch(input: NewCommercialMissionDispatch): Promise<void>;
  markInAppOpened(input: {
    tenantId: string;
    dispatchId: string;
    openedAt: Date;
  }): Promise<void>;
};

export type CommercialMissionDispatchRepository = {
  transaction<T>(
    work: (tx: CommercialMissionDispatchTransaction) => Promise<T>
  ): Promise<T>;
};

export type DispatchCommercialMissionInput = {
  tenantId: string;
  missionId: number;
  actorId: string;
  requestId: string;
  dispatchPolicy: CommercialMissionDispatchPolicy;
  handoffId?: string | null;
  includeSms?: boolean;
};

export type CommercialMissionDispatchView = {
  id: string;
  tenantId: string;
  missionId: number;
  assignedTo: string;
  handoffId: string | null;
  dispatchPolicy: CommercialMissionDispatchPolicy;
  channel: CommercialMissionDispatchChannel;
  status:
    | "queued"
    | "sent"
    | "failed"
    | "opened"
    | "not_configured"
    | "cancelled";
  destinationPath: string;
  queuedAt: string;
  sentAt: string | null;
  failedAt: string | null;
  openedAt: string | null;
  providerMessageId: string | null;
  failureReason: string | null;
  requestId: string;
  createdBy: string;
};

export type CommercialMissionDispatchResult = {
  missionId: number;
  assignedTo: string;
  requestId: string;
  destinationPath: string;
  dispatches: CommercialMissionDispatchView[];
};

export type CommercialMissionDispatchRuntime = {
  now(): Date;
  createId(): string;
  smsConfigured: boolean;
};

const DISPATCHABLE_MISSION_STATUSES = new Set<DispatchableMission["status"]>([
  "phone_ready",
  "preparing",
  "en_route",
  "arrived",
]);

function assertNonEmptyBounded(
  value: string,
  field: string,
  maximumLength: number
): void {
  if (!value.trim()) throw new Error(`${field} is required`);
  if (value.length > maximumLength)
    throw new Error(`${field} exceeds ${maximumLength} characters`);
}

function assertDispatchInput(input: DispatchCommercialMissionInput): void {
  assertNonEmptyBounded(input.tenantId, "tenantId", 64);
  assertNonEmptyBounded(input.actorId, "actorId", 128);
  assertNonEmptyBounded(input.requestId, "requestId", 36);
  if (!Number.isSafeInteger(input.missionId) || input.missionId <= 0)
    throw new Error("missionId must be a positive integer");
  if (input.handoffId) assertNonEmptyBounded(input.handoffId, "handoffId", 36);
}

function destinationPath(missionId: number): string {
  return `/driver/sales-mission/${missionId}`;
}

function dispatchChannels(includeSms: boolean | undefined) {
  return includeSms === true
    ? (["in_app", "sms"] as const)
    : (["in_app"] as const);
}

function dispatchView(
  row: CommercialMissionDispatchRow
): CommercialMissionDispatchView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    missionId: row.missionId,
    assignedTo: row.assignedTo,
    handoffId: row.handoffId,
    dispatchPolicy: row.dispatchPolicy,
    channel: row.channel,
    status: row.status,
    destinationPath: row.destinationPath,
    queuedAt: row.queuedAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    openedAt: row.openedAt?.toISOString() ?? null,
    providerMessageId: row.providerMessageId,
    failureReason: row.failureReason,
    requestId: row.requestId,
    createdBy: row.createdBy,
  };
}

function assertDispatchBinding(input: {
  rows: CommercialMissionDispatchRow[];
  tenantId: string;
  missionId: number;
  assignedTo: string;
  handoffId: string | null;
  dispatchPolicy: CommercialMissionDispatchPolicy;
  channels: readonly CommercialMissionDispatchChannel[];
  destinationPath: string;
  requestId: string;
  actorId: string;
}): void {
  const expectedChannels = new Set(input.channels);
  if (
    input.rows.length !== expectedChannels.size ||
    input.rows.some(row => !expectedChannels.has(row.channel))
  ) {
    throw new Error(
      "Dispatch request ID is already bound to a different channel set"
    );
  }
  for (const row of input.rows) {
    if (
      row.tenantId !== input.tenantId ||
      row.missionId !== input.missionId ||
      row.assignedTo !== input.assignedTo ||
      row.handoffId !== input.handoffId ||
      row.dispatchPolicy !== input.dispatchPolicy ||
      row.destinationPath !== input.destinationPath ||
      row.requestId !== input.requestId ||
      row.createdBy !== input.actorId
    ) {
      throw new Error(
        "Dispatch request ID is already bound to another mission or assignee"
      );
    }
  }
}

function dispatchResult(
  rows: CommercialMissionDispatchRow[]
): CommercialMissionDispatchResult {
  const ordered = [...rows].sort((left, right) =>
    left.channel.localeCompare(right.channel)
  );
  const first = ordered[0];
  if (!first) throw new Error("Commercial mission dispatch was not persisted");
  return {
    missionId: first.missionId,
    assignedTo: first.assignedTo,
    requestId: first.requestId,
    destinationPath: first.destinationPath,
    dispatches: ordered.map(dispatchView),
  };
}

/**
 * Persists the notification truth only. In-app delivery remains queued until
 * the field client opens it. SMS remains queued for a later provider worker,
 * or is explicitly recorded as not configured. This function has no Twilio
 * or other network side effects.
 */
export async function dispatchCommercialMissionWith(
  repository: CommercialMissionDispatchRepository,
  input: DispatchCommercialMissionInput,
  runtime: CommercialMissionDispatchRuntime
): Promise<CommercialMissionDispatchResult> {
  assertDispatchInput(input);
  return repository.transaction(async tx => {
    const mission = await tx.findMission({
      tenantId: input.tenantId,
      missionId: input.missionId,
    });
    if (!mission) throw new Error("Commercial mission not found");
    if (!mission.assignedTo)
      throw new Error("Assign the mission before dispatching it");
    const assignedTo = mission.assignedTo;
    if (
      !(await tx.isActiveFieldAssignee({
        tenantId: input.tenantId,
        assignedTo,
      }))
    ) {
      throw new Error(
        "Commercial mission assignee is not an active field user for this tenant"
      );
    }

    const handoffId = input.handoffId ?? null;
    if (input.includeSms === true && !handoffId) {
      throw new Error("SMS dispatch requires a validated SMS phone handoff");
    }
    const channels = dispatchChannels(input.includeSms);
    const path = destinationPath(mission.id);
    const existing = await tx.findDispatchesByRequest({
      tenantId: input.tenantId,
      requestId: input.requestId,
    });
    if (existing.length > 0) {
      assertDispatchBinding({
        rows: existing,
        tenantId: input.tenantId,
        missionId: mission.id,
        assignedTo,
        handoffId,
        dispatchPolicy: input.dispatchPolicy,
        channels,
        destinationPath: path,
        requestId: input.requestId,
        actorId: input.actorId,
      });
      return dispatchResult(existing);
    }

    const now = runtime.now();
    if (handoffId) {
      const handoff = await tx.findPhoneHandoff({
        tenantId: input.tenantId,
        handoffId,
      });
      if (
        !handoff ||
        handoff.missionId !== mission.id ||
        handoff.assignedTo !== assignedTo ||
        (input.includeSms === true && handoff.channel !== "sms") ||
        handoff.expiresAt.getTime() <= now.getTime() ||
        handoff.consumedAt !== null
      ) {
        throw new Error(
          "Phone handoff is invalid, expired, consumed, or bound to another mission"
        );
      }
    }

    if (!DISPATCHABLE_MISSION_STATUSES.has(mission.status)) {
      throw new Error(
        `Commercial mission cannot be dispatched from ${mission.status}`
      );
    }

    for (const channel of channels) {
      const smsIsUnavailable = channel === "sms" && !runtime.smsConfigured;
      await tx.insertDispatch({
        id: runtime.createId(),
        tenantId: input.tenantId,
        missionId: mission.id,
        assignedTo,
        handoffId,
        dispatchPolicy: input.dispatchPolicy,
        channel,
        status: smsIsUnavailable ? "not_configured" : "queued",
        destinationPath: path,
        queuedAt: now,
        sentAt: null,
        failedAt: null,
        openedAt: null,
        providerMessageId: null,
        failureReason: smsIsUnavailable ? SMS_NOT_CONFIGURED_REASON : null,
        requestId: input.requestId,
        createdBy: input.actorId,
      });
    }

    const persisted = await tx.findDispatchesByRequest({
      tenantId: input.tenantId,
      requestId: input.requestId,
    });
    assertDispatchBinding({
      rows: persisted,
      tenantId: input.tenantId,
      missionId: mission.id,
      assignedTo,
      handoffId,
      dispatchPolicy: input.dispatchPolicy,
      channels,
      destinationPath: path,
      requestId: input.requestId,
      actorId: input.actorId,
    });
    return dispatchResult(persisted);
  });
}

export type OpenCommercialMissionDispatchInput = {
  tenantId: string;
  dispatchId: string;
  actorId: string;
};

export async function openCommercialMissionDispatchWith(
  repository: CommercialMissionDispatchRepository,
  input: OpenCommercialMissionDispatchInput,
  now: Date
): Promise<CommercialMissionDispatchView> {
  assertNonEmptyBounded(input.tenantId, "tenantId", 64);
  assertNonEmptyBounded(input.dispatchId, "dispatchId", 36);
  assertNonEmptyBounded(input.actorId, "actorId", 128);
  return repository.transaction(async tx => {
    const dispatch = await tx.findDispatchById({
      tenantId: input.tenantId,
      dispatchId: input.dispatchId,
    });
    if (!dispatch) throw new Error("Commercial mission dispatch not found");
    if (dispatch.channel !== "in_app")
      throw new Error("Only in-app dispatches can be opened in the app");
    if (dispatch.assignedTo !== input.actorId)
      throw new Error(
        "Commercial mission dispatch is assigned to another user"
      );
    if (
      !(await tx.isActiveFieldAssignee({
        tenantId: input.tenantId,
        assignedTo: input.actorId,
      }))
    ) {
      throw new Error(
        "Commercial mission assignee is not active for this tenant"
      );
    }
    if (dispatch.status === "opened") return dispatchView(dispatch);
    if (dispatch.status !== "queued" && dispatch.status !== "sent") {
      throw new Error(
        `Commercial mission dispatch cannot be opened from ${dispatch.status}`
      );
    }
    await tx.markInAppOpened({
      tenantId: input.tenantId,
      dispatchId: input.dispatchId,
      openedAt: now,
    });
    const opened = await tx.findDispatchById({
      tenantId: input.tenantId,
      dispatchId: input.dispatchId,
    });
    if (!opened || opened.status !== "opened" || !opened.openedAt)
      throw new Error("Commercial mission dispatch open was not persisted");
    return dispatchView(opened);
  });
}

export function isTwilioSmsConfigured(
  environment: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    environment.TWILIO_ACCOUNT_SID?.trim() &&
      environment.TWILIO_AUTH_TOKEN?.trim() &&
      (environment.TWILIO_FROM_NUMBER?.trim() ||
        environment.TWILIO_PHONE_NUMBER?.trim())
  );
}

type DispatchDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type DispatchDbTransaction = Parameters<
  Parameters<DispatchDb["transaction"]>[0]
>[0];

function drizzleTransaction(
  tx: DispatchDbTransaction
): CommercialMissionDispatchTransaction {
  return {
    async findMission(input) {
      const [mission] = await tx
        .select({
          id: commercialMissions.id,
          tenantId: commercialMissions.tenantId,
          assignedTo: commercialMissions.assignedTo,
          status: commercialMissions.status,
        })
        .from(commercialMissions)
        .where(
          and(
            eq(commercialMissions.tenantId, input.tenantId),
            eq(commercialMissions.id, input.missionId)
          )
        )
        .limit(1);
      return mission ?? null;
    },
    async isActiveFieldAssignee(input) {
      const [membership] = await tx
        .select({ id: dayforgeSaasMemberships.id })
        .from(dayforgeSaasMemberships)
        .where(
          and(
            eq(dayforgeSaasMemberships.tenantId, input.tenantId),
            eq(dayforgeSaasMemberships.userOpenId, input.assignedTo),
            eq(dayforgeSaasMemberships.role, "field"),
            eq(dayforgeSaasMemberships.active, true)
          )
        )
        .limit(1);
      if (membership) return true;
      // Legacy DayForge tenants authorize their field user through the
      // platform driver role rather than a SaaS membership row.
      const [legacyDriver] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenantId, input.tenantId),
            eq(users.openId, input.assignedTo),
            eq(users.role, "driver")
          )
        )
        .limit(1);
      return Boolean(legacyDriver);
    },
    async findPhoneHandoff(input) {
      const [handoff] = await tx
        .select({
          id: commercialMissionPhoneHandoffs.id,
          tenantId: commercialMissionPhoneHandoffs.tenantId,
          missionId: commercialMissionPhoneHandoffs.missionId,
          assignedTo: commercialMissionPhoneHandoffs.assignedTo,
          channel: commercialMissionPhoneHandoffs.channel,
          expiresAt: commercialMissionPhoneHandoffs.expiresAt,
          consumedAt: commercialMissionPhoneHandoffs.consumedAt,
        })
        .from(commercialMissionPhoneHandoffs)
        .where(
          and(
            eq(commercialMissionPhoneHandoffs.tenantId, input.tenantId),
            eq(commercialMissionPhoneHandoffs.id, input.handoffId)
          )
        )
        .limit(1);
      return handoff ?? null;
    },
    async findDispatchesByRequest(input) {
      return tx
        .select()
        .from(commercialMissionDispatches)
        .where(
          and(
            eq(commercialMissionDispatches.tenantId, input.tenantId),
            eq(commercialMissionDispatches.requestId, input.requestId)
          )
        )
        .orderBy(asc(commercialMissionDispatches.channel));
    },
    async findDispatchById(input) {
      const [dispatch] = await tx
        .select()
        .from(commercialMissionDispatches)
        .where(
          and(
            eq(commercialMissionDispatches.tenantId, input.tenantId),
            eq(commercialMissionDispatches.id, input.dispatchId)
          )
        )
        .limit(1);
      return dispatch ?? null;
    },
    async insertDispatch(input) {
      await tx
        .insert(commercialMissionDispatches)
        .values(input)
        .onDuplicateKeyUpdate({
          set: { id: sql`${commercialMissionDispatches.id}` },
        });
    },
    async markInAppOpened(input) {
      await tx
        .update(commercialMissionDispatches)
        .set({ status: "opened", openedAt: input.openedAt })
        .where(
          and(
            eq(commercialMissionDispatches.tenantId, input.tenantId),
            eq(commercialMissionDispatches.id, input.dispatchId),
            eq(commercialMissionDispatches.channel, "in_app"),
            inArray(commercialMissionDispatches.status, ["queued", "sent"])
          )
        );
    },
  };
}

function drizzleRepository(
  db: DispatchDb
): CommercialMissionDispatchRepository {
  return {
    transaction(work) {
      return db.transaction(tx => work(drizzleTransaction(tx)));
    },
  };
}

export async function dispatchCommercialMission(
  input: DispatchCommercialMissionInput
): Promise<CommercialMissionDispatchResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return dispatchCommercialMissionWith(drizzleRepository(db), input, {
    now: () => new Date(),
    createId: randomUUID,
    smsConfigured: isTwilioSmsConfigured(),
  });
}

export async function openCommercialMissionDispatch(
  input: OpenCommercialMissionDispatchInput
): Promise<CommercialMissionDispatchView> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return openCommercialMissionDispatchWith(
    drizzleRepository(db),
    input,
    new Date()
  );
}
