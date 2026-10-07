import type { DaphneEpistemicClaimRecord } from "./epistemicStore";

export type DaphneHypothesis = {
  claimId: string;
  claimKey: string;
  claimType: DaphneEpistemicClaimRecord["claimType"];
  claim: Record<string, unknown>;
  supportCount: number;
  counterEvidenceCount: number;
  epistemicStatus: DaphneEpistemicClaimRecord["epistemicStatus"];
  causalEvidenceStatus: DaphneEpistemicClaimRecord["causalEvidenceStatus"];
  uncertainty: DaphneEpistemicClaimRecord["uncertainty"];
  score: number;
};

export type DaphneHypothesisSet = {
  claimKey: string;
  hypotheses: DaphneHypothesis[];
  preferredClaimId: string | null;
  decision: "prefer" | "competing_hypotheses" | "insufficient_evidence" | "abstain";
  uncertainty: {
    epistemic: number | null;
    aleatoric: number | null;
    change: number | null;
    measurement: number | null;
    decisionCost: "low" | "medium" | "high" | null;
  };
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedUncertainty(claim: DaphneEpistemicClaimRecord): number {
  const u = claim.uncertainty?.epistemic;
  return typeof u === "number" && Number.isFinite(u) ? clamp01(u) : 0.5;
}

function hypothesis(claim: DaphneEpistemicClaimRecord): DaphneHypothesis {
  const supportCount = claim.sourceObservationIds.length + claim.supportingEvidence.length;
  const counterEvidenceCount = claim.counterEvidence.length;
  const score =
    supportCount - counterEvidenceCount * 1.5 - normalizedUncertainty(claim);
  return {
    claimId: claim.id,
    claimKey: claim.claimKey,
    claimType: claim.claimType,
    claim: claim.claim,
    supportCount,
    counterEvidenceCount,
    epistemicStatus: claim.epistemicStatus,
    causalEvidenceStatus: claim.causalEvidenceStatus,
    uncertainty: claim.uncertainty,
    score: Number(score.toFixed(4)),
  };
}

export function buildDaphneHypothesisSet(input: {
  claimKey: string;
  claims: DaphneEpistemicClaimRecord[];
  preferenceMargin?: number;
}): DaphneHypothesisSet {
  const claimKey = input.claimKey.trim();
  if (!claimKey) throw new Error("Daphne HypothesisSet requires claimKey");
  const supersededIds = new Set(
    input.claims
      .filter(item => item.claimType === "supersession" && item.supersedesClaimId)
      .map(item => item.supersedesClaimId!)
  );
  const candidates = input.claims
    .filter(item =>
      item.claimKey === claimKey &&
      !supersededIds.has(item.id) &&
      !["rejected", "superseded"].includes(item.epistemicStatus) &&
      item.claimType !== "supersession"
    )
    .map(hypothesis)
    .sort((a, b) => b.score - a.score || a.claimId.localeCompare(b.claimId));

  if (!candidates.length) {
    return {
      claimKey,
      hypotheses: [],
      preferredClaimId: null,
      decision: "insufficient_evidence",
      uncertainty: {
        epistemic: 1,
        aleatoric: null,
        change: null,
        measurement: 1,
        decisionCost: null,
      },
    };
  }

  const top = candidates[0];
  const runner = candidates[1];
  const margin = input.preferenceMargin ?? 1;
  const hasContradiction = candidates.some(item => item.counterEvidenceCount > 0);
  const ambiguous = Boolean(runner) && top.score - runner.score < margin;
  const decision =
    ambiguous || hasContradiction
      ? "competing_hypotheses"
      : normalizedUncertainty(input.claims.find(c => c.id === top.claimId)!) >= 0.8
        ? "abstain"
        : "prefer";

  const uncertainty = input.claims
    .filter(c => candidates.some(h => h.claimId === c.id))
    .map(c => c.uncertainty)
    .filter(Boolean);
  const avg = (key: "epistemic" | "aleatoric" | "change" | "measurement") => {
    const vals = uncertainty
      .map(value => value?.[key])
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    return vals.length
      ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4))
      : null;
  };
  const costs = uncertainty
    .map(value => value?.decisionCost)
    .filter((value): value is "low" | "medium" | "high" => Boolean(value));
  const decisionCost = costs.includes("high")
    ? "high"
    : costs.includes("medium")
      ? "medium"
      : costs.includes("low")
        ? "low"
        : null;

  return {
    claimKey,
    hypotheses: candidates,
    preferredClaimId: decision === "prefer" ? top.claimId : null,
    decision,
    uncertainty: {
      epistemic: avg("epistemic"),
      aleatoric: avg("aleatoric"),
      change: avg("change"),
      measurement: avg("measurement"),
      decisionCost,
    },
  };
}
