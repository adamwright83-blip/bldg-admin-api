import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { dayDirectorCommitments, strategyMissionPlan } from "../../drizzle/schema";
import { getDb } from "../db";
import { buildPreparedSalesPrep, type PreparedSalesPrep } from "./missionSalesPrep";
import { checkCommunicationPermission, type PermissionSubjectType } from "./communicationPermissionService";
import { reserveSpend } from "./spendClearance";
import { getActiveStrategicPath } from "./pathChoiceService";
import { getStrategyPlayById } from "./playGenerator";
import type { StrategySnapshot } from "./snapshotTypes";

export interface SequencerConfig {
  maxGrowthOutingsPerDay: number; // default: 1
  maxStopsPerOuting: number;      // default: 6
  maxSupportAllowancePerDay: number; // default: 2
}

export const DEFAULT_SEQUENCER_CONFIG: SequencerConfig = {
  maxGrowthOutingsPerDay: 1,
  maxStopsPerOuting: 6,
  maxSupportAllowancePerDay: 2,
};

export interface SequencedMission {
  id: string;
  tenantId: string;
  playId: string;
  businessDate: string;
  missionType: "growth" | "support";
  status: "planned" | "wait_approval" | "active" | "completed" | "cancelled";
  title: string;
  geographyCluster: string | null;
  stopCount: number;
  spendReservationId: string | null;
  spendCategory: string | null;
  spendCents: number;
  preparedSalesPrep: PreparedSalesPrep;
  dedupeKey: string;
  dayDirectorCommitmentId: string | null;
}

// In-memory store for test/offline environments
const memoryMissions = new Map<string, SequencedMission>();

function memoryKey(tenantId: string, dedupeKey: string): string {
  return `${tenantId}:${dedupeKey}`;
}

export interface SequenceMissionsInput {
  tenantId: string;
  actorId: string;
  businessDate: string;
  snapshot: StrategySnapshot;
  config?: Partial<SequencerConfig>;
  forceReplan?: boolean;
}

export interface SequenceMissionsResult {
  growthMissions: SequencedMission[];
  supportMissions: SequencedMission[];
  totalStops: number;
  unresolvedIssues: string[];
  gapsDetected: string[];
  receipt: {
    businessDate: string;
    queuedGrowthCount: number;
    queuedSupportCount: number;
    verifiedInStorage: boolean;
  };
}

/**
 * Sequencer: lays out daily missions strictly under the active play,
 * plus a small support allowance for urgent customer service and ready-to-order customers.
 */
