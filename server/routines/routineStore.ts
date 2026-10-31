import { and, asc, desc, eq, lt, lte, ne, or, sql } from "drizzle-orm";
import { index, int, json, mysqlTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError } from "../mysqlErrors";
import type { RoutineCadence, RoutineFindings, RoutineKind, RoutineRunStatus, RoutineStatus, RoutineTrigger } from "../../shared/claireRoutines";

/**
 * Where Claire routines live: each routine in the operator's own words with its schedule, and every run with what it
 * found. Claire (server/claire/routines) reads and writes them only through `RoutineStore`. Every operator-facing
 * read and change is scoped by tenant; only the worker's `dueRoutines` looks across tenants.
 */

/** drizzle/0160_claire_routines.sql */
export const claireRoutines = mysqlTable(
  "claire_routines",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    operatorOpenId: varchar("operator_open_id", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 32 }).$type<RoutineKind>().notNull(),
    instruction: varchar("instruction", { length: 500 }).notNull(),
    cadence: varchar("cadence", { length: 16 }).$type<RoutineCadence>().notNull(),
    weekday: int("weekday"),
    localTime: varchar("local_time", { length: 5 }).notNull(),
    timeZone: varchar("time_zone", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).$type<RoutineStatus>().notNull(),
    nextRunAt: timestamp("next_run_at"),
    lastRunAt: timestamp("last_run_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    due: index("idx_claire_routines_due").on(table.status, table.nextRunAt),
    tenant: index("idx_claire_routines_tenant").on(table.tenantId),
  })
);

export const claireRoutineRuns = mysqlTable(
  "claire_routine_runs",
  {
    id: varchar("id", { length: 36 }).primaryKey(),
    routineId: varchar("routine_id", { length: 36 }).notNull(),
    tenantId: varchar("tenant_id", { length: 64 }).notNull(),
    periodKey: varchar("period_key", { length: 40 }).notNull(),
    trigger: varchar("trigger", { length: 16 }).$type<RoutineTrigger>().notNull(),
    status: varchar("status", { length: 16 }).$type<RoutineRunStatus>().notNull(),
    attempts: int("attempts").notNull().default(0),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at"),
    findings: json("findings_json").$type<RoutineFindings>(),
    summary: varchar("summary", { length: 1000 }),
    error: varchar("error", { length: 1000 }),
  },
  table => ({
    period: uniqueIndex("uq_claire_routine_runs_period").on(table.routineId, table.periodKey),
    routine: index("idx_claire_routine_runs_routine").on(table.routineId, table.startedAt),
    tenant: index("idx_claire_routine_runs_tenant").on(table.tenantId, table.finishedAt),
  })
);

export type RoutineRecord = typeof claireRoutines.$inferSelect;
export type RoutineRunRecord = typeof claireRoutineRuns.$inferSelect;
export type NewRoutine = Omit<typeof claireRoutines.$inferInsert, "createdAt" | "updatedAt">;
export type NewRoutineRun = typeof claireRoutineRuns.$inferInsert;
export type RoutinePatch = Partial<Pick<RoutineRecord, "status" | "nextRunAt" | "lastRunAt">>;

export type RoutineStore = {
  insertRoutine(row: NewRoutine): Promise<void>;
  listRoutines(tenantId: string): Promise<RoutineRecord[]>;
  findRoutine(tenantId: string, id: string): Promise<RoutineRecord | null>;
  /** routines that will still run (active or paused) */
  countLiveRoutines(tenantId: string): Promise<number>;
  updateRoutine(tenantId: string, id: string, patch: RoutinePatch): Promise<boolean>;
  /** the worker's view: active routines whose time has come, across tenants, oldest first */
  dueRoutines(now: Date, limit: number): Promise<RoutineRecord[]>;
  /** claims an occurrence; "exists" means that (routine, period) already has a run */
  insertRun(row: NewRoutineRun): Promise<"claimed" | "exists">;
  findRun(routineId: string, periodKey: string): Promise<RoutineRunRecord | null>;
  /** takes a failed (or abandoned) run back for another try, if it has tries left; false when someone else has it */
  reclaimRun(id: string, input: { now: Date; staleBefore: Date; maxAttempts: number }): Promise<boolean>;
  finishRun(id: string, input: { findings: RoutineFindings; summary: string; finishedAt: Date }): Promise<void>;
  failRun(id: string, input: { error: string; finishedAt: Date }): Promise<void>;
  recentRuns(tenantId: string, routineId: string, limit: number): Promise<RoutineRunRecord[]>;
  /** the latest finished run of this routine that actually read Gmail, other than `excludeId` */
  latestReadRun(tenantId: string, routineId: string, excludeId: string): Promise<RoutineRunRecord | null>;
};

async function db() {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database;
}

