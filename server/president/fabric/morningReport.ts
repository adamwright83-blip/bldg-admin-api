import { MysqlPresidentCycleStore } from "../cycle/store";

export async function buildPresidentMorningReport(
  store: MysqlPresidentCycleStore,
  cycleId: string
) {
  const cycle = await store.getCycle(cycleId);
  if (!cycle) throw new Error("President cycle not found");
  const missions = await store.listMissions(cycleId);
  const approvedIds = new Set(cycle.approval?.approvedCandidateIds ?? []);
  const unapprovedExecuted = missions.filter(
    mission =>
      !approvedIds.has(mission.candidateId) &&
      !["QUEUED", "BLOCKED"].includes(mission.state)
  );
  if (unapprovedExecuted.length)
    throw new Error("President morning report detected unapproved execution");

  const remainingSeven = cycle.finalCandidates
    ? cycle.finalCandidates.candidates.filter(
        candidate => !new Set(cycle.proposedCandidateIds).has(candidate.id)
      )
    : [];

  return {
    cycleId: cycle.id,
    cycleState: cycle.state,
    generatedAt: new Date().toISOString(),
    proposedCandidateIds: cycle.proposedCandidateIds,
    approvedCandidateIds: cycle.approval?.approvedCandidateIds ?? [],
    approvalReceipt: cycle.approval,
    noUnapprovedMissionsExecuted: unapprovedExecuted.length === 0,
    remainingRecommendations: remainingSeven,
    missions: missions.map(mission => ({
      id: mission.id,
      candidateId: mission.candidateId,
      title: mission.title,
      executionDomain: mission.executionDomain,
      state: mission.state,
      attempts: mission.attemptCount,
      executorId: mission.executorId,
      reviewerId: mission.reviewerId,
      branch: mission.branch,
      commitSha: mission.commitSha,
      pullRequestUrl: mission.pullRequestUrl,
      blocker: mission.blocker,
      result: mission.result,
      review: mission.review,
      nextHumanAction:
        mission.state === "READY_FOR_HUMAN"
          ? "Review and merge the pull request if you approve it."
          : mission.state === "BLOCKED"
            ? "Resolve the blocker or change the approved mission."
            : null,
      outcomeStatus:
        mission.state === "READY_FOR_HUMAN"
          ? "IMPLEMENTED_AND_REVIEWED_NOT_MERGED"
          : mission.state === "COMPLETED"
            ? "COMPLETED_NON_CODE_ARTIFACT"
            : mission.state,
    })),
    caveat:
      "A ready PR is not a merged deployment or a measured business outcome.",
  };
}
