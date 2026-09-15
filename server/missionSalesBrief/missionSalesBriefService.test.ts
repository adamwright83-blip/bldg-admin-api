import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionSalesBriefEvidence } from "./evidenceAssembler";

const mocks = vi.hoisted(() => ({
  assembleMissionSalesBriefEvidence: vi.fn(),
  listEligibleSalesIntel: vi.fn(),
  selectRelevantSalesIntel: vi.fn(),
  compileMissionSalesStrategy: vi.fn(),
}));

vi.mock("./evidenceAssembler", () => ({
  assembleMissionSalesBriefEvidence: mocks.assembleMissionSalesBriefEvidence,
}));
vi.mock("./salesIntelEligibility", () => ({
  listEligibleSalesIntel: mocks.listEligibleSalesIntel,
  selectRelevantSalesIntel: mocks.selectRelevantSalesIntel,
  selectSalesIntelWithAudit: (input: { eligible: unknown[]; situationText: string }) => ({
    selected: mocks.selectRelevantSalesIntel(input),
    considered: [],
    excluded: [],
  }),
}));
vi.mock("./strategyCompiler", () => ({
  compileMissionSalesStrategy: mocks.compileMissionSalesStrategy,
  STRATEGY_COMPILER_VERSION: "test-compiler-1",
}));

import {
  ensureCurrentMissionSalesBrief,
  getLatestMissionSalesBrief,
} from "./missionSalesBriefService";
import { toCompactMissionSalesBriefForClaire, toFieldMissionSalesBrief } from "../../shared/missionSalesBrief";
import { setMissionSalesBriefStoreForTesting } from "./store";
import { createInMemoryMissionSalesBriefStore } from "./testSupport/inMemoryMissionSalesBriefStore";

