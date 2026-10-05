import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  MISSION_TRANSITIONS,
  type Cycle,
  type Mission,
  type MissionStatus,
} from "../../../shared/presidentCycle";
import type { CycleStore } from "../cycle/cycleStore";
import { setStatus } from "../cycle/cycleService";
import { runCommand, assertSafeValidationCommand } from "./exec";
import {
  changedFiles,
  commitAndPush,
  prBody,
  prepareWorkspace,
  protectedViolations,
  runBrowserCheck,
  type EngineeringAgent,
  type GitHost,
} from "./engineering";
import {
  IndependentReviewer,
  validateResearchArtifact,
  writeArtifact,
  type ResearchAgent,
} from "./review";
import { BLOCKED_UNSUPPORTED, assertIndependentReviewer, assertPresidentActor, routeMission } from "./router";
import { generateMorningReport } from "./morningReport";

export class StaleWorkerError extends Error {}

export type FabricDeps = {
  store: CycleStore;
  repoRoot: string;
  workRoot: string;
  reviewRoot: string;
  artifactRoot: string;
  baseSha: string;
  engineeringAgent: EngineeringAgent | null;
  researchAgent: ResearchAgent | null;
  reviewer: IndependentReviewer | null;
  github: GitHost | null;
  leaseMs?: number;
  prRetries?: number;
};

const TERMINAL: MissionStatus[] = ["BLOCKED", "READY_FOR_HUMAN", "COMPLETED"];
const MID_FLIGHT: MissionStatus[] = ["PREPARING", "EXECUTING", "VALIDATING", "REVIEWING"];

function tail(s: string, n = 2000) {
  return s.length > n ? s.slice(-n) : s;
}

function go(m: Mission, to: MissionStatus, actorId: string) {
  if (!MISSION_TRANSITIONS[m.status].includes(to))
    throw new Error(`Illegal mission transition ${m.status} -> ${to}`);
  m.transitions.push({ at: new Date().toISOString(), from: m.status, to, actorId });
  m.status = to;
}

function receipt(m: Mission, kind: string, actorId: string, data: Record<string, unknown>) {
  m.receipts.push({ at: new Date().toISOString(), kind, actorId, attempt: m.attempt, data });
}

type Held = { token: string; attempt: number; workerId: string };

/** Mutate a mission only while holding the current lease; a stale worker is rejected. */
async function mutate<T>(
  deps: FabricDeps,
  cycleId: string,
  missionId: string,
  held: Held,
  fn: (m: Mission, c: Cycle) => T
): Promise<T> {
  return deps.store.update(cycleId, c => {
    const m = c.missions.find(x => x.missionId === missionId);
    if (!m) throw new Error("Unknown mission");
    if (!m.lease || m.lease.token !== held.token || m.attempt !== held.attempt)
      throw new StaleWorkerError(`Stale worker ${held.workerId} for ${missionId}`);
    return fn(m, c);
  });
}

function renew(deps: FabricDeps, m: Mission, held: Held) {
  m.lease = {
    actorId: held.workerId,
    token: held.token,
    attempt: m.attempt,
    expiresAt: new Date(Date.now() + (deps.leaseMs ?? 45 * 60_000)).toISOString(),
  };
}

function dependenciesState(c: Cycle, m: Mission): "READY" | "WAIT" | "BLOCKED" {
  let wait = false;
  for (const id of m.dependsOn) {
    const d = c.missions.find(x => x.missionId === id);
    if (!d || d.status === "BLOCKED") return "BLOCKED";
    if (d.status !== "READY_FOR_HUMAN" && d.status !== "COMPLETED") wait = true;
  }
  return wait ? "WAIT" : "READY";
}

/**
 * Atomically claims the next unit of work. Recovers expired leases left by a dead worker.
 * Duplicate calls cannot double-execute: only one claimant gets a token.
 */
