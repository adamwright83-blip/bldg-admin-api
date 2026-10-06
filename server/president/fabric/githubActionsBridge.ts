import { randomUUID, createHash } from "node:crypto";
import express, { type Express, type Request } from "express";
import Anthropic from "@anthropic-ai/sdk";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Cycle, Mission, MissionStatus, ReviewVerdict } from "../../../shared/presidentCycle";
import { generateMorningReport } from "./morningReport";
import { protectedViolations } from "./engineering";
import { getPresidentCycleStore } from "../cycle/runtime";
import type { CycleStore } from "../cycle/cycleStore";
import { setStatus } from "../cycle/cycleService";

const OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const OIDC_AUDIENCE = "joystick-president-executor";
const EXPECTED_REPOSITORY =
  process.env.PRESIDENT_GITHUB_REPOSITORY?.trim() ||
  "adamwright83-blip/bldg-admin-api";
const EXPECTED_WORKFLOW =
  process.env.PRESIDENT_GITHUB_WORKFLOW_PATH?.trim() ||
  ".github/workflows/president-autonomous-execution.yml";
const JWKS = createRemoteJWKSet(
  new URL("https://token.actions.githubusercontent.com/.well-known/jwks")
);
const EXECUTOR_ID = "president-github-actions-executor";
const REVIEWER_ID = "president-github-actions-reviewer";
const LEASE_MS = 45 * 60_000;

type GithubOidcClaims = {
  repository?: string;
  job_workflow_ref?: string;
  workflow_ref?: string;
  event_name?: string;
  ref?: string;
};

function bearer(req: Request): string | null {
  const raw = req.headers.authorization;
  if (!raw?.startsWith("Bearer ")) return null;
  return raw.slice("Bearer ".length).trim() || null;
}

export async function verifyPresidentGithubOidc(
  token: string
): Promise<GithubOidcClaims> {
  const verified = await jwtVerify(token, JWKS, {
    issuer: OIDC_ISSUER,
    audience: OIDC_AUDIENCE,
  });
  const claims = verified.payload as GithubOidcClaims;
  if (claims.repository !== EXPECTED_REPOSITORY)
    throw new Error("GitHub OIDC repository mismatch");
  const workflow = claims.job_workflow_ref ?? claims.workflow_ref ?? "";
  if (!workflow.includes(`/${EXPECTED_WORKFLOW}@`))
    throw new Error("GitHub OIDC workflow mismatch");
  return claims;
}

function legalGo(m: Mission, to: MissionStatus, actorId: string) {
  const from = m.status;
  const allowed: Record<MissionStatus, MissionStatus[]> = {
    ADAM_APPROVED: ["QUEUED"],
    QUEUED: ["PREPARING", "BLOCKED"],
    PREPARING: ["EXECUTING", "BLOCKED", "REPAIR_REQUIRED"],
    EXECUTING: ["VALIDATING", "BLOCKED", "REPAIR_REQUIRED"],
    VALIDATING: ["READY_FOR_REVIEW", "REPAIR_REQUIRED", "BLOCKED"],
    READY_FOR_REVIEW: ["REVIEWING"],
    REVIEWING: [
      "READY_FOR_HUMAN",
      "COMPLETED",
      "REPAIR_REQUIRED",
      "BLOCKED",
      "READY_FOR_REVIEW",
    ],
    REPAIR_REQUIRED: ["EXECUTING", "BLOCKED"],
    BLOCKED: [],
    READY_FOR_HUMAN: [],
    COMPLETED: [],
  };
  if (!allowed[from].includes(to))
    throw new Error(`Illegal mission transition ${from} -> ${to}`);
  m.transitions.push({
    at: new Date().toISOString(),
    from,
    to,
    actorId,
  });
  m.status = to;
}

function receipt(
  m: Mission,
  kind: string,
  actorId: string,
  data: Record<string, unknown>
) {
  m.receipts.push({
    at: new Date().toISOString(),
    kind,
    actorId,
    attempt: m.attempt,
    data,
  });
}

