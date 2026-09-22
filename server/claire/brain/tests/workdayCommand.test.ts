import { describe, expect, it } from "vitest";
import { retrieveBusinessEvidence, type BusinessMemoryDeps } from "../businessMemory/adapter";
import { planRetrievalPassA, planRetrievalPassB } from "../executive/retrievalPlan";
import { perceiveTurn } from "../perception/perceive";
import { snapshotWorkingMemory } from "../workingMemory/snapshot";
import { planAttention } from "../executive/attention";
import { activeTaskSets, classifyChange, gateWorkingMemory } from "../executive/workingMemoryGate";
import { runClaireBrainTurn } from "../shadow/runClaireBrainTurn";
import { liveExecutiveDeps, type ShadowRetrievalContext } from "../shadow/observeShadowTurn";
import { deriveDailyCommand, readCommandMetadata } from "../../../../shared/claireWorkdayCommand";

const NOW = "2026-09-21T16:00:00.000Z";
const CTX = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  dayDirectorActorId: "1",
  nowIso: NOW,
  businessDate: "2026-09-21",
  timeZone: "America/Los_Angeles",
};

const command = deriveDailyCommand({
  businessDate: "2026-09-21",
  actorId: "1",
  commitments: [
    {
      id: "zeely",
      title: "Finish Zeely ad",
      kind: "growth",
      status: "open",
      sourceText: "Monday's priority is Zeely",
      detailState: "COMPLETE",
      scheduleKind: null,
      scheduleLabel: null,
      command: readCommandMetadata({ command: { role: "primary" } }),
    },
  ],
  route: [],
  cargo: [],
  campaign: null,
  followUps: [],
});

function deps(over: Partial<BusinessMemoryDeps> = {}): BusinessMemoryDeps {
  return {
    runQuery: async () => ({}) as never,
    listAccounts: async () => [],
    listContacts: async () => [],
    loadHistory: async () =>
      ({
        account: { id: 1, name: "x" },
        missions: [],
        events: [],
        fieldVisits: [],
        outcomes: [],
        followUps: [],
        pipelineStage: null,
        pipelineId: null,
        contacts: [],
        dayLineMentions: [],
        conversationMentions: [],
      }) as never,
    loadOpenOrders: async () => [],
    loadOperations: async () => ({ businessDate: "2026-09-21", open: [], completed: [], routeAvailable: true }),
    loadDailyCommand: async () => command,
    verifyClaim: async () => ({}) as never,
    ...over,
  };
}

const shadowCtx: ShadowRetrievalContext = {
  tenantId: "default",
  operatorUserId: "adam-admin",
  conversationId: "shadow-command",
  dayDirectorActorId: "1",
  businessDate: "2026-09-21",
  timeZone: "America/Los_Angeles",
  surface: "voice",
  priorClaimReceipts: [],
};

function attentionFor(perceived: ReturnType<typeof perceiveTurn>, memory: ReturnType<typeof snapshotWorkingMemory>) {
  const change = classifyChange(perceived, memory);
  const taskSets = activeTaskSets(perceived, memory, Date.now());
  const rulings = gateWorkingMemory({ perceived, memory, change, taskSets });
  return planAttention({ perceived, memory, change, taskSets, rulings });
}

describe("Brain V2 Daily Command shadow retrieval", () => {
  it("retrieves Daily Command evidence read-only", async () => {
    const items = await retrieveBusinessEvidence({ compartment: "businessMemory", kind: "workday_command" }, CTX, deps());
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe("workday_command");
    expect(items[0]?.authoritativeFor).toContain("current_business_truth");
    const payload = items[0]?.payload as { command: typeof command };
    expect(payload.command.primary?.title).toBe("Finish Zeely ad");
  });

  it("plans Daily Command retrieval for an unscoped today question", () => {
    const perceived = perceiveTurn({ rawText: "What should I know about today?", completeness: "complete" });
    const memory = snapshotWorkingMemory({}, { conversationKey: "c1", tenantId: "default", operatorUserId: "u1", surface: "voice" });
    const attention = attentionFor(perceived, memory);
    const requests = planRetrievalPassA(perceived, memory, attention);
    expect(requests.some(request => request.kind === "workday_command")).toBe(true);
  });

  it("does not dump Daily Command into a scoped Dana question", () => {
    const perceived = perceiveTurn({ rawText: "What should I do about Dana?", completeness: "complete" });
    const memory = snapshotWorkingMemory({}, { conversationKey: "c1", tenantId: "default", operatorUserId: "u1", surface: "voice" });
    const attention = attentionFor(perceived, memory);
    const requests = planRetrievalPassA(perceived, memory, attention);
    expect(requests.some(request => request.kind === "workday_command")).toBe(false);
  });

  it("does not ask retrieval pass B to load Daily Command", () => {
    const perceived = perceiveTurn({ rawText: "What should I know about today?", completeness: "complete" });
    const memory = snapshotWorkingMemory({}, { conversationKey: "c1", tenantId: "default", operatorUserId: "u1", surface: "voice" });
    const attention = attentionFor(perceived, memory);
    const passB = planRetrievalPassB({
      perceived,
      memory,
      attention,
      scope: { accountIds: [], terms: [], ambiguous: false },
    });
    expect(passB.some(request => "kind" in request && request.kind === "workday_command")).toBe(false);
  });

  it("constructs a shadow judgment with zero live mutations", async () => {
    const result = await runClaireBrainTurn({
      conversationKey: "shadow-command",
      tenantId: "default",
      operatorUserId: "adam-admin",
      surface: "voice",
      rawText: "What should I know about today?",
      completeness: "complete",
      executive: liveExecutiveDeps(shadowCtx, { business: deps() }),
    });
    expect(result.productionAuthority).toBe(false);
    expect(result.mutations).toEqual([]);
    expect(result.decision.retrievals.some(request => request.kind === "workday_command")).toBe(true);
  });
});