function baseEvidence(overrides: Partial<MissionSalesBriefEvidence> = {}): MissionSalesBriefEvidence {
  return {
    tenantId: "tenant-1",
    missionId: 1,
    accountId: 7,
    mission: {
      id: 1,
      status: "arrived",
      account: { name: "Sunset Gardens", address: "123 Main St", accountType: "multifamily" },
      opportunity: { primarySignal: "Management previously showed interest." },
      brief: { openingLine: "Hi Dana", discoveryQuestions: [] },
      updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    } as never,
    currentVisitOutcome: null,
    priorOutcomes: [],
    knownFacts: [
      {
        text: "Management previously showed interest.",
        provenance: "authoritative_evidence",
        sourceReference: "commercial_missions:1:opportunity",
      },
    ],
    evidenceThrough: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function strategyResult(objective: string) {
  return {
    recommendedApproach: {
      primaryObjective: objective,
      recommendedOpening: null,
      questionsToAsk: [],
      actionsToTake: [],
      thingsToAvoid: [],
      successDefinition: "done",
    },
    unknowns: [],
    source: "model" as const,
    confidence: 0.7,
  };
}

describe("MissionSalesBrief service — end to end (in-memory store)", () => {
  beforeEach(() => {
    setMissionSalesBriefStoreForTesting(createInMemoryMissionSalesBriefStore());
    mocks.listEligibleSalesIntel.mockResolvedValue([]);
    mocks.selectRelevantSalesIntel.mockReturnValue(null);
  });
  afterEach(() => {
    setMissionSalesBriefStoreForTesting(null);
    vi.clearAllMocks();
  });

  it("generates version 1 when no brief exists yet", async () => {
    mocks.assembleMissionSalesBriefEvidence.mockResolvedValue(baseEvidence());
    mocks.compileMissionSalesStrategy.mockResolvedValue(strategyResult("Learn the blocker."));

    const brief = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    expect(brief?.version).toBe(1);
    expect(brief?.supersedesVersion).toBeNull();
  });

  it("J — returns the same version untouched when evidence hasn't changed (immutability, not a silent rewrite)", async () => {
    mocks.assembleMissionSalesBriefEvidence.mockResolvedValue(baseEvidence());
    mocks.compileMissionSalesStrategy.mockResolvedValue(strategyResult("Learn the blocker."));
    const v1 = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });

    const v1Again = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    expect(v1Again).toEqual(v1);
    expect(mocks.compileMissionSalesStrategy).toHaveBeenCalledTimes(1); // never recompiled
  });

  it("K — new evidence (a confirmed outcome) produces a new version without rewriting the old one", async () => {
    mocks.assembleMissionSalesBriefEvidence.mockResolvedValueOnce(baseEvidence());
    mocks.compileMissionSalesStrategy.mockResolvedValueOnce(strategyResult("Learn the blocker."));
    const v1 = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });

    mocks.assembleMissionSalesBriefEvidence.mockResolvedValueOnce(
      baseEvidence({
        currentVisitOutcome: { outcome: "follow_up", notes: "Corporate must approve all vendors.", decisionMakerStatus: "met", followUpAt: null, recordedAt: "2026-01-02T00:00:00.000Z" },
        evidenceThrough: "2026-01-02T00:00:00.000Z",
      })
    );
    mocks.compileMissionSalesStrategy.mockResolvedValueOnce(
      strategyResult("Identify the corporate approval path and decision maker.")
    );
    const v2 = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });

    expect(v2?.version).toBe(2);
    expect(v2?.supersedesVersion).toBe(1);
    expect(v2?.recommendedApproach.primaryObjective).toMatch(/corporate approval/i);

    // v1 remains exactly as it was generated — history is not rewritten.
    const stillV1 = await getLatestMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    expect(stillV1?.version).toBe(2); // latest is v2...
    expect(v1?.recommendedApproach.primaryObjective).toMatch(/learn the blocker/i); // ...but v1's own object is untouched
  });

  it("Q — tenant isolation: tenant-2 never sees tenant-1's brief for the same missionId", async () => {
    mocks.assembleMissionSalesBriefEvidence.mockImplementation(async (input: { tenantId: string; missionId: number }) =>
      baseEvidence({ tenantId: input.tenantId })
    );
    mocks.compileMissionSalesStrategy.mockResolvedValue(strategyResult("Learn the blocker."));

    await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    const tenant2Brief = await getLatestMissionSalesBrief({ tenantId: "tenant-2", missionId: 1 });
    expect(tenant2Brief).toBeNull();
  });

  it("R — mission isolation: one mission never receives another mission's brief", async () => {
    mocks.assembleMissionSalesBriefEvidence.mockImplementation(async (input: { missionId: number }) =>
      baseEvidence({ missionId: input.missionId })
    );
    mocks.compileMissionSalesStrategy.mockResolvedValue(strategyResult("Learn the blocker."));

    await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    const otherMissionBrief = await getLatestMissionSalesBrief({ tenantId: "tenant-1", missionId: 2 });
    expect(otherMissionBrief).toBeNull();
  });

  it("A — Claire and FIELD BRIEF both derive from the exact same brief id/version", async () => {
    mocks.assembleMissionSalesBriefEvidence.mockResolvedValue(baseEvidence());
    mocks.compileMissionSalesStrategy.mockResolvedValue(strategyResult("Learn the blocker."));
    const brief = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 1 });
    expect(brief).not.toBeNull();
    const claireView = toCompactMissionSalesBriefForClaire(brief!);
    const fieldView = toFieldMissionSalesBrief(brief!);
    expect(claireView.briefId).toBe(fieldView.briefId);
    expect(claireView.version).toBe(fieldView.version);
    expect(claireView.primaryObjective).toBe(fieldView.primaryObjective);
  });

  it("P — a missing mission (evidence assembler returns null) never throws; returns the previous brief if any", async () => {
    mocks.assembleMissionSalesBriefEvidence.mockResolvedValue(null);
    const result = await ensureCurrentMissionSalesBrief({ tenantId: "tenant-1", missionId: 999 });
    expect(result).toBeNull();
  });
});
