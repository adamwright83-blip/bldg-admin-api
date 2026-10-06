import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Candidate, EvidenceItem } from "../../../shared/presidentCycle";
import {
  approveFinalSet,
  createApprovedMissions,
  createCycle,
  setStatus,
} from "../cycle/cycleService";
import { FileCycleStore } from "../cycle/cycleStore";
import { claimPresidentGithubMission } from "./githubActionsBridge";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function candidate(rank: number, domain: Candidate["executionDomain"] = "ENGINEERING"): Candidate {
  return {
    rank,
    candidateId: `candidate-${rank}`,
    title: `Candidate ${rank}`,
    problem: "Observed problem",
    evidenceRefs: ["ev-1"],
    proposedChange: `Implement candidate ${rank}`,
    expectedUpside: "Improved product",
    risk: "low",
    effort: "S",
    dependencies: [],
    whyNow: "Evidence supports action now",
    successLooksLike: "Acceptance passes",
    executionDomain: domain,
    scope: "bounded scope",
    acceptanceCriteria: ["Required behavior works"],
    validationCommands: ["pnpm check"],
    browserCheck: null,
    continuesCandidateId: `candidate-${rank}`,
    responseToClaude: "kept after critique",
    changedFromFirstRound: false,
    recommendedPriority: "HIGH",
  };
}

async function approvedCycle(count = 3) {
  const dir = mkdtempSync(join(tmpdir(), "president-actions-"));
  dirs.push(dir);
  const store = new FileCycleStore(dir);
  const evidence: EvidenceItem[] = [
    {
      id: "ev-1",
      source: "test",
      kind: "fixture",
      observedAt: new Date().toISOString(),
      summary: "fixture evidence",
      ref: "fixture:1",
      basis: "EVIDENCE",
    },
  ];
  const cycle = await createCycle(store, { tenantId: "tenant-a", evidence });
  const candidates = Array.from({ length: 10 }, (_, index) => candidate(index + 1));
  await store.update(cycle.cycleId, current => {
    current.firstRoundCandidates = candidates;
    current.finalCandidates = candidates;
    current.presidentProposedIds = candidates.slice(0, 3).map(x => x.candidateId);
    setStatus(current, "DELIBERATING_PROPOSAL", "fixture");
    setStatus(current, "DELIBERATING_CRITIQUE", "fixture");
    setStatus(current, "DELIBERATING_SYNTHESIS", "fixture");
    setStatus(current, "PRESIDENT_RECOMMENDED", "fixture");
    setStatus(current, "AWAITING_ADAM_REVIEW", "fixture");
  });
  await approveFinalSet(store, {
    tenantId: "tenant-a",
    cycleId: cycle.cycleId,
    approvedCandidateIds: candidates.slice(0, count).map(x => x.candidateId),
    approvedBy: {
      identity: "adam-test",
      mechanism: "test-founder-session",
      sessionRef: "session-1234567890",
    },
  });
  await createApprovedMissions(store, cycle.cycleId, {
    defaultCommands: { ENGINEERING: ["pnpm check"] },
    maxAttempts: 3,
  });
  return { store, cycleId: cycle.cycleId };
}

describe("President GitHub Actions mission claims", () => {
  it("atomically gives three parallel workers three different Adam-approved missions", async () => {
    const { store } = await approvedCycle(3);
    const base = "a".repeat(40);
    const claims = await Promise.all([
      claimPresidentGithubMission(store, base),
      claimPresidentGithubMission(store, base),
      claimPresidentGithubMission(store, base),
    ]);
    expect(claims.every(x => x.claimed)).toBe(true);
    const ids = claims.map(x => (x as any).mission.missionId);
    expect(new Set(ids).size).toBe(3);
    expect(claims.every(x => !(x as any).mission.title.toLowerCase().includes("mitch"))).toBe(true);
    expect((await claimPresidentGithubMission(store, base)).claimed).toBe(false);
  });

  it("never creates or claims an unapproved candidate", async () => {
    const { store, cycleId } = await approvedCycle(1);
    const claim = await claimPresidentGithubMission(store, "b".repeat(40));
    expect(claim.claimed).toBe(true);
    const cycle = await store.get(cycleId);
    expect(cycle?.missions).toHaveLength(1);
    expect(cycle?.missions[0].candidateId).toBe("candidate-1");
  });

  it("pins the exact execution base in the durable mission receipt", async () => {
    const { store, cycleId } = await approvedCycle(1);
    const base = "c".repeat(40);
    const claim = await claimPresidentGithubMission(store, base);
    expect((claim as any).baseSha).toBe(base);
    const cycle = await store.get(cycleId);
    expect(
      cycle?.missions[0].receipts.some(
        r => r.kind === "EXECUTION_BASE_PINNED" && r.data.baseSha === base
      )
    ).toBe(true);
  });
});
