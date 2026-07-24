import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  commercialAccountContacts,
  commercialAccountLocations,
  commercialAgreements,
  commercialCustomerContacts,
  commercialCustomerLocations,
  commercialCustomers,
  commercialFollowUps,
  commercialMissionFinalRewards,
  commercialPipelineEvents,
  commercialPipelineRecords,
  commercialProposals,
  commercialRouteAssignments,
  commercialServiceExpectations,
} from "../../drizzle/schema";
import type { CommercialMission } from "@shared/commercialMission";
import {
  commercialPipelineStageRank,
  pipelineStageForMissionStatus,
  type CommercialPipelineStage,
} from "@shared/commercialPipeline";
import type { CommercialLaundryProposalSnapshot } from "@shared/commercialProposal";
import { getDb } from "../db";

type Transaction = Parameters<
  Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]
>[0];

type PipelineActor = {
  type: "system" | "operator" | "driver" | "game";
  id: string | null;
};

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalized(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function commercialAccountIdentityKey(input: {
  providerName?: string | null;
  providerAccountId?: string | null;
  name: string;
  address: string;
}): string {
  return sha(
    input.providerName && input.providerAccountId
      ? `provider:${normalized(input.providerName)}:${normalized(input.providerAccountId)}`
      : `account:${normalized(input.name)}:${normalized(input.address)}`
  );
}

export function commercialLocationIdentityKey(input: {
  address: string;
  latitude: number | null;
  longitude: number | null;
}): string {
  return sha(`address:${normalized(input.address)}`);
}

export function normalizeCommercialContactEmail(
  value: string | null | undefined
): string | null {
  const normalizedEmail = normalized(value);
  return normalizedEmail || null;
}

export function normalizeCommercialContactPhone(
  value: string | null | undefined
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const international = raw.startsWith("+")
    ? `+${raw.slice(1).replace(/\D/g, "")}`
    : raw.startsWith("00")
      ? `+${raw.slice(2).replace(/\D/g, "")}`
      : raw.replace(/\D/g, "");
  return international === "+" || international.length < 7
    ? null
    : international;
}

export function commercialContactIdentityCandidates(input: {
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  fallbackIdentity?: string | null;
}): string[] {
  const email = normalizeCommercialContactEmail(input.email);
  const phone = normalizeCommercialContactPhone(input.phone);
  const name = normalized(input.name);
  const title = normalized(input.title);
  const candidates: string[] = [];
  if (email) candidates.push(sha(`email:${email}`));
  if (phone) candidates.push(sha(`phone:${phone}`));
  if (name) candidates.push(sha(`name-title:${name}:${title}`));
  if (input.fallbackIdentity) {
    candidates.push(sha(`unnamed:${normalized(input.fallbackIdentity)}`));
  }
  return Array.from(new Set(candidates));
}

export function commercialContactIdentityKey(input: {
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  fallbackIdentity?: string | null;
}): string {
  const key = commercialContactIdentityCandidates(input)[0];
  if (!key) {
    throw new Error(
      "Commercial contact identity requires email, phone, name/title, or an idempotent fallback identity"
    );
  }
  return key;
}

function pipelineEventKey(kind: string, correlationId: string): string {
  return `${kind}:${sha(correlationId)}`;
}

export async function createCommercialPipelineForMissionWith(
  tx: Transaction,
  input: {
    tenantId: string;
    accountId: number;
    opportunityId: number;
    missionId: number;
    estimatedContractValueCents: number | null;
    actor: PipelineActor;
    correlationId: string;
  }
): Promise<number> {
  const existing = await tx
    .select({ id: commercialPipelineRecords.id })
    .from(commercialPipelineRecords)
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.missionId, input.missionId)
      )
    )
    .limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await tx.insert(commercialPipelineRecords).values({
    tenantId: input.tenantId,
    accountId: input.accountId,
    opportunityId: input.opportunityId,
    missionId: input.missionId,
    stage: "mission_created",
    estimatedContractValueCents: input.estimatedContractValueCents,
  });
  const pipelineId = Number(inserted[0].insertId);
  const stages: CommercialPipelineStage[] = [
    "discovered",
    "qualified",
    "mission_created",
  ];
  let fromStage: CommercialPipelineStage | null = null;
  for (const stage of stages) {
    await tx.insert(commercialPipelineEvents).values({
      tenantId: input.tenantId,
      pipelineId,
      missionId: input.missionId,
      fromStage,
      toStage: stage,
      actorType: input.actor.type,
      actorId: input.actor.id,
      idempotencyKey: pipelineEventKey(stage, input.correlationId),
      correlationId: input.correlationId,
      metadataJson: {
        automatic: true,
        estimatedContractValueCents: input.estimatedContractValueCents,
      },
    });
    fromStage = stage;
  }
  return pipelineId;
}

