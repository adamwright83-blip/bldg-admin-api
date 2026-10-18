import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DayDirectorProposal } from "../../../shared/dayDirector";

/**
 * Stage 1 · 1C-i: every Day Director commitment writer passes the right
 * admission proof. Each test drives one real caller and inspects the proof it
 * hands to the write boundary.
 */
const accepted = vi.hoisted(() => [] as Array<Record<string, any>>);
vi.mock("./dayDirectorService", async importOriginal => {
  const actual = await importOriginal<typeof import("./dayDirectorService")>();
  const capture = vi.fn(async (input: Record<string, any>) => {
    accepted.push(input);
    return { stored: { id: `commitment-${accepted.length}`, actorId: input.actorId }, created: true };
  });
  return {
    ...actual,
    acceptProposalWithReceipt: capture,
    acceptProposal: vi.fn(async (input: Record<string, any>) => (await capture(input)).stored),
  };
});
vi.mock("../../saas/tenantAccess", async importOriginal => ({
  ...(await importOriginal<typeof import("../../saas/tenantAccess")>()),
  resolveLegacyDayforgeMembership: vi.fn(async () => ({ role: "owner" })),
}));
vi.mock("../../agents/persistentOperator/identity", async importOriginal => ({
  ...(await importOriginal<typeof import("../../agents/persistentOperator/identity")>()),
  requireCanonicalOperatorIdentityForUser: vi.fn(async () => ({
    tenantId: "tenant-1c",
    canonicalOperatorId: "tenant:tenant-1c:operator:adam-open-id",
    canonicalOpenId: "adam-open-id",
    dayDirectorActorId: "1",
    dayDirectorActorIds: ["1"],
  })),
}));
vi.mock("../../agents/persistentOperator/observability", () => ({
  recordPersistentOperatorDiagnosticEvent: vi.fn(async () => undefined),
}));
vi.mock("../../goldlineCargo/cargoService", () => ({
  proposeCargo: vi.fn(async () => ({ matchState: "none", matchedOrderId: null, customerDisplayName: "Mei", quantity: 1 })),
  confirmCargo: vi.fn(async () => ({ id: 77, kind: "field" })),
  deliverCustodyToCustomer: vi.fn(),
}));
const strategic = vi.hoisted(() => ({ proposal: null as any, responses: [] as any[] }));
vi.mock("../../strategy/strategicStore", () => ({
  loadStrategicProposal: vi.fn(async () => strategic.proposal),
  strategicResponses: vi.fn(async () => strategic.responses),
  recordStrategicResponse: vi.fn(async (r: unknown) => {
    strategic.responses = [r];
    return r;
  }),
  persistStrategicProposal: vi.fn(),
}));
const towerWars = vi.hoisted(() => ({ inserted: [] as unknown[], promise: null as any }));
vi.mock("../../db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (towerWars.promise ? [towerWars.promise] : []) }) }),
    }),
    insert: () => ({
      values: (row: unknown) => {
        towerWars.inserted.push(row);
        return { onDuplicateKeyUpdate: async () => undefined };
      },
    }),
  })),
}));

const { dayDirectorRouter } = await import("./dayDirectorRouter");
const { activateTowerWarsPromise } = await import("./towerWarsPromiseService");
const { respondToStrategicProposal } = await import("../../strategy/strategicApproval");
const { commitWeeklyPlan } = await import("../../claire/weeklyMission/commit");
const { newWeeklySession } = await import("../../claire/weeklyMission/session");
const { createMemoryConversationStateStore, setClaireConversationStateStoreForTests } = await import(
  "../../claire/turn/conversationStateStore"
);
const { acceptSalesInsightChallenge } = await import("../../claire/proactive/growthChallenge");
const { commitAccountFollowUp } = await import("../../claire/knowledge/accountActions");
const { commitBriefing } = await import("../../claire/briefing/briefingCommit");
const { confirmLinkedVehicleWork } = await import("../../claire/workdayCargoOrchestrator");
const { projectRecurrenceForDate, recurrenceIdempotencyKey } = await import("../../claire/workdayRecurrenceService");
const { executeOperatorMissionCommand } = await import("../../claire/operatorMissionCommand");
const { handleVoiceCommitmentTurn } = await import("../../claire/voiceCommitmentLoop");

