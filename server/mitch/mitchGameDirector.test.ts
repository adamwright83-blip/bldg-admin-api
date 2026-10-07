import { describe, expect, it } from "vitest";
import { buildMitchGameDirectorBrief, routeMitchGameDirectorSkills } from "./mitchGameDirector";
import type { MitchMilestone, MitchWorkOrder } from "../../shared/mitchContracts";

function fixture() {
  const milestone = {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "tenant",
    gameId: "kingdom.boreslay",
    milestoneKey: "duel",
    sequence: 1,
    title: "Install Boreslay Duel into progression",
    desiredPlayerVisibleResult: "Player controls the duel on phone and sees immediate kick feedback.",
    acceptanceCriteria: [
      "Touch controls remain readable in landscape.",
      "Winning the duel does not unlock Kingdom Three.",
    ],
    status: "in_progress",
    currentAvailableBuildId: null,
    lastVerifiedBuildId: null,
    blockedReason: null,
    isHumanCreativeBlocker: false,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  } satisfies MitchMilestone;
  const order = {
    id: "22222222-2222-4222-8222-222222222222",
    tenantId: "tenant",
    gameId: milestone.gameId,
    milestoneId: milestone.id,
    milestoneKey: milestone.milestoneKey,
    title: milestone.title,
    desiredPlayerVisibleResult: milestone.desiredPlayerVisibleResult,
    acceptanceCriteria: milestone.acceptanceCriteria,
    canonConstraints: ["Preserve Clockhead and Kingdom Two canon."],
    relevantDependencies: ["client/src/components/boreslay-rally/RallyDemo.tsx"],
    realBusinessEvidenceConstraints: [],
    baseBranch: "main",
    baseSha: "a".repeat(40),
    requiredArtifact: "client/src/components/boreslay-rally/RallyDemo.tsx",
    requiredTests: ["pnpm check"],
    requiredEvidence: [],
    status: "claimed",
    claimedBy: "executor",
    claimedAt: new Date(0).toISOString(),
    leaseExpiresAt: new Date(9999999999999).toISOString(),
    attemptCount: 1,
    maxAttempts: 3,
    lastError: null,
    completedAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  } satisfies MitchWorkOrder;
  return { milestone, order };
}

describe("Mitch game director", () => {
  it("routes only relevant craft skills while always keeping core and playtest", () => {
    const skills = routeMitchGameDirectorSkills(fixture());
    expect(skills).toEqual(expect.arrayContaining(["core", "playtest", "gamefeel", "systems", "mobile", "narrative"]));
    expect(new Set(skills).size).toBe(skills.length);
  });

  it("makes exact gameplay evidence and human taste boundaries explicit", () => {
    const brief = buildMitchGameDirectorBrief(fixture());
    expect(brief).toContain("Diagnose before prescribing");
    expect(brief).toContain("exact build was exercised");
    expect(brief).toContain("human_play_required");
    expect(brief).toContain("Never turn missing evidence into a positive verdict");
  });
});
