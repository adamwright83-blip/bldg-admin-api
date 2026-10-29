import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dayDirectorRecurrenceRules, strategicProposalResponses } from "../../../drizzle/schema";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import { emptyCommandMetadata } from "../../../shared/claireWorkdayCommand";

/**
 * Stage 1 · 1C-i: a Day Director commitment write needs the operator's exact
 * approval or direct instruction. Anything else is refused before any row is
 * read or written.
 */
const rows = new Map<unknown, unknown[]>();
const getDb = vi.fn(async () => ({
  select: () => ({
    from: (table: unknown) => ({
      where: () => ({ limit: async () => rows.get(table) ?? [] }),
    }),
  }),
}));
vi.mock("../../db", () => ({ getDb }));

const {
  DayLineAdmissionRefusedError,
  assertDayLineAdmission,
  operatorInstructionAdmission,
  recurrenceRuleAdmission,
  strategicApprovalAdmission,
} = await import("./dayLineAdmission");
const { acceptProposalWithReceipt, acceptProposal } = await import("./dayDirectorService");
const { recurrenceIdempotencyKey } = await import("../../claire/workdayRecurrenceService");

const tenantId = "tenant-1c";
const actorIds = ["actor-1"];
const businessDate = "2026-10-19";

function proposal(overrides: Partial<DayDirectorProposal> = {}): DayDirectorProposal {
  return {
    promptKey: "commitment:abc",
    title: "Call the Louise",
    kind: "growth",
    quantity: null,
    sourceText: "Call the Louise",
    prerequisites: [],
    question: null,
    intelligence: "manual_fallback",
    ...overrides,
  };
}

const approval = {
  proposalId: "proposal-1",
  revision: "rev-1",
  itemId: "item-1",
  responseId: "response_1",
  canonicalOperatorId: "tenant:tenant-1c:operator:adam",
  approvedByUserId: "adam-open-id",
};

function storedApproval(overrides: Record<string, unknown> = {}) {
  rows.set(strategicProposalResponses, [
    {
      id: approval.responseId,
      responseJson: {
        id: approval.responseId,
        proposalId: approval.proposalId,
        revision: approval.revision,
        action: "approve",
        itemIds: [approval.itemId],
        operatorUserId: approval.approvedByUserId,
        ...overrides,
      },
    },
  ]);
}

async function refused(admission: unknown, p: DayDirectorProposal = proposal()) {
  await expect(
    assertDayLineAdmission({ tenantId, actorIds, businessDate, proposal: p, admission })
  ).rejects.toBeInstanceOf(DayLineAdmissionRefusedError);
}

beforeEach(() => {
  rows.clear();
  getDb.mockClear();
});