const operatorProof = (surface: string, sourceRef: string | RegExp, operatorUserId = "adam-open-id") => ({
  kind: "operator_instruction",
  operatorUserId,
  surface,
  sourceRef: typeof sourceRef === "string" ? sourceRef : expect.stringMatching(sourceRef),
});

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

beforeEach(() => {
  accepted.length = 0;
  towerWars.inserted.length = 0;
  towerWars.promise = null;
});

describe("Day Line writers pass the operator's proof", () => {
  it("Day Line UI accept: authenticated operator instruction from the session user", async () => {
    const caller = dayDirectorRouter.createCaller({
      tenantId: "tenant-1c",
      user: { id: 1, openId: "adam-open-id", role: "admin" },
    } as never);
    await caller.accept({ businessDate: "2026-10-19", proposal: proposal() });
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.admission).toEqual(operatorProof("day_line_ui", "day_director.accept:commitment:abc"));
  });

  it("strategic approval: the exact approval lineage, never an operator claim", async () => {
    strategic.proposal = {
      id: "proposal-1",
      revision: "r".repeat(64),
      tenantId: "tenant-1c",
      canonicalOperatorId: "tenant:tenant-1c:operator:adam-open-id",
      weekStart: "2026-10-19",
      timeZone: "America/Los_Angeles",
      expiresAt: "2026-10-30T00:00:00Z",
      items: [{ id: "item-1", businessDate: "2026-10-21", title: "Visit The Louise", objective: "Book a tour", candidateId: "cand-1", executionType: "mission" }],
    };
    strategic.responses = [];
    await respondToStrategicProposal({
      identity: {
        tenantId: "tenant-1c",
        canonicalOperatorId: "tenant:tenant-1c:operator:adam-open-id",
        canonicalOpenId: "adam-open-id",
        dayDirectorActorId: "1",
        dayDirectorActorIds: ["1"],
        membership: { source: "owner", canonical: "owner" },
      } as never,
      proposalId: "proposal-1",
      revision: "r".repeat(64),
      action: "approve",
      itemIds: ["item-1"],
      source: "authenticated_app",
      now: new Date("2026-10-19T16:00:00Z"),
    });
    expect(accepted).toHaveLength(1);
    const lineage = accepted[0]!.proposal.strategicApproval;
    expect(lineage).toMatchObject({ proposalId: "proposal-1", itemId: "item-1", approvedByUserId: "adam-open-id" });
    expect(accepted[0]!.admission).toEqual({ kind: "strategic_approval", ...lineage });
  });

  it("weekly lock: the operator who locked the week", async () => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
    const session = newWeeklySession({
      tenantId: "tenant-1c",
      operatorId: "adam-open-id",
      dayDirectorActorId: "1",
      weekStart: "2026-10-19",
      draft: {
        weekStart: "2026-10-19",
        days: [{
          businessDate: "2026-10-20",
          weekday: "Tuesday",
          disposition: "primary",
          primary: { text: "Visit The Louise", source: "operator_stated", existingCommitmentId: null },
          fixedConstraints: [],
          readinessRequirements: [],
          uncertainty: null,
        }],
      } as never,
    });
    session.phase = "awaiting_confirmation";
    let intent: unknown = null;
    await commitWeeklyPlan({ session }, {
      acceptProposal: async input => {
        accepted.push(input as never);
        return { stored: { id: "c-1", actorId: "1" }, created: true } as never;
      },
      designatePrimary: async input => ({ commitmentId: input.commitmentId }),
      readCommitment: async () => ({ id: "c-1", tenantId: "tenant-1c", actorId: "1", businessDate: "2026-10-20", title: "Visit The Louise", status: "open" }) as never,
      saveIntent: async (next: unknown) => { intent = next; },
      latestIntent: async () => intent as never,
    } as never);
    setClaireConversationStateStoreForTests(null);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.admission).toEqual(operatorProof("claire_turn", "weekly_lock:2026-10-19"));
  });

  it("growth challenge: the operator who said yes", async () => {
    const artifact = {
      observationReference: "obs-1",
      recommendedChallenge: {
        status: "proposal_only", requiresOperatorApproval: true, sourceObservationReference: "obs-1",
        title: "Diagnose churn", why: "Revenue down", completionCondition: "Review logs",
      },
    } as never;
    await acceptSalesInsightChallenge({
      tenantId: "tenant-1c", actorId: "1", operatorUserId: "adam-open-id",
      businessDate: "2026-10-19", artifact, operatorUtterance: "yes, add it",
    }, {
      loadInsight: async () => artifact,
      accept: async input => {
        accepted.push(input as never);
        throw new Error("captured");
      },
      readCommitment: async () => null,
    }).catch(() => undefined);
    expect(accepted[0]!.admission).toEqual(operatorProof("claire_turn", "sales-insight-challenge:obs-1"));
  });

  it("growth challenge without an operator id is refused at the boundary", async () => {
    const { assertDayLineAdmission } = await import("./dayLineAdmission");
    const artifact = {
      observationReference: "obs-1",
      recommendedChallenge: {
        status: "proposal_only", requiresOperatorApproval: true, sourceObservationReference: "obs-1",
        title: "Diagnose churn", why: "Revenue down", completionCondition: "Review logs",
      },
    } as never;
    await expect(acceptSalesInsightChallenge({
      tenantId: "tenant-1c", actorId: "1", operatorUserId: undefined as never,
      businessDate: "2026-10-19", artifact, operatorUtterance: "yes",
    }, {
      loadInsight: async () => artifact,
      accept: (async (input: any) => {
        await assertDayLineAdmission({ tenantId: input.tenantId, actorIds: [input.actorId], businessDate: input.businessDate, proposal: input.proposal, admission: input.admission });
        return { stored: { id: "x" }, created: true };
      }) as never,
      readCommitment: async () => null,
    })).rejects.toThrow(/Day Line write refused: the operator instruction has no operator user id/);
  });

  it("account follow-up: the operator who confirmed it", async () => {
    await commitAccountFollowUp(
      { accountId: 4, accountName: "The Louise", pipelineId: null, followUpId: null, previousDueAt: null, dueDate: "2026-10-23", note: "Dana back Thursday", requestId: "req-9" },
      { tenantId: "tenant-1c", operatorUserId: "adam-open-id", dayDirectorActorId: "1", timeZone: "America/Los_Angeles" }
    );
    expect(accepted[0]!.admission).toEqual(operatorProof("claire_turn", "account-follow-up:req-9"));
  });

  it("confirmed briefing (and its vehicle-cargo work): the briefing operator", async () => {
    const item = {
      kind: "new_work" as const, title: "Drop off the dry cleaning in the car", quote: "drop off the dry cleaning in the car at The Louise",
      businessDate: "2026-10-19", timing: { kind: "none" as const }, quantity: null, people: [], place: "The Louise",
      needs: null, existing: null,
    };
    const linked: Array<Record<string, unknown>> = [];
    await commitBriefing(
      { items: [item, { ...item, title: "Email the quote", quote: "email the quote", place: null }], context: [], questions: [], unparsed: [], source: "model" },
      { tenantId: "tenant-1c", dayDirectorActorId: "1", operatorUserId: "adam-open-id", conversationKey: "conv-1", vehicleId: "adam-open-id" },
      {
        linkVehicleWork: async input => {
          linked.push(input);
          return { cargo: { ok: false, error: "x" }, dayLine: { ok: false, error: "" }, receipts: [] };
        },
      }
    );
    expect(linked[0]!.admission).toEqual(operatorProof("claire_turn", "briefing:conv-1"));
    expect(accepted.map(input => input.admission)).toEqual([
      operatorProof("claire_turn", "briefing:conv-1"),
      operatorProof("claire_turn", "briefing:conv-1"),
    ]);
  });

  it("vehicle cargo work passes the confirming instruction through", async () => {
    const admission = { kind: "operator_instruction", operatorUserId: "adam-open-id", surface: "claire_turn", sourceRef: "briefing:conv-2" } as const;
    await confirmLinkedVehicleWork({
      tenantId: "tenant-1c", actorId: "1", vehicleId: "v", businessDate: "2026-10-19", requestId: "r-1",
      transcript: "dry cleaning for someone at The Louise", place: "The Louise", confirmed: true, admission,
    });
    expect(accepted[0]!.admission).toEqual(admission);
  });

  it("recurrence projection: the operator-confirmed rule, re-checked at the boundary", async () => {
    const rule = { id: "rule-1", tenantId: "tenant-1c", actorId: "1", sourceIdentity: "s", title: "Restock", kind: "prep", weekday: "monday", windowStart: null, windowEnd: null, sourceText: "restock every monday", status: "active" } as const;
    await projectRecurrenceForDate(
      { tenantId: "tenant-1c", actorId: "1", businessDate: "2026-10-19" },
      { listRules: async () => [rule] }
    );
    expect(accepted[0]!.admission).toEqual({ kind: "operator_recurrence_rule", ruleId: "rule-1" });
    expect(accepted[0]!.proposal.promptKey).toBe(recurrenceIdempotencyKey("rule-1", "2026-10-19"));
    expect(accepted[0]!.proposal.command.recurrenceRuleId).toBe("rule-1");
  });

  it("operator mission command: the operator's spoken command", async () => {
    await executeOperatorMissionCommand(
      {
        tenantId: "tenant-1c", operatorUserId: "adam-open-id", dayDirectorActorId: "1", businessDate: "2026-10-19",
        utterance: "Make publishing the Instagram ad my mission today.", sourceCommandRef: "voice:conv:turn:2",
      },
      {
        now: () => new Date("2026-10-19T17:00:00.000Z"),
        listToday: async () => [],
        latestIntent: async () => null,
        acceptProposal: (async (input: Record<string, any>) => {
          accepted.push(input);
          throw new Error("captured");
        }) as never,
        designatePrimary: async () => ({ commitmentId: "x" }),
      }
    );
    expect(accepted[0]!.admission).toEqual(operatorProof("claire_turn", "voice:conv:turn:2"));
  });

  it("voice confirmation: the operator who said yes, on both voice write paths", async () => {
    const state: Record<string, any> = { pendingProposal: proposal({ promptKey: "commitment:voice" }) };
    await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1c", actorId: "1", operatorUserId: "adam-open-id", businessDate: "2026-10-19", utterance: "yes", state: state as never, conversationId: "conv-3" },
      { accept: (async (input: Record<string, any>) => { accepted.push(input); return { id: "c-1" }; }) as never }
    ).catch(() => undefined);
    expect(accepted[0]!.admission).toEqual(operatorProof("claire_turn", "voice:conv-3:commitment:voice"));

    const field = { pendingFieldCapture: { rawUtterance: "visited the Louise", attestedFacts: ["Visited"], hearsay: [] } };
    await handleVoiceCommitmentTurn(
      { tenantId: "tenant-1c", actorId: "1", operatorUserId: "adam-open-id", businessDate: "2026-10-19", utterance: "yes", state: field as never, conversationId: "conv-3" },
      {
        propose: async () => proposal({ promptKey: "commitment:field" }),
        accept: (async (input: Record<string, any>) => { accepted.push(input); return { id: "c-2" }; }) as never,
      }
    ).catch(() => undefined);
    expect(accepted[1]!.admission).toEqual(operatorProof("claire_turn", "voice:conv-3:commitment:field"));
  });

  it("Tower Wars activation: refused without proof, admitted with the admin's instruction", async () => {
    towerWars.promise = {
      id: "11111111-1111-4111-8111-111111111111", tenantId: "tenant-1c", promiseType: "offer_insert", quantity: 3,
      sourceText: "Promised inserts", buildingId: "opus", sourceReference: "ref", permissionStatus: "recorded",
      permissionChannel: "sms", permissionEvidence: "consent screenshot",
    };
    await expect(
      activateTowerWarsPromise({ tenantId: "tenant-1c", promiseId: towerWars.promise.id, actorId: "1" } as never)
    ).rejects.toThrow(/Day Line write refused/);
    expect(towerWars.inserted).toEqual([]);

    const admission = { kind: "operator_instruction", operatorUserId: "1", surface: "tower_wars_ui", sourceRef: "tower_wars.activate_promise:x" } as const;
    await activateTowerWarsPromise({ tenantId: "tenant-1c", promiseId: towerWars.promise.id, actorId: "1", admission });
    expect(towerWars.inserted).toHaveLength(1);
    expect((towerWars.inserted[0] as { metadataJson: Record<string, unknown> }).metadataJson.dayLineAdmission).toEqual(admission);
  });
});
