import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { claireProactiveObligations } from "../../../drizzle/schema";
import type { ProactiveObligation } from "../../../shared/claireProactive";
import type { ObjectiveExecutionType } from "../../../shared/objectiveExecution";
import { getDb } from "../../db";
import { queryOptionalMysqlTable } from "../../mysqlErrors";
import type { VerticalRegistry } from "../../strategy/verticalTemplates/registry";

export { claireProactiveObligations };

const OPEN_STATUSES = ["scheduled", "draft_prepared", "awaiting_result"] as const;
const CORE_OBLIGATION_KINDS = new Set([
  "dormant_recovery",
  "sales_follow_up",
  "data_health",
]);

export type PersistentObligation = {
  id: string;
  tenantId: string;
  operatorUserId: string;
  canonicalOperatorId: string | null;
  kind: string;
  subjectKey: string;
  status: string;
  dueDate: string;
  payload: ProactiveObligation;
  goalRunId: string | null;
  cycleId: string | null;
  decisionId: string | null;
  executionType: ObjectiveExecutionType | null;
  commercialFollowUpRef: string | null;
  objectiveRef: string | null;
  agentEventId: number | null;
};

function assertDraftInvariant(payload: ProactiveObligation): void {
  if (payload.draft && payload.draft.sent !== false) {
    throw new Error(`Obligation ${payload.id} violates draft sent:false invariant`);
  }
}

function assertRegisteredKind(input: {
  registry: VerticalRegistry;
  verticalKey: string;
  kind: string;
}): void {
  if (CORE_OBLIGATION_KINDS.has(input.kind)) return;
  input.registry.assertObligationKind(input.verticalKey, input.kind);
}

function toRecord(
  row: typeof claireProactiveObligations.$inferSelect
): PersistentObligation {
  const payload = row.payloadJson as ProactiveObligation;
  assertDraftInvariant(payload);
  const executionType =
    row.executionType === "mission" ||
    row.executionType === "challenge" ||
    row.executionType === "hybrid_objective"
      ? row.executionType
      : null;
  return {
    id: row.id,
    tenantId: row.tenantId,
    operatorUserId: row.operatorUserId,
    canonicalOperatorId: row.canonicalOperatorId,
    kind: row.kind,
    subjectKey: row.subjectKey,
    status: row.status,
    dueDate: row.dueDate,
    payload,
    goalRunId: row.goalRunId,
    cycleId: row.cycleId,
    decisionId: row.decisionId,
    executionType,
    commercialFollowUpRef: row.commercialFollowUpRef,
    objectiveRef: row.objectiveRef,
    agentEventId: row.agentEventId,
  };
}

export async function listOpenPersistentObligations(input: {
  tenantId: string;
  operatorUserIds: readonly string[];
  verticalKey: string;
  registry: VerticalRegistry;
  dueThrough?: string | null;
}): Promise<PersistentObligation[]> {
  if (!input.tenantId.trim()) throw new Error("tenantId is required");
  const operatorUserIds = [...new Set(input.operatorUserIds.map(value => value.trim()).filter(Boolean))];
  if (!operatorUserIds.length) throw new Error("operator identity is required");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const where = [
    eq(claireProactiveObligations.tenantId, input.tenantId),
    inArray(claireProactiveObligations.operatorUserId, operatorUserIds),
    inArray(claireProactiveObligations.status, [...OPEN_STATUSES]),
  ];
  if (input.dueThrough) {
    where.push(lte(claireProactiveObligations.dueDate, input.dueThrough));
  }
  const rows = await db
    .select()
    .from(claireProactiveObligations)
    .where(and(...where))
    .orderBy(
      asc(claireProactiveObligations.dueDate),
      asc(claireProactiveObligations.id)
    );

  return rows.map(row => {
    assertRegisteredKind({
      registry: input.registry,
      verticalKey: input.verticalKey,
      kind: row.kind,
    });
    return toRecord(row);
  });
}

