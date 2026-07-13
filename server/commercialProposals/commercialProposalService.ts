import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, ne } from "drizzle-orm";
import {
  commercialProposalEvents,
  commercialProposals,
  tenantCommercialProposalProfiles,
} from "../../drizzle/schema";
import {
  buildCommercialLaundryProposal,
  type CommercialLaundryProposalSnapshot,
  type CommercialProposalProfile,
} from "@shared/commercialProposal";
import { getDb } from "../db";
import { isMysqlDuplicateKeyError as isDuplicateKeyError } from "../mysqlErrors";
import {
  readCommercialMissionWith,
  type CommercialMissionTransaction,
} from "../commercialMissions/commercialMissionStore";
import { writeDayforgeEventWith } from "../dayforgeEvents/dayforgeEventStore";

const PROPOSAL_READY_STATUSES = new Set([
  "phone_ready",
  "preparing",
  "en_route",
  "arrived",
  "visit_completed",
  "follow_up",
  "won",
]);

function affectedRows(result: unknown): number {
  return Number(
    (result as { [0]?: { affectedRows?: number } })[0]?.affectedRows ?? 0
  );
}

function contentHash(snapshot: CommercialLaundryProposalSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function estimatedValueBand(cents: number): string {
  if (cents < 5_000_00) return "under_5k";
  if (cents < 15_000_00) return "5k_to_15k";
  if (cents < 30_000_00) return "15k_to_30k";
  if (cents < 75_000_00) return "30k_to_75k";
  return "75k_plus";
}

function proposalAuditSnapshot(input: {
  id: string;
  missionId: number;
  version: number;
  status: "draft" | "approved" | "superseded" | "void";
  contentHash: string;
  validThrough: Date;
}) {
  return {
    proposalId: input.id,
    missionId: input.missionId,
    version: input.version,
    status: input.status,
    contentHash: input.contentHash,
    validThrough: input.validThrough.toISOString(),
  };
}

function profileFromRow(
  row: typeof tenantCommercialProposalProfiles.$inferSelect
): CommercialProposalProfile {
  const services = Array.isArray(row.servicesJson)
    ? row.servicesJson.filter(
        (value): value is string =>
          typeof value === "string" && value.trim().length > 0
      )
    : [];
  if (services.length === 0)
    throw new Error("Commercial proposal profile has no configured services");
  return {
    storeName: row.storeName,
    operatorName: row.operatorName,
    phone: row.phone,
    email: row.email,
    website: row.website,
    address: row.address,
    logoUrl: row.logoUrl,
    commercialPricePerPoundCents: row.commercialPricePerPoundCents,
    minimumOrderCents: row.minimumOrderCents,
    turnaroundLabel: row.turnaroundLabel,
    pickupScheduleLabel: row.pickupScheduleLabel,
    serviceAreaLabel: row.serviceAreaLabel,
    insuranceLabel: row.insuranceLabel,
    services,
  };
}

function proposalFromRow(row: typeof commercialProposals.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    missionId: row.missionId,
    version: row.version,
    status: row.status,
    snapshot: row.snapshotJson as CommercialLaundryProposalSnapshot,
    contentHash: row.contentHash,
    validThrough: row.validThrough.toISOString(),
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getCommercialProposalProfile(tenantId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(tenantCommercialProposalProfiles)
    .where(eq(tenantCommercialProposalProfiles.tenantId, tenantId))
    .limit(1);
  return rows[0] ? profileFromRow(rows[0]) : null;
}

export async function saveCommercialProposalProfile(input: {
  tenantId: string;
  actorId: string;
  profile: CommercialProposalProfile;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .insert(tenantCommercialProposalProfiles)
    .values({
      tenantId: input.tenantId,
      ...input.profile,
      servicesJson: input.profile.services,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    })
    .onDuplicateKeyUpdate({
      set: {
        ...input.profile,
        servicesJson: input.profile.services,
        updatedBy: input.actorId,
      },
    });
  return getCommercialProposalProfile(input.tenantId);
}

async function getProposalRowById(input: {
  tenantId: string;
  proposalId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(commercialProposals)
    .where(
      and(
        eq(commercialProposals.tenantId, input.tenantId),
        eq(commercialProposals.id, input.proposalId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function getLatestCommercialProposalForMission(input: {
  tenantId: string;
  missionId: number;
  approvedOnly?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const where = input.approvedOnly
    ? and(
        eq(commercialProposals.tenantId, input.tenantId),
        eq(commercialProposals.missionId, input.missionId),
        eq(commercialProposals.status, "approved"),
        gt(commercialProposals.validThrough, new Date())
      )
    : and(
        eq(commercialProposals.tenantId, input.tenantId),
        eq(commercialProposals.missionId, input.missionId)
      );
  const rows = await db
    .select()
    .from(commercialProposals)
    .where(where)
    .orderBy(desc(commercialProposals.version))
    .limit(1);
  return rows[0] ? proposalFromRow(rows[0]) : null;
}

export async function getApprovedCommercialProposalSummary(input: {
  tenantId: string;
  missionId: number;
}) {
  const proposal = await getLatestCommercialProposalForMission({
    ...input,
    approvedOnly: true,
  });
  return proposal
    ? {
        id: proposal.id,
        version: proposal.version,
        status: proposal.status,
        validThrough: proposal.validThrough,
      }
    : null;
}

async function readProfileWith(
  tx: CommercialMissionTransaction,
  tenantId: string
) {
  const rows = await tx
    .select()
    .from(tenantCommercialProposalProfiles)
    .where(eq(tenantCommercialProposalProfiles.tenantId, tenantId))
    .limit(1);
  return rows[0] ?? null;
}

export async function generateCommercialProposal(input: {
  tenantId: string;
  missionId: number;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let proposalId: string | null = null;
  try {
    proposalId = await db.transaction(async tx => {
      const replay = await tx
        .select({ id: commercialProposals.id })
        .from(commercialProposals)
        .where(
          and(
            eq(commercialProposals.tenantId, input.tenantId),
            eq(commercialProposals.requestId, input.requestId)
          )
        )
        .limit(1);
      if (replay[0]) return replay[0].id;
      const [mission, profileRow, latestRows] = await Promise.all([
        readCommercialMissionWith(tx, input),
        readProfileWith(tx, input.tenantId),
        tx
          .select({ version: commercialProposals.version })
          .from(commercialProposals)
          .where(
            and(
              eq(commercialProposals.tenantId, input.tenantId),
              eq(commercialProposals.missionId, input.missionId)
            )
          )
          .orderBy(desc(commercialProposals.version))
          .limit(1),
      ]);
      if (!mission) throw new Error("Commercial mission not found");
      if (!PROPOSAL_READY_STATUSES.has(mission.status))
        throw new Error(`Proposal cannot be generated from ${mission.status}`);
      if (!profileRow)
        throw new Error(
          "Configure the tenant commercial proposal profile before generating collateral"
        );
      const profile = profileFromRow(profileRow);
      const snapshot = buildCommercialLaundryProposal({ mission, profile });
      const id = randomUUID();
      const version = (latestRows[0]?.version ?? 0) + 1;
      await tx.insert(commercialProposals).values({
        id,
        tenantId: input.tenantId,
        missionId: input.missionId,
        version,
        status: "draft",
        snapshotJson: snapshot,
        contentHash: contentHash(snapshot),
        requestId: input.requestId,
        validThrough: new Date(snapshot.validThrough),
        createdBy: input.actorId,
      });
      await tx.insert(commercialProposalEvents).values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        proposalId: id,
        eventName: "proposal_generated",
        actorId: input.actorId,
        idempotencyKey: `proposal-generated:${input.requestId}`,
        metadataJson: { version, contentHash: contentHash(snapshot) },
      });
      const projectionCorrelationId = `commercial-proposal:${id}:${input.requestId}`;
      await writeDayforgeEventWith(tx, {
        tenantId: input.tenantId,
        actor: { type: "operator", id: input.actorId },
        entityType: "commercial_proposal",
        entityId: id,
        eventName: "proposal_created",
        before: null,
        after: proposalAuditSnapshot({
          id,
          missionId: input.missionId,
          version,
          status: "draft",
          contentHash: contentHash(snapshot),
          validThrough: new Date(snapshot.validThrough),
        }),
        source: "commercial_proposal",
        correlationId: projectionCorrelationId,
        idempotencyKey: `${projectionCorrelationId}:created`,
        productEvent: {
          name: "proposal_created",
          missionId: input.missionId,
          accountId: mission.account.accountId,
          opportunityId: mission.opportunity.opportunityId,
          properties: {
            versionNumber: version,
            templateKey: "tenant_commercial_profile_v1",
            estimatedValueBand: estimatedValueBand(
              snapshot.pricing.estimatedAnnualValueCents
            ),
          },
        },
      });
      return id;
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const replay = await db
      .select({ id: commercialProposals.id })
      .from(commercialProposals)
      .where(
        and(
          eq(commercialProposals.tenantId, input.tenantId),
          eq(commercialProposals.requestId, input.requestId)
        )
      )
      .limit(1);
    if (!replay[0])
      throw new Error("Proposal generation lost a version concurrency race");
    proposalId = replay[0].id;
  }
  if (!proposalId) throw new Error("Proposal was not persisted");
  const row = await getProposalRowById({
    tenantId: input.tenantId,
    proposalId,
  });
  if (!row) throw new Error("Proposal was not persisted");
  return proposalFromRow(row);
}

export async function approveCommercialProposal(input: {
  tenantId: string;
  missionId: number;
  proposalId: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    await db.transaction(async tx => {
      const replay = await tx
        .select({ id: commercialProposalEvents.id })
        .from(commercialProposalEvents)
        .where(
          and(
            eq(commercialProposalEvents.tenantId, input.tenantId),
            eq(
              commercialProposalEvents.idempotencyKey,
              `proposal-approved:${input.requestId}`
            )
          )
        )
        .limit(1);
      if (replay[0]) return;
      const rows = await tx
        .select()
        .from(commercialProposals)
        .where(
          and(
            eq(commercialProposals.tenantId, input.tenantId),
            eq(commercialProposals.missionId, input.missionId)
          )
        )
        .for("update");
      const target = rows.find(row => row.id === input.proposalId);
      if (!target) throw new Error("Commercial proposal not found");
      if (target.status === "approved") return;
      if (target.status !== "draft")
        throw new Error(`Proposal cannot be approved from ${target.status}`);
      const latestVersion = Math.max(...rows.map(row => row.version));
      if (target.version !== latestVersion)
        throw new Error("Only the latest proposal version can be approved");
      if (target.validThrough.getTime() <= Date.now())
        throw new Error("Expired proposal drafts must be regenerated");
      await tx
        .update(commercialProposals)
        .set({ status: "superseded" })
        .where(
          and(
            eq(commercialProposals.tenantId, input.tenantId),
            eq(commercialProposals.missionId, input.missionId),
            eq(commercialProposals.status, "approved"),
            ne(commercialProposals.id, input.proposalId)
          )
        );
      const approved = await tx
        .update(commercialProposals)
        .set({
          status: "approved",
          approvedBy: input.actorId,
          approvedAt: new Date(),
        })
        .where(
          and(
            eq(commercialProposals.tenantId, input.tenantId),
            eq(commercialProposals.id, input.proposalId),
            eq(commercialProposals.status, "draft")
          )
        );
      if (affectedRows(approved) !== 1)
        throw new Error("Proposal approval lost a concurrency race");
      await tx.insert(commercialProposalEvents).values({
        tenantId: input.tenantId,
        missionId: input.missionId,
        proposalId: input.proposalId,
        eventName: "proposal_approved",
        actorId: input.actorId,
        idempotencyKey: `proposal-approved:${input.requestId}`,
        metadataJson: { version: target.version },
      });
      const projectionCorrelationId = `commercial-proposal:${input.proposalId}:${input.requestId}`;
      await writeDayforgeEventWith(tx, {
        tenantId: input.tenantId,
        actor: { type: "operator", id: input.actorId },
        entityType: "commercial_proposal",
        entityId: input.proposalId,
        eventName: "proposal_approved",
        before: proposalAuditSnapshot(target),
        after: proposalAuditSnapshot({ ...target, status: "approved" }),
        source: "commercial_proposal",
        correlationId: projectionCorrelationId,
        idempotencyKey: `${projectionCorrelationId}:approved`,
        productEvent: {
          name: "proposal_approved",
          missionId: input.missionId,
          properties: {
            versionNumber: target.version,
            approvalSource: "tenant_operator",
          },
        },
      });
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  const row = await getProposalRowById({
    tenantId: input.tenantId,
    proposalId: input.proposalId,
  });
  if (!row || row.status !== "approved")
    throw new Error("Proposal approval was not persisted");
  return proposalFromRow(row);
}

export async function recordCommercialProposalBrowserPrint(input: {
  tenantId: string;
  missionId: number;
  proposalId: string;
  actorId: string;
  requestId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = await getProposalRowById(input);
  if (!row || row.missionId !== input.missionId)
    throw new Error("Commercial proposal not found");
  if (row.status !== "approved")
    throw new Error("Only approved collateral can be printed");
  if (row.validThrough.getTime() <= Date.now())
    throw new Error("This approved proposal has expired");
  try {
    await db.insert(commercialProposalEvents).values({
      tenantId: input.tenantId,
      missionId: input.missionId,
      proposalId: input.proposalId,
      eventName: "browser_print_opened",
      actorId: input.actorId,
      idempotencyKey: `proposal-browser-print:${input.requestId}`,
      metadataJson: { version: row.version, completionClaimed: false },
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
  return proposalFromRow(row);
}
