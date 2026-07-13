import { sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  CLEANABLE_DAYFORGE_RESOURCES,
  DAYFORGE_RETENTION_POLICY_VERSION,
  retentionCutoff,
  type DayforgeRetentionResource,
} from "./retentionPolicy";

export const MAX_DAYFORGE_RETENTION_BATCH = 1_000;
export const DEFAULT_DAYFORGE_RETENTION_BATCH = 250;

export type RetentionCountInput = {
  resource: DayforgeRetentionResource;
  cutoff: Date;
  now: Date;
  limit: number;
};

export interface DayforgeRetentionStore {
  countEligible(input: RetentionCountInput): Promise<number>;
  purgeEligible(input: RetentionCountInput): Promise<number>;
}

function rowsFrom(result: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(result)) {
    const first = result[0];
    if (Array.isArray(first)) return first as readonly Record<string, unknown>[];
    if (result.every(item => item && typeof item === "object")) {
      return result as readonly Record<string, unknown>[];
    }
  }
  const rows = (result as { rows?: readonly unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as readonly Record<string, unknown>[]) : [];
}

function affectedRows(result: unknown): number {
  if (Array.isArray(result)) {
    const header = result[0] as { affectedRows?: number; changedRows?: number } | undefined;
    return Number(header?.affectedRows ?? header?.changedRows ?? 0);
  }
  const header = result as { affectedRows?: number; changedRows?: number } | undefined;
  return Number(header?.affectedRows ?? header?.changedRows ?? 0);
}

function countFrom(result: unknown, limit: number): number {
  const first = rowsFrom(result)[0];
  return Math.min(limit, Math.max(0, Number(first?.count ?? first?.eligible ?? 0)));
}

type DayforgeDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/**
 * SQL adapter for 0043 plus optional future payload tables. Optional resources
 * are skipped when their table has not been deployed yet, which allows the
 * policy to precede evidence-upload and provider-diagnostic persistence.
 */
export class MysqlDayforgeRetentionStore implements DayforgeRetentionStore {
  private readonly availability = new Map<DayforgeRetentionResource, boolean>();

  constructor(private readonly db: DayforgeDb) {}

  private tableFor(resource: DayforgeRetentionResource): string {
    switch (resource) {
      case "anonymous_preview_results":
      case "anonymous_preview_sessions":
        return "dayforge_public_preview_sessions";
      case "product_analytics":
        return "dayforge_product_events";
      case "evidence_uploads":
        return "dayforge_evidence_uploads";
      case "rate_limit_buckets":
        return "dayforge_rate_limit_buckets";
      case "game_replays":
        return "commercial_mission_game_results";
      case "provider_diagnostics":
        return "dayforge_provider_budgets";
    }
  }

  private async isAvailable(resource: DayforgeRetentionResource): Promise<boolean> {
    const cached = this.availability.get(resource);
    if (cached !== undefined) return cached;
    const result = await this.db.execute(sql`
      SELECT COUNT(*) AS count
        FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = ${this.tableFor(resource)}
    `);
    const available = countFrom(result, 1) > 0;
    this.availability.set(resource, available);
    return available;
  }

  async countEligible(input: RetentionCountInput): Promise<number> {
    if (!(await this.isAvailable(input.resource))) return 0;
    const { cutoff, now, limit } = input;
    let result: unknown;
    switch (input.resource) {
      case "anonymous_preview_results":
        result = await this.db.execute(sql`
          SELECT COUNT(*) AS count FROM (
            SELECT r.id
              FROM territory_scan_results r
              JOIN dayforge_public_preview_sessions p
                ON p.scanSessionId = r.scanSessionId
             WHERE p.purgeAfter <= ${now}
             ORDER BY r.id
             LIMIT ${limit}
          ) eligible_rows
        `);
        break;
      case "anonymous_preview_sessions":
        result = await this.db.execute(sql`
          SELECT COUNT(*) AS count FROM (
            SELECT id FROM dayforge_public_preview_sessions
             WHERE purgeAfter <= ${now}
             ORDER BY purgeAfter, id
             LIMIT ${limit}
          ) eligible_rows
        `);
        break;
      case "product_analytics":
        result = await this.db.execute(sql`
          SELECT COUNT(*) AS count FROM (
            SELECT id FROM dayforge_product_events
             WHERE purgeAfter <= ${now}
             ORDER BY purgeAfter, id
             LIMIT ${limit}
          ) eligible_rows
        `);
        break;
      case "evidence_uploads":
        result = await this.db.execute(sql`
          SELECT COUNT(*) AS count FROM (
            SELECT id FROM dayforge_evidence_uploads
             WHERE purgeAfter <= ${now}
             ORDER BY purgeAfter, id
             LIMIT ${limit}
          ) eligible_rows
        `);
        break;
      case "rate_limit_buckets":
        result = await this.db.execute(sql`
          SELECT COUNT(*) AS count FROM (
            SELECT id FROM dayforge_rate_limit_buckets
             WHERE expiresAt <= ${now}
             ORDER BY expiresAt, id
             LIMIT ${limit}
          ) eligible_rows
        `);
        break;
      case "game_replays":
        // The current replay shares an authoritative result row. It is not
        // eligible until a future schema preserves hash/redaction proof.
        return 0;
      case "provider_diagnostics":
        result = await this.db.execute(sql`
          SELECT COUNT(*) AS count FROM (
            SELECT id FROM dayforge_provider_budgets
             WHERE budgetDate <= ${cutoff.toISOString().slice(0, 10)}
             ORDER BY budgetDate, id
             LIMIT ${limit}
          ) eligible_rows
        `);
        break;
    }
    return countFrom(result, limit);
  }

