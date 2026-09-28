import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionSalesBrief } from "../../shared/missionSalesBrief";
import type { ArmoryWeapon } from "../armory/armoryTypes";

const mocks = vi.hoisted(() => ({
  ensureBrief: vi.fn(),
  listWeapons: vi.fn(),
  classify: vi.fn(),
  invokeLLM: vi.fn(),
}));

vi.mock("./missionSalesBriefService", () => ({
  ensureCurrentMissionSalesBrief: mocks.ensureBrief,
}));
vi.mock("../armory/armoryWeaponService", () => ({
  listArmoryWeapons: mocks.listWeapons,
}));
vi.mock("../armory/armoryService", () => ({
  classifyObjectionArchetype: mocks.classify,
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

const trainerWeapon: ArmoryWeapon = {
  id: "framework:shelby-1",
  archetype: "GATEKEEPER",
  channel: "in_person",
  title: "Find the route",
  responseFamily: "route",
  spokenLine: "I am not trying to corner you; I just need the right route.",
  discoveryQuestion: "Who is the right person to speak with about this?",
  principle: "Make routing easy.",
  exampleLanguage: [],
  whenToUse: [],
  whenNotToUse: [],
  provenance: {
    type: "trainer_source",
    creator: "Shelby Sapp",
    creatorHandle: null,
    frameworkId: "11111111-1111-4111-8111-111111111111",
    frameworkName: "Find the route",
    sourceArtifactId: "shelby-source",
    sourceUrl: "https://example.com/source",
    sourceType: "youtube",
    transcriptStartMs: 0,
    transcriptEndMs: 1000,
    extractionVersion: "v1",
    extractionModel: "test",
    confidence: 0.9,
    independentSourceSupportCount: 0,
  },
  personalEvidence: null,
  fit: "high",
  fitReason: "fixture",
};

const foundationWeapon: ArmoryWeapon = {
  id: "foundation:ask-timing",
  archetype: "GATEKEEPER",
  channel: "in_person",
  title: "ASK FOR TIMING",
  responseFamily: "seek_callback_window",
  spokenLine: null,
  discoveryQuestion: "When is a better time to reach them?",
  principle: "A time is a real, recordable fact.",
  exampleLanguage: [],
  whenToUse: [],
  whenNotToUse: [],
  provenance: {
    type: "foundation",
    sourceReference: "armory:foundation:gatekeeper:ask-timing",
  },
  personalEvidence: null,
  fit: "low",
  fitReason: "fixture",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ensureBrief.mockResolvedValue(brief);
  mocks.classify.mockReturnValue("GATEKEEPER");
  mocks.listWeapons.mockResolvedValue({
    archetype: "GATEKEEPER",
    channel: "in_person",
    weapons: [trainerWeapon, foundationWeapon],
    trainerIntelligenceAvailable: true,
  });
  mocks.invokeLLM.mockRejectedValue(new Error("provider unavailable"));
});

describe("Claire pre-visit three", () => {
  it("reuses the authoritative Armory with mission, operator, archetype and in-person channel", async () => {
    await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(mocks.listWeapons).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
      archetype: "GATEKEEPER",
      channel: "in_person",
      limit: 3,
    });
  });

  it("returns exactly OPENING / PROBE / WEAPON while preserving Armory trainer provenance", async () => {
    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.accountName).toBe("Los Feliz Towers");
    expect(result?.items.map(item => item.slot)).toEqual([
      "OPENING",
      "PROBE",
      "WEAPON",
    ]);
    expect(result?.items).toHaveLength(3);
    expect(result?.items[1].provenance).toMatchObject({
      kind: "trainer_source",
      frameworkId: "11111111-1111-4111-8111-111111111111",
      creatorName: "Shelby Sapp",
    });
  });

  it("keeps foundation guidance explicitly separate from trainer provenance", async () => {
    mocks.listWeapons.mockResolvedValue({
      archetype: "GATEKEEPER",
      channel: "in_person",
      weapons: [foundationWeapon],
      trainerIntelligenceAvailable: false,
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[1].provenance.kind).toBe("foundation");
    expect(result?.items[1].provenance.creatorName).toBeNull();
  });

  it("fails soft to source-faithful lines when model adaptation is unavailable", async () => {
    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[0].line).toBe(
      "I have one quick question about resident laundry."
    );
    expect(result?.items[1].line).toBe(
      "Who is the right person to speak with about this?"
    );
    expect(result?.items[2].line).toBe(
      "A time is a real, recordable fact."
    );
  });

  it("rejects novel factual vocabulary even when it avoids the narrow risky-phrase patterns", async () => {
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                slot: "OPENING",
                line: "Residents complain about missed pickups.",
              },
              {
                slot: "PROBE",
                line: "Who is the right person to speak with about this?",
              },
              {
                slot: "WEAPON",
                line: "A time is a real, recordable fact.",
              },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[0].line).toBe(
      "I have one quick question about resident laundry."
    );
    expect(result?.items[0].line).not.toMatch(/complain|missed pickups/i);
  });

  it("rejects unsupported short factual words instead of filtering them out", async () => {
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                slot: "OPENING",
                line: "They own a gym and spa.",
              },
              {
                slot: "PROBE",
                line: "Who is the right person to speak with about this?",
              },
              {
                slot: "WEAPON",
                line: "A time is a real, recordable fact.",
              },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[0].line).toBe(
      "I have one quick question about resident laundry."
    );
    expect(result?.items[0].line).not.toMatch(/gym|spa/i);
  });

  it("rejects an adaptation that reverses a grounded negated fact", async () => {
    mocks.ensureBrief.mockResolvedValue({
      ...brief,
      knownFacts: [
        {
          text: "The property does not have a laundry contract.",
          sourceReference: "fixture",
        },
      ],
    });
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                slot: "OPENING",
                line: "The property has a laundry contract.",
              },
              {
                slot: "PROBE",
                line: "Who is the right person to speak with about this?",
              },
              {
                slot: "WEAPON",
                line: "A time is a real, recordable fact.",
              },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[0].line).toBe(
      "I have one quick question about resident laundry."
    );
  });

  it("does not promote an Armory source question into a building fact", async () => {
    mocks.listWeapons.mockResolvedValue({
      archetype: "GATEKEEPER",
      channel: "in_person",
      weapons: [
        {
          ...trainerWeapon,
          discoveryQuestion: "Does your building have a rooftop pool?",
        },
        foundationWeapon,
      ],
      trainerIntelligenceAvailable: true,
    });
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                slot: "OPENING",
                line: "I have one quick question about resident laundry.",
              },
              {
                slot: "PROBE",
                line: "Your building has a rooftop pool.",
              },
              {
                slot: "WEAPON",
                line: "A time is a real, recordable fact.",
              },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[1].line).toBe(
      "Does your building have a rooftop pool?"
    );
  });

  it("keeps unknown property attributes as questions instead of promoting them to facts", async () => {
    mocks.ensureBrief.mockResolvedValue({
      ...brief,
      unknowns: [
        ...brief.unknowns,
        {
          question: "Does your building have a rooftop pool?",
          reason: "No amenity record exists.",
        },
      ],
    });
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                slot: "OPENING",
                line: "Your building has a rooftop pool.",
              },
              {
                slot: "PROBE",
                line: "Who is the right person to speak with about this?",
              },
              {
                slot: "WEAPON",
                line: "A time is a real, recordable fact.",
              },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[0].line).toBe(
      "I have one quick question about resident laundry."
    );
    expect(result?.items[0].line).not.toMatch(/rooftop pool/i);
  });

  it("rejects a complete invented property claim even if generic property words are grounded", async () => {
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                slot: "OPENING",
                line: "Your building has a rooftop pool.",
              },
              {
                slot: "PROBE",
                line: "Who is the right person to speak with about this?",
              },
              {
                slot: "WEAPON",
                line: "A time is a real, recordable fact.",
              },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[0].line).toBe(
      "I have one quick question about resident laundry."
    );
    expect(result?.items[0].line).not.toMatch(/rooftop pool/i);
  });

  it("rejects a schema-valid adaptation that invents unsupported building facts", async () => {
    mocks.invokeLLM.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            items: [
              {
                slot: "OPENING",
                line: "Since your current provider misses pickups, I can solve that.",
              },
              {
                slot: "PROBE",
                line: "Who is the right person to speak with about this?",
              },
              {
                slot: "WEAPON",
                line: "A time is a real, recordable fact.",
              },
            ],
          }),
        },
      }],
    });

    const result = await getClairePreVisitIntel({
      tenantId: "tenant-1",
      actorId: "operator-1",
      missionId: 15,
    });

    expect(result?.items[0].line).toBe(
      "I have one quick question about resident laundry."
    );
    expect(result?.items[0].line).not.toMatch(/misses pickups/i);
  });
});