async function convertWonAccountWith(
  tx: Transaction,
  input: {
    tenantId: string;
    pipelineId: number;
    mission: CommercialMission;
    actor: PipelineActor;
    correlationId: string;
  }
) {
  const accountId = input.mission.account.accountId;
  await tx
    .insert(commercialCustomers)
    .values({
      tenantId: input.tenantId,
      accountId,
      sourceMissionId: input.mission.id,
      status: "active",
    })
    .onDuplicateKeyUpdate({ set: { status: "active" } });
  const customerRows = await tx
    .select()
    .from(commercialCustomers)
    .where(
      and(
        eq(commercialCustomers.tenantId, input.tenantId),
        eq(commercialCustomers.accountId, accountId)
      )
    )
    .for("update")
    .limit(1);
  const customer = customerRows[0];
  if (!customer) throw new Error("Commercial customer conversion failed");

  const [locations, contacts, proposals] = await Promise.all([
    tx
      .select()
      .from(commercialAccountLocations)
      .where(
        and(
          eq(commercialAccountLocations.tenantId, input.tenantId),
          eq(commercialAccountLocations.accountId, accountId)
        )
      ),
    tx
      .select()
      .from(commercialAccountContacts)
      .where(
        and(
          eq(commercialAccountContacts.tenantId, input.tenantId),
          eq(commercialAccountContacts.accountId, accountId)
        )
      ),
    tx
      .select()
      .from(commercialProposals)
      .where(
        and(
          eq(commercialProposals.tenantId, input.tenantId),
          eq(commercialProposals.missionId, input.mission.id),
          eq(commercialProposals.status, "approved")
        )
      )
      .orderBy(desc(commercialProposals.version))
      .limit(1),
  ]);

  for (const location of locations) {
    await tx
      .insert(commercialCustomerLocations)
      .values({
        tenantId: input.tenantId,
        commercialCustomerId: customer.id,
        locationId: location.id,
      })
      .onDuplicateKeyUpdate({ set: { active: true } });
  }
  for (const contact of contacts) {
    await tx
      .insert(commercialCustomerContacts)
      .values({
        tenantId: input.tenantId,
        commercialCustomerId: customer.id,
        contactId: contact.id,
      })
      .onDuplicateKeyUpdate({ set: { active: true } });
  }

  const proposal = proposals[0];
  const snapshot = proposal?.snapshotJson as
    | CommercialLaundryProposalSnapshot
    | undefined;
  const pricePerPoundCents = snapshot?.pricing.pricePerPoundCents ?? null;
  const estimatedAnnualValueCents =
    input.mission.opportunity.estimatedAnnualValueCents;
  const expectedWeeklyPounds =
    pricePerPoundCents &&
    pricePerPoundCents > 0 &&
    estimatedAnnualValueCents !== null
      ? Math.max(
          1,
          Math.round(
            estimatedAnnualValueCents /
              pricePerPoundCents /
              52
          )
        )
      : null;
  const expectationInsert = await tx
    .insert(commercialServiceExpectations)
    .values({
      tenantId: input.tenantId,
      commercialCustomerId: customer.id,
      sourceMissionId: input.mission.id,
      sourceProposalId: proposal?.id ?? null,
      sourceProposalVersion: proposal?.version ?? null,
      status: "proposed",
      pricePerPoundCents,
      minimumOrderCents: snapshot?.pricing.minimumOrderCents ?? null,
      expectedWeeklyPounds,
      capacityReservedPoundsPerWeek: expectedWeeklyPounds ?? 0,
      pickupScheduleLabel: snapshot?.store.pickupScheduleLabel ?? null,
      turnaroundLabel: snapshot?.store.turnaroundLabel ?? null,
      serviceAreaLabel: snapshot?.store.serviceAreaLabel ?? null,
    })
    .onDuplicateKeyUpdate({
      set: {
        sourceProposalId: proposal?.id ?? null,
        sourceProposalVersion: proposal?.version ?? null,
      },
    });
  let serviceExpectationId = Number(expectationInsert[0].insertId);
  if (!serviceExpectationId) {
    const expectationRows = await tx
      .select({ id: commercialServiceExpectations.id })
      .from(commercialServiceExpectations)
      .where(
        and(
          eq(commercialServiceExpectations.tenantId, input.tenantId),
          eq(commercialServiceExpectations.commercialCustomerId, customer.id),
          eq(commercialServiceExpectations.sourceMissionId, input.mission.id)
        )
      )
      .limit(1);
    serviceExpectationId = expectationRows[0]?.id ?? 0;
  }
  if (!serviceExpectationId)
    throw new Error("Commercial service expectation was not persisted");

  await tx
    .insert(commercialAgreements)
    .values({
      tenantId: input.tenantId,
      commercialCustomerId: customer.id,
      missionId: input.mission.id,
      proposalId: proposal?.id ?? null,
      proposalVersion: proposal?.version ?? null,
      status: "verbal_yes",
      approvedAnnualValueCents: null,
      evidenceReference: null,
      recordedBy: input.actor.id ?? "dayforge-pipeline",
    })
    .onDuplicateKeyUpdate({
      set: { recordedBy: input.actor.id ?? "dayforge-pipeline" },
    });

  for (const location of locations) {
    await tx
      .insert(commercialRouteAssignments)
      .values({
        tenantId: input.tenantId,
        commercialCustomerId: customer.id,
        locationId: location.id,
        serviceExpectationId,
        status: "planned",
        routeLabel: `Planned commercial route · ${location.label ?? "Primary"}`,
        routeWindowLabel: snapshot?.store.pickupScheduleLabel ?? null,
        capacityReservedPoundsPerWeek: expectedWeeklyPounds ?? 0,
      })
      .onDuplicateKeyUpdate({
        set: {
          serviceExpectationId,
          routeWindowLabel: snapshot?.store.pickupScheduleLabel ?? null,
          capacityReservedPoundsPerWeek: expectedWeeklyPounds ?? 0,
        },
      });
  }

  await tx
    .update(commercialPipelineRecords)
    .set({ commercialCustomerId: customer.id })
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.id, input.pipelineId)
      )
    );
  const existingRewards = await tx
    .select({ id: commercialMissionFinalRewards.id })
    .from(commercialMissionFinalRewards)
    .where(
      and(
        eq(commercialMissionFinalRewards.tenantId, input.tenantId),
        eq(commercialMissionFinalRewards.missionId, input.mission.id)
      )
    )
    .for("update")
    .limit(1);
  if (!existingRewards[0])
    await tx.insert(commercialMissionFinalRewards).values({
      tenantId: input.tenantId,
      missionId: input.mission.id,
      commercialCustomerId: customer.id,
      playerId:
        input.mission.assignedTo ??
        input.actor.id ??
        "unassigned-commercial-operator",
      xpAwarded: 250,
      idempotencyKey: pipelineEventKey(
        "account-won-reward",
        input.correlationId
      ),
    });
  return customer.id;
}

