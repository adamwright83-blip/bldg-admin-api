import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { operatorRepresentativeAdaptationReceipts } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  DAPHNE_STAGE3B_BEHAVIOR_CLASS,
  DAPHNE_STAGE3B_FIREWALL_RESULT,
  DAPHNE_STAGE3B_RECEIPT_CLASS,
  DAPHNE_STAGE3B_STRUCTURAL_OUTCOME,
  DAPHNE_STAGE3B_TARGET_KEY,
  type OperatorAdaptationDecision,
} from "./adaptationContract";

export type DaphneAdaptationUseReceipt = {
  id: string;
  tenantId: string;
  canonicalOperatorId: string;
  directiveId: string;
  targetKey: typeof DAPHNE_STAGE3B_TARGET_KEY;
  behaviorClass: typeof DAPHNE_STAGE3B_BEHAVIOR_CLASS;
  conversationId: string;
  turnId: string;
  executingSha: string;
  receiptClass: typeof DAPHNE_STAGE3B_RECEIPT_CLASS;
  structuralOutcome: typeof DAPHNE_STAGE3B_STRUCTURAL_OUTCOME;
  firewallResult: typeof DAPHNE_STAGE3B_FIREWALL_RESULT;
  createdAt: string;
  businessTruthMutation: false;
};

export type RecordDaphneAdaptationUseInput = {
  decision: OperatorAdaptationDecision;
  conversationId: string;
  turnId: string;
  executingSha?: string | null;
};