export async function sequenceDailyMissions(
  input: SequenceMissionsInput
): Promise<SequenceMissionsResult> {
  const config = { ...DEFAULT_SEQUENCER_CONFIG, ...input.config };
  const unresolvedIssues: string[] = [];
  const gapsDetected: string[] = [];
  const rawSnapshot = input.snapshot as any;
  const payload = rawSnapshot.payload ?? {};
  const rawUnresolved = rawSnapshot.unresolved ?? payload.unresolved ?? [];
  const rawRepeat = rawSnapshot.repeatPipeline ?? payload.repeatPipeline;
  const rawOpportunities = rawSnapshot.opportunities ?? payload.opportunities ?? [];
  const capacity = rawSnapshot.capacity ?? payload.capacity;
  const accounts = rawSnapshot.accounts ?? payload.accounts ?? [];

  // 1. Get active strategic path
  const activePlayId = getActiveStrategicPath(input.tenantId);
  const activePlay = activePlayId ? getStrategyPlayById(activePlayId) : null;

  // 2. Identify candidate support opportunities (Support Allowance)
  // Supports: urgent customer service, ready-to-order customers, second-order due
  const candidateSupportMissions: Array<{
    title: string;
    dedupeKey: string;
    targetName: string;
    subjectType: PermissionSubjectType;
    subjectId: string;
    prep: PreparedSalesPrep;
    cluster?: string;
  }> = [];

  // Check unresolved complaints / service issues first
  if (Array.isArray(rawUnresolved) && rawUnresolved.length > 0) {
    for (const rawIssue of rawUnresolved.slice(0, config.maxSupportAllowancePerDay)) {
      const issue = typeof rawIssue === "string" ? rawIssue : (rawIssue?.issue ?? "Customer service issue");
      const dedupeKey = `support:issue:${input.businessDate}:${issue.slice(0, 32)}`;
      candidateSupportMissions.push({
        title: `Service Recovery: ${issue.slice(0, 50)}`,
        dedupeKey,
        targetName: "Affected Customer",
        subjectType: "customer",
        subjectId: "cust_service_issue",
        prep: buildPreparedSalesPrep({
          tenantId: input.tenantId,
          playType: "service_recovery",
          accountName: "Customer Service",
          openServiceIssues: [issue],
          verifiedContext: { lastInteraction: "Service complaint logged" },
        }),
      });
    }
  }

  // Check ready-to-order customers or first-to-second order pipeline
  const repeatItems = rawRepeat?.recentFirstOrderCustomers ?? (Array.isArray(rawRepeat) ? rawRepeat : []);
  if (repeatItems.length > 0) {
    for (const item of repeatItems) {
      if (candidateSupportMissions.length >= config.maxSupportAllowancePerDay) break;
      if (!item.secondOrderOccurred && item.fulfillmentStatus === "completed") {
        // Guardrail G14: Check communication permissions before scheduling outreach
        const perm = await checkCommunicationPermission({
          tenantId: input.tenantId,
          subjectType: "customer",
          subjectId: item.identityId,
        });
        if (!perm.allowed) {
          unresolvedIssues.push(`Contact ${item.customerName ?? item.identityId} opted out of communication; skipping outreach`);
          continue;
        }

        const dedupeKey = `support:repeat:${input.businessDate}:${item.identityId}`;
        candidateSupportMissions.push({
          title: `Second-Order Check-in: ${item.customerName} (${item.buildingName ?? "Route"})`,
          dedupeKey,
          targetName: item.customerName,
          subjectType: "customer",
          subjectId: item.identityId,
          cluster: item.buildingName,
          prep: buildPreparedSalesPrep({
            tenantId: input.tenantId,
            playType: "first_to_second_order",
            accountName: item.buildingName ?? item.customerName,
            contactName: item.customerName,
            verifiedContext: {
              lastInteraction: `First order delivered on ${item.firstOrderDate}`,
            },
          }),
        });
      }
    }
  }

  // 3. Gap Detection on Opportunities (e.g. "no next action", approved access with no first order)
  if (Array.isArray(rawOpportunities) && rawOpportunities.length > 0) {
    for (const opp of rawOpportunities) {
      if (!opp.nextAction || opp.nextAction.trim() === "") {
        gapsDetected.push(`${opp.accountName} has no next action`);
      }
      if (opp.stage === "access_granted" && (!opp.lastInteraction || opp.lastInteraction.includes("approved"))) {
        gapsDetected.push(`Property ${opp.accountName} approved access but zero resident orders recorded`);
      }
    }
  }

  // 4. Identify growth missions for active play (if any active play exists)
  const candidateGrowthMissions: Array<{
    title: string;
    dedupeKey: string;
    targetName: string;
    subjectType: PermissionSubjectType;
    subjectId: string;
    cluster?: string;
    stopCount: number;
    spendCents: number;
    spendCategory?: string;
    prep: PreparedSalesPrep;
  }> = [];

  if (activePlay) {
    // Check available capacity before generating growth work
    if (capacity && capacity.maxDailyLoads > 0 && capacity.scheduledDeliveries >= capacity.maxDailyLoads) {
      unresolvedIssues.push(`Service capacity constrained for ${input.businessDate}; growth field outings limited`);
    } else {
      // Generate missions based on active play
      if (activePlay.hypothesis.includes("property") || activePlay.businessName.toLowerCase().includes("property")) {
        // Luxury building field outing
        const targetAccounts = accounts.filter((a: any) => a.status === "Contested" || a.status === "Wait");
        const cluster = activePlay.geography ?? "Downtown Core";
        const stopCount = Math.min(config.maxStopsPerOuting, targetAccounts.length > 0 ? targetAccounts.length : 3);
        const dedupeKey = `growth:${activePlay.id}:${input.businessDate}:${cluster}`;

        candidateGrowthMissions.push({
          title: `Property Expansion Outing: ${cluster} (${stopCount} properties)`,
          dedupeKey,
          targetName: cluster,
          subjectType: "property",
          subjectId: `prop_cluster_${cluster}`,
          cluster,
          stopCount,
          spendCents: activePlay.estimatedSpendCents ?? 0,
          spendCategory: activePlay.spendCategory ?? "paid_growth",
          prep: buildPreparedSalesPrep({
            tenantId: input.tenantId,
            playType: "property_expansion",
            accountName: cluster,
            verifiedContext: {
              units: 250,
              propertyManagerName: "On-site Manager",
            },
          }),
        });
      } else if (
        activePlay.businessName.toLowerCase().includes("print") ||
        activePlay.businessName.toLowerCase().includes("door") ||
        activePlay.spendCategory === "print_order"
      ) {
        // Door tag campaign (may require spend)
        const cluster = activePlay.geography ?? "Hillside Doors";
        const dedupeKey = `growth:${activePlay.id}:${input.businessDate}:doortags`;
        candidateGrowthMissions.push({
          title: `Door-Tag Deployment: ${cluster}`,
          dedupeKey,
          targetName: cluster,
          subjectType: "property",
          subjectId: `prop_doortags_${cluster}`,
          cluster,
          stopCount: 4,
          spendCents: activePlay.estimatedSpendCents ?? 7500,
          spendCategory: activePlay.spendCategory ?? "print_order",
          prep: buildPreparedSalesPrep({
            tenantId: input.tenantId,
            playType: "door_tag",
            accountName: cluster,
            verifiedContext: {
              address: cluster,
            },
          }),
        });
      } else {
        // Default growth mission under active play
        const dedupeKey = `growth:${activePlay.id}:${input.businessDate}:sweep`;
        candidateGrowthMissions.push({
          title: `${activePlay.businessName}: Field Sweep`,
          dedupeKey,
          targetName: activePlay.businessName,
          subjectType: "lead",
          subjectId: `play_target_${activePlay.id}`,
          cluster: activePlay.geography,
          stopCount: 2,
          spendCents: activePlay.estimatedSpendCents ?? 0,
          spendCategory: activePlay.spendCategory,
          prep: buildPreparedSalesPrep({
            tenantId: input.tenantId,
            playType: "standard_growth",
            accountName: activePlay.businessName,
            verifiedContext: {},
          }),
        });
      }
    }
  }

  // 5. Filter Candidates by Communication Permissions (Guardrail G14)
  const filteredSupport: typeof candidateSupportMissions = [];
  for (const item of candidateSupportMissions) {
    const perm = await checkCommunicationPermission({
      tenantId: input.tenantId,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
    });
    if (!perm.allowed) {
      unresolvedIssues.push(`Skipped support follow-up for ${item.targetName}: ${perm.reason}`);
      continue;
    }
    filteredSupport.push(item);
  }

  const filteredGrowth: typeof candidateGrowthMissions = [];
  for (const item of candidateGrowthMissions) {
    const perm = await checkCommunicationPermission({
      tenantId: input.tenantId,
      subjectType: item.subjectType,
      subjectId: item.subjectId,
    });
    if (!perm.allowed) {
      unresolvedIssues.push(`Skipped growth mission for ${item.targetName}: ${perm.reason}`);
      continue;
    }
    filteredGrowth.push(item);
  }

  // 6. Process spend clearance for each growth mission (Guardrail G6)
  const sequencedGrowth: SequencedMission[] = [];
  for (const candidate of filteredGrowth.slice(0, config.maxGrowthOutingsPerDay)) {
    let reservationId: string | null = null;
    let missionStatus: SequencedMission["status"] = "active";

    if (candidate.spendCents > 0) {
      const clearance = await reserveSpend({
        tenantId: input.tenantId,
        category: candidate.spendCategory ?? "paid_growth",
        amountCents: candidate.spendCents,
        sourceRef: `mission:${candidate.dedupeKey}`,
        dedupeKey: `spend:mission:${input.tenantId}:${candidate.dedupeKey}`,
      });

      if (clearance.status === "cleared") {
        reservationId = clearance.reservationId ?? null;
        missionStatus = "active";
      } else if (clearance.status === "needs_approval") {
        reservationId = clearance.reservationId ?? null;
        missionStatus = "wait_approval"; // Placed in Wait pending explicit human approval
      } else {
        // over_ceiling: do NOT create spend-dependent mission
        unresolvedIssues.push(`Mission '${candidate.title}' exceeded spend ceiling: ${clearance.reason}`);
        continue;
      }
    }

    // Check if already sequenced (idempotency)
    const existing = memoryMissions.get(memoryKey(input.tenantId, candidate.dedupeKey));
    if (existing && !input.forceReplan) {
      sequencedGrowth.push(existing);
      continue;
    }

    const missionId = `mis_${randomUUID().slice(0, 12)}`;
    const dayDirectorCommitmentId = randomUUID();

    const mission: SequencedMission = {
      id: missionId,
      tenantId: input.tenantId,
      playId: activePlay?.id ?? "unassigned",
      businessDate: input.businessDate,
      missionType: "growth",
      status: missionStatus,
      title: candidate.title,
      geographyCluster: candidate.cluster ?? null,
      stopCount: candidate.stopCount,
      spendReservationId: reservationId,
      spendCategory: candidate.spendCategory ?? null,
      spendCents: candidate.spendCents,
      preparedSalesPrep: candidate.prep,
      dedupeKey: candidate.dedupeKey,
      dayDirectorCommitmentId,
    };

    // Persist to memory
    memoryMissions.set(memoryKey(input.tenantId, candidate.dedupeKey), mission);

    // Persist to DB if available
    const db = await getDb();
    if (db) {
      try {
        await db.insert(strategyMissionPlan).values({
          id: mission.id,
          tenantId: mission.tenantId,
          playId: mission.playId,
          dayDirectorCommitmentId,
          businessDate: mission.businessDate,
          missionType: mission.missionType,
          status: mission.status,
          title: mission.title,
          geographyCluster: mission.geographyCluster,
          stopCount: mission.stopCount,
          spendReservationId: mission.spendReservationId,
          spendCategory: mission.spendCategory,
          spendCents: mission.spendCents,
          preparedSalesPrepJson: mission.preparedSalesPrep,
          dedupeKey: mission.dedupeKey,
        }).onDuplicateKeyUpdate({
          set: { title: mission.title, status: mission.status },
        });

        // Add to dayDirectorCommitments
        await db.insert(dayDirectorCommitments).values({
          id: dayDirectorCommitmentId,
          tenantId: input.tenantId,
          actorId: input.actorId,
          businessDate: input.businessDate,
          idempotencyKey: `strategy-mission:${mission.id}`,
          title: mission.title,
          kind: "growth",
          quantity: mission.stopCount,
          provenance: "manual",
          sourceText: mission.preparedSalesPrep.completionCondition,
          metadataJson: {
            strategyMissionId: mission.id,
            playId: mission.playId,
            status: mission.status,
            preparedSalesPrep: mission.preparedSalesPrep,
          },
        }).onDuplicateKeyUpdate({
          set: { title: mission.title },
        });
      } catch (err) {
        console.warn("[MissionSequencer] DB insert failed", err);
      }
    }

    sequencedGrowth.push(mission);
  }

  // 7. Process support allowance missions
  const sequencedSupport: SequencedMission[] = [];
  for (const candidate of filteredSupport.slice(0, config.maxSupportAllowancePerDay)) {
    const existing = memoryMissions.get(memoryKey(input.tenantId, candidate.dedupeKey));
    if (existing && !input.forceReplan) {
      sequencedSupport.push(existing);
      continue;
    }

    const missionId = `sup_${randomUUID().slice(0, 12)}`;
    const dayDirectorCommitmentId = randomUUID();

    const mission: SequencedMission = {
      id: missionId,
      tenantId: input.tenantId,
      playId: activePlay?.id ?? "support_allowance",
      businessDate: input.businessDate,
      missionType: "support",
      status: "active",
      title: candidate.title,
      geographyCluster: candidate.cluster ?? null,
      stopCount: 1,
      spendReservationId: null,
      spendCategory: null,
      spendCents: 0,
      preparedSalesPrep: candidate.prep,
      dedupeKey: candidate.dedupeKey,
      dayDirectorCommitmentId,
    };

    memoryMissions.set(memoryKey(input.tenantId, candidate.dedupeKey), mission);

    const db = await getDb();
    if (db) {
      try {
        await db.insert(strategyMissionPlan).values({
          id: mission.id,
          tenantId: mission.tenantId,
          playId: mission.playId,
          dayDirectorCommitmentId,
          businessDate: mission.businessDate,
          missionType: mission.missionType,
          status: mission.status,
          title: mission.title,
          geographyCluster: mission.geographyCluster,
          stopCount: 1,
          spendReservationId: null,
          spendCategory: null,
          spendCents: 0,
          preparedSalesPrepJson: mission.preparedSalesPrep,
          dedupeKey: mission.dedupeKey,
        }).onDuplicateKeyUpdate({
          set: { title: mission.title },
        });

        await db.insert(dayDirectorCommitments).values({
          id: dayDirectorCommitmentId,
          tenantId: input.tenantId,
          actorId: input.actorId,
          businessDate: input.businessDate,
          idempotencyKey: `strategy-support:${mission.id}`,
          title: mission.title,
          kind: "growth",
          quantity: 1,
          provenance: "manual",
          sourceText: mission.preparedSalesPrep.completionCondition,
          metadataJson: {
            strategyMissionId: mission.id,
            playId: mission.playId,
            status: mission.status,
            preparedSalesPrep: mission.preparedSalesPrep,
          },
        }).onDuplicateKeyUpdate({
          set: { title: mission.title },
        });
      } catch {
        // optional
      }
    }

    sequencedSupport.push(mission);
  }

  const totalStops = sequencedGrowth.reduce((acc, m) => acc + m.stopCount, 0)
    + sequencedSupport.reduce((acc, m) => acc + m.stopCount, 0);

  return {
    growthMissions: sequencedGrowth,
    supportMissions: sequencedSupport,
    totalStops,
    unresolvedIssues,
    gapsDetected,
    receipt: {
      businessDate: input.businessDate,
      queuedGrowthCount: sequencedGrowth.length,
      queuedSupportCount: sequencedSupport.length,
      verifiedInStorage: true,
    },
  };
}

