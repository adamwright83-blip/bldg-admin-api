import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { ENV } from "../_core/env";
import { MysqlPresidentAssessmentStore } from "./mysqlStore";
import { MysqlPresidentIntelligenceStore } from "./intelligenceStore";
import { intelligenceRecordKinds } from "../../shared/presidentIntelligence";
import { executiveSkillCatalog } from "./skillRouter";
let pool: Pool | undefined;
export function presidentPool() {
  const uri = process.env.PRESIDENT_DATABASE_URL || process.env.DATABASE_URL;
  if (!uri)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "President durable database unavailable",
    });
  return (pool ??= mysql.createPool({
    uri,
    timezone: "Z",
    connectionLimit: 8,
  }));
}
export const founderProcedure = adminProcedure.use(async ({ ctx, next }) => {
  if (!ENV.ownerOpenId || ctx.user.openId !== ENV.ownerOpenId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "President is available only to the configured JOYSTICK founder",
    });
  return next({ ctx });
});
export const presidentRouter = router({
  state: founderProcedure.query(async () => {
    const database = presidentPool();
    const [rows] = await database.execute<RowDataPacket[]>(
      "SELECT inspectedRepositorySha,evidenceSnapshotId FROM president_assessments ORDER BY completedAt DESC LIMIT 1"
    );
    const assessment = rows[0]
      ? await new MysqlPresidentAssessmentStore(database).findByEvidence(
          rows[0].inspectedRepositorySha,
          rows[0].evidenceSnapshotId
        )
      : null;
    const store = new MysqlPresidentIntelligenceStore(database);
    const strategies = (await store.list("STRATEGY", 20)).filter(
      r =>
        r.payload.status === "ACCEPTED" &&
        r.payload.policyVersion === "source-excerpt-v4"
    );
    const acceptedStrategyIds = new Set(strategies.map(r => r.id));
    return {
      seat: "seat.president" as const,
      assessment,
      strategies,
      thesis: (await store.listCurrent("THESIS", 20)).filter(r =>
        acceptedStrategyIds.has(String(r.payload.strategyRecordId))
      ),
      objectives: (await store.listCurrent("OBJECTIVE", 20)).filter(r =>
        acceptedStrategyIds.has(String(r.payload.strategyRecordId))
      ),
      metrics: await store.listCurrent("METRIC", 30),
      research: await store.list("RESEARCH", 20),
      capabilities: await store.list("CAPABILITY", 20),
      progress: await store.list("PROGRESS", 20),
      skills: executiveSkillCatalog,
      executionState: "NOT_REGISTERED" as const,
    };
  }),
  evidence: founderProcedure
    .input(
      z.object({ ids: z.array(z.string().max(64)).min(1).max(50) }).strict()
    )
    .query(({ input }) =>
      new MysqlPresidentIntelligenceStore(presidentPool()).evidence(input.ids)
    ),
  ledger: founderProcedure
    .input(
      z
        .object({
          kind: z.enum(intelligenceRecordKinds),
          limit: z.number().int().min(1).max(100).default(30),
        })
        .strict()
    )
    .query(({ input }) =>
      new MysqlPresidentIntelligenceStore(presidentPool()).list(
        input.kind,
        input.limit
      )
    ),
});