function terminal(m: Mission) {
  return ["BLOCKED", "READY_FOR_HUMAN", "COMPLETED"].includes(m.status);
}

function dependenciesReady(c: Cycle, m: Mission): boolean {
  return m.dependsOn.every(id => {
    const dep = c.missions.find(x => x.missionId === id);
    return dep && ["READY_FOR_HUMAN", "COMPLETED"].includes(dep.status);
  });
}

function approved(c: Cycle, m: Mission): boolean {
  return Boolean(
    c.approval &&
      c.approval.approvedCandidateIds.includes(m.candidateId) &&
      m.approvalReceiptId === c.approval.receiptId
  );
}

function feedback(m: Mission): string | null {
  for (let i = m.receipts.length - 1; i >= 0; i--) {
    const r = m.receipts[i];
    if (
      ["VALIDATION_FAILED", "REVIEW_FAIL", "EXECUTOR_ERROR", "LEASE_RECOVERED"].includes(
        r.kind
      )
    )
      return JSON.stringify(r.data).slice(0, 5000);
  }
  return null;
}

async function resolveMainSha(): Promise<string> {
  const response = await fetch(
    `https://api.github.com/repos/${EXPECTED_REPOSITORY}/commits/main`,
    {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "joystick-president",
      },
      signal: AbortSignal.timeout(20_000),
    }
  );
  if (!response.ok)
    throw new Error(`Unable to resolve GitHub main (${response.status})`);
  const body = (await response.json()) as { sha?: string };
  if (!body.sha || !/^[a-f0-9]{40}$/i.test(body.sha))
    throw new Error("GitHub main returned invalid SHA");
  return body.sha;
}

export async function claimPresidentGithubMission(store: CycleStore) {
  const cycles = (await store.list()).filter(cycle => cycle.status === "EXECUTING");
  const currentMain = await resolveMainSha();

  for (const cycle of cycles) {
    let response: Record<string, unknown> | null = null;
    await store.update(cycle.cycleId, current => {
      const mission = current.missions.find(candidate => {
        if (
          terminal(candidate) ||
          !approved(current, candidate) ||
          !dependenciesReady(current, candidate)
        )
          return false;
        if (
          !["ENGINEERING", "RESEARCH", "ANALYSIS", "DOCUMENTATION"].includes(
            candidate.domain
          )
        )
          return false;
        const live =
          candidate.lease &&
          new Date(candidate.lease.expiresAt).getTime() > Date.now();
        return !live;
      });
      if (!mission) return;

      if (mission.lease) {
        receipt(mission, "LEASE_RECOVERED", EXECUTOR_ID, {
          previousActor: mission.lease.actorId,
          previousStatus: mission.status,
        });
        if (["PREPARING", "EXECUTING", "VALIDATING"].includes(mission.status))
          mission.status = "REPAIR_REQUIRED";
        else if (mission.status === "REVIEWING")
          mission.status = "READY_FOR_REVIEW";
        mission.lease = null;
      }

      if (mission.status === "ADAM_APPROVED")
        legalGo(mission, "QUEUED", EXECUTOR_ID);
      if (mission.status === "QUEUED")
        legalGo(mission, "PREPARING", EXECUTOR_ID);

      const baseSha =
        (mission.handback?.baseSha as string | undefined) ??
        (mission.receipts.find(r => r.kind === "EXECUTION_BASE_PINNED")?.data
          .baseSha as string | undefined) ??
        currentMain;

      if (mission.status === "REPAIR_REQUIRED") {
        if (mission.attempt >= mission.maxAttempts) {
          legalGo(mission, "BLOCKED", EXECUTOR_ID);
          mission.blocker = `Repair attempts exhausted (${mission.attempt}/${mission.maxAttempts})`;
          receipt(mission, "BLOCKED", EXECUTOR_ID, { reason: mission.blocker });
          return;
        }
        legalGo(mission, "EXECUTING", EXECUTOR_ID);
      } else if (mission.status === "PREPARING") {
        legalGo(mission, "EXECUTING", EXECUTOR_ID);
      } else if (!["EXECUTING", "READY_FOR_REVIEW"].includes(mission.status)) {
        return;
      }

      if (mission.status === "READY_FOR_REVIEW") {
        legalGo(mission, "REVIEWING", REVIEWER_ID);
      } else {
        mission.attempt += 1;
        mission.executorActorId = EXECUTOR_ID;
      }

      const token = randomUUID();
      mission.lease = {
        actorId: mission.status === "REVIEWING" ? REVIEWER_ID : EXECUTOR_ID,
        token,
        attempt: mission.attempt,
        expiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
      };
      if (
        !mission.receipts.some(
          r =>
            r.kind === "EXECUTION_BASE_PINNED" &&
            r.data.baseSha === baseSha
        )
      )
        receipt(mission, "EXECUTION_BASE_PINNED", EXECUTOR_ID, { baseSha });

      response = {
        claimed: true,
        leaseToken: token,
        reviewOnly: mission.status === "REVIEWING",
        baseSha,
        branch: `president/${mission.missionId}`,
        feedback: feedback(mission),
        mission: {
          missionId: mission.missionId,
          cycleId: mission.cycleId,
          candidateId: mission.candidateId,
          title: mission.title,
          objective: mission.objective,
          businessReason: mission.businessReason,
          acceptanceCriteria: mission.acceptanceCriteria,
          domain: mission.domain,
          scope: mission.scope,
          constraints: mission.constraints,
          approvalReceiptId: mission.approvalReceiptId,
          approvedAt: mission.approvedAt,
          attempt: mission.attempt,
          maxAttempts: mission.maxAttempts,
          requiredValidation: mission.requiredValidation,
          handback: mission.handback,
        },
      };
    });
    if (response) return response;
  }

  return { claimed: false };
}

