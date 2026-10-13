import { afterEach, beforeEach, expect, it, vi } from "vitest";
const model = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../_core/llm", () => ({ invokeLLM: model.invoke }));
import { ENV } from "../_core/env";
import { reviewStrategicQuality } from "./strategicQualityReview";
import { assembleStrategicDiagnosis } from "./strategicDiagnosis";
import { defaultVerticalRegistry } from "./verticalTemplates/defaultRegistry";
import { strategicScenarios } from "./strategicStressScenarios";
const originalKey = ENV.anthropicApiKey;
const originalGate = process.env.CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED;
beforeEach(() => {
  ENV.anthropicApiKey = "controlled-provider-fixture";
  process.env.CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED = "1";
  model.invoke.mockReset();
});
afterEach(() => {
  ENV.anthropicApiKey = originalKey;
  if (originalGate == null)
    delete process.env.CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED;
  else process.env.CLAIRE_STRATEGY_QUALITY_REVIEW_ENABLED = originalGate;
});
const diagnosis = () =>
  assembleStrategicDiagnosis(
    structuredClone(strategicScenarios[0]!.input),
    defaultVerticalRegistry
  );
it("cannot certify an output with an invented evidence citation", async () => {
  model.invoke.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            judgment: "acceptable",
            reasons: ["Polished plan with 500% ROI"],
            evidenceIds: ["invented-market-proof"],
          }),
        },
      },
    ],
  });
  expect((await reviewStrategicQuality(diagnosis())).judgment).toBe(
    "unavailable"
  );
});
it("structural invalidity prevents a model from granting a pass", async () => {
  const d = diagnosis();
  d.actions[0]!.completionCondition = "";
  expect((await reviewStrategicQuality(d)).judgment).toBe("revise");
  expect(model.invoke).not.toHaveBeenCalled();
});
it("preserves a model veto without creating alternate work or new facts", async () => {
  const d = diagnosis();
  const before = structuredClone(d.actions);
  model.invoke.mockResolvedValue({
    choices: [
      {
        message: {
          content: JSON.stringify({
            judgment: "revise",
            reasons: ["The buyer alternative needs investigation"],
            evidenceIds: [d.supportingEvidence[0]],
          }),
        },
      },
    ],
  });
  expect((await reviewStrategicQuality(d)).judgment).toBe("revise");
  expect(d.actions).toEqual(before);
});
it("provider failure never counts as a strategic-quality pass", async () => {
  model.invoke.mockRejectedValue(new Error("controlled failure"));
  expect((await reviewStrategicQuality(diagnosis())).judgment).toBe(
    "unavailable"
  );
});
