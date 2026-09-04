import { createHash, createHmac } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import {
  commercialMissionEvents,
  commercialMissionFieldChecklistItems,
  commercialMissionFieldStates,
  commercialMissionPhoneHandoffs,
  commercialProposals,
  commercialVisitOutcomes,
  tenantFieldChecklistTemplates,
} from "../../drizzle/schema";
import {
  DEFAULT_FIELD_CHECKLIST,
  navigationUrl,
  type FieldOutcomeReason,
} from "@shared/commercialMissionField";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError as isDuplicateKeyError } from "../mysqlErrors";
import {
  getCommercialMission,
  readCommercialMissionWith,
  transitionCommercialMissionWith,
} from "./commercialMissionStore";
import { awardDriverSalesPoints } from "./driverSalesMotivationService";

function affectedRows(result: unknown): number {
  return Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function handoffToken(input: {
  tenantId: string;
  missionId: number;
  assignedTo: string;
  requestId: string;
}): string {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret)
    throw new Error("JWT_SECRET is required for secure phone handoffs");
  return createHmac("sha256", secret)
    .update(
      `${input.tenantId}:${input.missionId}:${input.assignedTo}:${input.requestId}`
    )
    .digest("base64url");
}

function asIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export async function getCommercialMissionFieldState(input: {
  tenantId: string;
  missionId: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const mission = await getCommercialMission(input);
  if (!mission) return null;
  const [states, checklist, outcomes, proposals] = await Promise.all([
    db
      .select()
      .from(commercialMissionFieldStates)
      .where(
        and(
          eq(commercialMissionFieldStates.tenantId, input.tenantId),
          eq(commercialMissionFieldStates.missionId, input.missionId)
        )
      )
      .limit(1),
    db
      .select()
      .from(commercialMissionFieldChecklistItems)
      .where(
        and(
          eq(commercialMissionFieldChecklistItems.tenantId, input.tenantId),
          eq(commercialMissionFieldChecklistItems.missionId, input.missionId)
        )
      )
      .orderBy(asc(commercialMissionFieldChecklistItems.position)),
    db
      .select()
      .from(commercialVisitOutcomes)
      .where(
        and(
          eq(commercialVisitOutcomes.tenantId, input.tenantId),
          eq(commercialVisitOutcomes.missionId, input.missionId)
        )
      )
      .limit(1),
    db
      .select({
        id: commercialProposals.id,
        version: commercialProposals.version,
        status: commercialProposals.status,
        validThrough: commercialProposals.validThrough,
      })
      .from(commercialProposals)
      .where(
        and(
          eq(commercialProposals.tenantId, input.tenantId),
          eq(commercialProposals.missionId, input.missionId),
          eq(commercialProposals.status, "approved"),
          gt(commercialProposals.validThrough, new Date())
        )
      )
      .orderBy(sql`${commercialProposals.version} DESC`)
      .limit(1),
  ]);
  const state = states[0] ?? null;
  const outcome = outcomes[0] ?? null;
  return {
    mission,
    field: state
      ? {
          version: state.version,
          notes: state.notes,
          preparationStartedAt: asIso(state.preparationStartedAt),
          departedAt: asIso(state.departedAt),
          arrivedAt: asIso(state.arrivedAt),
          checkInMethod: state.checkInMethod,
          latitude: state.latitude === null ? null : Number(state.latitude),
          longitude: state.longitude === null ? null : Number(state.longitude),
          locationAccuracyMeters: state.locationAccuracyMeters,
        }
      : null,
    checklist: checklist.map(item => ({
      itemKey: item.itemKey,
      label: item.label,
      detail: item.detail,
      required: item.required,
      position: item.position,
      status: item.status,
      completedAt: asIso(item.completedAt),
    })),
    visitOutcome: outcome
      ? {
          id: outcome.id,
          outcome: outcome.outcome,
          notes: outcome.notes,
          followUpAt: asIso(outcome.followUpAt),
          estimatedContractValueCents: outcome.estimatedContractValueCents,
          decisionMakerStatus: outcome.decisionMakerStatus,
          collateralDelivered: outcome.collateralDelivered,
          quoteRequested: outcome.quoteRequested,
          pilotRequested: outcome.pilotRequested,
          followUpRequested: outcome.followUpRequested,
          reason: outcome.reason,
          evidence: outcome.evidenceJson as Record<string, unknown>,
        }
      : null,
    proposal: proposals[0]
      ? {
          id: proposals[0].id,
          version: proposals[0].version,
          status: proposals[0].status,
          validThrough: proposals[0].validThrough.toISOString(),
        }
      : null,
    navigationUrl: navigationUrl(mission.account.address),
  };
}

export async function startCommercialMissionFieldPreparation(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  expectedMissionVersion: number;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const existingStates = await tx
        .select()
        .from(commercialMissionFieldStates)
        .where(
          and(
            eq(commercialMissionFieldStates.tenantId, input.tenantId),
            eq(commercialMissionFieldStates.missionId, input.missionId)
          )
        )
        .limit(1);
      if (existingStates[0]) return;
      const mission = await readCommercialMissionWith(tx, input);
      if (!mission) throw new Error("Commercial mission not found");
      if (mission.status !== "phone_ready")
        throw new Error(
          `Field preparation cannot start from ${mission.status}`
        );
      const templates = await tx
        .select()
        .from(tenantFieldChecklistTemplates)
        .where(
          and(
            eq(tenantFieldChecklistTemplates.tenantId, input.tenantId),
            eq(tenantFieldChecklistTemplates.active, true)
          )
        )
        .orderBy(asc(tenantFieldChecklistTemplates.position));
      const items = templates.length > 0 ? templates : DEFAULT_FIELD_CHECKLIST;
      await tx.insert(commercialMissionFieldStates).values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        notes: "",
        preparationStartedAt: new Date(),
      });
      await tx.insert(commercialMissionFieldChecklistItems).values(
        items.map(item => ({
          tenantId: input.tenantId,
          missionId: input.missionId,
          itemKey: item.itemKey,
          label: item.label,
          detail: item.detail,
          required: item.required,
          position: item.position,
          status: "pending" as const,
        }))
      );
      await transitionCommercialMissionWith(tx, {
        tenantId: input.tenantId,
        missionId: input.missionId,
        expectedVersion: input.expectedMissionVersion,
        toStatus: "preparing",
        actor: { type: "driver", id: input.actorId },
        idempotencyKey: `field-preparation:${input.requestId}`,
        metadata: { checklistItemKeys: items.map(item => item.itemKey) },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const state = await getCommercialMissionFieldState(input);
  if (!state?.field)
    throw new Error("Field preparation state was not persisted");
  return state;
}

export async function updateCommercialMissionFieldChecklist(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  expectedFieldVersion: number;
  itemKey: string;
  status: "pending" | "completed" | "skipped";
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const idempotencyKey = `field-checklist:${input.requestId}`;
    const replay = await tx
      .select({ id: commercialMissionEvents.id })
      .from(commercialMissionEvents)
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(commercialMissionEvents.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    if (replay[0]) return;
    const [fieldRows, itemRows, mission] = await Promise.all([
      tx
        .select()
        .from(commercialMissionFieldStates)
        .where(
          and(
            eq(commercialMissionFieldStates.tenantId, input.tenantId),
            eq(commercialMissionFieldStates.missionId, input.missionId)
          )
        )
        .limit(1),
      tx
        .select()
        .from(commercialMissionFieldChecklistItems)
        .where(
          and(
            eq(commercialMissionFieldChecklistItems.tenantId, input.tenantId),
            eq(commercialMissionFieldChecklistItems.missionId, input.missionId),
            eq(commercialMissionFieldChecklistItems.itemKey, input.itemKey)
          )
        )
        .limit(1),
      readCommercialMissionWith(tx, input),
    ]);
    const field = fieldRows[0];
    const item = itemRows[0];
    if (!field || !item || !mission)
      throw new Error("Field checklist item not found");
    if (mission.status !== "preparing")
      throw new Error(`Checklist cannot change from ${mission.status}`);
    if (field.version !== input.expectedFieldVersion)
      throw new Error("Field state version conflict");
    if (input.status === "skipped" && item.required)
      throw new Error("A required preparation item cannot be skipped");
    if (input.itemKey === "collateral" && input.status === "completed") {
      const approved = await tx
        .select({ id: commercialProposals.id })
        .from(commercialProposals)
        .where(
          and(
            eq(commercialProposals.tenantId, input.tenantId),
            eq(commercialProposals.missionId, input.missionId),
            eq(commercialProposals.status, "approved"),
            gt(commercialProposals.validThrough, new Date())
          )
        )
        .limit(1);
      if (!approved[0])
        throw new Error(
          "Approve a current proposal before marking the leave-behind ready"
        );
    }
    await tx
      .update(commercialMissionFieldChecklistItems)
      .set({
        status: input.status,
        completedAt: input.status === "completed" ? new Date() : null,
        completedBy: input.status === "completed" ? input.actorId : null,
      })
      .where(
        and(
          eq(commercialMissionFieldChecklistItems.tenantId, input.tenantId),
          eq(commercialMissionFieldChecklistItems.missionId, input.missionId),
          eq(commercialMissionFieldChecklistItems.itemKey, input.itemKey)
        )
      );
    const updated = await tx
      .update(commercialMissionFieldStates)
      .set({
        version: sql`${commercialMissionFieldStates.version} + 1`,
      })
      .where(
        and(
          eq(commercialMissionFieldStates.tenantId, input.tenantId),
          eq(commercialMissionFieldStates.missionId, input.missionId),
          eq(commercialMissionFieldStates.version, input.expectedFieldVersion)
        )
      );
    if (affectedRows(updated) !== 1)
      throw new Error("Field checklist update lost a concurrency race");
    await tx.insert(commercialMissionEvents).values({
      tenantId: input.tenantId,
      missionId: input.missionId,
      eventName: "field_checklist_updated",
      fromStatus: mission.status,
      toStatus: mission.status,
      actorType: "driver",
      actorId: input.actorId,
      idempotencyKey,
      metadataJson: {
        itemKey: input.itemKey,
        from: item.status,
        to: input.status,
      },
    });
  });
  const state = await getCommercialMissionFieldState(input);
  if (!state?.field)
    throw new Error("Field state is missing after checklist update");
  return state;
}

