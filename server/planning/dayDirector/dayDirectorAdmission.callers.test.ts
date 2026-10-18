import { afterEach, describe, expect, it, vi } from "vitest";
import { remainingWeekHorizon } from "../../../shared/weeklyMissionReadiness";
import { projectRecurrenceForDate } from "../../claire/workdayRecurrenceService";
import { commitBriefing } from "../../claire/briefing/briefingCommit";
import type { BriefingItem, ParsedBriefing } from "../../claire/briefing/briefingTypes";
import { commitWeeklyPlan, type WeeklyCommitPorts } from "../../claire/weeklyMission/commit";
import { newWeeklySession } from "../../claire/weeklyMission/session";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../../claire/turn/conversationStateStore";
import { acceptSalesInsightChallenge } from "../../claire/proactive/growthChallenge";
import type { SalesInsightArtifact } from "../../claire/proactive/salesInsights";
import { executeOperatorMissionCommand } from "../../claire/operatorMissionCommand";
import { commitAccountFollowUp } from "../../claire/knowledge/accountActions";
import { applyWorkLedgerPlan } from "../../claire/workLedger/workLedgerApply";
import type { WorkLedgerPlan } from "../../claire/workLedger/workLedgerPlanner";

// Each caller of a Day Director writer passes the operator's authority for that
// write, naming the operator whose Day Line it is. The writer refuses anything else
// (dayDirectorWriteBoundary.test.ts), so a caller that drops its proof fails closed.

function instruction(channel: string, operatorActorId: string, instructionRef: string) {
  return { kind: "operator_instruction", channel, operatorActorId, instructionRef };
}

function stored(id: string, actorId: string, extra: Record<string, unknown> = {}) {
  return { stored: { id, actorId, ...extra }, created: true };
}

describe("recurrence projection", () => {
  it("projects an occurrence only on the operator's active rule", async () => {
    const accept = vi.fn(async () => ({ id: "c-rec" }));
    await projectRecurrenceForDate(
      { tenantId: "t1", actorId: "42", businessDate: "2026-10-19" },
      {
        accept: accept as never,
        listRules: async () => [
          {
            id: "rule-1", tenantId: "t1", actorId: "42", sourceIdentity: "s", title: "Restock detergent",
            kind: "operations", weekday: "monday", windowStart: null, windowEnd: null, sourceText: "every Monday", status: "active",
          },
        ],
      }
    );
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({
        admission: { kind: "operator_recurrence_rule", ruleId: "rule-1", operatorActorId: "42" },
        proposal: expect.objectContaining({ promptKey: "recurrence:rule-1:2026-10-19" }),
      })
    );
  });
});

describe("Claire briefing commit", () => {
  const item = (overrides: Partial<BriefingItem> = {}): BriefingItem => ({
    kind: "new_work",
    title: "Call Mei about the order",
    quote: "I need to call Mei about the order",
    businessDate: "2026-10-19",
    timing: { kind: "daypart", label: "Morning" },
    quantity: null,
    people: [],
    place: null,
    needs: null,
    existing: null,
    ...overrides,
  });

  it("every write carries the operator's briefing from this conversation", async () => {
    const rows = new Map<string, Record<string, unknown>>();
    const accept = vi.fn(async (input: { proposal: { title: string; command?: unknown } }) => {
      rows.set("c-1", { id: "c-1", tenantId: "t1", actorId: "42", businessDate: "2026-10-19", title: input.proposal.title, status: "open", metadataJson: {} });
      return stored("c-1", "42");
    });
    const update = vi.fn(async (input: { commitmentId: string; patch: Record<string, unknown> }) => {
      const row = rows.get(input.commitmentId)!;
      row.metadataJson = { ...(row.metadataJson as object), ...input.patch };
      return { ok: true as const, id: input.commitmentId };
    });
    const complete = vi.fn(async () => ({ ok: true as const, alreadyCompleted: false }));
    const parsed: ParsedBriefing = {
      items: [item(), item({ kind: "completed", title: "Drop off cargo", quote: "I dropped off the cargo", timing: { kind: "none" }, existing: { id: "c-2", title: "Drop off cargo", source: "day_line" } })],
      context: [],
      questions: [],
      unparsed: [],
      source: "deterministic",
    };
    rows.set("c-2", { id: "c-2", tenantId: "t1", actorId: "42", businessDate: "2026-10-19", title: "Drop off cargo", status: "open", metadataJson: {} });
    const result = await commitBriefing(
      parsed,
      { tenantId: "t1", dayDirectorActorId: "42", conversationKey: "conv-7" },
      {
        accept: accept as never,
        update: update as never,
        complete: (async (input: { commitmentId: string }) => {
          rows.get(input.commitmentId)!.status = "completed";
          return complete(input);
        }) as never,
        readCanonical: (async (target: { commitmentId: string }) => rows.get(target.commitmentId) ?? null) as never,
      }
    );
    expect(result.failed).toEqual([]);
    const expected = instruction("claire_conversation", "42", "briefing:conv-7");
    expect(accept).toHaveBeenCalledWith(expect.objectContaining({ admission: expected }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ admission: expected }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ commitmentId: "c-2", admission: expected }));
  });
});