  async purgeEligible(input: RetentionCountInput): Promise<number> {
    if (!(await this.isAvailable(input.resource))) return 0;
    const { cutoff, now, limit } = input;
    let result: unknown;
    switch (input.resource) {
      case "anonymous_preview_results":
        result = await this.db.execute(sql`
          DELETE FROM territory_scan_results
           WHERE id IN (
             SELECT id FROM (
               SELECT r.id
                 FROM territory_scan_results r
                 JOIN dayforge_public_preview_sessions p
                   ON p.scanSessionId = r.scanSessionId
                WHERE p.purgeAfter <= ${now}
                ORDER BY r.id
                LIMIT ${limit}
             ) eligible_rows
           )
        `);
        break;
      case "anonymous_preview_sessions":
        result = await this.db.execute(sql`
          DELETE FROM dayforge_public_preview_sessions
           WHERE id IN (
             SELECT id FROM (
               SELECT id FROM dayforge_public_preview_sessions
                WHERE purgeAfter <= ${now}
                ORDER BY purgeAfter, id
                LIMIT ${limit}
             ) eligible_rows
           )
        `);
        break;
      case "product_analytics":
        result = await this.db.execute(sql`
          DELETE FROM dayforge_product_events
           WHERE id IN (
             SELECT id FROM (
               SELECT id FROM dayforge_product_events
                WHERE purgeAfter <= ${now}
                ORDER BY purgeAfter, id
                LIMIT ${limit}
             ) eligible_rows
           )
        `);
        break;
      case "evidence_uploads":
        result = await this.db.execute(sql`
          DELETE FROM dayforge_evidence_uploads
           WHERE id IN (
             SELECT id FROM (
               SELECT id FROM dayforge_evidence_uploads
                WHERE purgeAfter <= ${now}
                ORDER BY purgeAfter, id
                LIMIT ${limit}
             ) eligible_rows
           )
        `);
        break;
      case "rate_limit_buckets":
        result = await this.db.execute(sql`
          DELETE FROM dayforge_rate_limit_buckets
           WHERE id IN (
             SELECT id FROM (
               SELECT id FROM dayforge_rate_limit_buckets
                WHERE expiresAt <= ${now}
                ORDER BY expiresAt, id
                LIMIT ${limit}
             ) eligible_rows
           )
        `);
        break;
      case "game_replays":
        return 0;
      case "provider_diagnostics":
        result = await this.db.execute(sql`
          DELETE FROM dayforge_provider_budgets
           WHERE id IN (
             SELECT id FROM (
               SELECT id FROM dayforge_provider_budgets
                WHERE budgetDate <= ${cutoff.toISOString().slice(0, 10)}
                ORDER BY budgetDate, id
                LIMIT ${limit}
             ) eligible_rows
           )
        `);
        break;
    }
    return Math.min(limit, Math.max(0, affectedRows(result)));
  }
}

export type DayforgeRetentionRun = {
  policyVersion: string;
  dryRun: boolean;
  batchLimit: number;
  totalEligible: number;
  resources: Array<{
    resource: DayforgeRetentionResource;
    cutoff: string;
    eligible: number;
    purged: number;
  }>;
  operationalAuditPreserved: true;
};

export async function runDayforgeRetention(input: {
  store: DayforgeRetentionStore;
  dryRun?: boolean;
  batchLimit?: number;
  now?: Date;
}): Promise<DayforgeRetentionRun> {
  const now = input.now ?? new Date();
  const requested = input.batchLimit ?? DEFAULT_DAYFORGE_RETENTION_BATCH;
  const batchLimit = Math.min(
    MAX_DAYFORGE_RETENTION_BATCH,
    Math.max(1, Math.floor(requested))
  );
  const dryRun = input.dryRun === true;
  let remaining = batchLimit;
  const resources: DayforgeRetentionRun["resources"] = [];

  for (const resource of CLEANABLE_DAYFORGE_RESOURCES) {
    const cutoff = retentionCutoff(resource, now);
    if (remaining <= 0) {
      resources.push({ resource, cutoff: cutoff.toISOString(), eligible: 0, purged: 0 });
      continue;
    }
    const countInput = { resource, cutoff, now, limit: remaining };
    const purged = dryRun
      ? 0
      : Math.min(
          remaining,
          Math.max(0, await input.store.purgeEligible(countInput))
        );
    // A mutating run reports the rows it actually changed. This avoids a
    // count/delete race when two idempotent cleanup workers overlap.
    const eligible = dryRun
      ? Math.min(
          remaining,
          Math.max(0, await input.store.countEligible(countInput))
        )
      : purged;
    remaining -= dryRun ? eligible : purged;
    resources.push({
      resource,
      cutoff: cutoff.toISOString(),
      eligible,
      purged,
    });
  }

  return {
    policyVersion: DAYFORGE_RETENTION_POLICY_VERSION,
    dryRun,
    batchLimit,
    totalEligible: resources.reduce((sum, item) => sum + item.eligible, 0),
    resources,
    operationalAuditPreserved: true,
  };
}

export async function runDayforgeRetentionWithDatabase(input: {
  dryRun?: boolean;
  batchLimit?: number;
  now?: Date;
}): Promise<DayforgeRetentionRun> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return runDayforgeRetention({
    ...input,
    store: new MysqlDayforgeRetentionStore(db),
  });
}