export async function departCommercialMissionField(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  expectedMissionVersion: number;
  expectedFieldVersion: number;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const replay = await tx
      .select({ id: commercialMissionEvents.id })
      .from(commercialMissionEvents)
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(
            commercialMissionEvents.idempotencyKey,
            `field-departed:${input.requestId}`
          )
        )
      )
      .limit(1);
    if (replay[0]) return;
    const requiredItems = await tx
      .select({
        itemKey: commercialMissionFieldChecklistItems.itemKey,
        status: commercialMissionFieldChecklistItems.status,
      })
      .from(commercialMissionFieldChecklistItems)
      .where(
        and(
          eq(commercialMissionFieldChecklistItems.tenantId, input.tenantId),
          eq(commercialMissionFieldChecklistItems.missionId, input.missionId),
          eq(commercialMissionFieldChecklistItems.required, true)
        )
      );
    if (requiredItems.length === 0)
      throw new Error("Field preparation has no required checklist items");
    const incomplete = requiredItems.filter(
      item => item.status !== "completed"
    );
    if (incomplete.length > 0)
      throw new Error(
        `Complete required preparation: ${incomplete.map(item => item.itemKey).join(", ")}`
      );
    const currentProposal = await tx
      .select({ id: commercialProposals.id })
      .from(commercialProposals)
      .where(
        and(
          eq(commercialProposals.tenantId, input.tenantId),
          eq(commercialProposals.missionId, input.missionId),
          eq(commercialProposals.status, "approved"),
          gt(commercialProposals.validThrough, new Date())
        )
      )
      .limit(1);
    if (!currentProposal[0])
      throw new Error(
        "Approve a current proposal before departing for the visit"
      );
    const fieldUpdate = await tx
      .update(commercialMissionFieldStates)
      .set({
        departedAt: new Date(),
        version: sql`${commercialMissionFieldStates.version} + 1`,
      })
      .where(
        and(
          eq(commercialMissionFieldStates.tenantId, input.tenantId),
          eq(commercialMissionFieldStates.missionId, input.missionId),
          eq(commercialMissionFieldStates.version, input.expectedFieldVersion)
        )
      );
    if (affectedRows(fieldUpdate) !== 1)
      throw new Error("Field departure lost a concurrency race");
    await transitionCommercialMissionWith(tx, {
      tenantId: input.tenantId,
      missionId: input.missionId,
      expectedVersion: input.expectedMissionVersion,
      toStatus: "en_route",
      actor: { type: "driver", id: input.actorId },
      idempotencyKey: `field-departed:${input.requestId}`,
    });
  });
  return getCommercialMissionFieldState(input);
}

