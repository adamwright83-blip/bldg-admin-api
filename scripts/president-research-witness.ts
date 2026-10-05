import { mkdir, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import mysql from "mysql2/promise";
import { ClaudeCliJudgmentProvider } from "../server/president/reasoning";
import { MysqlPresidentIntelligenceStore } from "../server/president/intelligenceStore";
import { researchCompanyQuestion } from "../server/president/research";

// Schema is applied only by the dedicated local intelligence witness.
const pool = mysql.createPool({
  uri: "mysql://root:root@127.0.0.1:3411/president_intelligence_witness_v2",
  timezone: "Z",
  connectionLimit: 8,
});
try {
  const cwd = await mkdtemp(join(tmpdir(), "president-web-research-"));
  const plan = {
    question:
      "As of October 2026, what current primary-source patterns from Agent Skills, Anthropic web research and A2A capability cards should a small JOYSTICK executive agent adopt architecturally without installing another agent framework? Research the live internet and identify 3 independent official sources with concrete security/provenance implications.",
    reason:
      "Executive intelligence kernel source-backed integration design, not vendor procurement or capability adoption",
    allowedDomains: [
      "agentskills.io",
      "platform.claude.com",
      "a2a-protocol.org",
      "github.com",
      "www.anthropic.com",
      "modelcontextprotocol.io",
    ],
    recencyDays: 120,
    maxSources: 4,
    maxUsd: 0.5,
  };
  const input = {
    plan,
    provider: new ClaudeCliJudgmentProvider(
      cwd,
      "sonnet",
      "claude",
      "WEB_RESEARCH"
    ),
    store: new MysqlPresidentIntelligenceStore(pool),
    requestKey: "executive-patterns-2026-10-04-v1",
  };
  const first = await researchCompanyQuestion(input);
  const second = await researchCompanyQuestion({
    ...input,
    store: new MysqlPresidentIntelligenceStore(pool),
  });
  const report = {
    productionTouched: false,
    recordId: first.record.id,
    reused: second.reused,
    sameRecordId: first.record.id === second.record.id,
    research: first.record.payload,
    adoptedCapabilities: 0,
  };
  console.log(JSON.stringify(report, null, 2));
  const root = resolve(import.meta.dirname, "..");
  await mkdir(resolve(root, "artifacts/president-intelligence"), {
    recursive: true,
  });
  await writeFile(
    resolve(root, "artifacts/president-intelligence/research-witness.json"),
    JSON.stringify(report, null, 2) + "\n"
  );
} finally {
  await pool.end();
}
