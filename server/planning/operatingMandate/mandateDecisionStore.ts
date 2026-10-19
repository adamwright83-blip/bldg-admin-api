import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { operatingMandateDecisions, type OperatingMandateDecisionRow } from "../../../drizzle/schema";
import {
  MANDATE_DECISION_KINDS,
  STATED_METHOD_LEVERS,
  STATED_METHOD_POPULATIONS,
  mandateDecisionSubjectKey,
  type MandateDecisionPayload,
  type MandateDecisionRecord,
} from "../../../shared/operatingMandate";
import { getDb } from "../../db";
import { isMysqlDuplicateKeyError } from "../../mysqlErrors";

const AREA_KEY = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

function toRecord(row: OperatingMandateDecisionRow): MandateDecisionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    kind: row.kind as MandateDecisionRecord["kind"],
    subjectKey: row.subjectKey,
    payload: (typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson) : row.payloadJson) as MandateDecisionPayload,
    status: row.status === "active" ? "active" : "superseded",
    supersedesId: row.supersedesId ?? null,
    supersededById: row.supersededById ?? null,
    decidedByOpenId: row.decidedByOpenId,
    source: "authenticated_app",
    decidedAt: row.decidedAt.toISOString(),
  };
}

/** Structural checks only. Whether a named goal is active is the caller's check, against the resolved mandate. */
export function assertMandateDecisionPayload(payload: MandateDecisionPayload): void {
  if (!(MANDATE_DECISION_KINDS as readonly string[]).includes(payload.kind)) throw new Error("Unknown mandate decision");
  const text = (value: string, label: string) => {
    if (!value.trim() || value.length > 500) throw new Error(`${label} must be 1-500 characters`);
  };
  if (payload.kind === "focus") {
    if (!AREA_KEY.test(payload.area) || payload.area.length > 60) throw new Error("Focus area key is invalid");
    text(payload.label, "Focus label");
    text(payload.statement, "Focus statement");
  }
  if (payload.kind === "method") {
    if (!(STATED_METHOD_LEVERS as readonly string[]).includes(payload.lever)) throw new Error("Unsupported method lever");
    if (!(STATED_METHOD_POPULATIONS as readonly string[]).includes(payload.population)) throw new Error("Unsupported method population");
    if (payload.area !== null && !AREA_KEY.test(payload.area)) throw new Error("Method area key is invalid");
    text(payload.statement, "Method statement");
  }
}

/**
 * Records an operator decision about the mandate. Append-only: the decision
 * in force for the same subject is kept as superseded, never edited or
 * deleted. Repeating the decision already in force records nothing new.
 * `decidedAt` is the database's clock, the clock conversational remarks and
 * goals are stamped with, so "older" and "newer" compare like with like.
 */
export async function recordMandateDecision(input: {
  tenantId: string;
  canonicalOperatorId: string;
  decidedByOpenId: string;
  payload: MandateDecisionPayload;
}): Promise<{ decision: MandateDecisionRecord; created: boolean }> {
  const tenantId = input.tenantId.trim();
  const canonicalOperatorId = input.canonicalOperatorId.trim();
  const decidedByOpenId = input.decidedByOpenId.trim();
  if (!tenantId || !canonicalOperatorId || !decidedByOpenId) throw new Error("Mandate decisions require tenant and operator authority");
  assertMandateDecisionPayload(input.payload);
  const subjectKey = mandateDecisionSubjectKey(input.payload);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const scope = and(
    eq(operatingMandateDecisions.tenantId, tenantId),
    eq(operatingMandateDecisions.canonicalOperatorId, canonicalOperatorId),
    eq(operatingMandateDecisions.subjectKey, subjectKey)
  );
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await db.transaction(async tx => {
        const [inForce] = await tx
          .select()
          .from(operatingMandateDecisions)
          .where(and(scope, eq(operatingMandateDecisions.status, "active")))
          .limit(1)
          .for("update");
        if (inForce && JSON.stringify(toRecord(inForce).payload) === JSON.stringify(input.payload))
          return { decision: toRecord(inForce), created: false };
        const id = randomUUID();
        if (inForce)
          await tx
            .update(operatingMandateDecisions)
            .set({ status: "superseded", activeSlot: null, supersededById: id })
            .where(and(scope, eq(operatingMandateDecisions.id, inForce.id)));
        await tx.insert(operatingMandateDecisions).values({
          id,
          tenantId,
          canonicalOperatorId,
          kind: input.payload.kind,
          subjectKey,
          payloadJson: input.payload,
          status: "active",
          activeSlot: 1,
          supersedesId: inForce?.id ?? null,
          supersededById: null,
          decidedByOpenId,
          source: "authenticated_app",
        });
        const [saved] = await tx.select().from(operatingMandateDecisions).where(eq(operatingMandateDecisions.id, id)).limit(1);
        if (!saved) throw new Error("Mandate decision was not readable in its transaction");
        return { decision: toRecord(saved), created: true };
      });
    } catch (error) {
      // A concurrent first decision for the same subject took the slot; re-read and supersede it.
      if (isMysqlDuplicateKeyError(error) && attempt < 3) continue;
      throw error;
    }
  }
  throw new Error("Mandate decision write exhausted concurrent retries");
}

/** Every decision in force, plus the most recent superseded ones as history, newest first. */
export async function listMandateDecisions(input: {
  tenantId: string;
  canonicalOperatorId: string;
  historyLimit?: number;
}): Promise<MandateDecisionRecord[]> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const operator = and(
    eq(operatingMandateDecisions.tenantId, input.tenantId),
    eq(operatingMandateDecisions.canonicalOperatorId, input.canonicalOperatorId)
  );
  const order = [desc(operatingMandateDecisions.decidedAt), desc(operatingMandateDecisions.id)] as const;
  const [inForce, history] = await Promise.all([
    db.select().from(operatingMandateDecisions).where(and(operator, eq(operatingMandateDecisions.status, "active"))).orderBy(...order),
    db
      .select()
      .from(operatingMandateDecisions)
      .where(and(operator, eq(operatingMandateDecisions.status, "superseded")))
      .orderBy(...order)
      .limit(input.historyLimit ?? 20),
  ]);
  return [...inForce, ...history].map(toRecord).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt) || b.id.localeCompare(a.id));
}