export async function syncCommercialPipelineForMissionTransitionWith(
  tx: Transaction,
  input: {
    tenantId: string;
    mission: CommercialMission;
    toStatus: CommercialMission["status"];
    actor: PipelineActor;
    correlationId: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const opportunityId = input.mission.opportunity.opportunityId;
  if (!opportunityId)
    throw new Error("Commercial mission is missing its opportunity identity");
  const pipelineId = await createCommercialPipelineForMissionWith(tx, {
    tenantId: input.tenantId,
    accountId: input.mission.account.accountId,
    opportunityId,
    missionId: input.mission.id,
    estimatedContractValueCents:
      input.mission.opportunity.estimatedAnnualValueCents,
    actor: input.actor,
    correlationId: `pipeline-backfill:${input.mission.id}`,
  });
  const rows = await tx
    .select()
    .from(commercialPipelineRecords)
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.id, pipelineId)
      )
    )
    .for("update")
    .limit(1);
  const pipeline = rows[0];
  if (!pipeline) throw new Error("Commercial pipeline record not found");
  const requestedStage = pipelineStageForMissionStatus({
    status: input.toStatus,
    collateralDelivered: input.metadata?.collateralDelivered === true,
    quoteRequested: input.metadata?.quoteRequested === true,
    pilotRequested: input.metadata?.pilotRequested === true,
  });
  const currentStage = pipeline.stage as CommercialPipelineStage;
  const reopeningLost = currentStage === "lost" && requestedStage !== "lost";
  const forward =
    requestedStage === "lost" ||
    requestedStage === "won" ||
    commercialPipelineStageRank(requestedStage) >=
      commercialPipelineStageRank(currentStage);
  if (requestedStage === currentStage || (!forward && !reopeningLost)) return;

  const update = await tx
    .update(commercialPipelineRecords)
    .set({
      stage: requestedStage,
      version: sql`${commercialPipelineRecords.version} + 1`,
      nextFollowUpAt:
        requestedStage === "follow_up" &&
        typeof input.metadata?.followUpAt === "string"
          ? new Date(input.metadata.followUpAt)
          : pipeline.nextFollowUpAt,
      lossReason:
        requestedStage === "lost"
          ? String(input.metadata?.reason ?? "not_recorded")
          : null,
    })
    .where(
      and(
        eq(commercialPipelineRecords.tenantId, input.tenantId),
        eq(commercialPipelineRecords.id, pipelineId),
        eq(commercialPipelineRecords.version, pipeline.version)
      )
    );
  const affected = Number(
    (update as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
  if (affected !== 1)
    throw new Error("Commercial pipeline transition lost a concurrency race");

  await tx.insert(commercialPipelineEvents).values({
    tenantId: input.tenantId,
    pipelineId,
    missionId: input.mission.id,
    fromStage: currentStage,
    toStage: requestedStage,
    actorType: input.actor.type,
    actorId: input.actor.id,
    idempotencyKey: pipelineEventKey(
      `pipeline-${requestedStage}`,
      input.correlationId
    ),
    correlationId: input.correlationId,
    metadataJson: input.metadata ?? {},
  });

  if (
    requestedStage === "follow_up" &&
    typeof input.metadata?.followUpAt === "string" &&
    typeof input.metadata?.requestId === "string"
  ) {
    await tx
      .insert(commercialFollowUps)
      .values({
        id: randomUUID(),
        tenantId: input.tenantId,
        pipelineId,
        missionId: input.mission.id,
        dueAt: new Date(input.metadata.followUpAt),
        note: String(input.metadata.notes ?? "Follow up on commercial visit"),
        assignedTo: input.mission.assignedTo,
        requestId: input.metadata.requestId,
        createdBy: input.actor.id ?? "dayforge-pipeline",
      })
      .onDuplicateKeyUpdate({
        set: { dueAt: new Date(input.metadata.followUpAt) },
      });
  }

  if (requestedStage === "won") {
    await convertWonAccountWith(tx, {
      tenantId: input.tenantId,
      pipelineId,
      mission: input.mission,
      actor: input.actor,
      correlationId: input.correlationId,
    });
  }
}
