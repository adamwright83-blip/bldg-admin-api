import { randomInt } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import {
  strategicScenarios,
  runStrategicScenario,
} from "../server/strategy/strategicStressScenarios";
const results = strategicScenarios.map(runStrategicScenario);
await mkdir("artifacts/claire-strategy", { recursive: true });
await writeFile(
  "artifacts/claire-strategy/stress-results.json",
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      fixtureOnly: true,
      strategicQualityCertified: false,
      humanReview: "pending",
      results,
    },
    null,
    2
  )
);
const key: Array<{ case: number; enhanced: "A" | "B" }> = [];
const review = results.map((r, i) => {
  const enhanced = {
    condition: r.diagnosis.currentCondition,
    diagnosis: r.diagnosis.diagnosis,
    recommendation: r.diagnosis.selectedApproach,
    alternatives: r.diagnosis.options.map(o => ({
      approach: o.approach,
      economics: o.economics,
      cost: o.cost,
      effort: o.effort,
      risk: o.risk,
    })),
    action: r.diagnosis.actions.map(a => ({
      title: a.title,
      completionCondition: a.completionCondition,
      leadingIndicator: a.leadingIndicator,
      reviewCondition: a.reviewCondition,
    })),
    uncertainty: r.diagnosis.uncertainty,
  };
  const baseline = {
    condition: null,
    diagnosis: null,
    recommendation: r.baseline.selected,
    alternatives: [],
    action: [
      {
        title: r.baseline.selected,
        completionCondition:
          "Visit three qualified prospects in person and record the response",
        leadingIndicator: null,
        reviewCondition: null,
      },
    ],
    uncertainty: [],
  };
  const first = randomInt(2) === 0;
  key.push({ case: i + 1, enhanced: first ? "A" : "B" });
  return {
    case: i + 1,
    knownFacts: strategicScenarios[i]!.facts,
    missing: strategicScenarios[i]!.missing,
    alternatives: [
      { label: "A", content: first ? enhanced : baseline },
      { label: "B", content: first ? baseline : enhanced },
    ],
    questions: [
      "Which identifies the defensible constraint?",
      "Are alternatives credible and economics honest?",
      "Would you approve the preparation?",
      "What disqualifying error remains?",
    ],
    rating: null,
  };
});
await writeFile(
  "artifacts/claire-strategy/blinded-review.json",
  JSON.stringify(review, null, 2)
);
await writeFile(
  "artifacts/claire-strategy/review-key.json",
  JSON.stringify(key, null, 2)
);
console.log(
  JSON.stringify(
    {
      scenarios: results.length,
      failures: results
        .filter(r => r.failures.length)
        .map(r => ({ id: r.id, failures: r.failures })),
      humanReview: "pending",
      productionProof: "not established by fixture evaluation",
    },
    null,
    2
  )
);
if (results.some(r => r.failures.length)) process.exitCode = 1;