async function missionWithLease(
  store: CycleStore,
  cycleId: string,
  missionId: string,
  leaseToken: string
): Promise<{ cycle: Cycle; mission: Mission }> {
  const cycle = await store.get(cycleId);
  if (!cycle) throw new Error("Cycle not found");
  const mission = cycle.missions.find(m => m.missionId === missionId);
  if (!mission) throw new Error("Mission not found");
  if (!approved(cycle, mission))
    throw new Error("Mission is not in Adam's approved receipt");
  if (!mission.lease || mission.lease.token !== leaseToken)
    throw new Error("Mission lease mismatch");
  if (new Date(mission.lease.expiresAt).getTime() <= Date.now())
    throw new Error("Mission lease expired");
  return { cycle, mission };
}

const engineeringTools: Anthropic.Tool[] = [
  {
    name: "list_directory",
    description: "List files/directories in the isolated repository checkout.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "read_file",
    description: "Read a bounded range of one repository file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        start_line: { type: "integer" },
        end_line: { type: "integer" },
      },
      required: ["path"],
    },
  },
  {
    name: "search_text",
    description: "Search tracked repository text for a literal string.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "write_file",
    description: "Create or replace one allowed repository file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "replace_text",
    description: "Replace one unique exact text span in an allowed file.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_text: { type: "string" },
        new_text: { type: "string" },
      },
      required: ["path", "old_text", "new_text"],
    },
  },
];

const readOnlyTools = engineeringTools.filter(
  t => t.name !== "write_file" && t.name !== "replace_text"
);

