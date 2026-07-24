import { and, eq } from "drizzle-orm";
import { commercialMissionEvents, commercialMissionIrlStepDetails, commercialMissions, commercialMissionSteps } from "../../drizzle/schema";
import { getDb } from "../db";

export type LuxuryHotelIrlPlanInput = {
  tenantId: string; missionId: number; actorId: string; requestId: string;
  referenceImageUrl?: string | null; trainingVideoUrl?: string | null;
  printShopName: string; printShopAddress: string;
  convenienceStoreName: string; convenienceStoreAddress: string;
  hotelName?: string | null; hotelAddress?: string | null;
  printFulfillmentMode: "staged_demo" | "manual_fulfillment";
  printCreditDisplayCopy?: string | null;
};

export async function applyLuxuryHotelIrlPlan(input: LuxuryHotelIrlPlanInput) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const missions = await tx.select().from(commercialMissions).where(and(
      eq(commercialMissions.tenantId, input.tenantId), eq(commercialMissions.id, input.missionId)
    )).limit(1).for("update");
    const mission = missions[0];
    if (!mission) throw new Error("Commercial mission not found");
    const existingEvent = await tx.select().from(commercialMissionEvents).where(and(
      eq(commercialMissionEvents.tenantId, input.tenantId),
      eq(commercialMissionEvents.idempotencyKey, `irl-plan:${input.requestId}`)
    )).limit(1);
    if (existingEvent[0]) return { missionId: mission.id, created: false };
    const existingSteps = await tx.select().from(commercialMissionSteps).where(and(
      eq(commercialMissionSteps.tenantId, input.tenantId), eq(commercialMissionSteps.missionId, input.missionId)
    ));
    const positionOffset = existingSteps.reduce((maximum, step) => Math.max(maximum, step.position + 1), 0);
    const account = mission.accountSnapshotJson as { name?: string; address?: string };
    const steps = [
      { key: "wardrobe", label: "Suit up", detail: "Match the professional reference look before departure.", type: "wardrobe_review" as const, proof: "photo" as const, destinationName: null, destinationAddress: null, fulfillmentMode: "not_applicable" as const, metadata: {} },
      { key: "print-shop", label: "Collect the payload", detail: "Pick up the prepared hotel collateral.", type: "collateral_pickup" as const, proof: "confirmation" as const, destinationName: input.printShopName, destinationAddress: input.printShopAddress, fulfillmentMode: input.printFulfillmentMode, metadata: { printCreditDisplayCopy: input.printCreditDisplayCopy ?? "$100 complimentary print credit", providerConnected: false, paymentCreated: false } },
      { key: "mints", label: "Power up", detail: "Purchase mints while parked before the approach.", type: "purchase_stop" as const, proof: "confirmation" as const, destinationName: input.convenienceStoreName, destinationAddress: input.convenienceStoreAddress, fulfillmentMode: "manual_fulfillment" as const, metadata: {} },
      { key: "coaching", label: "Map the room", detail: "Review the role, first move, fallback, and opening line while parked.", type: "sales_training" as const, proof: "confirmation" as const, destinationName: null, destinationAddress: null, fulfillmentMode: "not_applicable" as const, metadata: {} },
      { key: "hotel", label: "Enter the room", detail: "Open Maps, park safely, then begin the canonical field visit.", type: "field_visit" as const, proof: "confirmation" as const, destinationName: input.hotelName ?? account.name ?? null, destinationAddress: input.hotelAddress ?? account.address ?? null, fulfillmentMode: "not_applicable" as const, metadata: { safety: "Park before interacting with DayForge." } },
      { key: "debrief", label: "Lock the next move", detail: "Record who you reached and schedule the next action.", type: "debrief" as const, proof: "confirmation" as const, destinationName: null, destinationAddress: null, fulfillmentMode: "not_applicable" as const, metadata: {} },
    ];
    await tx.insert(commercialMissionSteps).values(steps.map((step, position) => ({
      tenantId: input.tenantId, missionId: input.missionId, stepKey: step.key,
      label: step.label, detail: step.detail, status: position === 0 ? "ready" as const : "locked" as const, position: positionOffset + position,
    })));
    const rows = await tx.select().from(commercialMissionSteps).where(and(
      eq(commercialMissionSteps.tenantId, input.tenantId), eq(commercialMissionSteps.missionId, input.missionId)
    ));
    const byKey = new Map(rows.map(row => [row.stepKey, row]));
    await tx.insert(commercialMissionIrlStepDetails).values(steps.map((step, position) => ({
      tenantId: input.tenantId, missionId: input.missionId, missionStepId: byKey.get(step.key)!.id,
      stepType: step.type, status: position === 0 ? "ready" as const : "locked" as const, instructionText: step.detail,
      revealPolicy: "sequential" as const, destinationName: step.destinationName,
      destinationAddress: step.destinationAddress,
      mapsUrl: step.destinationAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(step.destinationAddress)}` : null,
      countdownDurationSeconds: step.destinationAddress ? 20 * 60 : null,
      proofRequirement: step.proof,
      referenceImageUrl: step.key === "wardrobe" ? input.referenceImageUrl ?? null : null,
      instructionVideoUrl: step.key === "coaching" ? input.trainingVideoUrl ?? null : null,
      fulfillmentMode: step.fulfillmentMode, metadataJson: step.metadata,
    })));
    await tx.insert(commercialMissionEvents).values({
      tenantId: input.tenantId, missionId: input.missionId, eventName: "irl_plan_created",
      fromStatus: mission.status, toStatus: mission.status, actorType: "operator", actorId: input.actorId,
      idempotencyKey: `irl-plan:${input.requestId}`, metadataJson: { template: "luxury_hotel_acquisition_v1", stepCount: steps.length },
    });
    return { missionId: mission.id, created: true };
  });
}

export async function advanceCommercialMissionIrlStep(input: {
  tenantId: string; missionId: number; stepKey: string; actorId: string;
  requestId: string; action: "start" | "complete";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const rows = await tx.select({ root: commercialMissionSteps, detail: commercialMissionIrlStepDetails })
      .from(commercialMissionSteps).innerJoin(commercialMissionIrlStepDetails, and(
        eq(commercialMissionIrlStepDetails.tenantId, input.tenantId),
        eq(commercialMissionIrlStepDetails.missionStepId, commercialMissionSteps.id)
      )).where(and(
        eq(commercialMissionSteps.tenantId, input.tenantId),
        eq(commercialMissionSteps.missionId, input.missionId),
        eq(commercialMissionSteps.stepKey, input.stepKey)
      )).limit(1).for("update");
    const current = rows[0];
    if (!current) throw new Error("IRL mission step not found");
    const existing = await tx.select().from(commercialMissionEvents).where(and(
      eq(commercialMissionEvents.tenantId, input.tenantId),
      eq(commercialMissionEvents.idempotencyKey, `irl-step:${input.requestId}`)
    )).limit(1);
    if (existing[0]) return { stepKey: input.stepKey, status: current.detail.status };
    const now = new Date();
    if (input.action === "start") {
      if (current.detail.status !== "ready") throw new Error(`IRL step cannot start from ${current.detail.status}`);
      const deadlineAt = current.detail.countdownDurationSeconds
        ? new Date(now.getTime() + current.detail.countdownDurationSeconds * 1000) : null;
      await tx.update(commercialMissionIrlStepDetails).set({ status: "active", startedAt: now, deadlineAt }).where(eq(commercialMissionIrlStepDetails.id, current.detail.id));
      await tx.update(commercialMissionSteps).set({ status: "active" }).where(eq(commercialMissionSteps.id, current.root.id));
    } else {
      if (!['active', 'ready'].includes(current.detail.status)) throw new Error(`IRL step cannot complete from ${current.detail.status}`);
      const awaitingReview = current.detail.proofRequirement === "photo";
      await tx.update(commercialMissionIrlStepDetails).set({ status: awaitingReview ? "awaiting_review" : "completed", verificationState: awaitingReview ? "pending" : current.detail.verificationState }).where(eq(commercialMissionIrlStepDetails.id, current.detail.id));
      if (!awaitingReview) {
        await tx.update(commercialMissionSteps).set({ status: "completed", completedAt: now }).where(eq(commercialMissionSteps.id, current.root.id));
        const next = await tx.select({ root: commercialMissionSteps, detail: commercialMissionIrlStepDetails }).from(commercialMissionSteps).innerJoin(commercialMissionIrlStepDetails, eq(commercialMissionIrlStepDetails.missionStepId, commercialMissionSteps.id)).where(and(
          eq(commercialMissionSteps.tenantId, input.tenantId), eq(commercialMissionSteps.missionId, input.missionId), eq(commercialMissionIrlStepDetails.status, "locked")
        )).orderBy(commercialMissionSteps.position).limit(1);
        if (next[0]) {
          await tx.update(commercialMissionSteps).set({ status: "ready" }).where(eq(commercialMissionSteps.id, next[0].root.id));
          await tx.update(commercialMissionIrlStepDetails).set({ status: "ready" }).where(eq(commercialMissionIrlStepDetails.id, next[0].detail.id));
        }
      }
    }
    await tx.insert(commercialMissionEvents).values({
      tenantId: input.tenantId, missionId: input.missionId,
      eventName: input.action === "start" ? "irl_step_started" : "irl_step_completed",
      fromStatus: current.root.status, toStatus: input.action === "start" ? "active" : "completed",
      actorType: "driver", actorId: input.actorId, idempotencyKey: `irl-step:${input.requestId}`,
      metadataJson: { stepKey: input.stepKey, deadlineAt: input.action === "start" && current.detail.countdownDurationSeconds ? new Date(now.getTime() + current.detail.countdownDurationSeconds * 1000).toISOString() : null },
    });
    return { stepKey: input.stepKey, status: input.action === "start" ? "active" : current.detail.proofRequirement === "photo" ? "awaiting_review" : "completed" };
  });
}
