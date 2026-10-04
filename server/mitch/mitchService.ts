/**
 * Mitch v1 — Game Production Service
 *
 * Core service for Mitch, EVP of Games.
 * Manages production state about canonical games / Kingdoms without duplicating them.
 */
import { randomUUID } from "node:crypto";
import { getKingdom } from "../goldlineKingdoms/kingdomService";
import type {
  MitchAuditEvent,
  MitchGameProductionState,
  MitchMilestone,
  MitchWorkOrder,
  MitchWorkOrderStatus,
} from "../../shared/mitchContracts";
import {
  assertValidBuildIdentity,
  mitchGameProductionStateSchema,
  mitchMilestoneSchema,
  mitchWorkOrderContractSchema,
} from "../../shared/mitchContracts";
import type { IMitchProductionStore } from "./mitchStore";

export class NonCanonicalGameError extends Error {
  constructor(gameId: string) {
    super(
      `Cannot initialize Mitch production state: "${gameId}" is not a canonical Kingdom or game in the authoritative Kingdom registry.`
    );
    this.name = "NonCanonicalGameError";
  }
}

export class CompetingWorkOrderError extends Error {
  constructor(gameId: string, milestoneKey: string, existingOrderId: string) {
    super(
      `Competing work order rejected for game "${gameId}" milestone "${milestoneKey}". Active work order "${existingOrderId}" is already in flight.`
    );
    this.name = "CompetingWorkOrderError";
  }
}

export class HumanCreativeBlockerUnresolvedError extends Error {
  constructor(gameId: string, milestoneKey: string, reason?: string | null) {
    super(
      `Cannot create work order for milestone "${milestoneKey}" in game "${gameId}": human creative decision is required before work can be authorized.${reason ? ` Reason: ${reason}` : ""}`
    );
    this.name = "HumanCreativeBlockerUnresolvedError";
  }
}

export class BlockedMilestoneWorkForbiddenError extends Error {
  constructor(gameId: string, milestoneKey: string, reason?: string | null) {
    super(
      `Cannot create work order for milestone "${milestoneKey}" in game "${gameId}": milestone is currently blocked.${reason ? ` Reason: ${reason}` : ""}`
    );
    this.name = "BlockedMilestoneWorkForbiddenError";
  }
}

export class BusinessEvidenceFabricationForbiddenError extends Error {
  constructor() {
    super(
      "Mitch is forbidden from fabricating real-world business evidence, customer orders, revenue, visits, or sales calls."
    );
    this.name = "BusinessEvidenceFabricationForbiddenError";
  }
}

export class AutonomousMainMergeForbiddenError extends Error {
  constructor() {
    super("Mitch v1 is strictly forbidden from autonomously merging to main.");
    this.name = "AutonomousMainMergeForbiddenError";
  }
}

export class AutonomousCustomerReleaseForbiddenError extends Error {
  constructor() {
    super("Mitch v1 is strictly forbidden from autonomously releasing customer-wide without human creative acceptance.");
    this.name = "AutonomousCustomerReleaseForbiddenError";
  }
}

export const CANONICAL_SYSTEM_MAP_GAMES: Readonly<Record<string, { title: string }>> = Object.freeze({
  "kingdom.boreslay": { title: "Boreslay" },
  "kingdom.brass_republic": { title: "Brass Republic" },
  "game.small_comforts": { title: "Small Comforts" },
});

export class MitchProductionService {
  constructor(private readonly store: IMitchProductionStore) {}