export async function arriveCommercialMissionField(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  expectedMissionVersion: number;
  expectedFieldVersion: number;
  requestId: string;
  checkInMethod: "manual" | "location";
  latitude?: number;
  longitude?: number;
  locationAccuracyMeters?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const replay = await tx
      .select({ id: commercialMissionEvents.id })
      .from(commercialMissionEvents)
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(
            commercialMissionEvents.idempotencyKey,
            `field-arrived:${input.requestId}`
          )
        )
      )
      .limit(1);
    if (replay[0]) return;
    const fieldUpdate = await tx
      .update(commercialMissionFieldStates)
      .set({
        arrivedAt: new Date(),
        checkInMethod: input.checkInMethod,
        latitude: input.latitude === undefined ? null : String(input.latitude),
        longitude:
          input.longitude === undefined ? null : String(input.longitude),
        locationAccuracyMeters: input.locationAccuracyMeters ?? null,
        version: sql`${commercialMissionFieldStates.version} + 1`,
      })
      .where(
        and(
          eq(commercialMissionFieldStates.tenantId, input.tenantId),
          eq(commercialMissionFieldStates.missionId, input.missionId),
          eq(commercialMissionFieldStates.version, input.expectedFieldVersion)
        )
      );
    if (affectedRows(fieldUpdate) !== 1)
      throw new Error("Field arrival lost a concurrency race");
    await transitionCommercialMissionWith(tx, {
      tenantId: input.tenantId,
      missionId: input.missionId,
      expectedVersion: input.expectedMissionVersion,
      toStatus: "arrived",
      actor: { type: "driver", id: input.actorId },
      idempotencyKey: `field-arrived:${input.requestId}`,
      metadata: {
        checkInMethod: input.checkInMethod,
        locationEvidenceRecorded: input.checkInMethod === "location",
      },
    });
  });
  return getCommercialMissionFieldState(input);
}