const affected = (result: unknown) => {
  const header = result as { affectedRows?: number; [0]?: { affectedRows?: number } };
  return header.affectedRows ?? header[0]?.affectedRows ?? 0;
};

/** mysql2 hands JSON columns back parsed; a string (other drivers, older rows) is parsed here. */
const parsedFindings = (row: RoutineRunRecord): RoutineRunRecord => {
  const value = row.findings as unknown;
  if (typeof value !== "string") return row;
  try {
    return { ...row, findings: JSON.parse(value) as RoutineFindings };
  } catch {
    return { ...row, findings: null };
  }
};

export const drizzleRoutineStore: RoutineStore = {
  async insertRoutine(row) {
    await (await db()).insert(claireRoutines).values(row);
  },
  async listRoutines(tenantId) {
    return (await db()).select().from(claireRoutines).where(eq(claireRoutines.tenantId, tenantId)).orderBy(asc(claireRoutines.createdAt), asc(claireRoutines.id));
  },
  async findRoutine(tenantId, id) {
    const [row] = await (await db())
      .select()
      .from(claireRoutines)
      .where(and(eq(claireRoutines.tenantId, tenantId), eq(claireRoutines.id, id)))
      .limit(1);
    return row ?? null;
  },
  async countLiveRoutines(tenantId) {
    const [row] = await (await db())
      .select({ n: sql<number>`count(*)` })
      .from(claireRoutines)
      .where(and(eq(claireRoutines.tenantId, tenantId), ne(claireRoutines.status, "stopped")));
    return Number(row?.n ?? 0);
  },
  async updateRoutine(tenantId, id, patch) {
    const result = await (await db())
      .update(claireRoutines)
      .set(patch)
      .where(and(eq(claireRoutines.tenantId, tenantId), eq(claireRoutines.id, id)));
    return affected(result) > 0;
  },
  async dueRoutines(now, limit) {
    return (await db())
      .select()
      .from(claireRoutines)
      .where(and(eq(claireRoutines.status, "active"), lte(claireRoutines.nextRunAt, now)))
      .orderBy(asc(claireRoutines.nextRunAt))
      .limit(limit);
  },
  async insertRun(row) {
    try {
      await (await db()).insert(claireRoutineRuns).values(row);
      return "claimed";
    } catch (error) {
      if (isMysqlDuplicateKeyError(error)) return "exists";
      throw error;
    }
  },
  async findRun(routineId, periodKey) {
    const [row] = await (await db())
      .select()
      .from(claireRoutineRuns)
      .where(and(eq(claireRoutineRuns.routineId, routineId), eq(claireRoutineRuns.periodKey, periodKey)))
      .limit(1);
    return row ? parsedFindings(row) : null;
  },
  async reclaimRun(id, input) {
    const result = await (await db())
      .update(claireRoutineRuns)
      .set({ status: "running", attempts: sql`${claireRoutineRuns.attempts} + 1`, startedAt: input.now, finishedAt: null, error: null })
      .where(
        and(
          eq(claireRoutineRuns.id, id),
          lt(claireRoutineRuns.attempts, input.maxAttempts),
          or(eq(claireRoutineRuns.status, "failed"), and(eq(claireRoutineRuns.status, "running"), lt(claireRoutineRuns.startedAt, input.staleBefore)))
        )
      );
    return affected(result) === 1;
  },
  async finishRun(id, input) {
    await (await db())
      .update(claireRoutineRuns)
      .set({ status: "done", findings: input.findings, summary: input.summary.slice(0, 1000), finishedAt: input.finishedAt, error: null })
      .where(eq(claireRoutineRuns.id, id));
  },
  async failRun(id, input) {
    await (await db())
      .update(claireRoutineRuns)
      .set({ status: "failed", error: input.error.slice(0, 1000), finishedAt: input.finishedAt })
      .where(eq(claireRoutineRuns.id, id));
  },
  async recentRuns(tenantId, routineId, limit) {
    const rows = await (await db())
      .select()
      .from(claireRoutineRuns)
      .where(and(eq(claireRoutineRuns.tenantId, tenantId), eq(claireRoutineRuns.routineId, routineId)))
      .orderBy(desc(claireRoutineRuns.startedAt), desc(claireRoutineRuns.id))
      .limit(limit);
    return rows.map(parsedFindings);
  },
  async latestReadRun(tenantId, routineId, excludeId) {
    const rows = await (await db())
      .select()
      .from(claireRoutineRuns)
      .where(and(eq(claireRoutineRuns.tenantId, tenantId), eq(claireRoutineRuns.routineId, routineId), eq(claireRoutineRuns.status, "done"), ne(claireRoutineRuns.id, excludeId)))
      .orderBy(desc(claireRoutineRuns.startedAt))
      .limit(20);
    return rows.map(parsedFindings).find(row => row.findings && !row.findings.unavailable) ?? null;
  },
};
