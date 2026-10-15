/**
 * Tenant- and operator-scoped personal sender observations.
 * Recording an observation does not touch the outreach outbox and cannot authorize a send.
 * No pairing secrets are accepted or stored.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { personalSenderIdentities } from "../../../../drizzle/schema";
import { getDb } from "../../../db";
import {
  ANDROID_DEVICE_SENDER,
  PERSONAL_SENDER_HUMAN_GATES,
} from "./androidDeviceSender";
import { evaluateGoogleMessagesBrowserTransport } from "./googleMessagesBrowserTransport";
import {
  classifyPersonalSenderHealth,
  type PersonalSenderClassification,
  type PersonalSenderObservation,
  type PersonalSenderObservationSource,
  isStrictUsE164,
} from "./personalSenderHealth";

export type PersonalSenderIdentityRecord = {
  id: string;
  tenantId: string;
  operatorId: string;
  pairingPresent: boolean;
  displacesExistingWebSession: boolean;
  pageLoaded: boolean;
  deviceOnline: boolean;
  sessionObservedAt: Date | null;
  originatingPhone: string | null;
  phoneVerified: boolean;
  observationSource: PersonalSenderObservationSource;
  deviceId: string | null;
  expectedDeviceId: string | null;
  transportProbeOk: boolean;
  updatedAt: Date;
};

export type PersonalSenderStatus = PersonalSenderClassification & {
  tenantId: string;
  operatorId: string;
  originatingPhone: string | null;
  browserTransport: ReturnType<typeof evaluateGoogleMessagesBrowserTransport>;
  deviceTransport: {
    id: typeof ANDROID_DEVICE_SENDER.id;
    status: "BLOCKED";
    reason: string;
  };
  humanGates: typeof PERSONAL_SENDER_HUMAN_GATES;
  carrierDeliveryObserved: false;
};

const memory = new Map<string, PersonalSenderIdentityRecord>();

function key(tenantId: string, operatorId: string): string {
  return `${tenantId}:${operatorId}`;
}

function unpaired(tenantId: string, operatorId: string): PersonalSenderIdentityRecord {
  return {
    id: `psi_unpaired_${tenantId}_${operatorId}`,
    tenantId,
    operatorId,
    pairingPresent: false,
    displacesExistingWebSession: false,
    pageLoaded: false,
    deviceOnline: false,
    sessionObservedAt: null,
    originatingPhone: null,
    phoneVerified: false,
    observationSource: "unknown",
    deviceId: null,
    expectedDeviceId: null,
    transportProbeOk: false,
    updatedAt: new Date(0),
  };
}

export function _resetPersonalSenderIdentityStore(): void {
  memory.clear();
}

function assertRecordable(source: PersonalSenderObservationSource): void {
  if (source === "simulated" && process.env.NODE_ENV !== "test") {
    throw new Error("Simulated sender observations are refused outside tests.");
  }
}

export async function recordPersonalSenderObservation(input: {
  tenantId: string;
  operatorId: string;
  pairingPresent: boolean;
  displacesExistingWebSession: boolean;
  pageLoaded: boolean;
  deviceOnline: boolean;
  sessionObservedAt: Date | null;
  originatingPhone: string | null;
  originatingPhoneVerified: boolean;
  observationSource: PersonalSenderObservationSource;
  deviceId: string | null;
  expectedDeviceId: string | null;
  transportProbeOk: boolean;
  now?: Date;
}): Promise<PersonalSenderStatus> {
  assertRecordable(input.observationSource);
  const now = input.now ?? new Date();
  const record: PersonalSenderIdentityRecord = {
    id: `psi_${randomUUID()}`,
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    pairingPresent: input.pairingPresent,
    displacesExistingWebSession: input.displacesExistingWebSession,
    pageLoaded: input.pageLoaded,
    deviceOnline: input.deviceOnline,
    sessionObservedAt: input.sessionObservedAt,
    originatingPhone: input.originatingPhone,
    phoneVerified: input.originatingPhoneVerified,
    observationSource: input.observationSource,
    deviceId: input.deviceId,
    expectedDeviceId: input.expectedDeviceId,
    transportProbeOk: input.transportProbeOk,
    updatedAt: now,
  };

  memory.set(key(input.tenantId, input.operatorId), record);
  await persist(record);
  return toStatus(record, now);
}

export async function getPersonalSenderStatus(input: {
  tenantId: string;
  operatorId: string;
  now?: Date;
}): Promise<PersonalSenderStatus> {
  const now = input.now ?? new Date();
  const stored = (await read(input.tenantId, input.operatorId)) ?? memory.get(key(input.tenantId, input.operatorId));
  return toStatus(stored ?? unpaired(input.tenantId, input.operatorId), now);
}

function toStatus(record: PersonalSenderIdentityRecord, now: Date): PersonalSenderStatus {
  const observation: PersonalSenderObservation = {
    pairingPresent: record.pairingPresent,
    displacesExistingWebSession: record.displacesExistingWebSession,
    pageLoaded: record.pageLoaded,
    deviceOnline: record.deviceOnline,
    sessionObservedAt: record.sessionObservedAt,
    now,
    originatingPhone: record.originatingPhone,
    originatingPhoneVerified: record.phoneVerified,
    observationSource: record.observationSource,
    deviceId: record.deviceId,
    expectedDeviceId: record.expectedDeviceId,
    transportProbeOk: record.transportProbeOk,
  };
  const classification = classifyPersonalSenderHealth(observation);
  const phoneVisible =
    record.phoneVerified &&
    isStrictUsE164(record.originatingPhone) &&
    (record.observationSource === "android_telephony_line" ||
      (record.observationSource === "simulated" && process.env.NODE_ENV === "test"));

  return {
    ...classification,
    tenantId: record.tenantId,
    operatorId: record.operatorId,
    originatingPhone: phoneVisible ? record.originatingPhone : null,
    browserTransport: evaluateGoogleMessagesBrowserTransport(),
    deviceTransport: {
      id: ANDROID_DEVICE_SENDER.id,
      status: "BLOCKED",
      reason: ANDROID_DEVICE_SENDER.reason,
    },
    humanGates: PERSONAL_SENDER_HUMAN_GATES,
    carrierDeliveryObserved: false,
  };
}

async function persist(record: PersonalSenderIdentityRecord): Promise<void> {
  if (process.env.NODE_ENV === "test" && !process.env.ALLOW_TEST_DB) return;
  const db = await getDb();
  if (!db) return;
  try {
    await db
      .insert(personalSenderIdentities)
      .values({
        id: record.id,
        tenantId: record.tenantId,
        operatorId: record.operatorId,
        pairingPresent: record.pairingPresent,
        displacesExistingWebSession: record.displacesExistingWebSession,
        pageLoaded: record.pageLoaded,
        deviceOnline: record.deviceOnline,
        sessionObservedAt: record.sessionObservedAt,
        originatingPhone: record.originatingPhone,
        phoneVerified: record.phoneVerified,
        observationSource: record.observationSource,
        deviceId: record.deviceId,
        expectedDeviceId: record.expectedDeviceId,
        transportProbeOk: record.transportProbeOk,
        updatedAt: record.updatedAt,
      })
      .onDuplicateKeyUpdate({
        set: {
          pairingPresent: record.pairingPresent,
          displacesExistingWebSession: record.displacesExistingWebSession,
          pageLoaded: record.pageLoaded,
          deviceOnline: record.deviceOnline,
          sessionObservedAt: record.sessionObservedAt,
          originatingPhone: record.originatingPhone,
          phoneVerified: record.phoneVerified,
          observationSource: record.observationSource,
          deviceId: record.deviceId,
          expectedDeviceId: record.expectedDeviceId,
          transportProbeOk: record.transportProbeOk,
          updatedAt: record.updatedAt,
        },
      });
  } catch {
    console.error("[personalSender] identity observation was not stored");
    throw new Error("personal sender identity store failed");
  }
}

async function read(tenantId: string, operatorId: string): Promise<PersonalSenderIdentityRecord | null> {
  if (process.env.NODE_ENV === "test" && !process.env.ALLOW_TEST_DB) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const [row] = await db
      .select()
      .from(personalSenderIdentities)
      .where(
        and(
          eq(personalSenderIdentities.tenantId, tenantId),
          eq(personalSenderIdentities.operatorId, operatorId)
        )
      )
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      operatorId: row.operatorId,
      pairingPresent: row.pairingPresent,
      displacesExistingWebSession: row.displacesExistingWebSession,
      pageLoaded: row.pageLoaded,
      deviceOnline: row.deviceOnline,
      sessionObservedAt: row.sessionObservedAt,
      originatingPhone: row.originatingPhone,
      phoneVerified: row.phoneVerified,
      observationSource: row.observationSource as PersonalSenderObservationSource,
      deviceId: row.deviceId,
      expectedDeviceId: row.expectedDeviceId,
      transportProbeOk: row.transportProbeOk,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}
