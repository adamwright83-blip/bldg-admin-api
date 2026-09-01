import { afterEach, describe, expect, it } from "vitest";
import {
  assertProofModeAllowed,
  goldlineProofModeEnabled,
} from "../_core/proofMode";
import {
  DeterministicTestTowerImageProvider,
  defaultTowerImageProvider,
} from "../worldForge/towerImageProvider";
import { extractFieldJournalDeterministically } from "./deterministicJournalExtraction";

const original = {
  nodeEnv: process.env.NODE_ENV,
  proof: process.env.GOLDLINE_PROOF_MODE,
  openai: process.env.OPENAI_API_KEY,
};

afterEach(() => {
  process.env.NODE_ENV = original.nodeEnv;
  if (original.proof === undefined) delete process.env.GOLDLINE_PROOF_MODE;
  else process.env.GOLDLINE_PROOF_MODE = original.proof;
  if (original.openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = original.openai;
});

describe("proof mode cannot reach production", () => {
  it("stays off in production even when the variable is set", () => {
    process.env.NODE_ENV = "production";
    process.env.GOLDLINE_PROOF_MODE = "1";
    expect(goldlineProofModeEnabled()).toBe(false);
    expect(() => assertProofModeAllowed("Fixture")).toThrow(/cannot run in production/);
  });

  it("stays off in development unless it is asked for by name", () => {
    process.env.NODE_ENV = "development";
    delete process.env.GOLDLINE_PROOF_MODE;
    expect(goldlineProofModeEnabled()).toBe(false);
    process.env.GOLDLINE_PROOF_MODE = "1";
    expect(goldlineProofModeEnabled()).toBe(true);
  });

  it("never hands production the deterministic tower image adapter", () => {
    process.env.NODE_ENV = "production";
    process.env.GOLDLINE_PROOF_MODE = "1";
    delete process.env.OPENAI_API_KEY;
    // Unconfigured is the truthful production answer; a fixture image is not.
    expect(defaultTowerImageProvider().key).toBe("unconfigured");
    expect(defaultTowerImageProvider().configured()).toBe(false);
  });

  it("uses the deterministic adapter only in an explicit proof run", () => {
    process.env.NODE_ENV = "ci";
    delete process.env.OPENAI_API_KEY;
    delete process.env.GOLDLINE_PROOF_MODE;
    expect(defaultTowerImageProvider().key).toBe("unconfigured");
    process.env.GOLDLINE_PROOF_MODE = "1";
    expect(defaultTowerImageProvider().key).toBe("deterministic_test_only");
  });

  it("labels its bytes so fixture art can never pass as real art", async () => {
    const generated = await new DeterministicTestTowerImageProvider().generate({
      physicalEntityId: "building-1",
      prompt: "p",
      promptVersion: "v1",
      sourceEvidenceIds: [],
    });
    expect(generated.bytes.toString()).toContain("GOLDLINE_TEST_ONLY_IMAGE");
    expect(generated.provider).toBe("deterministic_test_only");
  });

  it("refuses deterministic extraction outside a proof run", () => {
    process.env.NODE_ENV = "production";
    process.env.GOLDLINE_PROOF_MODE = "1";
    expect(() =>
      extractFieldJournalDeterministically("Visited The Louise at 1450 S La Cienega Blvd today.")
    ).toThrow(/cannot run in production/);
  });
});

describe("deterministic extraction refuses to invent", () => {
  const run = (transcript: string) => {
    process.env.NODE_ENV = "ci";
    process.env.GOLDLINE_PROOF_MODE = "1";
    return extractFieldJournalDeterministically(transcript);
  };

  it("reads the property and address the transcript actually contains", () => {
    const result = run(
      "Visited The Louise at 1450 S La Cienega Blvd this morning, nice courtyard and brick facade."
    );
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.propertyName?.value).toBe("The Louise");
    expect(result.entities[0]!.addressClue?.value).toBe("1450 S La Cienega Blvd");
    expect(result.entities[0]!.amenities.map(item => item.value)).toContain("courtyard");
  });

  it("separates what the driver saw from what they are repeating", () => {
    const entity = run(
      "Visited The Louise at 1450 S La Cienega Blvd today, nice courtyard and brick facade."
    ).entities[0]!;
    // A name is a claim being repeated; a courtyard is something they stood in.
    expect(entity.propertyName?.provenance).toBe("operator_reported");
    expect(entity.addressClue?.provenance).toBe("operator_reported");
    expect(entity.amenities[0]?.provenance).toBe("operator_observed");
    expect(entity.architecture[0]?.provenance).toBe("operator_observed");
    // Never confident, always traceable to the words that produced it.
    expect(entity.propertyName?.confidence).toBe("low");
    expect(entity.amenities[0]?.confidence).toBe("low");
    expect(entity.propertyName?.transcriptExcerpt).toBeTruthy();
  });

  it("produces no entity when the transcript names no place", () => {
    // Silence is the correct answer; a generated key would be a fabrication.
    expect(run("Long day on the road, traffic was heavy the whole way.").entities).toEqual([]);
  });

  it("never reports an outcome", () => {
    // Wins, losses and interest are exactly what a stand-in must not claim.
    const result = run(
      "Visited The Louise at 1450 S La Cienega Blvd, the manager said yes and we won the account."
    );
    expect(result.outcomes).toEqual([]);
  });

  it("gives the same transcript the same client key every time", () => {
    const first = run("Visited The Louise at 1450 S La Cienega Blvd today.");
    const second = run("Visited The Louise at 1450 S La Cienega Blvd today.");
    expect(second.entities[0]!.clientEntityKey).toBe(first.entities[0]!.clientEntityKey);
  });
});
