/** Operator-authorized production acceptance: records stay in RAM/IPC; only redacted checks are reported. */
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildApprovedDataset, type ApprovedDataset } from "../server/analytics/analysis/approvedViews";
import { loadPaidOrderLedger, type PaidOrderLedger } from "../server/analytics/paidOrderLedger";
import { reconcileLedgerSpan } from "../server/analytics/canonicalRevenue";
import { defaultBusinessQuery, defaultBusinessQueryDeps, runBusinessQuery } from "../server/analytics/businessQuery";
import { addressScope } from "../server/claire/business/businessLanguage";
import { analyzeBusinessData } from "../server/analytics/analysis/analyzeBusinessData";
import { answerClaireBusinessTurn, type ClaireAnalyticsState } from "../server/claire/businessConversation";
import { invokeLLM } from "../server/_core/llm";
import { executeAnalysisQuery } from "../server/analytics/analysis/sandbox";

// Canonical reader/provider failures can contain SQL parameters. Never log their messages in this exam.
console.log = () => {}; console.warn = () => {}; console.error = () => {};
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
const now = new Date("2026-10-14T19:00:00Z"), timeZone = "America/Los_Angeles";

function expectedPopulation(dataset: ApprovedDataset): string[] {
  const orders = dataset.tables.orders!.filter(r => r[9] === "laundry_farm" && Number(r[5]) > 0);
  const ids = [...new Set(orders.map(r => String(r[1])))];
  return ids.map(id => {
    const days = orders.filter(r => r[1] === id).map(r => Date.parse(String(r[2])) / 86400000).sort((a,b)=>a-b);
    const gaps = days.slice(1).map((day,i)=>day-days[i]!);
    const mean = gaps.reduce((n,g)=>n+g,0)/gaps.length;
    const variance = gaps.reduce((n,g)=>n+g*g,0)/gaps.length-mean*mean;
    return { id, days, score: mean > 0 ? variance/(mean*mean) : null };
  }).filter(c=>c.days.length >= 4 && c.days.at(-1)! < Date.parse("2026-08-15")/86400000 && c.score !== null)
    .sort((a,b)=>a.score!-b.score! || a.id.localeCompare(b.id)).slice(0,10).map(c=>c.id);
}

