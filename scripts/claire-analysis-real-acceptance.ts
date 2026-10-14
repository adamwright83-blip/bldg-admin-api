/** Actual configured Anthropic, isolated datasets, zero production DB writes. */
import { mkdir, writeFile } from "node:fs/promises";
import { syntheticAnalysisDataset } from "../server/analytics/analysis/acceptanceFixture";
import { analyzeBusinessData } from "../server/analytics/analysis/analyzeBusinessData";
import {
  answerClaireBusinessTurn,
  type ClaireAnalyticsState,
} from "../server/claire/businessConversation";
import { invokeLLM } from "../server/_core/llm";
import { claireModelId } from "../server/claire/claireModel";
if (process.env.DATABASE_URL)
  throw new Error(
    "Real-model certification must have no production database configured"
  );
const dataset = syntheticAnalysisDataset();
const now = new Date(dataset.generatedAt),
  timeZone = dataset.window.timeZone;
const traces: any[] = [];
const invoke: typeof invokeLLM = async params => {
  const started = Date.now();
  let result;
  try {
    result = await invokeLLM(params);
  } catch (error: any) {
    console.log(
      JSON.stringify({
        providerError: error.name,
        status: error.status,
        message: error.message,
      })
    );
    throw error;
  }
  const text = result.choices[0]!.message.content;
  traces.push({
    model: result.model,
    elapsedMs: Date.now() - started,
    usage: result.usage,
    decision: JSON.parse(typeof text === "string" ? text : "{}"),
  });
  return result;
};
const analyze: typeof analyzeBusinessData = input =>
  analyzeBusinessData(input, { invoke, build: async () => dataset });
const state: ClaireAnalyticsState = {};
const questions = [
  "Which Laundry Farm customers used to order weekly but stopped? Define weekly from their actual consecutive ordering intervals and use at least four orders with gaps between five and nine days, then no recorded paid order in the last thirty days.",
  "Exclude anyone with an outstanding order.",
  "Only Silver Lake.",
  "Show the five highest historical spenders among those remaining candidates, as evidence for Claire's existing strategic preparation. Do not independently decide whom to contact.",
  "What did the first one order last time?",
];
const turns: any[] = [];
const expected = [Array.from({length:10},(_,i)=>`cust_fixture${i}`), [...Array.from({length:8},(_,i)=>`cust_fixture${i}`), "cust_fixture9"], Array.from({length:8},(_,i)=>`cust_fixture${i}`), [7,6,5,4,3].map(i=>`cust_fixture${i}`), [7,6,5,4,3].map(i=>`cust_fixture${i}`)];
for (const question of questions) {
  const started = Date.now();
  const result = await answerClaireBusinessTurn(
    { tenantId: dataset.tenantId, utterance: question, state, surface: "text" },
    {
      now: () => now,
      timeZone: () => timeZone,
      analyze,
      planCalculation: async () => null,
    }
  );
  turns.push({
    question,
    elapsedMs: Date.now() - started,
    handled: result.handled,
    populationCorrect: JSON.stringify(state.businessAnalysis?.customerIds) === JSON.stringify(expected[turns.length]),
    ...(result.handled
      ? {
          answer: result.speak,
          reader: result.reader,
          evidenceKind: result.analysisEvidence?.kind,
          citedReceiptIds: result.analysisEvidence?.citedReceiptIds,
          customerIds: state.businessAnalysis?.customerIds,
        }
      : {}),
  });
  console.log(JSON.stringify(turns.at(-1)));
}
const proactive = await analyzeBusinessData(
  {
    tenantId: dataset.tenantId,
    question:
      "Investigate business conditions relevant to recovering consistent recurring customers, and identify missing evidence. Choose your own calculations; evidence only.",
    now,
    timeZone,
    proactive: true,
  },
  { invoke, build: async () => dataset }
);
const report = {
  testMode:
    "real configured Anthropic; synthetic approved data; real SQLite workers",
  requestedModel: claireModelId(),
  servedModels: [...new Set(traces.map(t => t.model))],
  turns,
  proactive: {
    kind: proactive.kind,
    answer: proactive.answer,
    receiptIds: proactive.citedReceiptIds,
  },
  traces,
  passed:
    turns.every(t => t.evidenceKind === "evidence" && t.populationCorrect) &&
    proactive.kind === "evidence",
};
await mkdir("artifacts/claire-analysis", { recursive: true });
await writeFile(
  "artifacts/claire-analysis/real-model-synthetic.json",
  JSON.stringify(report, null, 2)
);
console.log(
  JSON.stringify({
    passed: report.passed,
    turns: turns.length,
    modelCalls: traces.length,
    servedModels: report.servedModels,
    proactive: proactive.kind,
  })
);
process.exit(report.passed ? 0 : 1);
