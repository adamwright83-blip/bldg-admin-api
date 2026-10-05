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
import type { Cycle } from "../../../shared/presidentCycle";

/**
 * Durable cycle store. Whole-cycle documents are updated under a cross-process
 * directory lock and written with atomic rename, so a process restart (or kill
 * mid-write) never leaves partial state. A MySQL adapter can implement the same
 * interface later without changing callers.
 */
export interface CycleStore {
  get(cycleId: string): Promise<Cycle | null>;
  create(cycle: Cycle): Promise<void>;
  /** Serialized read-modify-write. fn must be pure w.r.t. outside state. */
  update<T>(cycleId: string, fn: (cycle: Cycle) => T): Promise<T>;
  list(tenantId?: string): Promise<Cycle[]>;
}

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
      const result = fn(cycle); // throws => nothing written
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

/** Tenant-scoped read: a cycle from another tenant is indistinguishable from absent. */
export async function getForTenant(
  store: CycleStore,
  tenantId: string,
  cycleId: string
): Promise<Cycle | null> {
  const c = await store.get(cycleId);
  return c && c.tenantId === tenantId ? c : null;
}
