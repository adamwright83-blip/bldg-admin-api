import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { assessPresidentStage1 } from "../server/president/assessment";
import { inspectPresidentEvidence } from "../server/president/evidence";
import { MysqlPresidentAssessmentStore } from "../server/president/mysqlStore";
const root = resolve(import.meta.dirname, "..");
const sha =
  process.env.PRESIDENT_INSPECTED_SHA ||
  execFileSync("git", ["rev-parse", "origin/main"], { cwd: root })
    .toString()
    .trim();
// This witness accepts only the dedicated disposable loopback database. It never
// reads DATABASE_URL, preventing accidental use of the application's production DB.
const url = new URL(
  process.env.PRESIDENT_TEST_DATABASE_URL ||
    "mysql://root:root@127.0.0.1:3411/president_stage1_witness"
);
if (
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.pathname !== "/president_stage1_witness"
)
  throw new Error(
    "Witness requires the dedicated local non-production president_stage1_witness database"
  );
const adminUrl = new URL(url);
adminUrl.pathname = "/";
const admin = await mysql.createConnection(adminUrl.toString());
try {
  await admin.query("CREATE DATABASE IF NOT EXISTS president_stage1_witness");
} finally {
  await admin.end();
}
const pool = mysql.createPool({ uri: url.toString(), timezone: "Z" });
try {
  const migration = await readFile(
    resolve(root, "drizzle/0109_president_stage1.sql"),
    "utf8"
  );
  for (const sql of migration
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map(x => x.trim())
    .filter(Boolean))
    await pool.query(sql);
  const [tables] = await pool.query<RowDataPacket[]>("SHOW TABLES");
  const snapshot = await inspectPresidentEvidence({
    repositoryRoot: root,
    repositorySha: sha,
  });
  const store = new MysqlPresidentAssessmentStore(pool);
  const first = await assessPresidentStage1({ snapshot, store });
  const afterFirst = {
    assessments: await store.count(),
    candidates: await store.candidateCount(),
  };
  // Recreate the adapter to prove recovery from MySQL, not an in-process cache.
  const recoveredStore = new MysqlPresidentAssessmentStore(pool);
  const second = await assessPresidentStage1({
    snapshot,
    store: recoveredStore,
  });
  const afterRerun = {
    assessments: await recoveredStore.count(),
    candidates: await recoveredStore.candidateCount(),
  };
  const report = {
    database: {
      host: url.hostname,
      port: url.port,
      name: "president_stage1_witness",
      productionTouched: false,
      migration: "0109",
      tables: tables.map(x => Object.values(x)[0]),
    },
    inspectedSha: sha,
    snapshot,
    assessment: first.assessment,
    afterFirst,
    afterRerun,
    reused: second.reused,
    sameAssessmentId: first.assessment.id === second.assessment.id,
    finalState: second.assessment.resultState,
    executionCount: second.assessment.executionCount,
  };
  if (
    !report.reused ||
    !report.sameAssessmentId ||
    afterFirst.assessments !== afterRerun.assessments ||
    afterFirst.candidates !== afterRerun.candidates
  )
    throw new Error("Database witness idempotency failed");
  console.log(JSON.stringify(report, null, 2));
  for (const c of first.assessment.candidates)
    console.log(
      `#${c.rank} ${c.title}\n${c.missingCapability} ${c.currentGap} Build: ${c.proposedBuild} Afterward: ${c.resultingCapability} ${c.rankReason}`
    );
  await mkdir(resolve(root, "artifacts/president-stage1"), { recursive: true });
  await writeFile(
    resolve(root, "artifacts/president-stage1/database-witness.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
} finally {
  await pool.end();
}
