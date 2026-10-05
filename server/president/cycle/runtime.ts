import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ENV } from "../../_core/env";
import { notifyOwner } from "../../_core/notification";
import { presidentPool } from "../database";
import { MysqlPresidentIntelligenceStore } from "../intelligenceStore";
import { createCycle, presentToAdam } from "./cycleService";
import { MysqlCycleStore, type CycleStore } from "./cycleStore";
import { runDeliberation } from "./deliberation";
import { gatherCompanyEvidence } from "./evidence";
import { redactSecrets, rosterFromEnv } from "./models";
import {
  ClaudeCodeEngineeringAgent,
  GhCliGitHost,
} from "../fabric/engineering";
import {
  ClaudeReadOnlyResearchAgent,
  ClaudeReadOnlyReviewerModel,
  IndependentReviewer,
} from "../fabric/review";
import { runApprovedMissions } from "../fabric/runner";
import { presidentReadiness } from "../fabric/readiness";
import { runCommand } from "../fabric/exec";

let storeSingleton: CycleStore | undefined;

export function getPresidentCycleStore(): CycleStore {
  return (storeSingleton ??= new MysqlCycleStore(presidentPool()));
}

export function presidentCycleRepoRoot(env = process.env): string {
  return resolve(env.PRESIDENT_REPO_ROOT?.trim() || process.cwd());
}

function runtimeRoot(env = process.env): string {
  return resolve(
    env.PRESIDENT_RUNTIME_DIR?.trim() ||
      join(tmpdir(), "joystick-president-runtime")
  );
}

async function baseSha(repoRoot: string, env = process.env): Promise<string> {
  const pinned = env.PRESIDENT_EXECUTION_BASE_SHA?.trim();
  if (pinned) {
    if (!/^[a-f0-9]{40}$/i.test(pinned))
      throw new Error("PRESIDENT_EXECUTION_BASE_SHA must be a full commit SHA");
    return pinned;
  }
  const result = await runCommand("git rev-parse origin/main", repoRoot, {
    timeoutMs: 20_000,
  });
  if (result.exitCode !== 0 || !/^[a-f0-9]{40}$/i.test(result.stdout.trim()))
    throw new Error(
      `President execution cannot resolve origin/main: ${result.stderr.slice(0, 300)}`
    );
  return result.stdout.trim();
}

const notificationPort = {
  async notify(input: { title: string; message: string; link: string }) {
    const ok = await notifyOwner({
      title: input.title,
      content: `${input.message}\n\n${input.link}`,
    });
    if (!ok) throw new Error("Owner notification was not accepted");
  },
};

async function durablePresidentEvidence() {
  const intelligence = new MysqlPresidentIntelligenceStore(presidentPool());
  const kinds = [
    "RESEARCH",
    "PROGRESS",
    "LESSON",
    "METRIC",
    "RISK",
    "OPPORTUNITY",
    "CONVERSATION",
    "EVALUATION",
    "STRATEGY",
  ] as const;
  const records = (
    await Promise.all(kinds.map(kind => intelligence.list(kind, 12)))
  ).flat();
  const ids = [
    ...new Set(records.flatMap(record => record.evidenceIds)),
  ].slice(0, 100);
  if (!ids.length) return [];
  const now = Date.now();
  const evidence = await intelligence.evidence(ids);
  return evidence
    .filter(
      e =>
        e.availability === "AVAILABLE" &&
        !/mitch/i.test(e.source) &&
        (!e.expiresAt || new Date(e.expiresAt).getTime() > now)
    )
    .map(e => ({
      id: `intel_${e.id}`,
      source: e.source,
      kind: e.kind,
      observedAt: e.capturedAt,
      summary: redactSecrets(e.statement),
      ref: `president-evidence:${e.id}`,
      basis: e.kind === "FACT" ? ("EVIDENCE" as const) : ("JUDGMENT" as const),
    }));
}

export async function queuePresidentRecommendationCycle(input: {
  tenantId: string;
  operatorEvidenceFile?: string;
}) {
  if (!input.tenantId.trim()) throw new Error("tenantId required");
  const [repoEvidence, durableEvidence] = await Promise.all([
    gatherCompanyEvidence({
      repoRoot: presidentCycleRepoRoot(),
      operatorEvidenceFile: input.operatorEvidenceFile,
    }),
    durablePresidentEvidence(),
  ]);
  const evidence = [
    ...new Map(
      [...durableEvidence, ...repoEvidence].map(item => [item.id, item])
    ).values(),
  ];
  return createCycle(getPresidentCycleStore(), {
    tenantId: input.tenantId,
    evidence,
  });
}

