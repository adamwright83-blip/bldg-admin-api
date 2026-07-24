import { and, eq, sql } from "drizzle-orm";
import {
  commercialFollowUps,
  commercialMissionEvents,
  commercialMissions,
  commercialPipelineEvents,
  commercialPipelineRecords,
} from "../../drizzle/schema";
import type { CommercialContactRelationshipType } from "@shared/commercialMission";
import { getDb } from "../db";
import { createCommercialMission } from "./commercialMissionStore";

export type CommercialWalkInInput = {
  tenantId: string;
  actorId: string;
  idempotencyKey: string;
  requestId: string;
  businessName: string;
  businessType: string;
  address: string;
  website?: string | null;
  contactName?: string | null;
  contactTitle?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  relationshipType?: CommercialContactRelationshipType | null;
  conversationNotes: string;
  visitResult: "follow_up" | "won" | "lost" | "no_contact";
  nextAction: string;
  followUpAt?: Date | null;
  assignedTo?: string | null;
  estimatedAnnualValueCents?: number | null;
  estimateConfidence?: "low" | "medium" | "high";
  campaign?: string | null;
  placement?: string | null;
  collateralDelivered?: boolean;
  quoteRequested?: boolean;
  pilotRequested?: boolean;
};

export function commercialWalkInMissionInput(input: CommercialWalkInInput) {
  return {
    tenantId: input.tenantId,
    assignedTo: input.assignedTo ?? input.actorId,
    account: {
      providerName: null,
      providerAccountId: null,
      name: input.businessName,
      accountType: input.businessType,
      website: input.website ?? null,
      address: input.address,
      latitude: null,
      longitude: null,
      locationCount: 1,
      decisionMaker: {
        name: input.contactName ?? null,
        title: input.contactTitle ?? null,
        email: input.contactEmail ?? null,
        phone: input.contactPhone ?? null,
        relationshipType: input.relationshipType ?? "unknown" as const,
        preferredChannel: input.contactEmail ? "email" as const : input.contactPhone ? "phone" as const : "unknown" as const,
        source: "unplanned_walk_in" as const,
        sourceUrl: null,
        sourcedAt: new Date().toISOString(),
        notes: input.conversationNotes,
      },
    },
    opportunity: {
      score: 50,
      estimatedAnnualValueCents: input.estimatedAnnualValueCents ?? null,
      estimateConfidence: input.estimatedAnnualValueCents === null || input.estimatedAnnualValueCents === undefined
        ? "low" as const
        : input.estimateConfidence ?? "low" as const,
      primarySignal: "Operator logged an unplanned in-person conversation",
      reasons: [input.visitResult, input.nextAction],
      risks: [],
      evidence: [{ kind: "operator_observation", claim: input.conversationNotes }],
    },
    brief: {
      laundryOpportunity: input.conversationNotes,
      salesAngle: input.nextAction,
      openingLine: input.nextAction,
      discoveryQuestions: [],
      objections: [],
    },
    steps: [],
    actor: { type: "operator" as const, id: input.actorId },
    idempotencyKey: input.idempotencyKey,
  };
}

export async function logCommercialWalkIn(input: CommercialWalkInInput) {
  if (input.visitResult === "follow_up" && !input.followUpAt)
    throw new Error("Follow-up date is required for a follow-up walk-in");
  const mission = await createCommercialMission(commercialWalkInMissionInput(input));
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const pipelines = await tx.select().from(commercialPipelineRecords).where(and(
      eq(commercialPipelineRecords.tenantId, input.tenantId),
      eq(commercialPipelineRecords.missionId, mission.id)
    )).limit(1).for("update");
    const pipeline = pipelines[0];
    if (!pipeline) throw new Error("Commercial pipeline was not created");
    const transitionIdempotencyKey = `walk-in-transition:${input.requestId}`;
    const existing = await tx.select({ id: commercialMissionEvents.id }).from(commercialMissionEvents).where(and(
      eq(commercialMissionEvents.tenantId, input.tenantId),
      eq(commercialMissionEvents.idempotencyKey, transitionIdempotencyKey)
    )).limit(1);
    if (existing[0]) return;
    const targetStatus = input.visitResult === "won" ? "won" : input.visitResult === "lost" ? "lost" : "follow_up";
    await tx.update(commercialMissions).set({
      status: targetStatus,
      version: sql`${commercialMissions.version} + 1`,
      completedAt: ["won", "lost"].includes(targetStatus) ? new Date() : null,
    }).where(and(eq(commercialMissions.tenantId, input.tenantId), eq(commercialMissions.id, mission.id)));
    await tx.update(commercialPipelineRecords).set({
      stage: targetStatus,
      version: sql`${commercialPipelineRecords.version} + 1`,
      nextFollowUpAt: input.followUpAt ?? null,
      lossReason: targetStatus === "lost" ? input.nextAction : null,
    }).where(and(eq(commercialPipelineRecords.tenantId, input.tenantId), eq(commercialPipelineRecords.id, pipeline.id)));
    await tx.insert(commercialMissionEvents).values({
      tenantId: input.tenantId, missionId: mission.id, eventName: "unplanned_walk_in",
      fromStatus: mission.status, toStatus: targetStatus, actorType: "operator",
      actorId: input.actorId, idempotencyKey: transitionIdempotencyKey,
      metadataJson: {
        source: "unplanned_walk_in", conversationNotes: input.conversationNotes,
        visitResult: input.visitResult, nextAction: input.nextAction,
        campaign: input.campaign ?? null, placement: input.placement ?? null,
        collateralDelivered: input.collateralDelivered ?? false,
        quoteRequested: input.quoteRequested ?? false, pilotRequested: input.pilotRequested ?? false,
        gameBypass: true, gameXpAwarded: false,
      },
    });
    await tx.insert(commercialPipelineEvents).values({
      tenantId: input.tenantId, pipelineId: pipeline.id, missionId: mission.id,
      fromStage: pipeline.stage, toStage: targetStatus, actorType: "operator",
      actorId: input.actorId, idempotencyKey: `pipeline-walk-in:${input.requestId}`,
      correlationId: input.requestId, metadataJson: { source: "unplanned_walk_in" },
    });
    if (input.followUpAt) await tx.insert(commercialFollowUps).values({
      id: crypto.randomUUID(), tenantId: input.tenantId, pipelineId: pipeline.id,
      missionId: mission.id, dueAt: input.followUpAt, note: input.nextAction,
      assignedTo: input.assignedTo ?? input.actorId, requestId: input.requestId,
      createdBy: input.actorId,
    });
  });
  return { missionId: mission.id, missionCode: mission.code };
}
