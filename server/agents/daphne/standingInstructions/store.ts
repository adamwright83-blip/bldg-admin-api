import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { claireOperatorInstructions } from "../../../../drizzle/schema";
import { getDb } from "../../../db";
import { isMysqlDuplicateKeyError } from "../../../mysqlErrors";
import type { DetectedStandingInstruction, StandingInstructionKind, StandingInstructionRecord } from "./types";

export type StandingInstructionScope = { tenantId: string; canonicalOperatorId: string };

export type NewStandingInstruction = StandingInstructionScope & {
  operatorUserId: string;
  detected: DetectedStandingInstruction;
  sourceConversationKey: string;
  sourceTurnId: string;
};

export interface StandingInstructionStore {
  /** Append-only and idempotent per (turn, subject): a replayed turn returns the existing row. */
  append(input: NewStandingInstruction): Promise<StandingInstructionRecord>;
  /** Newest version of each subject that is still active, oldest first. Always a fresh read. */
  listActive(scope: StandingInstructionScope): Promise<StandingInstructionRecord[]>;
  /** Every version, for audit and Desk. */
  listAll(scope: StandingInstructionScope): Promise<StandingInstructionRecord[]>;
}

export function standingInstructionFingerprint(input: NewStandingInstruction): string {
  return createHash("sha256")
    .update(
      [
        input.tenantId,
        input.canonicalOperatorId,
        input.sourceConversationKey,
        input.sourceTurnId,
        input.detected.kind,
        input.detected.subjectKey,
        input.detected.status,
      ].join("\u0000")
    )
    .digest("hex");
}

function recordId(input: NewStandingInstruction, version: number): string {
  return `cinst_${createHash("sha256")
    .update([input.tenantId, input.canonicalOperatorId, input.detected.subjectKey, String(version)].join("\u0000"))
    .digest("hex")
    .slice(0, 48)}`;
}

/** The newest version per subject wins; a revoked newest version removes the subject. */
export function activeFromVersions(rows: readonly StandingInstructionRecord[]): StandingInstructionRecord[] {
  const newest = new Map<string, StandingInstructionRecord>();
  for (const row of rows) {
    const current = newest.get(row.subjectKey);
    if (!current || row.version > current.version) newest.set(row.subjectKey, row);
  }
  return [...newest.values()]
    .filter(row => row.status === "active")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.subjectKey.localeCompare(b.subjectKey));
}

type Row = typeof claireOperatorInstructions.$inferSelect;
function toRecord(row: Row): StandingInstructionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    canonicalOperatorId: row.canonicalOperatorId,
    operatorUserId: row.operatorUserId,
    kind: row.kind as StandingInstructionKind,
    subjectKey: row.subjectKey,
    version: row.version,
    status: row.status === "revoked" ? "revoked" : "active",
    text: row.instructionText,
    quote: row.quote,
    payload: (row.payloadJson as Record<string, unknown> | null) ?? null,
    sourceConversationKey: row.sourceConversationKey,
    sourceTurnId: row.sourceTurnId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function drizzleStandingInstructionStore(): StandingInstructionStore {
  async function db() {
    const handle = await getDb();
    if (!handle) throw new Error("Database unavailable");
    return handle;
  }
  const scopeWhere = (scope: StandingInstructionScope) =>
    and(
      eq(claireOperatorInstructions.tenantId, scope.tenantId),
      eq(claireOperatorInstructions.canonicalOperatorId, scope.canonicalOperatorId)
    );
  const listAll = async (scope: StandingInstructionScope) => {
    const rows = await (await db())
      .select()
      .from(claireOperatorInstructions)
      .where(scopeWhere(scope))
      .orderBy(asc(claireOperatorInstructions.createdAt), asc(claireOperatorInstructions.version));
    return rows.map(toRecord);
  };
  return {
    listAll,
    async listActive(scope) {
      return activeFromVersions(await listAll(scope));
    },
    async append(input) {
      const handle = await db();
      const fingerprint = standingInstructionFingerprint(input);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const [replayed] = await handle
          .select()
          .from(claireOperatorInstructions)
          .where(and(scopeWhere(input), eq(claireOperatorInstructions.fingerprint, fingerprint)))
          .limit(1);
        if (replayed) return toRecord(replayed);
        const [latest] = await handle
          .select()
          .from(claireOperatorInstructions)
          .where(and(scopeWhere(input), eq(claireOperatorInstructions.subjectKey, input.detected.subjectKey)))
          .orderBy(desc(claireOperatorInstructions.version))
          .limit(1);
        const version = (latest?.version ?? 0) + 1;
        const id = recordId(input, version);
        try {
          await handle.insert(claireOperatorInstructions).values({
            id,
            tenantId: input.tenantId,
            canonicalOperatorId: input.canonicalOperatorId,
            operatorUserId: input.operatorUserId,
            kind: input.detected.kind,
            subjectKey: input.detected.subjectKey,
            version,
            status: input.detected.status,
            instructionText: input.detected.text,
            quote: input.detected.quote.slice(0, 2000),
            payloadJson: input.detected.payload,
            fingerprint,
            sourceConversationKey: input.sourceConversationKey,
            sourceTurnId: input.sourceTurnId,
          });
        } catch (error) {
          if (isMysqlDuplicateKeyError(error) && attempt < 3) continue;
          throw error;
        }
        const [row] = await handle.select().from(claireOperatorInstructions).where(eq(claireOperatorInstructions.id, id)).limit(1);
        if (!row) throw new Error("Standing instruction did not persist");
        return toRecord(row);
      }
      throw new Error("Standing instruction write exhausted concurrent retries");
    },
  };
}

/** Test and local-proof store with the same contract (append-only, idempotent, versioned). */
export function inMemoryStandingInstructionStore(initial: StandingInstructionRecord[] = []): StandingInstructionStore & {
  rows: StandingInstructionRecord[];
} {
  const rows = [...initial];
  const seen = new Map<string, StandingInstructionRecord>();
  const inScope = (scope: StandingInstructionScope) =>
    rows.filter(row => row.tenantId === scope.tenantId && row.canonicalOperatorId === scope.canonicalOperatorId);
  return {
    rows,
    async listAll(scope) {
      return inScope(scope).map(row => ({ ...row }));
    },
    async listActive(scope) {
      return activeFromVersions(inScope(scope)).map(row => ({ ...row }));
    },
    async append(input) {
      const fingerprint = standingInstructionFingerprint(input);
      const replay = seen.get(fingerprint);
      if (replay) return { ...replay };
      const version = Math.max(0, ...inScope(input).filter(row => row.subjectKey === input.detected.subjectKey).map(row => row.version)) + 1;
      const record: StandingInstructionRecord = {
        id: recordId(input, version),
        tenantId: input.tenantId,
        canonicalOperatorId: input.canonicalOperatorId,
        operatorUserId: input.operatorUserId,
        kind: input.detected.kind,
        subjectKey: input.detected.subjectKey,
        version,
        status: input.detected.status,
        text: input.detected.text,
        quote: input.detected.quote,
        payload: input.detected.payload,
        sourceConversationKey: input.sourceConversationKey,
        sourceTurnId: input.sourceTurnId,
        createdAt: new Date(Date.now() + rows.length).toISOString(),
      };
      rows.push(record);
      seen.set(fingerprint, record);
      return { ...record };
    },
  };
}