function systemFor(m: Mission, role: "EXECUTOR" | "REVIEWER") {
  if (role === "REVIEWER")
    return `You are JOYSTICK President's independent reviewer. You did not execute this mission. You have read-only repository tools. Never ask to edit files. Verify the Adam-approved scope, evidence, tests, security, and whether the work genuinely satisfies the acceptance criteria. Return a final JSON object only when finished: {"verdict":"PASS"|"FAIL"|"BLOCKED","reasons":["..."]}. FAIL means repairable. BLOCKED means an external/authority dependency prevents certification.`;

  const research = m.domain !== "ENGINEERING";
  return research
    ? `You are JOYSTICK President's read-only research executor. You are not Mitch and must never route work to Mitch. Read only repository evidence needed for the approved mission. Finish with markdown containing exactly: ## Findings (evidence), ## Inferences (judgment), ## Sources, ## State changes. Cite repository-relative files in backticks. State changes must be None.`
    : `You are JOYSTICK President's engineering executor. You are not Mitch and must never route work to Mitch. Work only inside the Adam-approved scope. Inspect before editing. Do not touch server/mitch/**, shared/mitch*, server/commercialPipeline/**, server/commercialCampaigns/**, server/authority/**, drizzle/schema.ts, package.json, pnpm-lock.yaml or .github/**. Never merge or deploy. Use repository tools to implement the mission; the GitHub Actions wrapper owns tests, git publication and PR creation. If unsafe or impossible, explain the blocker instead of broad speculative changes.`;
}

export async function presidentGithubModelTurn(
  store: CycleStore,
  input: {
    cycleId: string;
    missionId: string;
    leaseToken: string;
    role: "EXECUTOR" | "REVIEWER";
    messages: Anthropic.MessageParam[];
  }
) {
  const { mission } = await missionWithLease(
    store,
    input.cycleId,
    input.missionId,
    input.leaseToken
  );
  if (input.role === "REVIEWER" && mission.status !== "REVIEWING")
    throw new Error("Mission is not in review");
  if (
    input.role === "EXECUTOR" &&
    !["EXECUTING", "VALIDATING"].includes(mission.status)
  )
    throw new Error("Mission is not executable");
  if (input.messages.length < 1 || input.messages.length > 50)
    throw new Error("President model relay message count out of bounds");
  if (JSON.stringify(input.messages).length > 1_500_000)
    throw new Error("President model relay payload exceeds bound");
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) throw new Error("ANTHROPIC_API_KEY unavailable");
  const client = new Anthropic({ apiKey: key });
  const response = await client.messages.create({
    model:
      process.env.PRESIDENT_ENGINEERING_MODEL?.trim() ||
      process.env.PRESIDENT_MODEL?.trim() ||
      process.env.ANTHROPIC_MODEL_MISSION_PLANNER?.trim() ||
      "claude-sonnet-4-5",
    max_tokens: 8192,
    temperature: 0,
    system: systemFor(mission, input.role),
    messages: input.messages,
    tools: input.role === "REVIEWER" ? readOnlyTools : mission.domain === "ENGINEERING" ? engineeringTools : readOnlyTools,
  });
  return {
    id: response.id,
    model: response.model,
    stopReason: response.stop_reason,
    content: response.content,
  };
}

async function finalizeCycleIfTerminal(store: CycleStore, cycleId: string) {
  await store.update(cycleId, c => {
    if (
      c.status === "EXECUTING" &&
      c.missions.length &&
      c.missions.every(terminal)
    ) {
      c.morningReport = generateMorningReport(c);
      setStatus(c, "COMPLETE", "all Adam-approved missions reached a terminal state");
    }
  });
}

export async function recordPresidentGithubFailure(
  store: CycleStore,
  input: {
    cycleId: string;
    missionId: string;
    leaseToken: string;
    reason: string;
    checks?: unknown;
  }
) {
  await missionWithLease(
    store,
    input.cycleId,
    input.missionId,
    input.leaseToken
  );
  await store.update(input.cycleId, c => {
    const m = c.missions.find(x => x.missionId === input.missionId)!;
    if (!m.lease || m.lease.token !== input.leaseToken)
      throw new Error("Mission lease mismatch");
    receipt(m, "VALIDATION_FAILED", EXECUTOR_ID, {
      reason: input.reason.slice(0, 5000),
      checks: input.checks ?? null,
    });
    if (m.attempt >= m.maxAttempts) {
      legalGo(m, "BLOCKED", EXECUTOR_ID);
      m.blocker = `Repair attempts exhausted: ${input.reason.slice(0, 1000)}`;
    } else {
      legalGo(m, "REPAIR_REQUIRED", EXECUTOR_ID);
    }
    m.lease = null;
  });
  await finalizeCycleIfTerminal(store, input.cycleId);
}

