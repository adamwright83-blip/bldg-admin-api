import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import type { Cycle } from "../../../shared/presidentCycle";

export interface CycleStore {
  get(cycleId: string): Promise<Cycle | null>;
  create(cycle: Cycle): Promise<void>;
  /** Serialized read-modify-write. fn must be pure w.r.t. outside state. */
  update<T>(cycleId: string, fn: (cycle: Cycle) => T): Promise<T>;
  list(tenantId?: string): Promise<Cycle[]>;
}

/**
 * Development/test adapter only. Atomic rename + a cross-process directory lock
 * protect a single filesystem, but this is not a production durability guarantee:
 * ephemeral disks and multiple hosts can still lose or fork state.
 */
const STALE_LOCK_MS = 30_000;

export class FileCycleStore implements CycleStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(id: string) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid cycle id");
    return join(this.dir, `${id}.json`);
  }

  private async withLock<T>(id: string, fn: () => T): Promise<T> {
    const lock = this.file(id) + ".lock";
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        mkdirSync(lock);
        break;
      } catch {
        try {
          if (Date.now() - statSync(lock).mtimeMs > STALE_LOCK_MS)
            rmSync(lock, { recursive: true, force: true });
        } catch {
          /* raced */
        }
        if (Date.now() > deadline) throw new Error("Cycle lock timeout");
        await new Promise(r => setTimeout(r, 15));
      }
    }
    try {
      return fn();
    } finally {
      rmSync(lock, { recursive: true, force: true });
    }
  }

  async get(id: string) {
    const f = this.file(id);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Cycle) : null;
  }

  async create(cycle: Cycle) {
    await this.withLock(cycle.cycleId, () => {
      if (existsSync(this.file(cycle.cycleId)))
        throw new Error("Cycle already exists");
      this.write(cycle);
    });
  }

  private write(cycle: Cycle) {
    const f = this.file(cycle.cycleId);
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cycle, null, 2));
    renameSync(tmp, f);
  }

  async update<T>(id: string, fn: (c: Cycle) => T): Promise<T> {
    return this.withLock(id, () => {
      const f = this.file(id);
      if (!existsSync(f)) throw new Error(`Unknown cycle ${id}`);
      const cycle = JSON.parse(readFileSync(f, "utf8")) as Cycle;
      const result = fn(cycle);
      cycle.version += 1;
      this.write(cycle);
      return result;
    });
  }

  async list(tenantId?: string) {
    return readdirSync(this.dir)
      .filter(n => n.endsWith(".json"))
      .map(n => JSON.parse(readFileSync(join(this.dir, n), "utf8")) as Cycle)
      .filter(c => !tenantId || c.tenantId === tenantId);
  }
}

function cycleFromRow(row: RowDataPacket): Cycle {
  const raw = typeof row.payloadJson === "string" ? JSON.parse(row.payloadJson) : row.payloadJson;
  const cycle = raw as Cycle;
  if (!cycle || cycle.cycleId !== row.cycleId || cycle.tenantId !== row.tenantId)
    throw new Error("President cycle row/payload identity mismatch");
  if (Number(row.version) !== cycle.version)
    throw new Error("President cycle row/payload version mismatch");
  return cycle;
}

async function selectCycleForUpdate(
  conn: PoolConnection,
  cycleId: string
): Promise<RowDataPacket | null> {
  const [rows] = await conn.execute<RowDataPacket[]>(
    "SELECT cycleId,tenantId,version,status,payloadJson FROM president_autonomous_cycles WHERE cycleId=? FOR UPDATE",
    [cycleId]
  );
  return rows[0] ?? null;
}

/**
 * Production adapter. MySQL row locking serializes concurrent workers across
 * hosts; the full cycle/approval/mission/review receipt survives process and
 * host restarts. The table is created by drizzle/0120_president_autonomous_cycles.sql.
 */
export class MysqlCycleStore implements CycleStore {
  constructor(private readonly pool: Pool) {}

  async get(cycleId: string): Promise<Cycle | null> {
    const [rows] = await this.pool.execute<RowDataPacket[]>(
      "SELECT cycleId,tenantId,version,status,payloadJson FROM president_autonomous_cycles WHERE cycleId=? LIMIT 1",
      [cycleId]
    );
    return rows[0] ? cycleFromRow(rows[0]) : null;
  }

  async create(cycle: Cycle): Promise<void> {
    try {
      await this.pool.execute(
        "INSERT INTO president_autonomous_cycles (cycleId,tenantId,version,status,payloadJson,createdAt,updatedAt) VALUES (?,?,?,?,?,NOW(3),NOW(3))",
        [
          cycle.cycleId,
          cycle.tenantId,
          cycle.version,
          cycle.status,
          JSON.stringify(cycle),
        ]
      );
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "ER_DUP_ENTRY") throw new Error("Cycle already exists");
      throw error;
    }
  }

  async update<T>(cycleId: string, fn: (cycle: Cycle) => T): Promise<T> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const row = await selectCycleForUpdate(conn, cycleId);
      if (!row) throw new Error(`Unknown cycle ${cycleId}`);
      const cycle = cycleFromRow(row);
      const result = fn(cycle);
      cycle.version += 1;
      await conn.execute(
        "UPDATE president_autonomous_cycles SET tenantId=?,version=?,status=?,payloadJson=?,updatedAt=NOW(3) WHERE cycleId=?",
        [
          cycle.tenantId,
          cycle.version,
          cycle.status,
          JSON.stringify(cycle),
          cycle.cycleId,
        ]
      );
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async list(tenantId?: string): Promise<Cycle[]> {
    const [rows] = tenantId
      ? await this.pool.execute<RowDataPacket[]>(
          "SELECT cycleId,tenantId,version,status,payloadJson FROM president_autonomous_cycles WHERE tenantId=? ORDER BY updatedAt DESC",
          [tenantId]
        )
      : await this.pool.query<RowDataPacket[]>(
          "SELECT cycleId,tenantId,version,status,payloadJson FROM president_autonomous_cycles ORDER BY updatedAt DESC"
        );
    return rows.map(cycleFromRow);
  }
}

/** Tenant-scoped read: a cycle from another tenant is indistinguishable from absent. */
export async function getForTenant(
  store: CycleStore,
  tenantId: string,
  cycleId: string
): Promise<Cycle | null> {
  const c = await store.get(cycleId);
  return c && c.tenantId === tenantId ? c : null;
}
