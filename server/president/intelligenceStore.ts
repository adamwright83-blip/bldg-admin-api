import { createHash, randomUUID } from "node:crypto";
import { canonicalJson } from "./canonicalJson";
import { z } from "zod";
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  companyEvidenceSchema,
  metricSchema,
  thesisItemSchema,
  strategicObjectiveSchema,
  intelligenceRecordKinds,
  type CompanyEvidence,
  type IntelligenceRecord,
  type IntelligenceRecordKind,
} from "../../shared/presidentIntelligence";

const decode = <T>(x: unknown): T =>
  (typeof x === "string" ? JSON.parse(x) : x) as T;
export function evidenceHash(statement: string) {
  return createHash("sha256").update(statement).digest("hex");
}

function normalizeIsoMillis(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

/** Company-only, append-only revisions. No customer/tenant table access. */
export class MysqlPresidentIntelligenceStore {
  constructor(
    readonly pool: Pool,
    readonly origin: "REAL" | "TEST_FIXTURE" = "REAL"
  ) {}
  async putEvidence(input: CompanyEvidence) {
    const parsed = companyEvidenceSchema.parse(input);
    const e: CompanyEvidence = {
      ...parsed,
      capturedAt: normalizeIsoMillis(parsed.capturedAt)!,
      sourceAt: normalizeIsoMillis(parsed.sourceAt),
      expiresAt: normalizeIsoMillis(parsed.expiresAt),
    };
    if (e.origin !== this.origin || e.sha256 !== evidenceHash(e.statement))
      throw new Error("Evidence origin/hash mismatch");
    await this.pool.execute(
      "INSERT INTO president_evidence (id,origin,source,capturedAt,sourceAt,sha256,kind,confidence,availability,expiresAt,statement) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",
      [
        e.id,
        e.origin,
        e.source,
        new Date(e.capturedAt),
        e.sourceAt ? new Date(e.sourceAt) : null,
        e.sha256,
        e.kind,
        e.confidence,
        e.availability,
        e.expiresAt ? new Date(e.expiresAt) : null,
        e.statement,
      ]
    );
    const found = await this.evidence([e.id]);
    const prior = found[0];
    if (
      !prior ||
      Object.keys(e).some(
        key =>
          JSON.stringify(prior[key as keyof CompanyEvidence]) !==
          JSON.stringify(e[key as keyof CompanyEvidence])
      )
    )
      throw new Error(
        "Immutable evidence identity conflict: " +
          (prior
            ? Object.keys(e)
                .filter(
                  key =>
                    JSON.stringify(prior[key as keyof CompanyEvidence]) !==
                    JSON.stringify(e[key as keyof CompanyEvidence])
                )
                .join(",")
            : "missing")
      );
    return prior;
  }
  async evidence(ids: string[]): Promise<CompanyEvidence[]> {
    if (!ids.length) return [];
    if (ids.length > 100) throw new Error("Evidence read exceeds bound");
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      `SELECT * FROM president_evidence WHERE origin=? AND id IN (${ids.map(() => "?").join(",")})`,
      [this.origin, ...ids]
    );
    return rows.map(r =>
      companyEvidenceSchema.parse({
        id: r.id,
        origin: r.origin,
        source: r.source,
        capturedAt: new Date(r.capturedAt).toISOString(),
        sourceAt: r.sourceAt ? new Date(r.sourceAt).toISOString() : null,
        sha256: r.sha256,
        kind: r.kind,
        confidence: Number(r.confidence),
        availability: r.availability,
        expiresAt: r.expiresAt ? new Date(r.expiresAt).toISOString() : null,
        statement: r.statement,
      })
    );
  }
  async append(input: {
    kind: IntelligenceRecordKind;
    key: string;
    payload: Record<string, unknown>;
    evidenceIds: string[];
    expectedVersion: number;
    idempotencyKey: string;
  }) {
    if (
      !intelligenceRecordKinds.includes(input.kind) ||
      !input.key ||
      input.key.length > 191 ||
      !input.idempotencyKey ||
      JSON.stringify(input.payload).length > 64000
    )
      throw new Error("Invalid bounded intelligence record");
    const strategyLink = {
      strategyRecordId: z.string().uuid().optional(),
      priorityRank: z.number().int().positive().optional(),
    };
    if (input.kind === "THESIS")
      thesisItemSchema.extend(strategyLink).parse(input.payload);
    if (input.kind === "OBJECTIVE")
      strategicObjectiveSchema.extend(strategyLink).parse(input.payload);
    if (input.kind === "METRIC") metricSchema.parse(input.payload);
    const evidence = await this.evidence(input.evidenceIds);
    if (evidence.length !== new Set(input.evidenceIds).size)
      throw new Error("Evidence missing or cross-origin");
    const hash = evidenceHash(
      canonicalJson({
        kind: input.kind,
        key: input.key,
        payload: input.payload,
        evidenceIds: input.evidenceIds,
        expectedVersion: input.expectedVersion,
      })
    );
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [retry] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM president_intelligence_records WHERE origin=? AND idempotencyKey=?",
        [this.origin, input.idempotencyKey]
      );
      if (retry.length) {
        if (retry[0].requestHash !== hash)
          throw new Error("Idempotency key reused for different request");
        await conn.commit();
        return this.record(retry[0]);
      }
      const [prior] = await conn.execute<RowDataPacket[]>(
        "SELECT * FROM president_intelligence_records WHERE origin=? AND kind=? AND recordKey=? ORDER BY version DESC LIMIT 1 FOR UPDATE",
        [this.origin, input.kind, input.key]
      );
      const version = prior[0] ? Number(prior[0].version) : 0;
      if (version !== input.expectedVersion)
        throw new Error("Intelligence revision conflict");
      const record: IntelligenceRecord = {
        id: randomUUID(),
        kind: input.kind,
        key: input.key,
        version: version + 1,
        createdAt: new Date().toISOString(),
        evidenceIds: input.evidenceIds,
        supersedesId: prior[0]?.id ?? null,
        origin: this.origin,
        payload: input.payload,
      };
      await conn.execute(
        "INSERT INTO president_intelligence_records (id,origin,kind,recordKey,version,createdAt,evidenceIds,payload,supersedesId,idempotencyKey,requestHash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [
          record.id,
          this.origin,
          record.kind,
          record.key,
          record.version,
          new Date(record.createdAt),
          JSON.stringify(record.evidenceIds),
          JSON.stringify(record.payload),
          record.supersedesId,
          input.idempotencyKey,
          hash,
        ]
      );
      await conn.commit();
      return record;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }
  private record(r: RowDataPacket): IntelligenceRecord {
    return {
      id: r.id,
      kind: r.kind,
      key: r.recordKey,
      version: Number(r.version),
      createdAt: new Date(r.createdAt).toISOString(),
      evidenceIds: decode(r.evidenceIds),
      payload: decode(r.payload),
      supersedesId: r.supersedesId,
      origin: r.origin,
    };
  }
  async byId(id: string): Promise<IntelligenceRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_intelligence_records WHERE origin=? AND id=? LIMIT 1",
      [this.origin, id]
    );
    return rows[0] ? this.record(rows[0]) : null;
  }

  async current(
    kind: IntelligenceRecordKind,
    key: string
  ): Promise<IntelligenceRecord | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_intelligence_records WHERE origin=? AND kind=? AND recordKey=? ORDER BY version DESC LIMIT 1",
      [this.origin, kind, key]
    );
    return rows[0] ? this.record(rows[0]) : null;
  }
  async appendCurrent(input: {
    kind: IntelligenceRecordKind;
    key: string;
    payload: Record<string, unknown>;
    evidenceIds: string[];
    idempotencyKey: string;
  }) {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT * FROM president_intelligence_records WHERE origin=? AND idempotencyKey=?",
      [this.origin, input.idempotencyKey]
    );
    if (rows[0]) {
      const prior = this.record(rows[0]);
      if (
        prior.kind !== input.kind ||
        prior.key !== input.key ||
        canonicalJson(prior.payload) !== canonicalJson(input.payload) ||
        canonicalJson(prior.evidenceIds) !== canonicalJson(input.evidenceIds)
      )
        throw new Error("Ledger retry changes adopted payload");
      return prior;
    }
    const current = await this.current(input.kind, input.key);
    return this.append({ ...input, expectedVersion: current?.version ?? 0 });
  }
  async exclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const connection = await this.pool.getConnection();
    const name =
      "president:" + evidenceHash(this.origin + ":" + key).slice(0, 48);
    try {
      const [rows] = await connection.execute<RowDataPacket[]>(
        "SELECT GET_LOCK(?,0) AS acquired",
        [name]
      );
      if (Number(rows[0].acquired) !== 1)
        throw new Error("President operation already leased; retry later");
      try {
        return await operation();
      } finally {
        await connection.execute("SELECT RELEASE_LOCK(?)", [name]);
      }
    } finally {
      connection.release();
    }
  }
  async list(
    kind: IntelligenceRecordKind,
    limit = 50
  ): Promise<IntelligenceRecord[]> {
    if (
      !intelligenceRecordKinds.includes(kind) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Invalid ledger query");
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT * FROM president_intelligence_records WHERE origin=? AND kind=? ORDER BY createdAt DESC,id DESC LIMIT ?",
      [this.origin, kind, limit]
    );
    return rows.map(r => this.record(r));
  }
  async listCurrent(
    kind: IntelligenceRecordKind,
    limit = 50
  ): Promise<IntelligenceRecord[]> {
    if (
      !intelligenceRecordKinds.includes(kind) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100
    )
      throw new Error("Invalid current-ledger query");
    const [rows] = await this.pool.query<RowDataPacket[]>(
      "SELECT r.* FROM president_intelligence_records r WHERE r.origin=? AND r.kind=? AND NOT EXISTS (SELECT 1 FROM president_intelligence_records n WHERE n.origin=r.origin AND n.kind=r.kind AND n.recordKey=r.recordKey AND n.version>r.version) ORDER BY r.createdAt DESC,r.id DESC LIMIT ?",
      [this.origin, kind, limit]
    );
    return rows.map(r => this.record(r));
  }
}
