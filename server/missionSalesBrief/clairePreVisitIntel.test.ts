import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionSalesBrief } from "../../shared/missionSalesBrief";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";

const mocks = vi.hoisted(() => ({
  ensureBrief: vi.fn(),
  listEligible: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("./missionSalesBriefService", () => ({
  ensureCurrentMissionSalesBrief: mocks.ensureBrief,
}));
vi.mock("./salesIntelEligibility", () => ({
  listEligibleSalesIntel: mocks.listEligible,
}));
vi.mock("../_core/llm", () => ({
  invokeLLM: mocks.invokeLLM,
}));

import { getClairePreVisitIntel } from "./clairePreVisitIntel";

const brief = {
  id: 44,
  version: 3,
  tenantId: "tenant-1",
  missionId: 15,
  accountId: 9,
  generatedAt: "2026-09-27T20:00:00.000Z",
  generatedFromEvidenceThrough: "2026-09-27T19:59:00.000Z",
  account: {
    name: "Los Feliz Towers",
    address: "4455 Los Feliz Blvd, Los Angeles, CA 90027",
    accountType: "multifamily",
  },
  mission: {
    missionType: "multifamily",
    currentStatus: "phone_ready",
    objective: "Learn the approval path.",
  },
  knownFacts: [],
  priorInteractions: [],
  priorOutcomes: [],
  relevantSignals: [],
  unknowns: [
    {
      question: "Who owns vendor approval?",
      reason: "No decision maker is recorded.",
    },
  ],
  unresolvedQuestions: ["Who owns vendor approval?"],
  recommendedApproach: {
    primaryObjective: "Learn the approval path.",
    recommendedOpening: "I have one quick question about resident laundry.",
    questionsToAsk: ["Who handles resident amenity vendors?"],
    actionsToTake: [],
    thingsToAvoid: [],
    successDefinition: "Identify a concrete next step.",
  },
  salesIntel: {
    includedIntelIds: [],
    teachingId: null,
    frameworkId: null,
    rationale: null,
    considered: [],
    excluded: [],
  },
  provenance: {
    sourceReferences: [],
    verificationClasses: ["recommendation"],
  },
  source: "model",
  compilerVersion: "test",
  confidence: 0.75,
  warnings: [],
  createdBy: "system",
  supersedesVersion: 2,
} satisfies MissionSalesBrief;

function teaching(
  id: string,
  category: SalesIntelTeaching["category"],
  title: string,
  text: string
): SalesIntelTeaching {
  return {
    id,
    sourceArtifactId: "shelby-source",
    transcriptId: `transcript-${id}`,
    teachingKey: `key-${id}`,
    creatorName: "Shelby Sapp",
    creatorHandle: null,
    category,
    title,
    principle: text,
    whenToUse: [],
    whenNotToUse: [],
    exampleLanguage: [{ kind: "paraphrased_principle", text }],
    confidence: 0.9,
    extractionVersion: "v1",
    extractionProvider: "anthropic",
    extractionModel: "test",
    promptVersion: "test",
    transcriptStartMs: 0,
    transcriptEndMs: 1000,
    reviewState: "accepted",
    reviewedBy: "admin",
    reviewedAt: "2026-09-27T00:00:00.000Z",
    version: 1,
    active: true,
    supersededAt: null,
    createdAt: "2026-09-27T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureBrief.mockResolvedValue(brief);
  mocks.listEligible.mockResolvedValue([
    teaching("opening-1", "opening", "Permission opener", "Ask permission before pitching."),
    teaching("probe-1", "discovery", "Find the gap", "Ask where the current process creates extra work."),
    teaching("weapon-1", "objection_handling", "Do not attack the incumbent", "Diagnose the gap before challenging an existing provider."),
  ]);
});

describe("Claire pre-visit three", () => {
  it("turns three reviewed Shelby teachings into OPENING / PROBE / WEAPON for the exact mission", async () => {
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              { slot: "OPENING", line: "Could I ask one quick question before I explain anything?", why: "Earn permission first." },
              { slot: "PROBE", line: "Where does laundry still create extra work for your team or residents?", why: "Find a real gap before pitching." },
              { slot: "WEAPON", line: "If you already have a provider, I am not asking you to replace them today.", why: "Do not attack an incumbent." },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      missionId: 15,
    });

    expect(result?.accountName).toBe("Los Feliz Towers");
    expect(result?.items.map(item => item.slot)).toEqual([
      "OPENING",
      "PROBE",
      "WEAPON",
    ]);
    expect(result?.items.every(item => item.provenance.creatorName === "Shelby Sapp")).toBe(true);
    expect(result?.items.map(item => item.provenance.teachingId)).toEqual([
      "opening-1",
      "probe-1",
      "weapon-1",
    ]);

    const payload = JSON.parse(mocks.invokeLLM.mock.calls[0][0].messages[1].content);
    expect(payload.account.name).toBe("Los Feliz Towers");
    expect(payload.sourceMoves).toHaveLength(3);
    expect(payload.sourceMoves.every((item: any) => item.sourceKind === "reviewed_shelby_sapp_teaching")).toBe(true);
  });

  it("prefers Shelby teaching that overlaps the exact mission context", async () => {
    mocks.listEligible.mockResolvedValue([
      {
        ...teaching("generic-opening", "opening", "Smile first", "Open with energy."),
        confidence: 0.99,
      },
      {
        ...teaching(
          "approval-opening",
          "opening",
          "Approval path",
          "Ask about the vendor approval path before pitching."
        ),
        confidence: 0.7,
      },
      teaching("probe-1", "discovery", "Find the gap", "Ask where the current process creates extra work."),
      teaching("weapon-1", "objection_handling", "Do not attack the incumbent", "Diagnose the gap before challenging an existing provider."),
    ]);
    mocks.invokeLLM.mockRejectedValue(new Error("provider unavailable"));

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      missionId: 15,
    });

    expect(result?.items[0].provenance.teachingId).toBe("approval-opening");
  });

  it("fails soft to source-faithful lines when the model is unavailable", async () => {
    mocks.invokeLLM.mockRejectedValue(new Error("provider unavailable"));
    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      missionId: 15,
    });

    expect(result?.items).toHaveLength(3);
    expect(result?.items[0].line).toBe("Ask permission before pitching.");
    expect(result?.items[1].line).toBe("Ask where the current process creates extra work.");
    expect(result?.items[2].line).toBe("Diagnose the gap before challenging an existing provider.");
  });

  it("never labels mission-brief fallback copy as Shelby teaching", async () => {
    mocks.listEligible.mockResolvedValue([]);
    mocks.invokeLLM.mockRejectedValue(new Error("provider unavailable"));

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      missionId: 15,
    });

    expect(result?.items).toHaveLength(3);
    expect(result?.items.every(item => item.provenance.kind === "mission_brief")).toBe(true);
    expect(result?.items.every(item => item.provenance.creatorName === null)).toBe(true);
  });

  it("uses mission-brief fallback instead of stuffing an unrelated Shelby category into a slot", async () => {
    mocks.listEligible.mockResolvedValue([
      teaching(
        "closing-only",
        "closing",
        "Ask for the signature",
        "Ask directly for the signature once the buyer is ready."
      ),
    ]);
    mocks.invokeLLM.mockRejectedValue(new Error("provider unavailable"));

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      missionId: 15,
    });

    expect(result?.items[0].slot).toBe("OPENING");
    expect(result?.items[0].provenance.kind).toBe("mission_brief");
    expect(result?.items[0].line).toBe(
      "I have one quick question about resident laundry."
    );
    expect(result?.items[0].provenance.teachingId).toBeNull();
  });

  it("rejects a schema-valid compiled line that invents unsupported business facts", async () => {
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                slot: "OPENING",
                line: "Since your current provider misses pickups, I can solve that.",
                why: "Invented provider claim.",
              },
              {
                slot: "PROBE",
                line: "Who owns vendor approval?",
                why: "Find the approval path.",
              },
              {
                slot: "WEAPON",
                line: "Diagnose the gap before challenging an existing provider.",
                why: "Use reviewed trainer guidance.",
              },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      missionId: 15,
    });

    expect(result?.items[0].line).toBe("Ask permission before pitching.");
    expect(result?.items[0].line).not.toMatch(/misses pickups/i);
  });
});