describe("weekly plan lock", () => {
  afterEach(() => setClaireConversationStateStoreForTests(null));

  it("the operator's lock admits every primary it writes and designates", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const horizon = remainingWeekHorizon({ businessDate: "2026-09-18", localTime: "09:00" });
    const session = newWeeklySession({
      tenantId: "t1",
      operatorId: "adam",
      dayDirectorActorId: "42",
      weekStart: horizon.weekStart,
      draft: {
        weekStart: horizon.weekStart,
        days: horizon.remainingDates.map(businessDate => ({
          businessDate,
          weekday: "Friday",
          disposition: "primary" as const,
          primary: { text: `Mission ${businessDate}`, source: "operator_stated" as const, existingCommitmentId: null },
          fixedConstraints: [],
          readinessRequirements: [],
          uncertainty: null,
        })),
      },
    });
    session.phase = "awaiting_confirmation";
    const rows = new Map<string, Record<string, unknown>>();
    let intent: unknown = null;
    const ports: WeeklyCommitPorts = {
      acceptProposal: vi.fn(async input => {
        const id = `c-${input.businessDate}`;
        rows.set(id, { id, tenantId: "t1", actorId: "42", businessDate: input.businessDate, title: input.proposal.title, status: "open" });
        return stored(id, "42") as never;
      }),
      designatePrimary: vi.fn(async input => ({ commitmentId: input.commitmentId })),
      readCommitment: (async (target: { commitmentId: string }) => rows.get(target.commitmentId) ?? null) as never,
      updateCommitment: vi.fn(async input => ({ ok: true as const, id: input.commitmentId })),
      saveIntent: (async (record: unknown) => {
        intent = record;
      }) as never,
      latestIntent: (async () => intent) as never,
    };
    const result = await commitWeeklyPlan({ session }, ports);
    expect(result.locked).toBe(true);
    const expected = instruction("claire_conversation", "42", `weekly_lock:${session.key}`);
    expect(ports.acceptProposal).toHaveBeenCalledWith(expect.objectContaining({ admission: expected }));
    expect(ports.designatePrimary).toHaveBeenCalledWith(expect.objectContaining({ admission: expected }));
  });
});

describe("growth challenge confirmation", () => {
  it("only the operator's confirmation admits the challenge", async () => {
    const artifact = {
      observationReference: "obs-1",
      recommendedChallenge: {
        title: "Diagnose the September decline",
        why: "Revenue fell.",
        completionCondition: "Review the customer list",
        sourceObservationReference: "obs-1",
        status: "proposal_only",
        requiresOperatorApproval: true,
      },
    } as unknown as SalesInsightArtifact;
    const accept = vi.fn(async () => stored("c-g", "42"));
    await acceptSalesInsightChallenge(
      { tenantId: "t1", actorId: "42", businessDate: "2026-10-19", artifact, operatorUtterance: "yes, add that challenge" },
      {
        loadInsight: (async () => artifact) as never,
        accept: accept as never,
        readCommitment: (async () => null) as never,
      }
    ).catch(() => undefined); // readback is not under test here
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({ admission: instruction("claire_conversation", "42", "growth_challenge:obs-1") })
    );
  });
});