export async function claimMission(
  deps: FabricDeps,
  cycleId: string,
  missionId: string,
  workerId: string
): Promise<{ held: Held; status: MissionStatus } | null> {
  assertPresidentActor(workerId);
  return deps.store.update(cycleId, c => {
    const m = c.missions.find(x => x.missionId === missionId);
    if (!m || c.status !== "EXECUTING" || !c.approval) return null;
    if (TERMINAL.includes(m.status)) return null;
    const live = m.lease && new Date(m.lease.expiresAt).getTime() > Date.now();
    if (live) return null;
    const dep = dependenciesState(c, m);
    if (dep === "WAIT") return null;
    if (dep === "BLOCKED") {
      if (m.status === "ADAM_APPROVED") go(m, "QUEUED", workerId);
      go(m, "BLOCKED", workerId);
      m.blocker = "Dependency mission is BLOCKED";
      m.lease = null;
      return null;
    }
    // Stale lease from a dead process: recover instead of duplicating.
    if (MID_FLIGHT.includes(m.status) && m.lease) {
      receipt(m, "LEASE_RECOVERED", workerId, { previousActor: m.lease.actorId, status: m.status });
      if (m.status === "REVIEWING") go(m, "READY_FOR_REVIEW", workerId);
      else go(m, "REPAIR_REQUIRED", workerId);
      m.lease = null;
    }
    if (m.status === "ADAM_APPROVED") go(m, "QUEUED", workerId);
    if (m.status === "QUEUED") go(m, "PREPARING", workerId);
    else if (m.status === "REPAIR_REQUIRED") {
      if (m.attempt >= m.maxAttempts) {
        go(m, "BLOCKED", workerId);
        m.blocker = `Repair attempts exhausted (${m.attempt}/${m.maxAttempts})`;
        receipt(m, "BLOCKED", workerId, { reason: m.blocker });
        m.lease = null;
        return null;
      }
      m.attempt += 1;
      go(m, "EXECUTING", workerId);
    } else if (m.status === "PREPARING") {
      /* resumed prepare */
    } else if (m.status !== "READY_FOR_REVIEW") return null;
    const held: Held = { token: randomUUID(), attempt: m.attempt, workerId };
    renew(deps, m, held);
    return { held, status: m.status };
  });
}

function lastFeedback(m: Mission): string | undefined {
  for (let i = m.receipts.length - 1; i >= 0; i--) {
    const r = m.receipts[i];
    if (["VALIDATION_FAILED", "REVIEW_FAIL", "LEASE_RECOVERED", "EXECUTOR_ERROR"].includes(r.kind))
      return JSON.stringify(r.data).slice(0, 3000);
  }
  return undefined;
}

async function block(deps: FabricDeps, cycleId: string, id: string, held: Held, reason: string, data: Record<string, unknown> = {}) {
  await mutate(deps, cycleId, id, held, m => {
    receipt(m, "BLOCKED", held.workerId, { reason, ...data });
    if (m.status !== "BLOCKED") go(m, "BLOCKED", held.workerId);
    m.blocker = reason;
    m.lease = null;
  });
}

/**
 * Reconstructs ephemeral worker state from durable mission identity. Engineering
 * resumes its mission branch; research needs only a clean snapshot of the pinned
 * base. This is safe to call on every pass.
 */
async function ensureMissionWorkspace(
  deps: FabricDeps,
  m: Mission,
  kind: "ENGINEERING" | "RESEARCH",
  wsDir: string
) {
  if (kind === "ENGINEERING") {
    await prepareWorkspace(deps.repoRoot, deps.workRoot, m, deps.baseSha);
    return;
  }
  if (existsSync(wsDir)) return;
  mkdirSync(deps.workRoot, { recursive: true });
  await runCommand("git worktree prune", deps.repoRoot, { timeoutMs: 30_000 });
  const r = await runCommand(
    `git worktree add --detach '${wsDir}' ${deps.baseSha}`,
    deps.repoRoot,
    { timeoutMs: 120_000 }
  );
  if (r.exitCode !== 0)
    throw new Error(`snapshot failed: ${r.stderr.slice(0, 200)}`);
  const nodeModules = join(deps.repoRoot, "node_modules");
  if (existsSync(nodeModules))
    await runCommand(
      `ln -s '${nodeModules}' '${wsDir}/node_modules'`,
      deps.repoRoot
    );
}

