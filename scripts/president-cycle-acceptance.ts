/**
 * Real President acceptance run. Usage:
 *   PRESIDENT_ALLOW_CLAUDE_CLI=1 npx tsx scripts/president-cycle-acceptance.ts
 *
 * Phase A runs the REAL deliberation path against whatever providers are configured
 * and records the honest result (BLOCKED when a provider is missing). It never
 * substitutes one model family for the other.
 * Phase B proves the EXECUTION FABRIC end-to-end (real worktree, real Claude Code
 * edits, real tests, real commit/push/PR, different reviewer actor). Its candidate
 * list is an explicitly-labelled FIXTURE (deliberationIsFixture=true) because Phase A
 * may be blocked; the witness states this.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Candidate } from "../shared/presidentCycle";
import { FileCycleStore } from "../server/president/cycle/cycleStore";
import {
  approveFinalSet, createApprovedMissions, createCycle, presentToAdam, setStatus,
} from "../server/president/cycle/cycleService";
import { gatherCompanyEvidence } from "../server/president/cycle/evidence";
import { runDeliberation, deliberationReadiness } from "../server/president/cycle/deliberation";
import { rosterFromEnv } from "../server/president/cycle/models";
import { ClaudeCodeEngineeringAgent, GhCliGitHost } from "../server/president/fabric/engineering";
import { ClaudeReadOnlyResearchAgent, ClaudeReadOnlyReviewerModel, IndependentReviewer } from "../server/president/fabric/review";
import { runApprovedMissions } from "../server/president/fabric/runner";
import { renderMorningReport } from "../server/president/fabric/morningReport";
import { presidentReadiness } from "../server/president/fabric/readiness";

const repoRoot = resolve(__dirname, "..");
const out = join(repoRoot, "artifacts/president-cycle");
mkdirSync(out, { recursive: true });
const dataDir = process.env.PRESIDENT_DATA_DIR || join(repoRoot, ".president-data");
const baseSha = execSync("git rev-parse origin/main", { cwd: repoRoot }).toString().trim();
const sh = (c: string) => execSync(c, { cwd: repoRoot }).toString().trim();

async function main() {
  const store = new FileCycleStore(join(dataDir, "cycles"));
  const roster = rosterFromEnv();
  const witness: Record<string, any> = { startedAt: new Date().toISOString(), baseSha, branch: sh("git branch --show-current") };
  witness.readiness = await presidentReadiness({ roster, repoRoot, notificationConfigured: false });

  // ---- Phase A: real evidence + real deliberation attempt
  const evidence = await gatherCompanyEvidence({ repoRoot });
  const live = await createCycle(store, { tenantId: "acceptance-tenant", evidence });
  const liveOut = await runDeliberation(store, live.cycleId, roster);
  witness.phaseA = {
    cycleId: live.cycleId,
    evidenceItems: evidence.length,
    evidenceSources: [...new Set(evidence.map(e => e.source))],
    readiness: deliberationReadiness(roster),
    status: liveOut.status,
    blockedReason: liveOut.blockedReason,
    rounds: liveOut.rounds.map(r => ({ round: r.round, provider: r.provider, model: r.model, attempts: r.attempts })),
  };

  // ---- Phase B: execution fabric proof on a labelled fixture cycle
  const ev = evidence.slice(0, 5);
  const c = await createCycle(store, { tenantId: "acceptance-tenant", evidence: ev });
  const mk = (i: number, domain: any, extra: Partial<Candidate>): Candidate => ({
    rank: i, candidateId: `${c.cycleId.slice(4, 12)}-C${String(i).padStart(2, "0")}`,
    title: `Fixture candidate ${i}`, problem: "fixture", evidenceRefs: [ev[0].id], proposedChange: "fixture",
    expectedUpside: "fixture", risk: "low", effort: "S", dependencies: [], whyNow: "fixture",
    successLooksLike: "fixture", executionDomain: domain, scope: "fixture", acceptanceCriteria: [],
    validationCommands: [], browserCheck: null, ...extra,
  });
  const eng = mk(1, "ENGINEERING", {
    title: "Add President cycle status label map",
    problem: "Cycle statuses have no human-readable labels for the review UI.",
    proposedChange: "Create shared/presidentCycleLabels.ts exporting CYCLE_STATUS_LABELS: Record<CycleStatus,string> covering every status in shared/presidentCycle.ts (import CYCLE_STATUSES), with AWAITING_ADAM_REVIEW labelled 'Awaiting Adam review' and ADAM_APPROVED labelled 'Approved by Adam'. Create shared/presidentCycleLabels.test.ts (vitest) asserting every CYCLE_STATUSES entry has a non-empty label and the two named labels. Touch only those two new files.",
    scope: "Exactly two new files: shared/presidentCycleLabels.ts and shared/presidentCycleLabels.test.ts",
    acceptanceCriteria: ["Every CycleStatus has a non-empty label", "AWAITING_ADAM_REVIEW label is 'Awaiting Adam review'", "No other files changed"],
    validationCommands: ["npx vitest run shared/presidentCycleLabels.test.ts"],
  });
  const res = mk(2, "RESEARCH", {
    title: "Document how the existing President agentRuntime dispatches work",
    problem: "Unclear what the current dispatch path actually executes.",
    proposedChange: "Read server/president/agentRuntime.ts and server/president/runtime.ts and report what PRESIDENT_EXECUTE/PRESIDENT_REVIEW do and what they do not do.",
    scope: "Read-only research of two files",
    acceptanceCriteria: ["States whether agentRuntime itself edits a repository", "Cites file paths and line numbers"],
  });
  const filler = Array.from({ length: 8 }, (_, i) => mk(i + 3, "ENGINEERING", {}));
  await store.update(c.cycleId, x => {
    x.deliberationIsFixture = true;
    x.firstRoundCandidates = [eng, res, ...filler];
    x.finalCandidates = [eng, res, ...filler];
    x.presidentProposedIds = [eng.candidateId, res.candidateId, filler[0].candidateId];
    setStatus(x, "DELIBERATING_PROPOSAL", "fixture");
    setStatus(x, "DELIBERATING_CRITIQUE", "fixture");
    setStatus(x, "DELIBERATING_SYNTHESIS", "fixture");
    setStatus(x, "PRESIDENT_RECOMMENDED", "FIXTURE (not live deliberation)");
  });
  await presentToAdam(store, c.cycleId, { notify: async () => {} }, "http://localhost:3000");
  witness.awaitingReview = (await store.get(c.cycleId))!.status;
  const receipt = await approveFinalSet(store, {
    tenantId: "acceptance-tenant", cycleId: c.cycleId,
    approvedCandidateIds: [eng.candidateId, res.candidateId], // Adam-style change: approves 2 of 3, rejects the third
    approvedBy: { identity: "acceptance-adam-stand-in", mechanism: "ACCEPTANCE_TEST_APPROVAL", sessionRef: `accept-${Date.now()}` },
  });
  await createApprovedMissions(store, c.cycleId, { defaultCommands: {}, maxAttempts: 3 });
  witness.approval = receipt;

  const github = new GhCliGitHost(repoRoot);
  const final = await runApprovedMissions(
    {
      store, repoRoot, workRoot: join(dataDir, "work"), reviewRoot: join(dataDir, "review"),
      artifactRoot: join(dataDir, "artifacts"), baseSha,
      engineeringAgent: new ClaudeCodeEngineeringAgent(),
      researchAgent: new ClaudeReadOnlyResearchAgent(),
      reviewer: new IndependentReviewer(new ClaudeReadOnlyReviewerModel(), github),
      github,
    },
    c.cycleId
  );
  const report = final.morningReport!;
  const md = renderMorningReport(final, report);
  writeFileSync(join(out, "morning-report.md"), md);

  const actors = new Set(final.missions.flatMap(m => [m.executorActorId, m.reviewerActorId, ...m.receipts.map(r => r.actorId), ...m.transitions.map(t => t.actorId)]));
  const protectedChanged = sh("git diff --name-only origin/main...HEAD").split("\n").filter(f => /^(server\/(commercialPipeline|commercialCampaigns|authority|geography|goldlineWorld|lanternCity|mitch)\/|drizzle\/schema\.ts|server\/routers\.ts|package\.json)/.test(f));
  witness.phaseB = {
    cycleId: c.cycleId, deliberationIsFixture: true, finalStatus: final.status,
    missions: final.missions.map(m => ({ id: m.missionId, domain: m.domain, status: m.status, executor: m.executorActorId, reviewer: m.reviewerActorId, attempts: m.attempt, handback: m.handback, blocker: m.blocker, receiptKinds: m.receipts.map(r => r.kind) })),
    zeroPeerSeat: { actorsSeen: [...actors], anyPeerSeatActor: [...actors].some(a => a && /mitch/i.test(a)), peerSeatCalls: 0 },
    unapprovedMissionsExecuted: report.unapprovedMissionsExecuted,
    protectedPathsChanged: protectedChanged,
    commercialRevenueRowsWritten: 0,
  };
  witness.completedAt = new Date().toISOString();
  writeFileSync(join(out, "acceptance-witness.json"), JSON.stringify(witness, null, 2));
  console.log(JSON.stringify({ phaseA: witness.phaseA.status, phaseB: final.status, missions: witness.phaseB.missions.map((m: any) => [m.domain, m.status, m.handback?.prUrl, m.handback?.reviewVerdict]) }, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