export async function saveCommercialMissionFieldNotes(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  expectedFieldVersion: number;
  notes: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    const replay = await tx
      .select({ id: commercialMissionEvents.id })
      .from(commercialMissionEvents)
      .where(
        and(
          eq(commercialMissionEvents.tenantId, input.tenantId),
          eq(
            commercialMissionEvents.idempotencyKey,
            `field-notes:${input.requestId}`
          )
        )
      )
      .limit(1);
    if (replay[0]) return;
    const mission = await readCommercialMissionWith(tx, input);
    if (!mission) throw new Error("Commercial mission not found");
    if (mission.status !== "arrived")
      throw new Error(`Visit notes cannot change from ${mission.status}`);
    const updated = await tx
      .update(commercialMissionFieldStates)
      .set({
        notes: input.notes,
        version: sql`${commercialMissionFieldStates.version} + 1`,
      })
      .where(
        and(
          eq(commercialMissionFieldStates.tenantId, input.tenantId),
          eq(commercialMissionFieldStates.missionId, input.missionId),
          eq(commercialMissionFieldStates.version, input.expectedFieldVersion)
        )
      );
    if (affectedRows(updated) !== 1)
      throw new Error("Field notes update lost a concurrency race");
    await tx.insert(commercialMissionEvents).values({
      tenantId: input.tenantId,
      missionId: input.missionId,
      eventName: "field_notes_saved",
      fromStatus: mission.status,
      toStatus: mission.status,
      actorType: "driver",
      actorId: input.actorId,
      idempotencyKey: `field-notes:${input.requestId}`,
      metadataJson: { characterCount: input.notes.length },
    });
  });
  return getCommercialMissionFieldState(input);
}