/** One leased pass. Returns when the mission reaches a state needing another claim, or terminates. */
export async function runMissionPass(
  deps: FabricDeps,
  cycleId: string,
  missionId: string,
  workerId: string
): Promise<MissionStatus | null> {
  const claim = await claimMission(deps, cycleId, missionId, workerId);
  if (!claim) return null;
  const { held } = claim;
  let c = (await deps.store.get(cycleId))!;
  let m = c.missions.find(x => x.missionId === missionId)!;

  const kind = routeMission(m.domain);
  if (kind === BLOCKED_UNSUPPORTED) {
    await block(deps, cycleId, missionId, held, `${BLOCKED_UNSUPPORTED}: ${m.domain}`);
    return "BLOCKED";
  }
  const executor = kind === "ENGINEERING" ? deps.engineeringAgent : deps.researchAgent;
  if (!executor) {
    await block(deps, cycleId, missionId, held, `${kind} executor not configured`);
    return "BLOCKED";
  }
  try {
    assertPresidentActor(executor.actorId);
    if (deps.reviewer) assertIndependentReviewer(executor.actorId, deps.reviewer.actorId);
  } catch (e) {
    await block(deps, cycleId, missionId, held, (e as Error).message);
    return "BLOCKED";
  }
  const wsDir = join(deps.workRoot, m.missionId);

  try {
    /* ---------------------------------------------------------- PREPARING */
    // PREPARING and recovered REPAIR/REVIEW passes all reconstruct any
    // ephemeral worktree they need before touching the mission.
    await ensureMissionWorkspace(deps, m, kind, wsDir);

    if (claim.status === "PREPARING") {
      await mutate(deps, cycleId, missionId, held, mm => {
        mm.executorActorId = executor.actorId;
        mm.attempt += 1;
        held.attempt = mm.attempt;
        renew(deps, mm, held);
        receipt(mm, "PREPARED", held.workerId, { baseSha: deps.baseSha, kind });
        go(mm, "EXECUTING", held.workerId);
      });
    }
    c = (await deps.store.get(cycleId))!;
    m = c.missions.find(x => x.missionId === missionId)!;

    /* ---------------------------------------------------------- EXECUTING */
    if (m.status === "EXECUTING") {
      const feedback = lastFeedback(m);
      let summary = "";
      let artifactPath: string | undefined;
      if (kind === "ENGINEERING") {
        const r = await deps.engineeringAgent!.run({ workdir: wsDir, mission: m, feedback });
        summary = r.summary;
      } else {
        const md = await deps.researchAgent!.run({ repoSnapshot: wsDir, mission: m, feedback });
        const w = writeArtifact(deps.artifactRoot, m.cycleId, m.missionId, md);
        artifactPath = w.path;
        summary = `artifact sha256 ${w.sha256}`;
        await mutate(deps, cycleId, missionId, held, mm => {
          mm.handback = {
            artifactPath: w.path,
            artifactText: md,
            artifactSha256: w.sha256,
            checks: [],
            evidenceIds: [],
          };
        });
      }
      await mutate(deps, cycleId, missionId, held, mm => {
        renew(deps, mm, held);
        receipt(mm, "EXECUTED", held.workerId, { summary: tail(summary, 1500), artifactPath });
        if (artifactPath && !mm.handback)
          throw new Error("Research artifact handback was not persisted");
        go(mm, "VALIDATING", held.workerId);
      });
    }
    c = (await deps.store.get(cycleId))!;
    m = c.missions.find(x => x.missionId === missionId)!;

    /* --------------------------------------------------------- VALIDATING */
    if (m.status === "VALIDATING") {
      if (kind === "RESEARCH") {
        const text =
          m.handback?.artifactText ??
          (m.handback?.artifactPath && existsSync(m.handback.artifactPath)
            ? (await import("node:fs")).readFileSync(
                m.handback.artifactPath,
                "utf8"
              )
            : "");
        const problems = validateResearchArtifact(text, wsDir);
        await mutate(deps, cycleId, missionId, held, mm => {
          renew(deps, mm, held);
          if (problems.length) {
            receipt(mm, "VALIDATION_FAILED", held.workerId, { problems });
            go(mm, "REPAIR_REQUIRED", held.workerId);
            mm.lease = null;
          } else {
            receipt(mm, "VALIDATED", held.workerId, { problems: [] });
            go(mm, "READY_FOR_REVIEW", held.workerId);
          }
        });
      } else {
        const files = await changedFiles(wsDir, deps.baseSha);
        const violations = protectedViolations(files);
        const checks: { command: string; exitCode: number; ok: boolean }[] = [];
        const logs: string[] = [];
        for (const cmd of m.requiredValidation.commands) {
          assertSafeValidationCommand(cmd);
          const r = await runCommand(cmd, wsDir, { timeoutMs: 900_000 });
          checks.push({ command: cmd, exitCode: r.exitCode, ok: r.exitCode === 0 });
          if (r.exitCode !== 0) logs.push(`${cmd}\n${tail(r.stdout + r.stderr)}`);
        }
        let browser: { ok: boolean; consoleErrors: string[]; screenshotPath?: string; detail: string } | null = null;
        if (m.requiredValidation.browser)
          browser = await runBrowserCheck(
            m.requiredValidation.browser,
            wsDir,
            join(deps.artifactRoot, m.cycleId, `${m.missionId}-attempt${m.attempt}.png`)
          );
        const problems: string[] = [];
        if (files.length === 0) problems.push("Executor produced no file changes");
        if (violations.length) problems.push(`Touched protected/out-of-scope files: ${violations.join(", ")}`);
        for (const x of checks) if (!x.ok) problems.push(`Check failed: ${x.command}`);
        if (browser && !browser.ok) problems.push(`Browser validation failed: ${browser.detail} ${browser.consoleErrors.join(" | ")}`);

        if (problems.length) {
          // Protected-path violations cannot be repaired by retrying blindly; still bounded by attempts.
          await mutate(deps, cycleId, missionId, held, mm => {
            renew(deps, mm, held);
            receipt(mm, "VALIDATION_FAILED", held.workerId, { problems, logs: logs.map(l => tail(l, 1500)), checks });
            go(mm, "REPAIR_REQUIRED", held.workerId);
            mm.lease = null;
          });
          return "REPAIR_REQUIRED";
        }
        // Publish: commit, push, PR (idempotent).
        const ws = { dir: wsDir, branch: `president/${m.missionId}`, baseSha: deps.baseSha };
        const { commitSha } = await commitAndPush(ws, m, `President mission ${m.missionId}: ${m.title}`);
        if (!deps.github) throw new Error("GitHub host not configured");
        let prUrl = await deps.github.findPr(ws.branch);
        let lastErr: unknown;
        for (let i = 0; !prUrl && i < (deps.prRetries ?? 3); i++) {
          try {
            prUrl = await deps.github.createPr({
              branch: ws.branch,
              title: `[President] ${m.title}`,
              body: prBody(m, {
                summary: m.receipts.filter(r => r.kind === "EXECUTED").slice(-1)[0]?.data.summary as string ?? "",
                files,
                checks: checks.map(x => ({ ...x, command: x.command, stdout: "", stderr: "", timedOut: false, durationMs: 0 })),
                browser: browser ? `ok=${browser.ok}, console errors=${browser.consoleErrors.length}, screenshot=${browser.screenshotPath ?? "n/a"}` : undefined,
              }),
            });
          } catch (e) {
            lastErr = e;
            prUrl = await deps.github.findPr(ws.branch).catch(() => null);
            await new Promise(r => setTimeout(r, 1500 * (i + 1)));
          }
        }
        if (!prUrl) {
          await block(deps, cycleId, missionId, held, `PR creation failed: ${(lastErr as Error)?.message}`, { commitSha, branch: ws.branch });
          return "BLOCKED";
        }
        await mutate(deps, cycleId, missionId, held, mm => {
          renew(deps, mm, held);
          mm.handback = {
            prUrl,
            branch: ws.branch,
            commitSha,
            changedFiles: files,
            checks,
            browserEvidence: browser ?? undefined,
            evidenceIds: [],
          };
          receipt(mm, "PUBLISHED", held.workerId, { prUrl, commitSha, branch: ws.branch });
          go(mm, "READY_FOR_REVIEW", held.workerId);
        });
      }
    }
    c = (await deps.store.get(cycleId))!;
    m = c.missions.find(x => x.missionId === missionId)!;

    /* ---------------------------------------------------------- REVIEWING */
    if (m.status === "READY_FOR_REVIEW") {
      if (!deps.reviewer) {
        await block(deps, cycleId, missionId, held, "Independent reviewer not configured");
        return "BLOCKED";
      }
      const reviewer = deps.reviewer;
      await mutate(deps, cycleId, missionId, held, mm => {
        assertIndependentReviewer(mm.executorActorId!, reviewer.actorId);
        mm.reviewerActorId = reviewer.actorId;
        renew(deps, mm, held);
        go(mm, "REVIEWING", held.workerId);
      });
      const res =
        kind === "ENGINEERING"
          ? await reviewer.reviewEngineering({
              mission: m,
              repoRoot: deps.repoRoot,
              reviewRoot: deps.reviewRoot,
              branch: m.handback!.branch!,
              baseSha: deps.baseSha,
              commitSha: m.handback!.commitSha!,
              prUrl: m.handback!.prUrl ?? null,
              executorActorId: m.executorActorId!,
              executorChecks: m.handback!.checks,
            })
          : await reviewer.reviewResearch({
              mission: m,
              artifactPath: m.handback!.artifactPath,
              artifactText: m.handback!.artifactText,
              repoSnapshot: wsDir,
              executorActorId: m.executorActorId!,
            });
      await mutate(deps, cycleId, missionId, held, mm => {
        receipt(mm, `REVIEW_${res.verdict}`, res.actorId, { reasons: res.reasons, checks: res.checks, browserOk: res.browserOk });
        mm.handback = { ...mm.handback!, reviewVerdict: res.verdict, reviewReasons: res.reasons };
        if (res.verdict === "PASS") {
          go(mm, mm.humanGate === "MERGE_REQUIRED" ? "READY_FOR_HUMAN" : "COMPLETED", res.actorId);
          mm.lease = null;
        } else if (res.verdict === "FAIL") {
          go(mm, "REPAIR_REQUIRED", res.actorId);
          mm.lease = null;
        } else {
          go(mm, "BLOCKED", res.actorId);
          mm.blocker = `Reviewer BLOCKED: ${res.reasons.join("; ")}`;
          mm.lease = null;
        }
      });
    }
  } catch (e) {
    if (e instanceof StaleWorkerError) return null;
    const msg = (e as Error).message;
    // Executor/infra error: bounded repair, never fabricated success.
    await mutate(deps, cycleId, missionId, held, mm => {
      receipt(mm, "EXECUTOR_ERROR", held.workerId, { error: tail(msg, 1000) });
      if (mm.status === "REVIEWING") go(mm, "READY_FOR_REVIEW", held.workerId);
      else if (["PREPARING", "EXECUTING", "VALIDATING"].includes(mm.status)) go(mm, "REPAIR_REQUIRED", held.workerId);
      mm.lease = null;
    }).catch(() => {});
  }
  c = (await deps.store.get(cycleId))!;
  return c.missions.find(x => x.missionId === missionId)!.status;
}