export async function recordPresidentGithubPublication(
  store: CycleStore,
  input: {
    cycleId: string;
    missionId: string;
    leaseToken: string;
    baseSha: string;
    branch?: string;
    commitSha?: string;
    prUrl?: string;
    changedFiles?: string[];
    artifactText?: string;
    artifactSha256?: string;
    checks: Array<{ command: string; exitCode: number; ok: boolean }>;
    browserEvidence?: {
      screenshotPath?: string;
      consoleErrors: string[];
      ok: boolean;
    };
  }
) {
  await missionWithLease(
    store,
    input.cycleId,
    input.missionId,
    input.leaseToken
  );
  await store.update(input.cycleId, c => {
    const m = c.missions.find(x => x.missionId === input.missionId)!;
    if (!m.lease || m.lease.token !== input.leaseToken)
      throw new Error("Mission lease mismatch");
    if (m.status === "EXECUTING") legalGo(m, "VALIDATING", EXECUTOR_ID);
    if (m.status !== "VALIDATING")
      throw new Error("Mission is not validating");
    if (input.checks.some(x => !x.ok))
      throw new Error("Cannot publish a mission with failed required checks");
    if (m.requiredValidation.browser && input.browserEvidence?.ok !== true)
      throw new Error("Required browser validation did not pass");

    if (m.domain === "ENGINEERING") {
      if (
        !input.prUrl ||
        !input.branch ||
        !input.commitSha ||
        !input.changedFiles?.length
      )
        throw new Error("Engineering publication requires PR/branch/commit/files");
      const protectedPaths = protectedViolations(input.changedFiles);
      if (protectedPaths.length)
        throw new Error(
          "Engineering publication touched protected paths: " +
            protectedPaths.join(", ")
        );
    } else {
      const artifact = input.artifactText?.trim() ?? "";
      if (!artifact)
        throw new Error("Research/analysis publication requires artifact text");
      if (artifact.length > 500_000)
        throw new Error("Research/analysis artifact exceeds durable bound");
      for (const section of [
        "## Findings (evidence)",
        "## Inferences (judgment)",
        "## Sources",
        "## State changes",
      ])
        if (!artifact.includes(section))
          throw new Error("Research artifact missing section: " + section);
      const changes = artifact.split("## State changes")[1] ?? "";
      if (!/^\s*None\b/i.test(changes))
        throw new Error("Research artifact must declare State changes: None");
    }

    m.handback = {
      prUrl: input.prUrl,
      branch: input.branch,
      baseSha: input.baseSha,
      commitSha: input.commitSha,
      changedFiles: input.changedFiles,
      artifactText: input.artifactText,
      artifactSha256:
        input.artifactSha256 ??
        (input.artifactText
          ? createHash("sha256").update(input.artifactText).digest("hex")
          : undefined),
      checks: input.checks,
      browserEvidence: input.browserEvidence,
      evidenceIds: [],
    };
    receipt(m, "PUBLISHED", EXECUTOR_ID, {
      prUrl: input.prUrl ?? null,
      commitSha: input.commitSha ?? null,
      artifactSha256: m.handback.artifactSha256 ?? null,
    });
    legalGo(m, "READY_FOR_REVIEW", EXECUTOR_ID);
    legalGo(m, "REVIEWING", REVIEWER_ID);
    m.reviewerActorId = REVIEWER_ID;
    m.lease = {
      actorId: REVIEWER_ID,
      token: input.leaseToken,
      attempt: m.attempt,
      expiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
    };
  });
}

