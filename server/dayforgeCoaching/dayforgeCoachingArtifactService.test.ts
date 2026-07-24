import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { DayforgeCoachingOutput } from "@shared/dayforgeCoaching";
import {
  createDayforgeCoachingArtifactService,
  dayforgeCoachingContextHash,
} from "./dayforgeCoachingArtifactService";
import type {
  DayforgeCoachingArtifact,
  DayforgeCoachingArtifactRepository,
  PersistDayforgeCoachingArtifactInput,
} from "./dayforgeCoachingArtifactTypes";
import { dayforgeCoachingArtifactCacheKey } from "./dayforgeCoachingArtifactTypes";
import {
  DayforgeCoachingPolicyError,
  buildDeterministicDayforgeCoachingFallback,
  groundDayforgeModelCoachingOutput,
  type DayforgeCoachingGroundingEvidence,
} from "./dayforgeCoachingPolicy";

const NOW = new Date("2026-07-23T18:00:00.000Z");

function reference(
  id: string,
  sourceType: DayforgeCoachingGroundingEvidence["reference"]["sourceType"] = "general_industry_guidance",
): DayforgeCoachingGroundingEvidence["reference"] {
  return {
    id,
    sourceType,
    capturedAt: "2026-07-20T10:00:00.000Z",
    sourceUrl: "https://evidence.example/hotel?token=secret#private",
    formulaVersion: null,
    formula: null,
    inputs: null,
  };
}

function directEvidence(): DayforgeCoachingGroundingEvidence[] {
  return [
    {
      claimKey: "recommended_role",
      displayValue: "Director of Rooms",
      reference: reference("guidance-role"),
    },
    {
      claimKey: "first_navigation_point",
      displayValue: "Ask security where Rooms leadership is located.",
      reference: reference("guidance-first-move"),
    },
    {
      claimKey: "fallback_navigation_point",
      displayValue: "Ask the concierge desk to route you to Rooms leadership.",
      reference: reference("guidance-fallback"),
    },
    {
      claimKey: "opening_line",
      displayValue: "Who oversees laundry and linen operations?",
      reference: reference("guidance-opening"),
    },
  ];
}

function modelOutput(extraClaims: Array<{
  key: DayforgeCoachingGroundingEvidence["claimKey"];
  displayValue: string;
  evidenceReferenceId: string | null;
}> = []): unknown {
  return {
    recommendedRole: "Director of Rooms",
    roleRationale: "Provider-authored rationale that must not be stored verbatim.",
    firstNavigationPoint: "Ask security where Rooms leadership is located.",
    fallbackNavigationPoint: "Ask the concierge desk to route you to Rooms leadership.",
    openingLine: "Who oversees laundry and linen operations?",
    discoveryQuestions: ["Provider-authored question?"],
    likelyObjectionCategories: ["Pricing", "Untrusted novel category"],
    doNotClaim: ["Provider-authored warning"],
    unknowns: ["Provider-authored unknown"],
    claims: [
      {
        key: "recommended_role",
        displayValue: "Director of Rooms",
        evidenceReferenceId: "guidance-role",
      },
      {
        key: "first_navigation_point",
        displayValue: "Ask security where Rooms leadership is located.",
        evidenceReferenceId: "guidance-first-move",
      },
      {
        key: "fallback_navigation_point",
        displayValue: "Ask the concierge desk to route you to Rooms leadership.",
        evidenceReferenceId: "guidance-fallback",
      },
      {
        key: "opening_line",
        displayValue: "Who oversees laundry and linen operations?",
        evidenceReferenceId: "guidance-opening",
      },
      ...extraClaims,
    ],
    generatedSummary: "Provider-authored summary that must not be stored verbatim.",
  };
}