function required(value: string, label: string, max: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Daphne adaptation receipt requires ${label}`);
  if (normalized.length > max) {
    throw new Error(`Daphne adaptation receipt ${label} exceeds ${max} characters`);
  }
  return normalized;
}

export function daphneExecutingSha(explicit?: string | null): string {
  const value =
    explicit?.trim() ||
    process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
    process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
    process.env.GITHUB_SHA?.trim() ||
    process.env.GIT_COMMIT_SHA?.trim() ||
    "unavailable";
  return value.slice(0, 64) || "unavailable";
}

export function daphneAdaptationReceiptIdempotencyMaterial(input: {
  tenantId: string;
  canonicalOperatorId: string;
  directiveId: string;
  conversationId: string;
  turnId: string;
}): string {
  return [
    required(input.tenantId, "tenantId", 64),
    required(input.canonicalOperatorId, "canonicalOperatorId", 191),
    required(input.directiveId, "directiveId", 36),
    required(input.conversationId, "conversationId", 191),
    required(input.turnId, "turnId", 191),
  ].join("\u0000");
}

function rowToReceipt(
  row: typeof operatorRepresentativeAdaptationReceipts.$inferSelect
): DaphneAdaptationUseReceipt {
  if (
    row.targetKey !== DAPHNE_STAGE3B_TARGET_KEY ||
    row.behaviorClass !== DAPHNE_STAGE3B_BEHAVIOR_CLASS ||
    row.receiptClass !== DAPHNE_STAGE3B_RECEIPT_CLASS ||
    row.structuralOutcome !== DAPHNE_STAGE3B_STRUCTURAL_OUTCOME ||
    row.firewallResult !== DAPHNE_STAGE3B_FIREWALL_RESULT
  ) {
    throw new Error("Unsupported Daphne adaptation receipt shape");
  }
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    directiveId: row.directiveId,
    targetKey: DAPHNE_STAGE3B_TARGET_KEY,
    behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
    conversationId: row.conversationId,
    turnId: row.turnId,
    executingSha: row.executingSha,
    receiptClass: DAPHNE_STAGE3B_RECEIPT_CLASS,
    structuralOutcome: DAPHNE_STAGE3B_STRUCTURAL_OUTCOME,
    firewallResult: DAPHNE_STAGE3B_FIREWALL_RESULT,
    createdAt: row.createdAt.toISOString(),
    businessTruthMutation: false,
  };
}

export async function recordDaphneAdaptationUse(
  input: RecordDaphneAdaptationUseInput
): Promise<DaphneAdaptationUseReceipt> {
  const tenantId = required(input.decision.tenantId, "tenantId", 64);
  const canonicalOperatorId = required(
    input.decision.canonicalOperatorId,
    "canonicalOperatorId",
    191
  );
  const directiveId = required(input.decision.directiveId, "directiveId", 36);
  const conversationId = required(input.conversationId, "conversationId", 191);
  const turnId = required(input.turnId, "turnId", 191);
  if (
    input.decision.targetKey !== DAPHNE_STAGE3B_TARGET_KEY ||
    input.decision.behaviorClass !== DAPHNE_STAGE3B_BEHAVIOR_CLASS ||
    input.decision.status !== "applicable"
  ) {
    throw new Error("Unsupported Daphne adaptation decision");
  }

  const material = daphneAdaptationReceiptIdempotencyMaterial({
    tenantId,
    canonicalOperatorId,
    directiveId,
    conversationId,
    turnId,
  });
  const id = `daphne-${createHash("sha256").update(material).digest("hex").slice(0, 48)}`;
  const executingSha = daphneExecutingSha(input.executingSha);

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .insert(operatorRepresentativeAdaptationReceipts)
    .values({
      id,
      tenantId,
      canonicalOperatorId,
      directiveId,
      targetKey: DAPHNE_STAGE3B_TARGET_KEY,
      behaviorClass: DAPHNE_STAGE3B_BEHAVIOR_CLASS,
      conversationId,
      turnId,
      executingSha,
      receiptClass: DAPHNE_STAGE3B_RECEIPT_CLASS,
      structuralOutcome: DAPHNE_STAGE3B_STRUCTURAL_OUTCOME,
      firewallResult: DAPHNE_STAGE3B_FIREWALL_RESULT,
    })
    .onDuplicateKeyUpdate({ set: { id } });

  const [row] = await db
    .select()
    .from(operatorRepresentativeAdaptationReceipts)
    .where(
      and(
        eq(operatorRepresentativeAdaptationReceipts.tenantId, tenantId),
        eq(
          operatorRepresentativeAdaptationReceipts.canonicalOperatorId,
          canonicalOperatorId
        ),
        eq(operatorRepresentativeAdaptationReceipts.directiveId, directiveId),
        eq(operatorRepresentativeAdaptationReceipts.conversationId, conversationId),
        eq(operatorRepresentativeAdaptationReceipts.turnId, turnId)
      )
    )
    .limit(1);

  if (!row) throw new Error("Daphne adaptation receipt did not persist");
  return rowToReceipt(row);
}

export async function listDaphneAdaptationReceipts(input: {
  tenantId: string;
  canonicalOperatorId: string;
  directiveId?: string;
  limit?: number;
}): Promise<DaphneAdaptationUseReceipt[]> {
  const tenantId = required(input.tenantId, "tenantId", 64);
  const canonicalOperatorId = required(
    input.canonicalOperatorId,
    "canonicalOperatorId",
    191
  );
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const predicates = [
    eq(operatorRepresentativeAdaptationReceipts.tenantId, tenantId),
    eq(
      operatorRepresentativeAdaptationReceipts.canonicalOperatorId,
      canonicalOperatorId
    ),
  ];
  if (input.directiveId) {
    predicates.push(
      eq(
        operatorRepresentativeAdaptationReceipts.directiveId,
        required(input.directiveId, "directiveId", 36)
      )
    );
  }
  const rows = await db
    .select()
    .from(operatorRepresentativeAdaptationReceipts)
    .where(and(...predicates))
    .orderBy(desc(operatorRepresentativeAdaptationReceipts.createdAt))
    .limit(Math.max(1, Math.min(input.limit ?? 100, 250)));
  return rows.map(rowToReceipt);
}