if (process.env.CLAIRE_ANALYSIS_MODEL_CHILD === "1") {
  if (process.env.DATABASE_URL) throw new Error("Model child must have no database configuration");
  process.once("message", async (payload: any) => {
    try {
      const dataset: ApprovedDataset = payload.dataset;
      const state: ClaireAnalyticsState = {};
      const calls: Array<{ model: string; queryHash: string | null }> = [];
      const invoke: typeof invokeLLM = async params => {
        const response = await invokeLLM(params);
        const content = response.choices[0]?.message.content;
        const decision = JSON.parse(typeof content === "string" ? content : "{}");
        calls.push({ model: response.model, queryHash: typeof decision.sql === "string" && decision.sql ? createHash("sha256").update(decision.sql).digest("hex") : null });
        return response;
      };
      const analyze: typeof analyzeBusinessData = input => analyzeBusinessData(input, { invoke, build: async () => dataset });
      const questions = [
        "For Laundry Farm customers with at least four positive paid orders and no recorded paid order in the past sixty days, calculate ordering consistency as population variance of consecutive gaps divided by squared mean gap. Return the ten lowest normalized variances, with ties ordered by customer_id. Exclude zero-mean gaps. This is evidence only, not mission ranking.",
        "Exclude anyone with an outstanding order.",
        "Only Silver Lake.",
        "Show the five highest historical spenders among those remaining candidates as evidence for Claire's existing strategic preparation, breaking spending ties by customer_id.",
        "What did the first one order last time?",
      ];
      const checks: Array<Record<string, unknown>> = [];
      let expected = expectedPopulation(dataset);
      for (let index=0; index<questions.length; index++) {
        if (index===1) {
          const open = new Set(dataset.tables.open_orders!.map(r=>r[1])); expected=expected.filter(id=>!open.has(id));
        } else if (index===2) expected=expected.filter(id=>String(dataset.tables.customers!.find(r=>r[0]===id)?.[8]??"").includes("Silver Lake"));
        else if (index===3) expected=[...expected].sort((a,b)=>Number(dataset.tables.customers!.find(r=>r[0]===b)![6])-Number(dataset.tables.customers!.find(r=>r[0]===a)![6]) || a.localeCompare(b)).slice(0,5);
        const result = await answerClaireBusinessTurn({ tenantId: dataset.tenantId, utterance: questions[index]!, state, surface: "text" }, { now:()=>now, timeZone:()=>timeZone, analyze, planCalculation:async()=>null });
        const observed = state.businessAnalysis?.customerIds ?? [];
        const populationCorrect = index===0 || index===3 || index===4 ? JSON.stringify(observed)===JSON.stringify(expected) : observed.length===expected.length && observed.every(id=>expected.includes(id));
        let referenceCorrect = true;
        if (index===4 && expected[0] && result.handled) referenceCorrect=Boolean(result.analysisEvidence?.results.some(r=>r.receipt.status==="ok" && r.rows.some(row=>row[r.columns.indexOf("customer_id")]===expected[0])));
        checks.push({ case: ["novel_interval_consistency","native_outstanding_exclusion","approximate_zip_scope","five_spending_candidates","first_customer_latest_order"][index], passed: result.handled && result.analysisEvidence?.kind==="evidence" && populationCorrect && referenceCorrect, coverageDisclosed: result.handled && /CleanCloud|native/i.test(result.speak) && /ZIP|approximate/i.test(result.speak), receiptsGrounded: result.handled && Boolean(result.analysisEvidence?.citedReceiptIds.length) });
      }
      const financial = await executeAnalysisQuery({ tenantId: dataset.tenantId, dataset, sql: "SELECT SUM(amount_cents) AS recorded_cents FROM orders" });
      checks.push({ case: "canonical_reconciled_money", passed: financial.receipt.status==="ok" && Number(financial.rows[0]?.[0]??0)===payload.canonicalCents, queryHash: financial.receipt.queryHash });
      const coverage = await analyze({ tenantId: dataset.tenantId, question: "Can you establish actual profit and confirm that no customers have outstanding CleanCloud orders, or what evidence is missing?", now, timeZone });
      checks.push({ case: "missing_costs_and_cleancloud_open_orders", passed: coverage.kind==="insufficient_evidence" || coverage.kind==="evidence" && /cost|profit/i.test(coverage.answer+coverage.limitations.join(" ")) });
      process.send?.({ redacted: true, persistedRawRecords: false, productionBusinessWrites: false, source: "actual tenant-scoped canonical records in memory", checks, originalFixedWindowRegression: payload.originalRegression, modelCalls: calls.length, servedModels: [...new Set(calls.map(c=>c.model))], queryHashes: calls.map(c=>c.queryHash).filter(Boolean), passed: checks.every(c=>c.passed===true) });
      process.exit(0);
    } catch { process.send?.({ redacted: true, passed: false, error: "production_memory_acceptance_failed" }); process.exit(1); }
  });
} else {
  const tenantId = process.env.CLAIRE_ACCEPTANCE_TENANT;
  if (!tenantId || !process.env.DATABASE_URL) throw new Error("Explicit authorized tenant and canonical database required");
  let captured: PaidOrderLedger | undefined;
  const dataset = await buildApprovedDataset({ tenantId, now, timeZone, loaders: { ledger: async input => { captured=await loadPaidOrderLedger(input);return captured; } } });
  const book = reconcileLedgerSpan(captured!, dataset.window);
  const original = await runBusinessQuery(tenantId, { ...defaultBusinessQuery("dormant_customers"), listMembers:true, limit:50, filters: addressScope("only Silver Lake") }, { ...defaultBusinessQueryDeps, now:()=>now, timeZone:()=>timeZone });
  const originalCount = original.status==="ok" && original.data.kind==="customers" ? original.data.population.count : null;
  const originalRegression = { reportingWindowFrozen: true, matchesPreviouslyReportedFourteen: originalCount===14, historicalSnapshotIdentityProven: false, reason: "The prior raw snapshot was not retained; this repeats the original governed calculation at its frozen reporting clock against current canonical records" };
  // Contact keys remain server-side; model process needs only an opaque identity bridge.
  dataset.customerRefs=Object.fromEntries(Object.entries(dataset.customerRefs).map(([id,ref])=>[id,{ displayName:ref.displayName, identityKeys:[`approved_identity:${id}`] }]));
  const child = fork(fileURLToPath(import.meta.url), [], { execArgv:["--import","tsx"], env: { PATH:process.env.PATH, HOME:process.env.HOME, NODE_ENV:"test", CLAIRE_ANALYSIS_MODEL_CHILD:"1", ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL:process.env.ANTHROPIC_MODEL, ANTHROPIC_MODEL_CLAIRE:process.env.ANTHROPIC_MODEL_CLAIRE }, stdio:["ignore","ignore","ignore","ipc"] });
  const timeout=setTimeout(()=>{child.kill();send({redacted:true,passed:false,error:"memory_acceptance_deadline"});process.exit(1)},360000);
  child.once("message", report=>{clearTimeout(timeout);send(report);process.exit((report as any).passed?0:1)});
  child.once("exit", code=>{if(code!==0){clearTimeout(timeout);send({redacted:true,passed:false,error:"model_child_failed"});process.exit(1)}});
  child.send({ dataset, canonicalCents: book.exactIncludedCents, originalRegression });
}
