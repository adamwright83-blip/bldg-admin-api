import type { Cycle, MorningReport, Mission } from "../../../shared/presidentCycle";

function nextAction(m: Mission): string {
  switch (m.status) {
    case "READY_FOR_HUMAN":
      return `Review and merge PR ${m.handback?.prUrl ?? "(missing)"}; President cannot merge.`;
    case "COMPLETED":
      return "Read the artifact; no merge needed.";
    case "BLOCKED":
      return `Resolve blocker: ${m.blocker ?? "unknown"}`;
    default:
      return `Still ${m.status}; no action yet.`;
  }
}

/** Built only from persisted receipts and handbacks. No model text is consulted. */
export function generateMorningReport(c: Cycle): MorningReport {
  if (!c.approval) throw new Error("No approval receipt; nothing was authorized to run");
  const approved = new Set(c.approval.approvedCandidateIds);
  const executedUnapproved = c.missions.filter(m => !approved.has(m.candidateId));
  if (executedUnapproved.length) throw new Error("Unapproved mission present in cycle");
  return {
    generatedAt: new Date().toISOString(),
    audience: "ADAM",
    cycleId: c.cycleId,
    approvalReceiptId: c.approval.receiptId,
    approvedCandidateIds: c.approval.approvedCandidateIds,
    unapprovedMissionsExecuted: 0,
    remainingCandidateIds: c.finalCandidates
      .map(x => x.candidateId)
      .filter(id => !approved.has(id)),
    missions: c.missions.map(m => {
      const reviewed = m.handback?.reviewVerdict === "PASS";
      return {
        missionId: m.missionId,
        candidateId: m.candidateId,
        title: m.title,
        status: m.status,
        levels: {
          implemented: !!(m.handback?.commitSha || m.handback?.artifactPath),
          independentlyReviewed: !!m.handback?.reviewVerdict,
          prReady: !!m.handback?.prUrl && reviewed,
          merged: false,
          deployed: false,
          outcomeObserved: false,
        },
        prUrl: m.handback?.prUrl,
        changedFiles: m.handback?.changedFiles,
        checks: m.handback?.checks,
        reviewVerdict: m.handback?.reviewVerdict,
        blocker: m.blocker,
        nextHumanAction: nextAction(m),
      };
    }),
    outcomesNotYetObservable:
      "Nothing here is merged or deployed by President. Business/product outcomes are not observable until a human merges, deploys, and the measurement window passes.",
  };
}

export function renderMorningReport(c: Cycle, r: MorningReport): string {
  const byId = new Map(c.finalCandidates.map(x => [x.candidateId, x]));
  const lines = [
    `# President morning report — cycle ${r.cycleId}`,
    `To: Adam · Generated ${r.generatedAt}`,
    "",
    `Approval receipt \`${r.approvalReceiptId}\` by ${c.approval?.approvedBy.identity} at ${c.approval?.approvedAt}.`,
    `Approved candidates: ${r.approvedCandidateIds.join(", ")}`,
    `Unapproved missions executed: **${r.unapprovedMissionsExecuted}**`,
    "",
  ];
  for (const m of r.missions) {
    lines.push(
      `## ${m.title} — ${m.status}`,
      `Mission \`${m.missionId}\` / candidate \`${m.candidateId}\``,
      `- implemented: ${m.levels.implemented} · independently reviewed: ${m.levels.independentlyReviewed} (${m.reviewVerdict ?? "n/a"}) · PR ready: ${m.levels.prReady} · merged: false · deployed: false · outcome observed: false`,
      m.prUrl ? `- PR: ${m.prUrl}` : "",
      m.changedFiles?.length ? `- files: ${m.changedFiles.join(", ")}` : "",
      m.checks?.length ? `- checks: ${m.checks.map(x => `${x.command} → ${x.exitCode}`).join("; ")}` : "",
      m.blocker ? `- blocker: ${m.blocker}` : "",
      `- next human action: ${m.nextHumanAction}`,
      ""
    );
  }
  lines.push(
    "## Remaining recommendations (still available)",
    ...r.remainingCandidateIds.map(id => `- ${id}: ${byId.get(id)?.title ?? ""}`),
    "",
    `**Outcomes:** ${r.outcomesNotYetObservable}`
  );
  return lines.filter(l => l !== "").join("\n");
}