export async function recordCommercialMissionVisitOutcome(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  expectedMissionVersion: number;
  expectedFieldVersion: number;
  requestId: string;
  outcome: "follow_up" | "won" | "lost" | "no_contact" | "no_decision";
  notes: string;
  followUpAt?: Date;
  decisionMakerStatus: "met" | "unavailable" | "not_recorded";
  collateralDelivered: boolean;
  quoteRequested: boolean;
  pilotRequested: boolean;
  followUpRequested: boolean;
  reason?: FieldOutcomeReason;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const existing = await tx
        .select({ id: commercialVisitOutcomes.id })
        .from(commercialVisitOutcomes)
        .where(
          and(
            eq(commercialVisitOutcomes.tenantId, input.tenantId),
            eq(commercialVisitOutcomes.missionId, input.missionId)
          )
        )
        .limit(1);
      if (existing[0]) return;
      let mission = await readCommercialMissionWith(tx, input);
      if (!mission) throw new Error("Commercial mission not found");
      if (mission.status !== "arrived")
        throw new Error(
          `Visit outcome cannot be recorded from ${mission.status}`
        );
      await tx.insert(commercialVisitOutcomes).values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        outcome: input.outcome,
        notes: input.notes,
        followUpAt: input.followUpAt,
        estimatedContractValueCents:
          input.outcome === "won"
            ? mission.opportunity.estimatedAnnualValueCents
            : null,
        decisionMakerStatus: input.decisionMakerStatus,
        collateralDelivered: input.collateralDelivered,
        quoteRequested: input.quoteRequested,
        pilotRequested: input.pilotRequested,
        followUpRequested: input.followUpRequested,
        reason: input.reason,
        evidenceJson: {},
        recordedBy: input.actorId,
      });
      const fieldUpdate = await tx
        .update(commercialMissionFieldStates)
        .set({
          notes: input.notes,
          version: sql`${commercialMissionFieldStates.version} + 1`,
        })
        .where(
          and(
            eq(commercialMissionFieldStates.tenantId, input.tenantId),
            eq(commercialMissionFieldStates.missionId, input.missionId),
            eq(commercialMissionFieldStates.version, input.expectedFieldVersion)
          )
        );
      if (affectedRows(fieldUpdate) !== 1)
        throw new Error("Visit outcome lost a field-state concurrency race");
      mission = await transitionCommercialMissionWith(tx, {
        tenantId: input.tenantId,
        missionId: input.missionId,
        expectedVersion: input.expectedMissionVersion,
        toStatus: "visit_completed",
        actor: { type: "driver", id: input.actorId },
        idempotencyKey: `field-visit-completed:${input.requestId}`,
        metadata: {
          visitOutcome: input.outcome,
          collateralDelivered: input.collateralDelivered,
        },
      });
      if (
        input.outcome === "follow_up" ||
        input.outcome === "won" ||
        input.outcome === "lost"
      ) {
        await transitionCommercialMissionWith(tx, {
          tenantId: input.tenantId,
          missionId: input.missionId,
          expectedVersion: mission.version,
          toStatus: input.outcome,
          actor: { type: "driver", id: input.actorId },
          idempotencyKey: `field-outcome:${input.requestId}`,
          metadata: {
            visitOutcome: input.outcome,
            reason: input.reason ?? null,
            decisionMakerStatus: input.decisionMakerStatus,
            collateralDelivered: input.collateralDelivered,
            quoteRequested: input.quoteRequested,
            pilotRequested: input.pilotRequested,
            followUpRequested: input.followUpRequested,
            followUpAt: input.followUpAt?.toISOString() ?? null,
            notes: input.notes,
            requestId: input.requestId,
          },
        });
      }
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const state = await getCommercialMissionFieldState(input);
  if (!state?.visitOutcome) throw new Error("Visit outcome was not persisted");
  const outcomePoints = input.outcome === "won" ? 100 : input.outcome === "follow_up" ? 22 : 0;
  const proofPoints =
    (input.decisionMakerStatus === "met" ? 10 : 0) +
    (input.quoteRequested ? 25 : 0) +
    (input.pilotRequested ? 25 : 0);
  await awardDriverSalesPoints({
    tenantId: input.tenantId,
    driverId: input.actorId,
    missionId: input.missionId,
    eventType: input.outcome === "won" ? "deal_closed" : "in_person_visit",
    points: 10 + outcomePoints + proofPoints,
    dedupeKey: `score:field-outcome:${input.requestId}`,
    metadata: {
      outcome: input.outcome,
      decisionMakerStatus: input.decisionMakerStatus,
      quoteRequested: input.quoteRequested,
      pilotRequested: input.pilotRequested,
    },
  });
  return state;
}