export async function attachObligationDecisionLineage(input: {
  tenantId: string;
  obligationId: string;
  canonicalOperatorId: string;
  goalRunId: string;
  cycleId: string;
  decisionId: string;
  executionType?: ObjectiveExecutionType | null;
  objectiveRef?: string | null;
  onlyIfUnclaimedOrSameDecision?: boolean;
}): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const lineage: Partial<typeof claireProactiveObligations.$inferInsert> = {
    canonicalOperatorId: input.canonicalOperatorId,
    goalRunId: input.goalRunId,
    cycleId: input.cycleId,
    decisionId: input.decisionId,
    executionType: input.executionType ?? null,
  };
  if (input.objectiveRef !== undefined) {
    lineage.objectiveRef = input.objectiveRef;
  }
  const result = await db
    .update(claireProactiveObligations)
    .set(lineage)
    .where(
      and(
        eq(claireProactiveObligations.tenantId, input.tenantId),
        eq(claireProactiveObligations.id, input.obligationId),
        (input.onlyIfUnclaimedOrSameDecision ?? true)
          ? or(
              isNull(claireProactiveObligations.decisionId),
              eq(claireProactiveObligations.decisionId, input.decisionId)
            )
          : undefined
      )
    );
  return Number(result[0]?.affectedRows ?? 0) === 1;
}


/**
 * Persistent Operator-owned read port for the full proactive obligation board.
 * Claire may consume these payloads, but does not own their persistence.
 */
export async function listPersistentOperatorObligationPayloads(input: {
  tenantId: string;
  operatorUserId: string;
}): Promise<ProactiveObligation[]> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId) throw new Error("tenantId is required");
  if (!operatorUserId) throw new Error("operator identity is required");

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const rows = await queryOptionalMysqlTable(async () =>
    db
      .select({ payloadJson: claireProactiveObligations.payloadJson })
      .from(claireProactiveObligations)
      .where(
        and(
          eq(claireProactiveObligations.tenantId, tenantId),
          eq(claireProactiveObligations.operatorUserId, operatorUserId)
        )
      )
  );

  return rows.map(row => {
    const payload = row.payloadJson as ProactiveObligation;
    assertDraftInvariant(payload);
    return payload;
  });
}

export async function upsertPersistentOperatorObligation(input: {
  tenantId: string;
  operatorUserId: string;
  obligation: ProactiveObligation;
  commercialFollowUpRef?: string | null;
}): Promise<void> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId) throw new Error("tenantId is required");
  if (!operatorUserId) throw new Error("operator identity is required");
  assertDraftInvariant(input.obligation);

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .insert(claireProactiveObligations)
    .values({
      id: input.obligation.id,
      tenantId,
      operatorUserId,
      kind: input.obligation.kind,
      subjectKey: input.obligation.subjectKey,
      payloadJson: input.obligation,
      status: input.obligation.status,
      dueDate: input.obligation.dueDate,
      commercialFollowUpRef: input.commercialFollowUpRef ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        payloadJson: input.obligation,
        status: input.obligation.status,
        dueDate: input.obligation.dueDate,
        commercialFollowUpRef: input.commercialFollowUpRef ?? null,
      },
    });
}

export async function backfillPersistentOperatorCommercialFollowUpRef(input: {
  tenantId: string;
  operatorUserId: string;
  obligationId: string;
  commercialFollowUpRef: string;
}): Promise<void> {
  const tenantId = input.tenantId.trim();
  const operatorUserId = input.operatorUserId.trim();
  if (!tenantId) throw new Error("tenantId is required");
  if (!operatorUserId) throw new Error("operator identity is required");

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .update(claireProactiveObligations)
    .set({ commercialFollowUpRef: input.commercialFollowUpRef })
    .where(
      and(
        eq(claireProactiveObligations.tenantId, tenantId),
        eq(claireProactiveObligations.operatorUserId, operatorUserId),
        eq(claireProactiveObligations.id, input.obligationId)
      )
    );
}
