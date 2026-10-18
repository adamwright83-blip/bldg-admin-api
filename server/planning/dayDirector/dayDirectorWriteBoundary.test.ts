import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Stage 1 authority rule at the write boundary: every Day Director writer refuses
// a write without the operator's authority, before it reads or changes a row.

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../../db", () => ({ getDb: mocks.getDb }));

import {
  acceptProposal,
  acceptProposalWithReceipt,
  completeDayDirectorCommitment,
  designateDayDirectorPrimary,
  moveDayDirectorCommitment,
  updateDayDirectorCommitment,
} from "./dayDirectorService";
import { DayDirectorAdmissionError } from "./dayDirectorAdmission";

const proposal = {
  promptKey: "claire-proactive:sales:6:2026-08-07",
  title: "Follow up with account 6",
  kind: "growth" as const,
  quantity: null,
  sourceText: "Prepared by the board",
  prerequisites: [],
  question: null,
  intelligence: "manual_fallback" as const,
};

type AnyWriter = (input: never) => Promise<unknown>;

const writes: Array<[string, AnyWriter, Record<string, unknown>]> = [
  ["acceptProposalWithReceipt", acceptProposalWithReceipt as AnyWriter, { businessDate: "2026-10-19", proposal }],
  ["acceptProposal", acceptProposal as AnyWriter, { businessDate: "2026-10-19", proposal }],
  ["completeDayDirectorCommitment", completeDayDirectorCommitment as AnyWriter, { commitmentId: "c-1" }],
  ["updateDayDirectorCommitment", updateDayDirectorCommitment as AnyWriter, { commitmentId: "c-1", patch: { detailNote: "x" } }],
  ["moveDayDirectorCommitment", moveDayDirectorCommitment as AnyWriter, { commitmentId: "c-1", fromBusinessDate: "2026-10-19", toBusinessDate: "2026-10-20" }],
  ["designateDayDirectorPrimary", designateDayDirectorPrimary as AnyWriter, { businessDate: "2026-10-19", commitmentId: "c-1", nowIso: "2026-10-19T16:00:00.000Z" }],
];

describe("Day Director writers require an admission", () => {
  beforeEach(() => {
    mocks.getDb.mockReset();
    mocks.getDb.mockImplementation(async () => {
      throw new Error("the database must not be reached by an un-admitted write");
    });
  });

  it.each(writes)("%s refuses an un-admitted write without touching the database", async (_name, write, rest) => {
    await expect(
      write({ tenantId: "default", actorId: "1", ...rest } as never)
    ).rejects.toMatchObject({ name: "DayDirectorAdmissionError", reason: "admission_missing" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(writes)("%s refuses a goal-cycle policy decision offered as authority", async (_name, write, rest) => {
    const automatic = { allowed: true, authority: "automatic", standingAuthorizationId: null, standingAuthorizationVersion: null };
    await expect(
      write({ tenantId: "default", actorId: "1", ...rest, admission: automatic } as never)
    ).rejects.toBeInstanceOf(DayDirectorAdmissionError);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it.each(writes)("%s refuses an instruction from a different operator", async (_name, write, rest) => {
    await expect(
      write({
        tenantId: "default",
        actorId: "1",
        ...rest,
        admission: { kind: "operator_instruction", channel: "authenticated_app", operatorActorId: "2", instructionRef: "x" },
      } as never)
    ).rejects.toMatchObject({ reason: "operator_not_owner" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

// Every place that can write day_director_commitments, and the authority it carries.
// A new writer fails this test until it is reviewed and added here with its proof.
const REVIEWED_WRITERS: Record<string, string> = {
  "server/planning/dayDirector/dayDirectorService.ts": "the boundary itself",
  "server/planning/dayDirector/dayDirectorRouter.ts": "operator_instruction / authenticated_app",
  "server/planning/dayline/currentDayLineRouter.ts": "operator_instruction / authenticated_app",
  "server/planning/dayDirector/towerWarsPromiseService.ts": "operator_instruction from towerWars.activatePromise",
  "server/strategy/strategicApproval.ts": "strategic_approval (recorded response); its direct updates only enrich or retire the commitment it just admitted",
  "server/claire/workdayRecurrenceService.ts": "operator_recurrence_rule (active rule rechecked)",
  "server/claire/workdayCargoOrchestrator.ts": "caller's operator_instruction",
  "server/claire/briefing/briefingCommit.ts": "operator_instruction / claire_conversation",
  "server/claire/weeklyMission/commit.ts": "operator_instruction / claire_conversation (weekly lock)",
  "server/claire/proactive/growthChallenge.ts": "operator_instruction / claire_conversation (confirmed challenge)",
  "server/claire/workLedger/workLedgerApply.ts": "operator_instruction / claire_conversation (validated ledger plan)",
  "server/claire/operatorMissionCommand.ts": "operator_instruction / claire_conversation (explicit command)",
  "server/claire/knowledge/accountActions.ts": "operator_instruction / claire_conversation (confirmed follow-up)",
  "server/claire/voiceCommitmentLoop.ts": "operator_instruction / claire_voice (spoken yes)",
  // Direct overlay/metadata writers. They never create or complete work.
  "server/planning/dayline/dayLineMutationService.ts": "edit/cancel overlay on existing rows",
  "server/agents/daphne/missionFollowUp.ts": "marks overdue open rows unresolved; records the operator's answer",
  "server/planning/dayDirector/workdayPlanSnapshotStore.ts": "hidden snapshot row (hiddenFromDayPlan), never shown as work",
};

const WRITER_CALL =
  /\b(acceptProposalWithReceipt|acceptProposal|completeDayDirectorCommitment|updateDayDirectorCommitment|moveDayDirectorCommitment|designateDayDirectorPrimary)\b/;
const TABLE_WRITE = /\.(insert|update|delete)\(\s*dayDirectorCommitments\s*\)|(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+`?day_director_commitments\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "node_modules" ? [] : sourceFiles(path);
    return /\.ts$/.test(entry) && !/\.(test|spec)\.ts$/.test(entry) ? [path] : [];
  });
}

describe("Day Director writer inventory", () => {
  it("only reviewed modules can write Day Line commitments", () => {
    const writers = sourceFiles("server").filter(path => {
      const source = readFileSync(path, "utf8");
      const importsWriter =
        /from\s+["'](?:[^"']*\/dayDirector|\.)\/dayDirectorService["']/.test(source) &&
        WRITER_CALL.test(source);
      return importsWriter || TABLE_WRITE.test(source);
    });
    expect(writers.sort()).toEqual(Object.keys(REVIEWED_WRITERS).sort());
  });

  it("the proactive board is not among them", () => {
    expect(Object.keys(REVIEWED_WRITERS)).not.toContain("server/claire/proactive/boardService.ts");
  });
});
