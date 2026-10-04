import { readFile, mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import mysql from "mysql2/promise";
import { inspectPresidentEvidence } from "../server/president/evidence";
import { execFileSync } from "node:child_process";
import {
  evidenceHash,
  MysqlPresidentIntelligenceStore,
} from "../server/president/intelligenceStore";
import {
  ClaudeCliJudgmentProvider,
  reasonAboutCompany,
} from "../server/president/reasoning";
import type { CompanyEvidence } from "../shared/presidentIntelligence";
import { persistUnknownMetricTree } from "../server/president/metricTree";
import { assessPresidentStage1 } from "../server/president/assessment";
import { MysqlPresidentAssessmentStore } from "../server/president/mysqlStore";

const root = resolve(import.meta.dirname, "..");
const sha = execFileSync("git", ["rev-parse", "origin/main"], { cwd: root })
  .toString()
  .trim();
const snapshot = await inspectPresidentEvidence({
  repositoryRoot: root,
  repositorySha: sha,
});
// Fixed captured date is retained in the snapshot-specific evidence identity across retries.
const capturedAt = new Date().toISOString();
const evidence: CompanyEvidence[] = [
  {
    id: "main-launch-" + sha,
    source: `git:${sha}:docs/JOYSTICK-SAAS-LAUNCH-OPS.md`,
    capturedAt,
    sourceAt: null,
    statement: snapshot.sourceContents["docs/JOYSTICK-SAAS-LAUNCH-OPS.md"],
    sha256: evidenceHash(
      snapshot.sourceContents["docs/JOYSTICK-SAAS-LAUNCH-OPS.md"]
    ),
    kind: "FACT",
    confidence: 1,
    availability: "AVAILABLE",
    origin: "REAL",
    expiresAt: null,
  },
  ...snapshot.unavailableSources.map(source => ({
    id: `unavailable-${evidenceHash(source + sha).slice(0, 32)}`,
    source,
    capturedAt,
    sourceAt: null,
    statement: `${source} was not available to this non-production witness.`,
    sha256: evidenceHash(
      `${source} was not available to this non-production witness.`
    ),
    kind: "UNKNOWN" as const,
    confidence: 0,
    availability: "UNAVAILABLE" as const,
    origin: "REAL" as const,
    expiresAt: null,
  })),
];
const admin = await mysql.createConnection("mysql://root:root@127.0.0.1:3411/");
await admin.query(
  "CREATE DATABASE IF NOT EXISTS president_intelligence_witness_v2"
);
await admin.end();
const pool = mysql.createPool({
  uri: "mysql://root:root@127.0.0.1:3411/president_intelligence_witness_v2",
  timezone: "Z",
  connectionLimit: 8,
});
try {
  for (const migration of [
    "0109_president_stage1.sql",
    "0111_president_intelligence.sql",
  ]) {
    const sql = await readFile(resolve(root, "drizzle", migration), "utf8");
    for (const statement of sql
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map(s => s.trim())
      .filter(Boolean))
      await pool.query(statement);
  }
  const admission = await assessPresidentStage1({
    snapshot,
    store: new MysqlPresidentAssessmentStore(pool),
  });
  const providerDirectory = await mkdtemp(
    join(tmpdir(), "president-tool-free-")
  );
  const store = new MysqlPresidentIntelligenceStore(pool);
  for (const item of evidence) {
    const prior = await store.evidence([item.id]);
    if (prior[0]) item.capturedAt = prior[0].capturedAt;
  }
  const input = {
    question:
      "Which JOYSTICK company work deserves attention first? Defend the priority against its best alternative. Form a small source-backed thesis and proposed objective. Billing, isolation and log clearance must remain UNKNOWN unless this evidence affirmatively establishes they are unmet. Do not change pricing or launch policy.",
    evidence,
    context: {
      admittedProjects: admission.assessment.candidates,
      inspectedMainSha: sha,
      snapshot: snapshot.id,
      publicLaunchAuthority: "Adam",
      businessMetrics: "UNKNOWN",
    },
    provider: new ClaudeCliJudgmentProvider(providerDirectory),
    store,
    maxUsd: 0.5,
    requestKey: "current-main-strategy-v4-" + sha,
    admittedCandidateIds: admission.assessment.candidates.map(c => c.id),
  };
  const first = await reasonAboutCompany(input);
  await persistUnknownMetricTree(
    store,
    evidence.find(e => e.source === "posthog_live_product_data")!.id,
    input.requestKey + ":metrics"
  );
  for (const [index, thesis] of first.recommendation.thesisUpdates.entries())
    await store.appendCurrent({
      kind: "THESIS",
      key: thesis.topic + ":" + index,
      payload: { ...thesis, strategyRecordId: first.record.id },
      evidenceIds: thesis.evidenceIds,
      idempotencyKey: input.requestKey + ":normalized-thesis:" + index,
    });
  for (const [index, objective] of first.recommendation.objectives.entries())
    await store.appendCurrent({
      kind: "OBJECTIVE",
      key: "objective:" + index,
      payload: { ...objective, strategyRecordId: first.record.id },
      evidenceIds: objective.evidenceIds,
      idempotencyKey: input.requestKey + ":normalized-objective:" + index,
    });
  const recovered = await reasonAboutCompany({
    ...input,
    store: new MysqlPresidentIntelligenceStore(pool),
  });
  const report = {
    inspectedMainSha: sha,
    snapshot: snapshot.id,
    database: "127.0.0.1:3411/president_intelligence_witness_v2",
    productionTouched: false,
    provider: first.record.payload.provider,
    recordId: first.record.id,
    durableThesisIds: (await store.listCurrent("THESIS"))
      .filter(r => r.payload.strategyRecordId === first.record.id)
      .map(r => r.id),
    durableObjectiveIds: (await store.listCurrent("OBJECTIVE"))
      .filter(r => r.payload.strategyRecordId === first.record.id)
      .map(r => r.id),
    recommendation: first.recommendation,
    providerRunId: first.record.payload.providerRunId,
    costUsd: first.record.payload.costUsd,
    reused: recovered.reused,
    sameRecordId: first.record.id === recovered.record.id,
    executedProjects: 0,
    cabinetExecuted: false,
  };
  if (!report.reused || !report.sameRecordId)
    throw new Error("Reasoning retry produced a competing judgment");
  console.log(JSON.stringify(report, null, 2));
  await mkdir(resolve(root, "artifacts/president-intelligence"), {
    recursive: true,
  });
  await writeFile(
    resolve(root, "artifacts/president-intelligence/witness.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
} finally {
  await pool.end();
}