export async function recordPresidentGithubReview(
  store: CycleStore,
  input: {
    cycleId: string;
    missionId: string;
    leaseToken: string;
    verdict: ReviewVerdict;
    reasons: string[];
  }
) {
  await missionWithLease(
    store,
    input.cycleId,
    input.missionId,
    input.leaseToken
  );
  await store.update(input.cycleId, c => {
    const m = c.missions.find(x => x.missionId === input.missionId)!;
    if (!m.lease || m.lease.token !== input.leaseToken)
      throw new Error("Mission lease mismatch");
    if (m.status !== "REVIEWING") throw new Error("Mission is not reviewing");
    if (m.executorActorId === REVIEWER_ID)
      throw new Error("Reviewer cannot equal executor");
    receipt(m, `REVIEW_${input.verdict}`, REVIEWER_ID, {
      reasons: input.reasons.slice(0, 20),
    });
    m.handback = {
      ...m.handback!,
      reviewVerdict: input.verdict,
      reviewReasons: input.reasons.slice(0, 20),
    };
    if (input.verdict === "PASS") {
      legalGo(
        m,
        m.humanGate === "MERGE_REQUIRED" ? "READY_FOR_HUMAN" : "COMPLETED",
        REVIEWER_ID
      );
      m.blocker = null;
    } else if (input.verdict === "FAIL") {
      if (m.attempt >= m.maxAttempts) {
        legalGo(m, "BLOCKED", REVIEWER_ID);
        m.blocker = "Independent review failed after maximum attempts";
      } else {
        legalGo(m, "REPAIR_REQUIRED", REVIEWER_ID);
      }
    } else {
      legalGo(m, "BLOCKED", REVIEWER_ID);
      m.blocker = `Independent reviewer blocked: ${input.reasons.join("; ").slice(0, 2000)}`;
    }
    m.lease = null;
  });
  await finalizeCycleIfTerminal(store, input.cycleId);
}

function jsonBody(req: Request) {
  return (req.body ?? {}) as Record<string, any>;
}

export function registerPresidentGithubActionsBridge(app: Express) {
  const store = getPresidentCycleStore();
  const path = "/api/president/autonomous/github";

  app.use(path, express.json({ limit: "2mb" }));
  app.use(path, async (req, res, next) => {
    try {
      const token = bearer(req);
      if (!token) throw new Error("GitHub OIDC bearer required");
      await verifyPresidentGithubOidc(token);
      next();
    } catch (error) {
      res.status(401).json({
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.post(`${path}/claim`, async (_req, res) => {
    try {
      res.json(await claimPresidentGithubMission(store));
    } catch (error) {
      res.status(503).json({ error: (error as Error).message });
    }
  });

  app.post(`${path}/model`, async (req, res) => {
    try {
      const body = jsonBody(req);
      res.json(
        await presidentGithubModelTurn(store, {
          cycleId: String(body.cycleId),
          missionId: String(body.missionId),
          leaseToken: String(body.leaseToken),
          role: body.role === "REVIEWER" ? "REVIEWER" : "EXECUTOR",
          messages: Array.isArray(body.messages) ? body.messages : [],
        })
      );
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  app.post(`${path}/failure`, async (req, res) => {
    try {
      const body = jsonBody(req);
      await recordPresidentGithubFailure(store, {
        cycleId: String(body.cycleId),
        missionId: String(body.missionId),
        leaseToken: String(body.leaseToken),
        reason: String(body.reason ?? "execution failed"),
        checks: body.checks,
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  app.post(`${path}/published`, async (req, res) => {
    try {
      const body = jsonBody(req);
      await recordPresidentGithubPublication(store, body as any);
      res.json({ ok: true });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });

  app.post(`${path}/review`, async (req, res) => {
    try {
      const body = jsonBody(req);
      await recordPresidentGithubReview(store, {
        cycleId: String(body.cycleId),
        missionId: String(body.missionId),
        leaseToken: String(body.leaseToken),
        verdict: body.verdict,
        reasons: Array.isArray(body.reasons)
          ? body.reasons.map(String)
          : ["Reviewer returned no reasons"],
      });
      res.json({ ok: true });
    } catch (error) {
      res.status(409).json({ error: (error as Error).message });
    }
  });
}