/**
 * Overnight driver: independent missions run in parallel, dependent ones serialize,
 * and one BLOCKED mission never stops the others. Only missions created from the
 * Adam receipt exist, so only they can run.
 */
export async function runApprovedMissions(
  deps: FabricDeps,
  cycleId: string,
  opts: { concurrency?: number; workerId?: string } = {}
): Promise<Cycle> {
  const workerId = opts.workerId ?? "president-fabric-worker";
  const conc = opts.concurrency ?? 3;
  let idle = 0;
  for (let round = 0; round < 200 && idle < 3; round++) {
    const c = (await deps.store.get(cycleId))!;
    if (c.status !== "EXECUTING") break;
    const pending = c.missions.filter(m => !TERMINAL.includes(m.status));
    if (pending.length === 0) break;
    let progressed = false;
    for (let i = 0; i < pending.length; i += conc) {
      const batch = pending.slice(i, i + conc);
      const rs = await Promise.allSettled(
        batch.map(m => runMissionPass(deps, cycleId, m.missionId, `${workerId}-${m.missionId.slice(-4)}`))
      );
      if (rs.some(r => r.status === "fulfilled" && r.value !== null)) progressed = true;
    }
    if (progressed) idle = 0;
    else {
      idle++;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  const final = (await deps.store.get(cycleId))!;
  if (final.missions.length && final.missions.every(m => TERMINAL.includes(m.status))) {
    await deps.store.update(cycleId, c => {
      if (c.status === "EXECUTING") {
        c.morningReport = generateMorningReport(c);
        setStatus(c, "COMPLETE", "all approved missions reached a terminal state");
      }
    });
  }
  return (await deps.store.get(cycleId))!;
}