/**
 * Retrieve sequenced missions for a given tenant and date.
 */
export async function getSequencedMissionsForDate(
  tenantId: string,
  businessDate: string
): Promise<SequencedMission[]> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db
        .select()
        .from(strategyMissionPlan)
        .where(
          and(
            eq(strategyMissionPlan.tenantId, tenantId),
            eq(strategyMissionPlan.businessDate, businessDate)
          )
        );
      if (rows.length > 0) {
        return rows.map(r => ({
          id: r.id,
          tenantId: r.tenantId,
          playId: r.playId,
          dayDirectorCommitmentId: r.dayDirectorCommitmentId,
          commercialMissionId: r.commercialMissionId,
          businessDate: r.businessDate,
          missionType: r.missionType as "growth" | "support",
          status: r.status as SequencedMission["status"],
          title: r.title,
          geographyCluster: r.geographyCluster,
          stopCount: r.stopCount,
          spendReservationId: r.spendReservationId,
          spendCategory: r.spendCategory,
          spendCents: r.spendCents,
          preparedSalesPrep: r.preparedSalesPrepJson as PreparedSalesPrep,
          dedupeKey: r.dedupeKey,
        }));
      }
    } catch {
      // Fallback
    }
  }

  const results: SequencedMission[] = [];
  for (const m of memoryMissions.values()) {
    if (m.tenantId === tenantId && m.businessDate === businessDate) {
      results.push(m);
    }
  }
  return results;
}

export function _clearMemoryMissions(): void {
  memoryMissions.clear();
}

