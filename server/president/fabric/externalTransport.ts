import { randomUUID } from "node:crypto";
import {
  MISSION_TRANSITIONS,
  type Cycle,
  type Mission,
  type MissionStatus,
  type ReviewVerdict,
} from "../../../shared/presidentCycle";
import type { CycleStore } from "../cycle/cycleStore";
import { verifyReceipt, setStatus } from "../cycle/cycleService";
import { generateMorningReport } from "./morningReport";
import { protectedViolations } from "./engineering";
import {
  assertIndependentReviewer,
  assertPresidentActor,
  BLOCKED_UNSUPPORTED,
  routeMission,
} from "./router";

const TERMINAL: MissionStatus[] = ["BLOCKED", "READY_FOR_HUMAN", "COMPLETED"];

function transition(m: Mission, to: MissionStatus, actorId: string) {
  const allowed = MISSION_TRANSITIONS[m.status] as readonly MissionStatus[] | undefined;
  if (!allowed?.includes(to))
    throw new Error(`Illegal mission transition ${m.status} -> ${to}`);
  m.transitions.push({
    at: new Date().toISOString(),
    from: m.status,
    to,
    actorId,
  });
  m.status = to;
}


function addReceipt(
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

function depsReady(c: Cycle, m: Mission): "READY" | "WAIT" | "BLOCKED" {
  let wait = false;
  for (const id of m.dependsOn) {
    const d = c.missions.find(x => x.missionId === id);
    if (!d || d.status === "BLOCKED") return "BLOCKED";
    if (!["READY_FOR_HUMAN", "COMPLETED"].includes(d.status)) wait = true;
  }
  return wait ? "WAIT" : "READY";
}

function leaseExpired(m: Mission) {
  return !m.lease || new Date(m.lease.expiresAt).getTime() <= Date.now();
}

function leaseFor(actorId: string, attempt: number) {
  return {
    actorId,
    token: randomUUID(),
    attempt,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  };
}

function normalizeBlockedMissions(c: Cycle, actorId: string) {
  for (const m of c.missions) {
    if (TERMINAL.includes(m.status) || ["READY_FOR_REVIEW", "REVIEWING"].includes(m.status))
      continue;
    const unsupported = routeMission(m.domain) === BLOCKED_UNSUPPORTED;
    const dependencyBlocked = depsReady(c, m) === "BLOCKED";
    if (!unsupported && !dependencyBlocked) continue;
    if (m.status === "ADAM_APPROVED") transition(m, "QUEUED", actorId);
    if (m.status === "PREPARING" || m.status === "EXECUTING" || m.status === "VALIDATING" || m.status === "REPAIR_REQUIRED" || m.status === "QUEUED") {
      transition(m, "BLOCKED", actorId);
      m.blocker = unsupported
        ? `${BLOCKED_UNSUPPORTED}: ${m.domain}`
        : "Dependency mission is BLOCKED";
      addReceipt(m, "BLOCKED", actorId, { reason: m.blocker });
      m.lease = null;
    }
  }
}

function nextExecutionMission(c: Cycle): Mission | null {
  for (const m of c.missions) {
    if (
      TERMINAL.includes(m.status) ||
      ["READY_FOR_REVIEW", "REVIEWING"].includes(m.status)
    )
      continue;
    if (m.lease && !leaseExpired(m)) continue;
    if (routeMission(m.domain) === BLOCKED_UNSUPPORTED) continue;
    if (depsReady(c, m) === "READY") return m;
  }
  return null;
}

export type ExternalMissionClaim = {
  cycleId: string;
  mission: Mission;
  leaseToken: string;
  route: "ENGINEERING" | "RESEARCH";
  feedback: string | null;
};

function lastFeedback(m: Mission): string | null {
  for (let i = m.receipts.length - 1; i >= 0; i--) {
    const r = m.receipts[i];
    if (
      ["VALIDATION_FAILED", "REVIEW_FAIL", "LEASE_RECOVERED", "EXECUTOR_ERROR"].includes(
        r.kind
      )
    )
      return JSON.stringify(r.data).slice(0, 4000);
  }
  return null;
}

export async function claimExternalExecution(
  store: CycleStore,
  actorId = "president-github-actions-executor"
): Promise<ExternalMissionClaim | null> {
  assertPresidentActor(actorId);
  const cycles = (await store.list()).filter(c => c.status === "EXECUTING");
  for (const snapshot of cycles) {
    const result = await store.update(snapshot.cycleId, c => {
      if (c.status !== "EXECUTING" || !c.approval || !verifyReceipt(c.approval))
        return null;
      normalizeBlockedMissions(c, actorId);
      maybeCompleteCycle(c);
      if (c.status !== "EXECUTING") return null;
      const m = nextExecutionMission(c);
      if (!m) return null;

      const dep = depsReady(c, m);
      if (dep === "BLOCKED") {
        if (m.status === "ADAM_APPROVED") transition(m, "QUEUED", actorId);
        transition(m, "BLOCKED", actorId);
        m.blocker = "Dependency mission is BLOCKED";
        return null;
      }

      if (m.lease && !leaseExpired(m)) return null;
      if (m.lease && leaseExpired(m)) {
        addReceipt(m, "LEASE_RECOVERED", actorId, {
          previousActor: m.lease.actorId,
          status: m.status,
        });
        m.lease = null;
        if (m.status === "REVIEWING") transition(m, "READY_FOR_REVIEW", actorId);
        else if (["PREPARING", "EXECUTING", "VALIDATING"].includes(m.status))
          transition(m, "REPAIR_REQUIRED", actorId);
      }

      if (m.status === "ADAM_APPROVED") transition(m, "QUEUED", actorId);
      if (m.status === "QUEUED") transition(m, "PREPARING", actorId);

      if (m.status === "PREPARING") {
        m.attempt += 1;
        m.executorActorId = actorId;
        transition(m, "EXECUTING", actorId);
      } else if (m.status === "REPAIR_REQUIRED") {
        if (m.attempt >= m.maxAttempts) {
          transition(m, "BLOCKED", actorId);
          m.blocker = `Repair attempts exhausted (${m.attempt}/${m.maxAttempts})`;
          addReceipt(m, "BLOCKED", actorId, { reason: m.blocker });
          return null;
        }
        m.attempt += 1;
        m.executorActorId = actorId;
        transition(m, "EXECUTING", actorId);
      } else if (m.status !== "EXECUTING") {
        return null;
      }

      const route = routeMission(m.domain);
      if (route === BLOCKED_UNSUPPORTED) return null;
      m.lease = leaseFor(actorId, m.attempt);
      addReceipt(m, "EXTERNAL_EXECUTION_CLAIMED", actorId, { route });
      return {
        cycleId: c.cycleId,
        mission: structuredClone(m),
        leaseToken: m.lease.token,
        route,
        feedback: lastFeedback(m),
      } satisfies ExternalMissionClaim;
    });
    if (result) return result;
  }
  return null;
}

function requireLease(
  m: Mission,
  actorId: string,
  token: string,
  expected: MissionStatus
) {
  if (m.status !== expected) throw new Error(`Mission is ${m.status}, expected ${expected}`);
  if (
    !m.lease ||
    m.lease.actorId !== actorId ||
    m.lease.token !== token ||
    m.lease.attempt !== m.attempt
  )
    throw new Error("Stale or invalid mission lease");
}

export type ExternalExecutionResult =
  | {
      ok: true;
      route: "ENGINEERING";
      baseSha: string;
      branch: string;
      commitSha: string;
      prUrl: string;
      changedFiles: string[];
      checks: { command: string; exitCode: number; ok: boolean }[];
      browserEvidence?: {
        ok: boolean;
        consoleErrors: string[];
        screenshotPath?: string;
        detail: string;
        workflowRunId?: string;
      };
      summary: string;
    }
  | {
      ok: true;
      route: "RESEARCH";
      artifactText: string;
      artifactSha256: string;
      summary: string;
    }
  | {
      ok: false;
      reason: string;
      validationFailure?: boolean;
    };

export async function reportExternalExecution(
  store: CycleStore,
  input: {
    cycleId: string;
    missionId: string;
    leaseToken: string;
    actorId?: string;
    result: ExternalExecutionResult;
  }
) {
  const actorId = input.actorId ?? "president-github-actions-executor";
  assertPresidentActor(actorId);
  await store.update(input.cycleId, c => {
    const m = c.missions.find(x => x.missionId === input.missionId);
    if (!m) throw new Error("Unknown mission");
    requireLease(m, actorId, input.leaseToken, "EXECUTING");

    if (!input.result.ok) {
      addReceipt(
        m,
        input.result.validationFailure ? "VALIDATION_FAILED" : "EXECUTOR_ERROR",
        actorId,
        { reason: input.result.reason }
      );
      m.lease = null;
      if (m.attempt >= m.maxAttempts) {
        transition(m, "BLOCKED", actorId);
        m.blocker = input.result.reason;
      } else transition(m, "REPAIR_REQUIRED", actorId);
      return;
    }

    if (input.result.route === "ENGINEERING") {
      if (!/^[a-f0-9]{40}$/i.test(input.result.baseSha))
        throw new Error("Invalid base SHA");
      if (!/^[a-f0-9]{40}$/i.test(input.result.commitSha))
        throw new Error("Invalid commit SHA");
      if (!/^president\//.test(input.result.branch))
        throw new Error("President mission branch required");
      if (!/^https:\/\/github\.com\/adamwright83-blip\/bldg-admin-api\/pull\/\d+$/.test(input.result.prUrl))
        throw new Error("Unexpected PR URL");
      if (!input.result.changedFiles.length)
        throw new Error("Engineering execution produced no changed files");
      const violations = protectedViolations(input.result.changedFiles);
      if (violations.length)
        throw new Error(`Protected files changed: ${violations.join(", ")}`);
      if (input.result.checks.some(x => !x.ok))
        throw new Error("Required validation did not pass");
      if (
        m.requiredValidation.browser &&
        input.result.browserEvidence?.ok !== true
      )
        throw new Error("Required browser validation did not pass");
      m.handback = {
        baseSha: input.result.baseSha,
        branch: input.result.branch,
        commitSha: input.result.commitSha,
        prUrl: input.result.prUrl,
        changedFiles: input.result.changedFiles,
        checks: input.result.checks,
        browserEvidence: input.result.browserEvidence,
        evidenceIds: [],
      };
    } else {
      if (!input.result.artifactText.trim())
        throw new Error("Research artifact is empty");
      m.handback = {
        artifactText: input.result.artifactText,
        artifactSha256: input.result.artifactSha256,
        checks: [],
        evidenceIds: [],
      };
    }
    addReceipt(m, "EXTERNAL_EXECUTION_REPORTED", actorId, {
      route: input.result.route,
      summary: input.result.summary.slice(0, 2000),
    });
    m.lease = null;
    transition(m, "VALIDATING", actorId);
    transition(m, "READY_FOR_REVIEW", actorId);
  });
}

export async function claimExternalReview(
  store: CycleStore,
  actorId = "president-github-actions-reviewer"
): Promise<{ cycleId: string; mission: Mission; leaseToken: string } | null> {
  assertPresidentActor(actorId);
  const cycles = (await store.list()).filter(c => c.status === "EXECUTING");
  for (const snapshot of cycles) {
    const result = await store.update(snapshot.cycleId, c => {
      const m = c.missions.find(
        x =>
          x.status === "READY_FOR_REVIEW" ||
          (x.status === "REVIEWING" && leaseExpired(x))
      );
      if (!m) return null;
      if (!m.executorActorId) throw new Error("Mission has no executor actor");
      assertIndependentReviewer(m.executorActorId, actorId);
      if (m.status === "REVIEWING") {
        addReceipt(m, "LEASE_RECOVERED", actorId, {
          previousActor: m.lease?.actorId ?? null,
          status: m.status,
        });
        m.lease = null;
        transition(m, "READY_FOR_REVIEW", actorId);
      }
      if (m.lease && !leaseExpired(m)) return null;
      m.reviewerActorId = actorId;
      transition(m, "REVIEWING", actorId);
      m.lease = leaseFor(actorId, m.attempt);
      addReceipt(m, "EXTERNAL_REVIEW_CLAIMED", actorId, {});
      return {
        cycleId: c.cycleId,
        mission: structuredClone(m),
        leaseToken: m.lease.token,
      };
    });
    if (result) return result;
  }
  return null;
}

function maybeCompleteCycle(c: Cycle) {
  if (
    c.status === "EXECUTING" &&
    c.missions.length > 0 &&
    c.missions.every(m => TERMINAL.includes(m.status))
  ) {
    c.morningReport = generateMorningReport(c);
    setStatus(c, "COMPLETE", "all approved missions reached a terminal state");
  }
}

export async function reportExternalReview(
  store: CycleStore,
  input: {
    cycleId: string;
    missionId: string;
    leaseToken: string;
    actorId?: string;
    verdict: ReviewVerdict;
    reasons: string[];
    checks: { command: string; exitCode: number; ok: boolean }[];
  }
) {
  const actorId = input.actorId ?? "president-github-actions-reviewer";
  assertPresidentActor(actorId);
  await store.update(input.cycleId, c => {
    const m = c.missions.find(x => x.missionId === input.missionId);
    if (!m) throw new Error("Unknown mission");
    requireLease(m, actorId, input.leaseToken, "REVIEWING");
    if (!m.executorActorId)
      throw new Error("Mission has no executor actor");
    assertIndependentReviewer(m.executorActorId, actorId);

    let verdict = input.verdict;
    const reasons = [...input.reasons];
    if (
      verdict === "PASS" &&
      (!m.handback ||
        input.checks.some(x => !x.ok) ||
        (m.humanGate === "MERGE_REQUIRED" && !m.handback.prUrl))
    ) {
      verdict = "FAIL";
      reasons.unshift("Harness evidence is insufficient for PASS");
    }

    addReceipt(m, `REVIEW_${verdict}`, actorId, { reasons, checks: input.checks });
    m.handback = {
      ...m.handback!,
      checks: input.checks,
      reviewVerdict: verdict,
      reviewReasons: reasons,
    };
    m.lease = null;

    if (verdict === "PASS")
      transition(
        m,
        m.humanGate === "MERGE_REQUIRED" ? "READY_FOR_HUMAN" : "COMPLETED",
        actorId
      );
    else if (verdict === "FAIL") {
      if (m.attempt >= m.maxAttempts) {
        transition(m, "BLOCKED", actorId);
        m.blocker = reasons.join("; ");
      } else transition(m, "REPAIR_REQUIRED", actorId);
    } else {
      transition(m, "BLOCKED", actorId);
      m.blocker = reasons.join("; ");
    }

    maybeCompleteCycle(c);
  });
}
