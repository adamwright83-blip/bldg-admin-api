import { describe, expect, it } from "vitest";
import {
  deriveDaphneIfThenSignature,
  deriveDaphnePersonDistribution,
} from "./personModel";

describe("Daphne V2 Person distributions and if/then signatures", () => {
  it("refuses to turn one context into a Person-level distribution", () => {
    expect(() =>
      deriveDaphnePersonDistribution({
        samples: [
          { observationId: "1", dimension: "response_directness", value: 0.9, contextKey: "execution", occurredAt: "2026-10-01T08:00:00Z" },
          { observationId: "2", dimension: "response_directness", value: 0.8, contextKey: "execution", occurredAt: "2026-10-02T08:00:00Z" },
          { observationId: "3", dimension: "response_directness", value: 0.7, contextKey: "execution", occurredAt: "2026-10-03T08:00:00Z" },
          { observationId: "4", dimension: "response_directness", value: 0.9, contextKey: "execution", occurredAt: "2026-10-04T08:00:00Z" },
        ],
      })
    ).toThrow(/at least two contexts/);
  });

  it("stores a distribution and observed range instead of a scalar trait label", () => {
    const value = deriveDaphnePersonDistribution({
      samples: [
        { observationId: "1", dimension: "response_directness", value: 0.9, contextKey: "execution", occurredAt: "2026-10-01T08:00:00Z" },
        { observationId: "2", dimension: "response_directness", value: 0.8, contextKey: "execution", occurredAt: "2026-10-02T08:00:00Z" },
        { observationId: "3", dimension: "response_directness", value: 0.3, contextKey: "planning", occurredAt: "2026-10-03T08:00:00Z" },
        { observationId: "4", dimension: "response_directness", value: 0.4, contextKey: "planning", occurredAt: "2026-10-04T08:00:00Z" },
      ],
    });
    expect(value.mean).toBe(0.6);
    expect(value.observedMin).toBe(0.3);
    expect(value.observedMax).toBe(0.9);
    expect(value.distinctContextCount).toBe(2);
  });

  it("keeps if/then signatures observational rather than causal", () => {
    const signature = deriveDaphneIfThenSignature({
      conditionKey: "taskMode",
      conditionValue: "execution",
      outcomeKey: "continued",
      samples: [
        { observationId: "1", conditionValue: "execution", outcome: true, occurredAt: "2026-10-01T08:00:00Z" },
        { observationId: "2", conditionValue: "execution", outcome: true, occurredAt: "2026-10-02T08:00:00Z" },
        { observationId: "3", conditionValue: "planning", outcome: false, occurredAt: "2026-10-03T08:00:00Z" },
        { observationId: "4", conditionValue: "planning", outcome: true, occurredAt: "2026-10-04T08:00:00Z" },
      ],
    });
    expect(signature.epistemicStatus).toBe("association_only");
    expect(signature.conditionRate).toBe(1);
    expect(signature.otherRate).toBe(0.5);
    expect(signature.difference).toBe(0.5);
  });

  it("does not allow clinical diagnoses as Person dimensions", () => {
    expect(() =>
      deriveDaphnePersonDistribution({
        samples: [
          { observationId: "1", dimension: "ADHD", value: 0.5, contextKey: "a", occurredAt: "2026-10-01T08:00:00Z" },
          { observationId: "2", dimension: "ADHD", value: 0.5, contextKey: "b", occurredAt: "2026-10-02T08:00:00Z" },
          { observationId: "3", dimension: "ADHD", value: 0.5, contextKey: "a", occurredAt: "2026-10-03T08:00:00Z" },
          { observationId: "4", dimension: "ADHD", value: 0.5, contextKey: "b", occurredAt: "2026-10-04T08:00:00Z" },
        ],
      })
    ).toThrow(/clinical diagnoses/);
  });
});