export async function advancePresidentRecommendationCycle(
  cycleId: string,
  reviewBaseUrl = ENV.adminBaseUrl
) {
  const store = getPresidentCycleStore();
  let cycle = (await store.get(cycleId));
  if (!cycle) throw new Error("President cycle not found");

  if (
    cycle.status === "GATHERING_EVIDENCE" ||
    cycle.status === "DELIBERATION_BLOCKED" ||
    cycle.status === "DELIBERATING_PROPOSAL" ||
    cycle.status === "DELIBERATING_CRITIQUE" ||
    cycle.status === "DELIBERATING_SYNTHESIS"
  ) {
    cycle = await runDeliberation(store, cycleId, rosterFromEnv());
  }
  if (
    cycle.status === "PRESIDENT_RECOMMENDED" ||
    (cycle.status === "AWAITING_ADAM_REVIEW" &&
      !cycle.notifications.some(n => n.channel === "owner"))
  ) {
    await presentToAdam(store, cycleId, notificationPort, reviewBaseUrl);
  }
  return (await store.get(cycleId))!;
}

/** Synchronous convenience for acceptance/manual runs; HTTP uses the queued path. */
export async function startPresidentRecommendationCycle(input: {
  tenantId: string;
  operatorEvidenceFile?: string;
  reviewBaseUrl?: string;
}) {
  const cycle = await queuePresidentRecommendationCycle(input);
  return advancePresidentRecommendationCycle(
    cycle.cycleId,
    input.reviewBaseUrl || ENV.adminBaseUrl
  );
}

export async function runPresidentApprovedCycle(cycleId: string) {
  if (process.env.PRESIDENT_EXECUTION_ENABLED !== "1")
    throw new Error("PRESIDENT_EXECUTION_ENABLED is not 1");
  const repoRoot = presidentCycleRepoRoot();
  const root = runtimeRoot();
  const gh = new GhCliGitHost(repoRoot);
  return runApprovedMissions(
    {
      store: getPresidentCycleStore(),
      repoRoot,
      workRoot: join(root, "work"),
      reviewRoot: join(root, "review"),
      artifactRoot: join(root, "artifacts"),
      baseSha: await baseSha(repoRoot),
      engineeringAgent: new ClaudeCodeEngineeringAgent(),
      researchAgent: new ClaudeReadOnlyResearchAgent(),
      reviewer: new IndependentReviewer(
        new ClaudeReadOnlyReviewerModel(),
        gh
      ),
      github: gh,
    },
    cycleId
  );
}

export async function runPresidentCycleWorkerTick() {
  if (process.env.PRESIDENT_EXECUTION_ENABLED !== "1")
    return {
      attempted: 0,
      results: [] as Array<{ cycleId: string; status: string }>,
    };

  const store = getPresidentCycleStore();
  const cycles = (await store.list()).filter(c =>
    [
      "GATHERING_EVIDENCE",
      "DELIBERATION_BLOCKED",
      "DELIBERATING_PROPOSAL",
      "DELIBERATING_CRITIQUE",
      "DELIBERATING_SYNTHESIS",
      "PRESIDENT_RECOMMENDED",
      "AWAITING_ADAM_REVIEW",
      "EXECUTING",
    ].includes(c.status)
  );
  const results: Array<{ cycleId: string; status: string }> = [];

  for (const cycle of cycles) {
    try {
      const out =
        cycle.status === "EXECUTING"
          ? await runPresidentApprovedCycle(cycle.cycleId)
          : await advancePresidentRecommendationCycle(cycle.cycleId);
      results.push({ cycleId: cycle.cycleId, status: out.status });
    } catch (error) {
      results.push({
        cycleId: cycle.cycleId,
        status: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
  return { attempted: cycles.length, results };
}

export async function presidentCycleReadiness() {
  const repoRoot = presidentCycleRepoRoot();
  let durableStoreReady = false;
  let durableStoreDetail = "President cycle MySQL table unavailable";
  try {
    await presidentPool().query(
      "SELECT cycleId FROM president_autonomous_cycles LIMIT 1"
    );
    durableStoreReady = true;
    durableStoreDetail = "MySQL cycle store ready";
  } catch (error) {
    durableStoreDetail =
      error instanceof Error ? error.message : String(error);
  }
  const base = await presidentReadiness({
    roster: rosterFromEnv(),
    repoRoot,
    notificationConfigured: Boolean(ENV.forgeApiUrl && ENV.forgeApiKey),
  });
  base.capabilities.durableCycleStoreReady = {
    ready: durableStoreReady,
    detail: durableStoreDetail,
  };
  base.PRESIDENT_AUTONOMOUS_EXECUTION_READY =
    base.PRESIDENT_AUTONOMOUS_EXECUTION_READY && durableStoreReady;
  return base;
}
