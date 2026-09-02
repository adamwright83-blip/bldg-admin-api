const fs = require("fs");

function replaceOne(path, oldText, newText) {
  let s = fs.readFileSync(path, "utf8");
  const count = s.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${path}: expected 1 match, found ${count}`);
  fs.writeFileSync(path, s.replace(oldText, newText));
}

replaceOne(
  "server/commercialPipeline/commercialPipelineService.ts",
  'import { and, desc, eq, inArray, sql } from "drizzle-orm";',
  'import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";'
);
replaceOne(
  "server/commercialPipeline/commercialPipelineService.ts",
  `import {
  canAdvanceRelationshipStage,
  type CommercialPipelineStage,
} from "@shared/commercialPipeline";`,
  `import {
  canAdvanceRelationshipStage,
  missionStatusForFollowUpOutcome,
  type CommercialFollowUpOutcome,
  type CommercialPipelineStage,
} from "@shared/commercialPipeline";`
);
replaceOne(
  "server/commercialPipeline/commercialPipelineService.ts",
  `  getCommercialMission,
  getCommercialMissionByIdempotencyKey,
  transitionCommercialMission,
} from "../commercialMissions/commercialMissionStore";`,
  `  getCommercialMission,
  getCommercialMissionByIdempotencyKey,
  transitionCommercialMission,
  transitionCommercialMissionWith,
} from "../commercialMissions/commercialMissionStore";`
);

const servicePath = "server/commercialPipeline/commercialPipelineService.ts";
let service = fs.readFileSync(servicePath, "utf8");
const start = service.indexOf("export async function completeCommercialFollowUp(input: {");
const end = service.indexOf("export async function rescheduleCommercialFollowUp(input: {", start);
if (start < 0 || end < 0) throw new Error("completeCommercialFollowUp block not found");
const replacement = `export async function completeCommercialFollowUp(input: {
  tenantId: string;
  pipelineId: number;
  followUpId: string;
  actorId: string;
  requestId: string;
  outcome: CommercialFollowUpOutcome;
  notes: string;
  nextFollowUpAt?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const pipeline = await readPipelineWith(tx, input);
      if (!pipeline) throw new Error("Commercial pipeline record not found");
      const idempotencyKey = \`pipeline-follow-up-completed:\${input.requestId}\`;
      const replay = await tx
        .select({ pipelineId: commercialPipelineEvents.pipelineId })
        .from(commercialPipelineEvents)
        .where(
          and(
            eq(commercialPipelineEvents.tenantId, input.tenantId),
            eq(commercialPipelineEvents.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      if (replay[0]) {
        if (replay[0].pipelineId !== pipeline.id)
          throw new Error(
            "Idempotency key is already bound to a different commercial pipeline"
          );
        return;
      }

      const terminalStatus = missionStatusForFollowUpOutcome(input.outcome);
      if (terminalStatus && input.nextFollowUpAt) {
        throw new Error("Terminal follow-up outcomes cannot schedule another follow-up");
      }

      const result = await tx
        .update(commercialFollowUps)
        .set({
          status: "completed",
          completedAt: new Date(),
          completedBy: input.actorId,
        })
        .where(
          and(
            eq(commercialFollowUps.tenantId, input.tenantId),
            eq(commercialFollowUps.pipelineId, input.pipelineId),
            eq(commercialFollowUps.id, input.followUpId),
            eq(commercialFollowUps.status, "open")
          )
        );
      if (affectedRows(result) !== 1)
        throw new Error("Open follow-up not found or already completed");

      let nextFollowUpId: string | null = null;
      if (input.nextFollowUpAt) {
        nextFollowUpId = randomUUID();
        await tx.insert(commercialFollowUps).values({
          id: nextFollowUpId,
          tenantId: input.tenantId,
          pipelineId: pipeline.id,
          missionId: pipeline.missionId,
          dueAt: input.nextFollowUpAt,
          note: input.notes,
          assignedTo: input.actorId,
          requestId: randomUUID(),
          createdBy: input.actorId,
        });
      }

      const nextOpen = terminalStatus
        ? []
        : await tx
            .select({ dueAt: commercialFollowUps.dueAt })
            .from(commercialFollowUps)
            .where(
              and(
                eq(commercialFollowUps.tenantId, input.tenantId),
                eq(commercialFollowUps.pipelineId, input.pipelineId),
                eq(commercialFollowUps.status, "open")
              )
            )
            .orderBy(asc(commercialFollowUps.dueAt))
            .limit(1);
      await tx
        .update(commercialPipelineRecords)
        .set({ nextFollowUpAt: terminalStatus ? null : (nextOpen[0]?.dueAt ?? null) })
        .where(
          and(
            eq(commercialPipelineRecords.tenantId, input.tenantId),
            eq(commercialPipelineRecords.id, pipeline.id)
          )
        );

      await tx.insert(commercialPipelineEvents).values({
        tenantId: input.tenantId,
        pipelineId: pipeline.id,
        missionId: pipeline.missionId,
        fromStage: pipeline.stage,
        toStage: pipeline.stage,
        actorType: "operator",
        actorId: input.actorId,
        idempotencyKey,
        correlationId: input.requestId,
        metadataJson: {
          followUpId: input.followUpId,
          outcome: input.outcome,
          notes: input.notes,
          nextFollowUpAt: input.nextFollowUpAt?.toISOString() ?? null,
          nextFollowUpId,
        },
      });

      if (terminalStatus) {
        const missionRows = await tx
          .select({ id: commercialMissions.id, version: commercialMissions.version, status: commercialMissions.status })
          .from(commercialMissions)
          .where(
            and(
              eq(commercialMissions.tenantId, input.tenantId),
              eq(commercialMissions.id, pipeline.missionId)
            )
          )
          .for("update")
          .limit(1);
        const mission = missionRows[0];
        if (!mission) throw new Error("Commercial mission not found");
        if (mission.status !== "follow_up" && mission.status !== "visit_completed") {
          throw new Error(\`Follow-up outcome cannot resolve mission from \${mission.status}\`);
        }
        await transitionCommercialMissionWith(tx, {
          tenantId: input.tenantId,
          missionId: mission.id,
          expectedVersion: mission.version,
          toStatus: terminalStatus,
          actor: { type: "driver", id: input.actorId },
          idempotencyKey: \`pipeline-follow-up-outcome:\${input.requestId}\`,
          metadata: {
            source: "follow_up",
            followUpId: input.followUpId,
            outcome: input.outcome,
            notes: input.notes,
          },
        });
      }
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  await assertPipelineEventPersisted({
    tenantId: input.tenantId,
    pipelineId: input.pipelineId,
    idempotencyKey: \`pipeline-follow-up-completed:\${input.requestId}\`,
  });
  const detail = await getCommercialPipelineDetail(input);
  if (
    !detail?.followUps.some(
      item => item.id === input.followUpId && item.status === "completed"
    )
  )
    throw new Error("Commercial follow-up completion was not persisted");
  if (
    input.nextFollowUpAt &&
    !detail.followUps.some(
      item => item.status === "open" && item.dueAt === input.nextFollowUpAt?.toISOString()
    )
  )
    throw new Error("Next commercial follow-up was not persisted");
  return detail;
}

`;
service = service.slice(0, start) + replacement + service.slice(end);
fs.writeFileSync(servicePath, service);

replaceOne(
  "server/dayforgeToday/dayforgeTodayRouter.ts",
  'import { z } from "zod";',
  'import { z } from "zod";\nimport { COMMERCIAL_FOLLOW_UP_OUTCOMES } from "@shared/commercialPipeline";'
);
replaceOne(
  "server/dayforgeToday/dayforgeTodayRouter.ts",
  `  completeFollowUp: dayforgeMissionFieldProcedure.input(z.object({
    pipelineId: z.number().int().positive(), followUpId: z.string().uuid(), requestId: z.string().uuid(),
  })).mutation(({ ctx, input }) => completeCommercialFollowUp({
    ...input, tenantId: ctx.tenantId, actorId: ctx.user.openId,
  })),`,
  `  completeFollowUp: dayforgeMissionFieldProcedure
    .input(
      z
        .object({
          pipelineId: z.number().int().positive(),
          followUpId: z.string().uuid(),
          requestId: z.string().uuid(),
          outcome: z.enum(COMMERCIAL_FOLLOW_UP_OUTCOMES),
          notes: z.string().trim().min(1).max(20_000),
          nextFollowUpAt: z.coerce.date().optional(),
        })
        .superRefine((value, ctx) => {
          if (value.nextFollowUpAt && value.nextFollowUpAt.getTime() <= Date.now()) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Next follow-up time must be in the future",
            });
          }
          if (
            (value.outcome === "won" || value.outcome === "lost") &&
            value.nextFollowUpAt
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Terminal follow-up outcomes cannot schedule another follow-up",
            });
          }
        })
    )
    .mutation(({ ctx, input }) =>
      completeCommercialFollowUp({
        ...input,
        tenantId: ctx.tenantId,
        actorId: ctx.user.openId,
      })
    ),`
);

replaceOne(
  "client/src/game/actions/actionServices.ts",
  'import type { AuthoritativeFollowUp } from "./actionRegistry";',
  'import type { AuthoritativeFollowUp } from "./actionRegistry";\nimport type { CommercialFollowUpOutcome } from "../../../../shared/commercialPipeline";'
);
replaceOne(
  "client/src/game/actions/actionServices.ts",
  `  completeFollowUp: (input: {
    followUp: AuthoritativeFollowUp;
    requestId: string;
  }) => Promise<void>;`,
  `  completeFollowUp: (input: {
    followUp: AuthoritativeFollowUp;
    requestId: string;
    outcome: CommercialFollowUpOutcome;
    notes: string;
    nextFollowUpAt?: Date;
  }) => Promise<void>;`
);

replaceOne(
  "client/src/pages/driver/GoldlineDriverController.tsx",
  `  async function completeFollowUpAction(input: {
    followUp: AuthoritativeFollowUp;
    requestId: string;
  }) {
    await completeFollowUp.mutateAsync({
      pipelineId: input.followUp.pipelineId,
      followUpId: input.followUp.followUpId,
      requestId: input.requestId,
    });
  }`,
  `  async function completeFollowUpAction(input: {
    followUp: AuthoritativeFollowUp;
    requestId: string;
    outcome: import("../../../../shared/commercialPipeline").CommercialFollowUpOutcome;
    notes: string;
    nextFollowUpAt?: Date;
  }) {
    await completeFollowUp.mutateAsync({
      pipelineId: input.followUp.pipelineId,
      followUpId: input.followUp.followUpId,
      requestId: input.requestId,
      outcome: input.outcome,
      notes: input.notes,
      nextFollowUpAt: input.nextFollowUpAt,
    });
  }`
);

replaceOne(
  "client/src/game/actions/GoldlineActionSurface.tsx",
  `  const [dueAt, setDueAt] = useState("");
  const [busy, setBusy] = useState(false);`,
  `  const [dueAt, setDueAt] = useState("");
  const [result, setResult] = useState<"" | "no_contact" | "contacted_no_decision" | "won" | "lost">("");
  const [resultNotes, setResultNotes] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [busy, setBusy] = useState(false);`
);

replaceOne(
  "client/src/game/actions/GoldlineActionSurface.tsx",
  `      <button
        disabled={busy}
        onClick={() =>
          void perform(() =>
            props.services.completeFollowUp({
              followUp: props.action.followUp,
              requestId: props.requestId,
            })
          )
        }
      >
        RECORD FOLLOW-UP COMPLETE
      </button>
      <label>
        SCHEDULE A REAL NEW TIME`,
  `      <label>
        WHAT HAPPENED
        <select
          value={result}
          onChange={event =>
            setResult(
              event.target.value as typeof result
            )
          }
        >
          <option value="">Choose real result</option>
          <option value="no_contact">No contact</option>
          <option value="contacted_no_decision">Contacted — no decision</option>
          <option value="won">Won</option>
          <option value="lost">Lost</option>
        </select>
      </label>
      <label>
        RESULT NOTES
        <textarea
          rows={3}
          value={resultNotes}
          onChange={event => setResultNotes(event.target.value)}
        />
      </label>
      {result && result !== "won" && result !== "lost" ? (
        <label>
          EXPLICIT NEW FOLLOW-UP · OPTIONAL
          <input
            type="datetime-local"
            value={nextFollowUpAt}
            onChange={event => setNextFollowUpAt(event.target.value)}
          />
        </label>
      ) : null}
      <button
        disabled={
          busy ||
          !result ||
          !resultNotes.trim() ||
          (!!nextFollowUpAt && new Date(nextFollowUpAt).getTime() <= Date.now())
        }
        onClick={() =>
          void perform(() =>
            props.services.completeFollowUp({
              followUp: props.action.followUp,
              requestId: props.requestId,
              outcome: result as "no_contact" | "contacted_no_decision" | "won" | "lost",
              notes: resultNotes.trim(),
              nextFollowUpAt:
                nextFollowUpAt && result !== "won" && result !== "lost"
                  ? new Date(nextFollowUpAt)
                  : undefined,
            })
          )
        }
      >
        RECORD FOLLOW-UP RESULT
      </button>
      <label>
        MOVE THIS FOLLOW-UP WITHOUT RECORDING AN ATTEMPT`
);

fs.writeFileSync(
  "server/commercialPipeline/realWorkdayFollowUpTruth.test.ts",
`import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const shared = readFileSync(new URL("../../shared/commercialPipeline.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("./commercialPipelineService.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("../dayforgeToday/dayforgeTodayRouter.ts", import.meta.url), "utf8");
const surface = readFileSync(new URL("../../client/src/game/actions/GoldlineActionSurface.tsx", import.meta.url), "utf8");

describe("Real Workday follow-up truth", () => {
  it("records observed outcomes without treating an attempt as success", () => {
    expect(shared).toContain('"no_contact"');
    expect(shared).toContain('"contacted_no_decision"');
    expect(shared).toContain('return outcome === "won" || outcome === "lost" ? outcome : null');
    expect(service).toContain("missionStatusForFollowUpOutcome(input.outcome)");
    expect(service).toContain("outcome: input.outcome");
    expect(service).toContain("notes: input.notes");
  });

  it("allows only explicit won/lost to resolve terminal mission truth", () => {
    expect(service).toContain("if (terminalStatus)");
    expect(service).toContain("toStatus: terminalStatus");
    expect(service).toContain('idempotencyKey: `pipeline-follow-up-outcome:${input.requestId}`');
    expect(router).toContain('value.outcome === "won" || value.outcome === "lost"');
  });

  it("creates a new future obligation only from an explicit future date", () => {
    expect(service).toContain("if (input.nextFollowUpAt)");
    expect(service).toContain("dueAt: input.nextFollowUpAt");
    expect(router).toContain("Next follow-up time must be in the future");
    expect(surface).toContain("EXPLICIT NEW FOLLOW-UP · OPTIONAL");
  });

  it("removes the naked complete button from the game surface", () => {
    expect(surface).not.toContain("RECORD FOLLOW-UP COMPLETE");
    expect(surface).toContain("RECORD FOLLOW-UP RESULT");
    expect(surface).toContain('value="no_contact"');
    expect(surface).toContain('value="contacted_no_decision"');
    expect(surface).toContain("MOVE THIS FOLLOW-UP WITHOUT RECORDING AN ATTEMPT");
  });
});
`
);