describe("Day Line admission: un-admitted writes are refused", () => {
  it("refuses a write with no proof, before touching the database", async () => {
    await expect(
      acceptProposalWithReceipt({
        tenantId,
        actorId: actorIds[0]!,
        businessDate,
        proposal: proposal(),
      } as never)
    ).rejects.toThrow(/Day Line write refused: no operator approval or instruction was provided/);
    expect(getDb).not.toHaveBeenCalled();
    await expect(
      acceptProposal({ tenantId, actorId: actorIds[0]!, businessDate, proposal: proposal() } as never)
    ).rejects.toBeInstanceOf(DayLineAdmissionRefusedError);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("refuses unknown proof kinds, including a machine policy receipt", async () => {
    await refused({ kind: "board_sweep" });
    await refused({ kind: "policy_receipt", riskClass: "INTERNAL_REVERSIBLE", allowed: true });
    await refused({
      kind: "persistent_action_policy",
      exactAction: "persistent_operator.goal_cycle.prepare",
      decision: "allowed",
    });
    await refused("operator_instruction");
    await refused(null);
  });

  it("refuses an operator instruction without a real operator, surface or source", async () => {
    for (const operatorUserId of ["", "  ", "unknown", "system", "worker"]) {
      await refused({ kind: "operator_instruction", operatorUserId, surface: "claire_turn", sourceRef: "turn-1" });
    }
    await refused({ kind: "operator_instruction", operatorUserId: "adam", surface: "goal_cycle_worker", sourceRef: "x" });
    await refused({ kind: "operator_instruction", operatorUserId: "adam", surface: "claire_turn", sourceRef: "" });
  });

  it("admits an authenticated operator instruction", async () => {
    const admitted = await assertDayLineAdmission({
      tenantId,
      actorIds,
      businessDate,
      proposal: proposal(),
      admission: operatorInstructionAdmission({ operatorUserId: "adam", surface: "day_line_ui", sourceRef: "day_director.accept:commitment:abc" }),
    });
    expect(admitted).toEqual({
      kind: "operator_instruction",
      operatorUserId: "adam",
      surface: "day_line_ui",
      sourceRef: "day_director.accept:commitment:abc",
    });
  });
});

describe("Day Line admission: exact strategic approval", () => {
  it("admits the item when a stored approval response matches its lineage", async () => {
    storedApproval();
    const admitted = await assertDayLineAdmission({
      tenantId,
      actorIds,
      businessDate,
      proposal: proposal({ strategicApproval: approval }),
      admission: strategicApprovalAdmission(approval),
    });
    expect(admitted.kind).toBe("strategic_approval");
  });

  it("refuses when no stored response exists, or it is not an approval of this item", async () => {
    const p = proposal({ strategicApproval: approval });
    await refused(strategicApprovalAdmission(approval), p);
    storedApproval({ action: "reject" });
    await refused(strategicApprovalAdmission(approval), p);
    storedApproval({ itemIds: ["item-2"] });
    await refused(strategicApprovalAdmission(approval), p);
    storedApproval({ revision: "rev-0" });
    await refused(strategicApprovalAdmission(approval), p);
    storedApproval({ operatorUserId: "someone-else" });
    await refused(strategicApprovalAdmission(approval), p);
  });

  it("refuses a proof that does not match the item's approval lineage", async () => {
    storedApproval();
    await refused(strategicApprovalAdmission({ ...approval, itemId: "item-2" }), proposal({ strategicApproval: approval }));
    await refused(strategicApprovalAdmission(approval), proposal());
  });

  it("refuses an item claiming approval lineage under any other proof", async () => {
    storedApproval();
    await refused(
      operatorInstructionAdmission({ operatorUserId: "adam", surface: "claire_turn", sourceRef: "turn" }),
      proposal({ strategicApproval: approval })
    );
  });
});

describe("Day Line admission: operator-confirmed recurrence rule", () => {
  const ruleId = "rule-1";
  const recurring = () => {
    const command = emptyCommandMetadata();
    command.recurrenceRuleId = ruleId;
    return proposal({ promptKey: recurrenceIdempotencyKey(ruleId, businessDate), command });
  };

  it("admits the rule's occurrence while the rule is active", async () => {
    rows.set(dayDirectorRecurrenceRules, [{ id: ruleId, status: "active" }]);
    const admitted = await assertDayLineAdmission({
      tenantId, actorIds, businessDate, proposal: recurring(), admission: recurrenceRuleAdmission(ruleId),
    });
    expect(admitted).toEqual({ kind: "operator_recurrence_rule", ruleId });
  });

  it("refuses a cancelled or missing rule, or an item that is not that rule's occurrence", async () => {
    rows.set(dayDirectorRecurrenceRules, [{ id: ruleId, status: "cancelled" }]);
    await refused(recurrenceRuleAdmission(ruleId), recurring());
    rows.clear();
    await refused(recurrenceRuleAdmission(ruleId), recurring());
    rows.set(dayDirectorRecurrenceRules, [{ id: ruleId, status: "active" }]);
    await refused(recurrenceRuleAdmission(ruleId), proposal({ promptKey: recurrenceIdempotencyKey(ruleId, businessDate) }));
    await refused(recurrenceRuleAdmission(ruleId), { ...recurring(), promptKey: recurrenceIdempotencyKey(ruleId, "2026-10-20") });
    await refused(recurrenceRuleAdmission(""), recurring());
  });
});

describe("Day Line admission: structural guard", () => {
  const root = join(import.meta.dirname, "../../..");
  const serverDir = join(root, "server");

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
      return /\.(?:ts|tsx|mjs)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
    });
  }
  const files = sourceFiles(serverDir).map(path => ({
    path: relative(root, path).replaceAll("\\", "/"),
    source: readFileSync(path, "utf8"),
  }));

  it("only known writers insert Day Director commitments", () => {
    const writers = files
      .filter(f => /\.insert\(\s*dayDirectorCommitments\s*\)|insert\s+into\s+`?day_director_commitments/i.test(f.source))
      .map(f => f.path)
      .sort();
    expect(writers).toEqual([
      // Admission-gated: acceptProposalWithReceipt.
      "server/planning/dayDirector/dayDirectorService.ts",
      // Admission-gated: activateTowerWarsPromise.
      "server/planning/dayDirector/towerWarsPromiseService.ts",
      // Hidden plan snapshot (hiddenFromDayPlan: true); never shown as Day Line work.
      "server/planning/dayDirector/workdayPlanSnapshotStore.ts",
    ]);
    const snapshot = files.find(f => f.path.endsWith("workdayPlanSnapshotStore.ts"))!.source;
    expect(snapshot).toMatch(/hiddenFromDayPlan:\s*true/);
  });

  it("every commitment insert runs after the admission check", () => {
    for (const path of [
      "server/planning/dayDirector/dayDirectorService.ts",
      "server/planning/dayDirector/towerWarsPromiseService.ts",
    ]) {
      const source = files.find(f => f.path === path)!.source;
      const check = source.indexOf("await assertDayLineAdmission(");
      const insert = source.indexOf(".insert(dayDirectorCommitments)");
      expect(check, path).toBeGreaterThan(-1);
      expect(insert, path).toBeGreaterThan(check);
    }
  });

  it("operator-instruction proof is built only at operator-facing entry points", () => {
    const builders = files
      .filter(f => f.path !== "server/planning/dayDirector/dayLineAdmission.ts")
      .filter(f => /operatorInstructionAdmission\(|kind:\s*["']operator_instruction["']/.test(f.source))
      .map(f => f.path)
      .sort();
    expect(builders).toEqual([
      "server/claire/briefing/briefingCommit.ts",
      "server/claire/knowledge/accountActions.ts",
      "server/claire/operatorMissionCommand.ts",
      "server/claire/proactive/growthChallenge.ts",
      // Disposable-database harnesses for the native-tool Claire (both refuse a non-local DATABASE_URL).
      "server/claire/prototype/evals/liveSmoke.ts",
      "server/claire/prototype/evals/runEvals.ts",
      // The native-tool Claire's Day Line tool on a live call: the operator's quoted words,
      // verified against the server's record of the call, are the proof.
      "server/claire/prototype/tools.ts",
      // The operator's own words on a live showrunner call (2026-10-23: reported pickups).
      "server/claire/showrunner/reportedWork.ts",
      "server/claire/voiceCommitmentLoop.ts",
      "server/claire/weeklyMission/commit.ts",
      "server/experience/goldline/modes/towerWars/towerWarsRouter.ts",
      "server/planning/dayDirector/dayDirectorRouter.ts",
    ]);
    for (const path of builders) {
      expect(path).not.toMatch(/persistentOperator|boardService|[wW]orker/);
    }
  });

  it("machine-side preparation never references a Day Line admission or writer", () => {
    const machine = files.filter(f =>
      f.path.startsWith("server/agents/persistentOperator/") ||
      f.path === "server/claire/proactive/boardService.ts"
    );
    expect(machine.length).toBeGreaterThan(5);
    for (const f of machine) {
      expect(f.source, f.path).not.toMatch(/dayLineAdmission|acceptProposalWithReceipt|acceptProposal\(|operatorInstructionAdmission|strategicApprovalAdmission/);
    }
  });
});
