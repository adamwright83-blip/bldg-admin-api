import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";
const DEFAULT_LOCK_NAME = "held_procurement_schema_migrations";

export type ProcurementMigration = {
  key: string;
  checksum: string;
  statements: string[];
  verificationStatements: string[];
  absolutePath: string;
};

export type MigrationStatus = {
  key: string;
  checksum: string;
  databaseChecksum: string | null;
  databaseStatus: "applying" | "applied" | "failed" | null;
  state: "pending" | "applied" | "failed" | "checksum_mismatch";
};

type MigrationRow = RowDataPacket & {
  migration_key: string;
  checksum: string;
  status: "applying" | "applied" | "failed";
};

export function defaultProcurementMigrationsDir() {
  return path.resolve(process.cwd(), "procurement", "migrations");
}

export async function loadProcurementMigrations(
  directory = defaultProcurementMigrationsDir(),
): Promise<ProcurementMigration[]> {
  const names = (await fs.readdir(directory)).filter(name => MIGRATION_FILE.test(name)).sort();
  if (names.length === 0) throw new Error(`No procurement migrations found in ${directory}`);

  const migrations = await Promise.all(
    names.map(async key => {
      const absolutePath = path.join(directory, key);
      const sql = await fs.readFile(absolutePath, "utf8");
      const verificationPath = path.resolve(
        directory,
        "..",
        "verify",
        key.replace(/\.sql$/, ".verify.sql"),
      );
      const verificationSql = await fs.readFile(verificationPath, "utf8");
      const statements = sql
        .split(STATEMENT_BREAKPOINT)
        .map(statement => statement.trim())
        .filter(Boolean);
      if (statements.length === 0) throw new Error(`Migration ${key} contains no statements`);
      const verificationStatements = verificationSql
        .split(STATEMENT_BREAKPOINT)
        .map(statement => statement.trim())
        .filter(Boolean);
      if (verificationStatements.length === 0) {
        throw new Error(`Migration ${key} contains no verification statements`);
      }
      return {
        key,
        absolutePath,
        statements,
        verificationStatements,
        checksum: crypto.createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );

  if (migrations[0]?.key !== "0000_held_schema_migrations.sql") {
    throw new Error("The first procurement migration must be 0000_held_schema_migrations.sql");
  }
  return migrations;
}

export function createProcurementPool(databaseUrl = process.env.DATABASE_URL): Pool {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for procurement migrations");
  return mysql.createPool({ uri: databaseUrl, connectionLimit: 4, namedPlaceholders: false });
}

async function tableExists(connection: PoolConnection, tableName: string) {
  const [rows] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName],
  );
  return Number(rows[0]?.count ?? 0) === 1;
}

async function ensureLedger(connection: PoolConnection, bootstrap: ProcurementMigration) {
  if (!(await tableExists(connection, "held_schema_migrations"))) {
    await connection.query(bootstrap.statements[0]!);
  }
}

async function readMigrationRows(connection: PoolConnection): Promise<Map<string, MigrationRow>> {
  if (!(await tableExists(connection, "held_schema_migrations"))) return new Map();
  const [rows] = await connection.query<MigrationRow[]>(
    `SELECT migration_key, checksum, status
       FROM held_schema_migrations
      ORDER BY migration_key`,
  );
  return new Map(rows.map(row => [row.migration_key, row]));
}

export async function getProcurementMigrationStatus(
  pool: Pool,
  migrations: ProcurementMigration[],
): Promise<MigrationStatus[]> {
  const connection = await pool.getConnection();
  try {
    const databaseRows = await readMigrationRows(connection);
    return migrations.map(migration => {
      const row = databaseRows.get(migration.key);
      if (!row) {
        return {
          key: migration.key,
          checksum: migration.checksum,
          databaseChecksum: null,
          databaseStatus: null,
          state: "pending" as const,
        };
      }
      const checksumMatches = row.checksum === migration.checksum;
      return {
        key: migration.key,
        checksum: migration.checksum,
        databaseChecksum: row.checksum,
        databaseStatus: row.status,
        state: !checksumMatches
          ? ("checksum_mismatch" as const)
          : row.status === "applied"
            ? ("applied" as const)
            : ("failed" as const),
      };
    });
  } finally {
    connection.release();
  }
}

async function recordApplying(connection: PoolConnection, migration: ProcurementMigration) {
  await connection.execute(
    `INSERT INTO held_schema_migrations
       (migration_key, checksum, status, started_at, applied_at, execution_ms, error_text)
     VALUES (?, ?, 'applying', CURRENT_TIMESTAMP(3), NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       status = 'applying', started_at = CURRENT_TIMESTAMP(3), applied_at = NULL,
       execution_ms = NULL, error_text = NULL`,
    [migration.key, migration.checksum],
  );
}

async function applyOne(connection: PoolConnection, migration: ProcurementMigration) {
  const [rows] = await connection.execute<MigrationRow[]>(
    `SELECT migration_key, checksum, status
       FROM held_schema_migrations
      WHERE migration_key = ?`,
    [migration.key],
  );
  const existing = rows[0];
  if (existing?.checksum !== undefined && existing.checksum !== migration.checksum) {
    throw new Error(
      `Checksum mismatch for ${migration.key}: database=${existing.checksum} file=${migration.checksum}`,
    );
  }
  if (existing?.status === "applied") return "skipped" as const;

  const started = Date.now();
  await recordApplying(connection, migration);
  try {
    for (const statement of migration.statements) await connection.query(statement);
    for (const statement of migration.verificationStatements) {
      const [verificationRows] = await connection.query<RowDataPacket[]>(statement);
      for (const row of verificationRows) {
        if (Number(row.passed ?? 0) !== 1) {
          throw new Error(
            `Verification failed for ${migration.key}: ${String(row.verification_name ?? "unnamed")}`,
          );
        }
      }
    }
    await connection.execute(
      `UPDATE held_schema_migrations
          SET status = 'applied', applied_at = CURRENT_TIMESTAMP(3), execution_ms = ?, error_text = NULL
        WHERE migration_key = ? AND checksum = ?`,
      [Date.now() - started, migration.key, migration.checksum],
    );
    return "applied" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await connection.execute(
      `UPDATE held_schema_migrations
          SET status = 'failed', execution_ms = ?, error_text = ?
        WHERE migration_key = ? AND checksum = ?`,
      [Date.now() - started, message.slice(0, 65_535), migration.key, migration.checksum],
    );
    throw error;
  }
}

export async function runProcurementMigrations(
  pool: Pool,
  migrations: ProcurementMigration[],
  options: { lockName?: string; lockTimeoutSeconds?: number } = {},
) {
  const connection = await pool.getConnection();
  const lockName = options.lockName ?? DEFAULT_LOCK_NAME;
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.execute<RowDataPacket[]>(`SELECT GET_LOCK(?, ?) AS acquired`, [
      lockName,
      options.lockTimeoutSeconds ?? 30,
    ]);
    lockAcquired = Number(lockRows[0]?.acquired ?? 0) === 1;
    if (!lockAcquired) throw new Error(`Could not acquire MySQL advisory lock ${lockName}`);

    await ensureLedger(connection, migrations[0]!);
    const results: Array<{ key: string; result: "applied" | "skipped" }> = [];
    for (const migration of migrations) {
      results.push({ key: migration.key, result: await applyOne(connection, migration) });
    }
    return results;
  } finally {
    if (lockAcquired) await connection.execute(`SELECT RELEASE_LOCK(?)`, [lockName]);
    connection.release();
  }
}