export async function createCommercialMissionPhoneHandoff(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  requestId: string;
  driverOrigin?: string;
}) {
  const mission = await getCommercialMission(input);
  if (!mission) throw new Error("Commercial mission not found");
  if (!mission.assignedTo)
    throw new Error("Assign the mission before creating a phone handoff");
  if (
    !["phone_ready", "preparing", "en_route", "arrived"].includes(
      mission.status
    )
  ) {
    throw new Error(`Phone handoff is unavailable from ${mission.status}`);
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const token = handoffToken({ ...input, assignedTo: mission.assignedTo });
  const existingRows = await db
    .select()
    .from(commercialMissionPhoneHandoffs)
    .where(
      and(
        eq(commercialMissionPhoneHandoffs.tenantId, input.tenantId),
        eq(commercialMissionPhoneHandoffs.id, input.requestId)
      )
    )
    .limit(1);
  let persistedHandoff = existingRows[0];
  if (
    persistedHandoff &&
    (persistedHandoff.missionId !== input.missionId ||
      persistedHandoff.assignedTo !== mission.assignedTo)
  ) {
    throw new Error(
      "Phone handoff request ID is already bound to another mission or assignee"
    );
  }
  if (!persistedHandoff) {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await db.insert(commercialMissionPhoneHandoffs).values({
        id: input.requestId,
        tenantId: input.tenantId,
        missionId: input.missionId,
        assignedTo: mission.assignedTo,
        channel: "secure_link",
        tokenHash: hashToken(token),
        expiresAt,
        createdBy: input.actorId,
      });
      persistedHandoff = {
        id: input.requestId,
        tenantId: input.tenantId,
        missionId: input.missionId,
        assignedTo: mission.assignedTo,
        channel: "secure_link",
        tokenHash: hashToken(token),
        targetMasked: null,
        expiresAt,
        consumedAt: null,
        consumedBy: null,
        createdBy: input.actorId,
        createdAt: new Date(),
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const concurrentRows = await db
        .select()
        .from(commercialMissionPhoneHandoffs)
        .where(
          and(
            eq(commercialMissionPhoneHandoffs.tenantId, input.tenantId),
            eq(commercialMissionPhoneHandoffs.id, input.requestId)
          )
        )
        .limit(1);
      persistedHandoff = concurrentRows[0];
      if (
        !persistedHandoff ||
        persistedHandoff.missionId !== input.missionId ||
        persistedHandoff.assignedTo !== mission.assignedTo
      ) {
        throw new Error(
          "Phone handoff request ID is already bound to another mission or assignee"
        );
      }
    }
  }
  if (!persistedHandoff) throw new Error("Phone handoff was not persisted");
  const origin = (
    input.driverOrigin ??
    process.env.DRIVER_APP_ORIGIN ??
    "https://driver.bldg.chat"
  ).replace(/\/$/, "");
  return {
    handoffId: input.requestId,
    expiresAt: persistedHandoff.expiresAt.toISOString(),
    secureUrl: `${origin}/driver/sales-mission/${mission.id}?handoff=${encodeURIComponent(token)}`,
  };
}

export async function consumeCommercialMissionPhoneHandoff(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  token: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const rows = await tx
        .select()
        .from(commercialMissionPhoneHandoffs)
        .where(
          and(
            eq(commercialMissionPhoneHandoffs.tenantId, input.tenantId),
            eq(commercialMissionPhoneHandoffs.missionId, input.missionId),
            eq(commercialMissionPhoneHandoffs.tokenHash, hashToken(input.token))
          )
        )
        .limit(1);
      const handoff = rows[0];
      if (!handoff || handoff.expiresAt.getTime() <= Date.now())
        throw new Error("Phone handoff is invalid or expired");
      if (handoff.assignedTo !== input.actorId)
        throw new Error("Phone handoff is assigned to another field user");
      if (handoff.consumedAt) {
        if (handoff.consumedBy !== input.actorId)
          throw new Error("Phone handoff was already consumed by another user");
        return;
      }
      await tx
        .update(commercialMissionPhoneHandoffs)
        .set({ consumedAt: new Date(), consumedBy: input.actorId })
        .where(
          and(
            eq(commercialMissionPhoneHandoffs.tenantId, input.tenantId),
            eq(commercialMissionPhoneHandoffs.id, handoff.id),
            isNull(commercialMissionPhoneHandoffs.consumedAt)
          )
        );
      const mission = await readCommercialMissionWith(tx, input);
      if (!mission) throw new Error("Commercial mission not found");
      await tx.insert(commercialMissionEvents).values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        eventName: "phone_handoff_consumed",
        fromStatus: mission.status,
        toStatus: mission.status,
        actorType: "driver",
        actorId: input.actorId,
        idempotencyKey: `phone-handoff-consumed:${handoff.id}`,
        metadataJson: { handoffId: handoff.id, channel: handoff.channel },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  return getCommercialMissionFieldState(input);
}

export async function saveTenantFieldChecklistTemplates(input: {
  tenantId: string;
  items: Array<{
    itemKey: string;
    label: string;
    detail: string;
    required: boolean;
    position: number;
    active: boolean;
  }>;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.transaction(async tx => {
    for (const item of input.items) {
      await tx
        .insert(tenantFieldChecklistTemplates)
        .values({ ...item, tenantId: input.tenantId })
        .onDuplicateKeyUpdate({
          set: {
            label: item.label,
            detail: item.detail,
            required: item.required,
            position: item.position,
            active: item.active,
          },
        });
    }
  });
  return { ok: true as const };
}
