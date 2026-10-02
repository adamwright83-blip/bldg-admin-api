/**
 * Mitch v1 — Production Reasoning Loop
 *
 * Deterministic production service capable of inspecting an active game and answering:
 * 1. What exact production state is this game in?
 * 2. What milestone is incomplete?
 * 3. What is blocking it?
 * 4. Is the missing outcome implementable now?
 * 5. Is work already active for the same milestone/outcome?
 * 6. Does a returned implementation need QA instead of more implementation?
 * 7. Does a failed QA issue require a fix before new scope begins?
 * 8. Does a submitted fix need retesting?
 * 9. What is the smallest bounded next production outcome?
 * 10. Is the missing input actually a human creative decision?
 *
 * Invariant: Mitch prefers finish → verify → fix → retest over starting more parallel work.
 * Invariant: Stops at HUMAN CREATIVE DECISION REQUIRED when missing input is genuinely creative judgment.
 * Invariant: Never invents business evidence.
 */
import type {
  MitchGameProductionState,
  MitchIssue,
  MitchMilestone,
  MitchProductionInspection,
  MitchWorkOrder,
} from "../../shared/mitchContracts";
import type { IMitchProductionStore } from "./mitchStore";

export class MitchProductionReasoningService {
  constructor(private readonly store: IMitchProductionStore) {}

  /**
   * Deterministically inspects an active game and produces the complete production read model.
   */
  async inspectProductionState(
    tenantId: string,
    gameId: string
  ): Promise<MitchProductionInspection> {
    const gameState = await this.store.getProductionState(tenantId, gameId);
    if (!gameState) {
      throw new Error(`Game "${gameId}" has no Mitch production state.`);
    }

    const milestones = await this.store.listMilestones(tenantId, gameId);
    const workOrders = await this.store.listWorkOrders(tenantId, gameId);
    const issues = await this.store.listIssues(tenantId, gameId);

    // Q2: What milestone is incomplete?
    const incompleteMilestone =
      milestones.find(
        m => m.status !== "verified" && m.status !== "creatively_accepted"
      ) ?? null;

    // Q5: Is work already active for the same milestone/outcome?
    const activeWorkOrder =
      workOrders.find(
        o =>
          o.status === "pending" ||
          o.status === "claimed" ||
          o.status === "executing"
      ) ?? null;

    // Q7 & Q8: Check issues
    const openIssues = issues.filter(i => i.status !== "closed");
    const openIssueNeedingFix = openIssues.find(i => i.status === "open");
    const fixNeedingRetest = openIssues.find(i => i.status === "fix_submitted");

    // Q3 & Q10: What is blocking it? Is the missing input a human creative decision?
    const isHumanCreativeBlocker = Boolean(incompleteMilestone?.isHumanCreativeBlocker);
    const blockedReason = incompleteMilestone?.blockedReason ?? null;
    const isBlocked = isHumanCreativeBlocker || Boolean(blockedReason) || openIssues.length > 0;

    // Reasoning about next action (Preferences: fix → retest → QA → implement)
    let recommendedAction: MitchProductionInspection["nextBoundedOutcome"]["recommendedAction"] =
      "game_complete";
    let outcomeDescription = "All milestones verified.";
    let readyToDispatch = false;

    if (incompleteMilestone) {
      if (isHumanCreativeBlocker) {
        // Stop condition!
        recommendedAction = "stop_human_creative_decision";
        outcomeDescription = `HUMAN CREATIVE DECISION REQUIRED: ${incompleteMilestone.title}`;
        readyToDispatch = false;
      } else if (openIssueNeedingFix) {
        // Fix has priority over new scope!
        recommendedAction = "dispatch_fix";
        outcomeDescription = `Fix failed gameplay QA issue "${openIssueNeedingFix.title}"`;
        readyToDispatch = true;
      } else if (fixNeedingRetest) {
        // Retesting submitted fix has priority!
        recommendedAction = "retest_fix";
        outcomeDescription = `Independently retest fixed behavior for issue "${fixNeedingRetest.title}" against build ${fixNeedingRetest.fixBuildId}`;
        readyToDispatch = false; // Eligible for QA run, not new work order
      } else if (
        incompleteMilestone.status === "implemented" &&
        incompleteMilestone.currentAvailableBuildId &&
        incompleteMilestone.currentAvailableBuildId !== incompleteMilestone.lastVerifiedBuildId
      ) {
        // Returned implementation needs QA instead of more implementation!
        recommendedAction = "perform_gameplay_qa";
        outcomeDescription = `Execute independent gameplay QA on exact build ${incompleteMilestone.currentAvailableBuildId} for milestone "${incompleteMilestone.title}"`;
        readyToDispatch = false; // Eligible for QA, not implementation
      } else if (activeWorkOrder) {
        // Work already in flight
        recommendedAction = "dispatch_implementation";
        outcomeDescription = `Work order "${activeWorkOrder.title}" is currently active (${activeWorkOrder.status})`;
        readyToDispatch = false;
      } else {
        // Ready for bounded implementation dispatch
        recommendedAction = "dispatch_implementation";
        outcomeDescription = `Dispatch bounded implementation for milestone "${incompleteMilestone.title}"`;
        readyToDispatch = true;
      }
    } else if (gameState.creativeAcceptanceState === "pending") {
      recommendedAction = "ready_for_creative_acceptance";
      outcomeDescription = "All milestones verified. Ready for human creative acceptance.";
      readyToDispatch = false;
    }

    return {
      gameId: gameState.gameId,
      title: gameState.title,
      lifecycleState: gameState.lifecycleState,
      currentAvailableBuildId: gameState.currentAvailableBuildId,
      lastVerifiedBuildId: gameState.lastVerifiedBuildId,
      activeWorkOrder,
      incompleteMilestone,
      openIssues,
      blockers: {
        isBlocked,
        reason: isHumanCreativeBlocker ? "HUMAN CREATIVE DECISION REQUIRED" : blockedReason,
        isHumanCreativeBlocker,
      },
      nextBoundedOutcome: {
        readyToDispatch,
        description: outcomeDescription,
        milestoneKey: incompleteMilestone?.milestoneKey ?? null,
        recommendedAction,
      },
    };
  }
}