function artifactFromDraft(
  draft: PersistDayforgeCoachingArtifactInput,
): DayforgeCoachingArtifact {
  return {
    id: randomUUID(),
    tenantId: draft.tenantId,
    missionId: draft.missionId,
    missionStepId: draft.missionStepId,
    scopeKey: draft.missionStepId === null ? "mission" : `step:${draft.missionStepId}`,
    accountId: draft.accountId,
    generationStatus: draft.generationStatus,
    provider: draft.provider,
    modelId: draft.modelId,
    promptVersion: draft.promptVersion,
    contextHash: draft.contextHash,
    cacheKey: null,
    requestId: draft.requestId,
    version: 1,
    generatedAt: draft.generatedAt.toISOString(),
    structuredOutput: draft.structuredOutput,
    evidenceReferences: draft.evidenceReferences,
    claims: draft.structuredOutput.claims,
    failureCode: draft.failureCode,
    fallbackCode: draft.fallbackCode,
    requestedBy: draft.requestedBy,
    supersededAt: null,
    active: true,
    latencyMs: draft.latencyMs,
    inputTokens: draft.inputTokens,
    outputTokens: draft.outputTokens,
    estimatedCostMicros: draft.estimatedCostMicros,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

describe("DayForge coaching grounding policy", () => {
  it("assigns provenance only from matching server evidence and strips URL secrets", () => {
    const evidence = directEvidence();
    evidence.push({
      claimKey: "decision_maker_name",
      displayValue: "Jane Smith",
      reference: reference("provider-contact", "provider_sourced"),
    });
    const prepared = groundDayforgeModelCoachingOutput({
      rawOutput: modelOutput([{
        key: "decision_maker_name",
        displayValue: "Jane Smith",
        evidenceReferenceId: "provider-contact",
      }]),
      evidence,
      generatedAt: NOW,
    });

    expect(prepared.generationStatus).toBe("generated");
    expect(prepared.structuredOutput.claims.find(claim => claim.key === "decision_maker_name"))
      .toMatchObject({
        provenance: "provider_sourced",
        evidenceReferenceId: "provider-contact",
        grounded: true,
        safeForDirectInstruction: true,
      });
    expect(prepared.evidenceReferences.find(item => item.id === "provider-contact")?.sourceUrl)
      .toBe("https://evidence.example/hotel");
  });

  it("does not persist provider prose or unsupported account-specific claims and paraphrases", () => {
    const raw = modelOutput([{
      key: "approved_offer",
      displayValue: "Guaranteed twenty-percent discount",
      evidenceReferenceId: null,
    }]) as Record<string, unknown>;
    raw.roleRationale = "Promise the account twenty percent off because it is approved.";
    raw.discoveryQuestions = ["Can Jane approve our twenty-percent discount?"];
    raw.generatedSummary = "Tell Jane the discount is guaranteed.";
    const prepared = groundDayforgeModelCoachingOutput({
      rawOutput: raw,
      evidence: directEvidence(),
      generatedAt: NOW,
    });
    const persisted = JSON.stringify(prepared.structuredOutput);

    expect(persisted).not.toContain("Jane");
    expect(persisted).not.toContain("twenty percent");
    expect(persisted).not.toContain("twenty-percent");
    expect(prepared.structuredOutput.claims.some(claim => claim.key === "approved_offer"))
      .toBe(false);
    expect(prepared.structuredOutput.unknowns).toContain("The account's approved offer is unconfirmed.");
  });

  it("rejects model attempts to set their own verified provenance", () => {
    const raw = modelOutput() as { claims: Array<Record<string, unknown>> };
    raw.claims[0].provenance = "provider_sourced";
    expect(() => groundDayforgeModelCoachingOutput({
      rawOutput: raw,
      evidence: directEvidence(),
      generatedAt: NOW,
    })).toThrowError(expect.objectContaining({ code: "invalid_structured_output" }));
  });

  it("requires formula provenance and retained inputs for deterministic estimates", () => {
    expect(() => groundDayforgeModelCoachingOutput({
      rawOutput: modelOutput(),
      evidence: [
        ...directEvidence(),
        {
          claimKey: "estimated_annual_value",
          displayValue: "$24,800",
          reference: reference("estimate", "deterministic_estimate"),
        },
      ],
      generatedAt: NOW,
    })).toThrowError(expect.objectContaining({ code: "invalid_evidence" }));
  });

  it("bounds the trusted evidence envelope", () => {
    const excessive = Array.from({ length: 51 }, (_, index) => ({
      claimKey: "account_type" as const,
      displayValue: `Type ${index}`,
      reference: reference(`account-type-${index}`, "provider_sourced"),
    }));
    expect(() => groundDayforgeModelCoachingOutput({
      rawOutput: modelOutput(),
      evidence: excessive,
      generatedAt: NOW,
    })).toThrowError(expect.objectContaining({ code: "invalid_evidence" }));
  });

  it("builds stable, honest fallback content without account PII", () => {
    const first = buildDeterministicDayforgeCoachingFallback({
      category: "luxury_full_service_hotel",
      fallbackCode: "provider_timeout",
      generatedAt: NOW,
    });
    const second = buildDeterministicDayforgeCoachingFallback({
      category: "luxury_full_service_hotel",
      fallbackCode: "provider_timeout",
      generatedAt: new Date("2026-07-24T18:00:00.000Z"),
    });

    const stableContent = (output: DayforgeCoachingOutput) => ({
      recommendedRole: output.recommendedRole,
      firstNavigationPoint: output.firstNavigationPoint,
      fallbackNavigationPoint: output.fallbackNavigationPoint,
      openingLine: output.openingLine,
      discoveryQuestions: output.discoveryQuestions,
    });
    expect(stableContent(first.structuredOutput)).toEqual(stableContent(second.structuredOutput));
    expect(first.structuredOutput.recommendedRole).toBe("Director of Rooms");
    expect(JSON.stringify(first.structuredOutput)).not.toMatch(/email|phone|resident name/i);
  });
});

describe("DayForge coaching artifact service", () => {
  it("stores an honest deterministic fallback for invalid model output", async () => {
    const drafts: PersistDayforgeCoachingArtifactInput[] = [];
    const repository: DayforgeCoachingArtifactRepository = {
      async findReusable() {
        return null;
      },
      async persist(draft) {
        drafts.push(draft);
        return artifactFromDraft(draft);
      },
    };
    const service = createDayforgeCoachingArtifactService({ repository, now: () => NOW });
    const artifact = await service.save({
      tenantId: "tenant-a",
      missionId: 10,
      missionStepId: 20,
      accountId: 30,
      requestId: randomUUID(),
      requestedBy: "operator-1",
      provider: "anthropic",
      modelId: "configured-sonnet",
      promptVersion: "hotel-coaching-v1",
      contextHash: "a".repeat(64),
      fallbackCategory: "luxury_full_service_hotel",
      providerResult: { kind: "output", rawOutput: { bad: true }, evidence: [] },
    });

    expect(artifact.generationStatus).toBe("fallback");
    expect(artifact.fallbackCode).toBe("invalid_structured_output");
    expect(artifact.provider).toBe("anthropic");
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).not.toHaveProperty("rawOutput");
    expect(drafts[0]).not.toHaveProperty("prompt");
  });

  it("falls back instead of blocking when evidence is invalid", async () => {
    const drafts: PersistDayforgeCoachingArtifactInput[] = [];
    const service = createDayforgeCoachingArtifactService({
      repository: {
        async findReusable() {
          return null;
        },
        async persist(draft) {
          drafts.push(draft);
          return artifactFromDraft(draft);
        },
      },
      now: () => NOW,
    });
    const duplicateEvidence = directEvidence();
    duplicateEvidence.push({
      claimKey: "current_vendor",
      displayValue: "Vendor A",
      reference: reference("guidance-role", "provider_sourced"),
    });
    const artifact = await service.save({
      tenantId: "tenant-a",
      missionId: 10,
      missionStepId: null,
      accountId: 30,
      requestId: randomUUID(),
      requestedBy: "operator-1",
      provider: "anthropic",
      modelId: "configured-sonnet",
      promptVersion: "coaching-v1",
      contextHash: "b".repeat(64),
      fallbackCategory: "other_local_service_business",
      providerResult: { kind: "output", rawOutput: modelOutput(), evidence: duplicateEvidence },
    });

    expect(artifact.generationStatus).toBe("fallback");
    expect(artifact.fallbackCode).toBe("invalid_evidence");
    expect(drafts).toHaveLength(1);
  });

  it("uses canonical key ordering for stable context hashes", () => {
    expect(dayforgeCoachingContextHash({ account: { id: 1, type: "hotel" }, known: true }))
      .toBe(dayforgeCoachingContextHash({ known: true, account: { type: "hotel", id: 1 } }));
    expect(dayforgeCoachingContextHash({ values: [1, 2] }))
      .not.toBe(dayforgeCoachingContextHash({ values: [2, 1] }));
  });

  it("uses a content cache key that is stable across artifact versions and changes by model", () => {
    const input = {
      tenantId: "tenant-a",
      missionId: 10,
      missionStepId: 20,
      accountId: 30,
      provider: "anthropic",
      modelId: "configured-sonnet",
      promptVersion: "coaching-v1",
      contextHash: "c".repeat(64),
    };
    expect(dayforgeCoachingArtifactCacheKey(input)).toBe(dayforgeCoachingArtifactCacheKey({ ...input }));
    expect(dayforgeCoachingArtifactCacheKey(input)).not.toBe(
      dayforgeCoachingArtifactCacheKey({ ...input, modelId: "next-model" }),
    );
  });

  it("exposes a pre-spend lookup and preserves the cached artifact", async () => {
    let lookedUp = 0;
    const cachedDraft: PersistDayforgeCoachingArtifactInput = {
      tenantId: "tenant-a",
      missionId: 10,
      missionStepId: 20,
      accountId: 30,
      requestId: randomUUID(),
      requestedBy: "operator-1",
      generationStatus: "generated",
      provider: "anthropic",
      modelId: "configured-sonnet",
      promptVersion: "coaching-v1",
      contextHash: "c".repeat(64),
      generatedAt: NOW,
      structuredOutput: buildDeterministicDayforgeCoachingFallback({
        category: "luxury_full_service_hotel",
        fallbackCode: "provider_timeout",
        generatedAt: NOW,
      }).structuredOutput,
      evidenceReferences: [],
      fallbackCode: null,
      failureCode: null,
      latencyMs: 10,
      inputTokens: 20,
      outputTokens: 30,
      estimatedCostMicros: 40,
    };
    const cached = artifactFromDraft(cachedDraft);
    const service = createDayforgeCoachingArtifactService({
      repository: {
        async findReusable(input) {
          lookedUp += 1;
          expect(input).toMatchObject({
            tenantId: "tenant-a",
            missionId: 10,
            missionStepId: 20,
            accountId: 30,
          });
          return cached;
        },
        async persist() {
          throw new Error("cache lookup must happen before persistence or provider spend");
        },
      },
    });

    await expect(service.findReusable({
      tenantId: "tenant-a",
      missionId: 10,
      missionStepId: 20,
      accountId: 30,
      provider: "anthropic",
      modelId: "configured-sonnet",
      promptVersion: "coaching-v1",
      contextHash: "c".repeat(64),
    })).resolves.toBe(cached);
    expect(lookedUp).toBe(1);
  });
});