describe("explicit operator mission command", () => {
  it("the parsed command is the admission for the commitment and its primary designation", async () => {
    const acceptProposal = vi.fn(async (input: { proposal: { title: string } }) => ({ id: "c-m", title: input.proposal.title }));
    const designatePrimary = vi.fn(async (input: { commitmentId: string }) => ({ commitmentId: input.commitmentId }));
    await executeOperatorMissionCommand(
      {
        tenantId: "t1",
        operatorUserId: "adam-open-id",
        dayDirectorActorId: "42",
        businessDate: "2026-09-22",
        utterance: "Claire, create today's mission: create and publish one static-image Instagram ad.",
        sourceCommandRef: "voice:conv-1:turn:3",
      },
      {
        now: () => new Date("2026-09-22T16:00:00.000Z"),
        listToday: async () => [],
        latestIntent: async () => null,
        acceptProposal: acceptProposal as never,
        designatePrimary: designatePrimary as never,
        loadCommand: (async () => {
          throw new Error("readback not under test");
        }) as never,
      }
    );
    const expected = instruction("claire_conversation", "42", "operator_mission:voice:conv-1:turn:3");
    expect(acceptProposal).toHaveBeenCalledWith(expect.objectContaining({ admission: expected }));
    expect(designatePrimary).toHaveBeenCalledWith(expect.objectContaining({ admission: expected }));
  });
});

describe("account follow-up confirmation", () => {
  it("the operator's yes to the pending follow-up admits its Day Line row", async () => {
    const accept = vi.fn(async () => stored("c-f", "42"));
    await commitAccountFollowUp(
      {
        accountId: 6,
        accountName: "Sunset Towers",
        pipelineId: null,
        followUpId: null,
        previousDueAt: null,
        dueDate: "2026-10-20",
        note: "They want a quote",
        requestId: "req-1",
      } as never,
      { tenantId: "t1", operatorUserId: "adam-open-id", dayDirectorActorId: "42", timeZone: "America/Los_Angeles" },
      { accept: accept as never }
    );
    expect(accept).toHaveBeenCalledWith(
      expect.objectContaining({ admission: instruction("claire_conversation", "42", "account_follow_up:req-1") })
    );
  });
});

describe("work ledger plan", () => {
  it("edits, moves and completions carry the conversation's admission", async () => {
    const update = vi.fn(async (input: { commitmentId: string }) => ({ ok: true as const, id: input.commitmentId }));
    const move = vi.fn(async () => true);
    const complete = vi.fn(async () => ({ ok: true as const, alreadyCompleted: false }));
    const plan: WorkLedgerPlan = {
      workChanged: true,
      endCall: false,
      held: [],
      saveRefs: [],
      edits: [
        { id: "c-1", title: null, executionType: "challenge", detail: null, timing: null, moveTo: null },
        { id: "c-2", title: null, executionType: "unchanged", detail: null, timing: null, moveTo: "2026-10-20" },
      ],
      completeIds: ["c-3"],
      confirmIds: [],
      removeIds: [],
      reply: "",
      operatorSignal: "none" as never,
      refused: [],
    };
    const line = (id: string) => ({
      id, title: `Item ${id}`, businessDate: "2026-10-19", status: "open" as const, executionType: null,
      detail: null, sourceText: null, scheduleLabel: null, savedThisConversation: false,
    });
    await applyWorkLedgerPlan({
      plan,
      dayLine: [line("c-1"), line("c-2"), line("c-3")],
      target: { tenantId: "t1", dayDirectorActorId: "42", operatorUserId: "adam-open-id", conversationKey: "conv-9" },
      clock: { today: "2026-10-19", minutesNow: 600 },
      deps: {
        update: update as never,
        move: move as never,
        complete: complete as never,
        readState: (async () => ({ commitments: [] })) as never,
      },
    });
    const expected = instruction("claire_conversation", "42", "work_ledger:conv-9");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ commitmentId: "c-1", admission: expected }));
    expect(move).toHaveBeenCalledWith(expect.objectContaining({ commitmentId: "c-2", admission: expected }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ commitmentId: "c-3", admission: expected }));
  });
});