  /**
   * Initialize or load production state for an existing canonical game/Kingdom.
   * INVARIANT: Mitch attaches to existing canonical Kingdom/game identity.
   * If the Kingdom does not exist in the authoritative system, reject!
   */
  async initializeOrLoadProductionState(input: {
    tenantId: string;
    canonicalGameId: string;
    titleOverride?: string;
    realBusinessBindingOverride?: string | null;
    coreMechanic?: string | null;
    companionDependency?: string | null;
    requiredAssets?: string[];
    blockingDependencies?: string[];
  }): Promise<MitchGameProductionState> {
    const existing = await this.store.getProductionState(input.tenantId, input.canonicalGameId);
    if (existing) {
      return existing;
    }

    const systemMapGame = CANONICAL_SYSTEM_MAP_GAMES[input.canonicalGameId];
    const canonicalKingdom = await getKingdom({
      tenantId: input.tenantId,
      kingdomId: input.canonicalGameId,
    });

    if (!systemMapGame && !canonicalKingdom) {
      throw new NonCanonicalGameError(input.canonicalGameId);
    }

    const nowIso = new Date().toISOString();
    const resolvedRealBusinessBinding =
      input.realBusinessBindingOverride !== undefined
        ? input.realBusinessBindingOverride
        : (canonicalKingdom?.realCampaignId ?? null);

    const initialState: MitchGameProductionState = {
      id: randomUUID(),
      tenantId: input.tenantId,
      gameId: input.canonicalGameId,
      storedRowId: canonicalKingdom ? canonicalKingdom.kingdomId : null,
      title: input.titleOverride ?? systemMapGame?.title ?? canonicalKingdom?.title ?? "Untitled Game",
      lifecycleState: "concept",
      realBusinessBinding: resolvedRealBusinessBinding,
      coreMechanic: input.coreMechanic ?? null,
      companionDependency: input.companionDependency ?? (canonicalKingdom?.companionEarnedId ?? null),
      requiredAssets: input.requiredAssets ?? [],
      blockingDependencies: input.blockingDependencies ?? [],
      currentAvailableBuildId: null,
      lastVerifiedBuildId: null, // Separately tracked!
      creativeAcceptanceState: "pending",
      creativeAcceptanceNote: null,
      creativeAcceptanceDecidedAt: null,
      releaseState: "unreleased",
      releasedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    mitchGameProductionStateSchema.parse(initialState);
    const saved = await this.store.saveProductionState(initialState);

    await this.store.recordAuditEvent({
      tenantId: input.tenantId,
      gameId: input.canonicalGameId,
      eventType: "mitch_game_production_state_initialized",
      actorId: "mitch_system",
      details: {
        canonicalGameId: input.canonicalGameId,
        storedRowId: saved.storedRowId,
        title: saved.title,
        realCampaignId: saved.realBusinessBinding,
      },
    });

    return saved;
  }

  /**
   * Get production state for a game.
   */
  async getProductionState(tenantId: string, gameId: string): Promise<MitchGameProductionState | null> {
    return this.store.getProductionState(tenantId, gameId);
  }

  /**
   * Register a milestone for a canonical game.
   */
  async registerMilestone(input: {
    tenantId: string;
    gameId: string;
    milestoneKey: string;
    sequence: number;
    title: string;
    desiredPlayerVisibleResult: string;
    acceptanceCriteria: string[];
    isHumanCreativeBlocker?: boolean;
    blockedReason?: string | null;
  }): Promise<MitchMilestone> {
    const existing = await this.store.getMilestone(input.tenantId, input.gameId, input.milestoneKey);
    if (existing) {
      return existing;
    }

    const nowIso = new Date().toISOString();
    const milestone: MitchMilestone = {
      id: randomUUID(),
      tenantId: input.tenantId,
      gameId: input.gameId,
      milestoneKey: input.milestoneKey,
      sequence: input.sequence,
      title: input.title,
      desiredPlayerVisibleResult: input.desiredPlayerVisibleResult,
      acceptanceCriteria: input.acceptanceCriteria,
      status: input.isHumanCreativeBlocker ? "blocked" : "pending",
      currentAvailableBuildId: null,
      lastVerifiedBuildId: null,
      blockedReason: input.blockedReason ?? (input.isHumanCreativeBlocker ? "HUMAN CREATIVE DECISION REQUIRED" : null),
      isHumanCreativeBlocker: Boolean(input.isHumanCreativeBlocker),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    mitchMilestoneSchema.parse(milestone);
    return this.store.saveMilestone(milestone);
  }

  /**
   * Create an implementation work order for a bounded milestone.
   * INVARIANT: Only ONE active implementation work order allowed per equivalent milestone.
   */
  async createWorkOrder(input: {
    tenantId: string;
    gameId: string;
    milestoneKey: string;
    title: string;
    desiredPlayerVisibleResult: string;
    acceptanceCriteria: string[];
    canonConstraints: string[];
    relevantDependencies: string[];
    realBusinessEvidenceConstraints: string[];
    baseBranch: string;
    baseSha: string;
    requiredArtifact: string;
    requiredTests: string[];
    requiredEvidence?: string[];
  }): Promise<MitchWorkOrder> {
    // Check if there is already an active work order for this milestone
    const activeOrders = await this.store.listWorkOrders(input.tenantId, input.gameId);
    const competing = activeOrders.find(
      o =>
        o.milestoneKey === input.milestoneKey &&
        (o.status === "pending" || o.status === "claimed" || o.status === "executing")
    );

    if (competing) {
      throw new CompetingWorkOrderError(input.gameId, input.milestoneKey, competing.id);
    }

    const milestone = await this.store.getMilestone(input.tenantId, input.gameId, input.milestoneKey);
    if (!milestone) {
      throw new Error(`Milestone "${input.milestoneKey}" not found for game "${input.gameId}".`);
    }

    if (milestone.isHumanCreativeBlocker) {
      throw new HumanCreativeBlockerUnresolvedError(input.gameId, input.milestoneKey, milestone.blockedReason);
    }

    if (milestone.status === "blocked") {
      throw new BlockedMilestoneWorkForbiddenError(input.gameId, input.milestoneKey, milestone.blockedReason);
    }

    const orderData: Omit<MitchWorkOrder, "id" | "createdAt" | "updatedAt"> = {
      tenantId: input.tenantId,
      gameId: input.gameId,
      milestoneId: milestone.id,
      milestoneKey: input.milestoneKey,
      title: input.title,
      desiredPlayerVisibleResult: input.desiredPlayerVisibleResult,
      acceptanceCriteria: input.acceptanceCriteria,
      canonConstraints: input.canonConstraints,
      relevantDependencies: input.relevantDependencies,
      realBusinessEvidenceConstraints: input.realBusinessEvidenceConstraints,
      baseBranch: input.baseBranch,
      baseSha: input.baseSha,
      requiredArtifact: input.requiredArtifact,
      requiredTests: input.requiredTests,
      requiredEvidence: input.requiredEvidence ?? [],
      status: "pending",
      claimedBy: null,
      claimedAt: null,
      leaseExpiresAt: null,
      attemptCount: 0,
      maxAttempts: 3,
      lastError: null,
      completedAt: null,
    };

    const created = await this.store.createWorkOrder(orderData);
    mitchWorkOrderContractSchema.parse(created);

    // Update milestone status to in_progress
    await this.store.saveMilestone({
      ...milestone,
      status: "in_progress",
    });

    // Update game lifecycle state to implementing
    const gameState = await this.store.getProductionState(input.tenantId, input.gameId);
    if (gameState) {
      await this.store.saveProductionState({
        ...gameState,
        lifecycleState: "implementing",
      });
    }

    await this.store.recordAuditEvent({
      tenantId: input.tenantId,
      gameId: input.gameId,
      eventType: "mitch_work_order_created",
      actorId: "mitch_system",
      details: {
        workOrderId: created.id,
        milestoneKey: input.milestoneKey,
        baseSha: input.baseSha,
      },
    });

    return created;
  }

  /**
   * Explicitly resolve a creative or procedural blocker on a milestone.
   * Can only be performed through an authoritative decision pathway.
   */
  async resolveMilestoneBlocker(input: {
    tenantId: string;
    gameId: string;
    milestoneKey: string;
    resolvedBy: string;
    resolutionNote: string;
  }): Promise<MitchMilestone> {
    const milestone = await this.store.getMilestone(input.tenantId, input.gameId, input.milestoneKey);
    if (!milestone) {
      throw new Error(`Milestone "${input.milestoneKey}" not found for game "${input.gameId}".`);
    }

    const updated: MitchMilestone = {
      ...milestone,
      status: "pending",
      isHumanCreativeBlocker: false,
      blockedReason: null,
      updatedAt: new Date().toISOString(),
    };

    mitchMilestoneSchema.parse(updated);
    const saved = await this.store.saveMilestone(updated);

    await this.store.recordAuditEvent({
      tenantId: input.tenantId,
      gameId: input.gameId,
      eventType: "mitch_milestone_blocker_resolved",
      actorId: input.resolvedBy,
      details: {
        milestoneKey: input.milestoneKey,
        resolutionNote: input.resolutionNote,
      },
    });

    return saved;
  }

  /**
   * Asserts that Mitch never attempts autonomous main merge or customer release.
   */
  assertNoAutonomousMerge(): void {
    throw new AutonomousMainMergeForbiddenError();
  }

  assertNoAutonomousRelease(): void {
    throw new AutonomousCustomerReleaseForbiddenError();
  }
}
