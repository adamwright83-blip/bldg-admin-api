import { cancelDayLineItem } from "../planning/dayline/dayLineMutationService";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq } from "drizzle-orm";
import {
  dayDirectorCommitments,
  goalCycleObjectives,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  acceptProposalWithReceipt,
  getDayDirectorState,
} from "../planning/dayDirector/dayDirectorService";
import { emptyCommandMetadata } from "../../shared/claireWorkdayCommand";
import type { CanonicalOperatorIdentity } from "../agents/persistentOperator/identity";
import type { StrategicPlanningProposal } from "../../shared/strategicIntelligence";
import {
  loadStrategicProposal,
  persistStrategicProposal,
  recordStrategicResponse,
  strategicResponses,
} from "./strategicStore";

export type StrategicApprovalInput = {
  identity: CanonicalOperatorIdentity;
  proposalId: string;
  revision: string;
  action: "approve" | "reject" | "defer";
  itemIds?: string[];
  note?: string;
  source: "authenticated_app" | "authenticated_voice";
  now?: Date;
};
export async function respondToStrategicProposal(
  input: StrategicApprovalInput
) {
  if (
    !["owner", "admin", "operator"].includes(
      input.identity.membership.source
    ) ||
    !["owner", "admin", "operator"].includes(
      input.identity.membership.canonical
    )
  )
    throw new Error("Authenticated operator approval required");
  const now = input.now ?? new Date();
  const p = await loadStrategicProposal(input.identity, input.proposalId);
  if (!p || p.revision !== input.revision)
    throw new Error("Exact proposal revision required");
  if (Date.parse(p.expiresAt) <= now.getTime())
    throw new Error("Proposal is stale; refresh before approving");
  const itemIds = [...new Set(input.itemIds ?? [])].sort();
  if (
    input.action === "approve" &&
    (!itemIds.length || itemIds.some(id => !p.items.some(i => i.id === id)))
  )
    throw new Error("Approval requires the exact nonempty proposed item scope");
  const response = {
    id: `response_${createHash("sha256")
      .update(
        JSON.stringify([
          p.id,
          p.revision,
          input.identity.canonicalOperatorId,
          input.action,
          itemIds,
          input.source,
          input.note ?? null,
        ])
      )
      .digest("hex")
      .slice(0, 40)}`,
    proposalId: p.id,
    revision: p.revision,
    tenantId: input.identity.tenantId,
    canonicalOperatorId: input.identity.canonicalOperatorId,
    operatorUserId: input.identity.canonicalOpenId,
    action: input.action,
    itemIds,
    source: input.source,
    note: input.note ?? null,
  };
  await recordStrategicResponse(response, now);
  if (input.action !== "approve")
    return {
      speech:
        input.action === "reject"
          ? "The recommendation is rejected. No work was added."
          : "The decision is deferred. No work was added.",
      actionIds: [] as string[],
      failedItems: [] as string[],
      responseId: response.id,
    };
  const approvals = (await strategicResponses(input.identity, p.id))
    .filter(r => r.action === "approve")
    .reverse();
  const actionIds: string[] = [];
  const failedItems: string[] = [];
  for (const id of itemIds) {
    const item = p.items.find(i => i.id === id)!;
    try {
      const firstApproval = approvals.find(r => r.itemIds.includes(id))!;
      const approved = {
        proposalId: p.id,
        revision: p.revision,
        itemId: item.id,
        responseId: firstApproval.id,
        canonicalOperatorId: input.identity.canonicalOperatorId,
        approvedByUserId: firstApproval.operatorUserId,
      };
      const promptKey = `strategy-approved:${p.revision.slice(0, 32)}:${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
      // Accepted work enters as supporting work. Existing primary/protected
      // commitments retain their designation; this approval does not displace them.
      const result = await acceptProposalWithReceipt({
        tenantId: p.tenantId,
        actorId: input.identity.dayDirectorActorId,
        actorIds: input.identity.dayDirectorActorIds,
        businessDate: item.businessDate,
        proposal: {
          promptKey,
          title: item.title,
          kind: "growth",
          quantity: null,
          sourceText: item.objective,
          prerequisites: [],
          question: null,
          intelligence: "manual_fallback",
          targetBusinessDate: item.businessDate,
          command: emptyCommandMetadata(),
          executionType: item.executionType,
          strategicApproval: approved,
        },
      });
      if (!result.stored?.id) throw new Error("No authoritative write receipt");
      // A separate canonical read validates identity, content, and exact approval lineage.
      const db = await getDb();
      if (!db) throw new Error("Readback database unavailable");
      const [row] = await db
        .select()
        .from(dayDirectorCommitments)
        .where(
          and(
            eq(dayDirectorCommitments.tenantId, p.tenantId),
            eq(dayDirectorCommitments.id, result.stored.id)
          )
        )
        .limit(1);
      const metadata = row?.metadataJson as {
        strategicApproval?: typeof approved;
      } | null;
      const lineage = metadata?.strategicApproval;
      const receipt = approvals.find(
        r => r.id === lineage?.responseId && r.itemIds.includes(item.id)
      );
      const expectedLineage = receipt
        ? {
            ...approved,
            responseId: receipt.id,
            approvedByUserId: receipt.operatorUserId,
          }
        : null;
      if (
        !row ||
        row.actorId !== input.identity.dayDirectorActorId ||
        row.businessDate !== item.businessDate ||
        row.title !== item.title.trim().slice(0, 255) ||
        row.sourceText !== item.objective ||
        row.idempotencyKey !== promptKey ||
        !expectedLineage ||
        !isDeepStrictEqual(lineage, expectedLineage)
      )
        throw new Error("Canonical commitment readback mismatch");
      if (metadata && (item.missionType || item.timeWindow)) {
        const label = item.timeWindow
          ? `${item.timeWindow.window[0]!.toUpperCase()}${item.timeWindow.window.slice(1)}${item.timeWindow.time ? ` · ${item.timeWindow.time}` : ""}`
          : null;
        await db
          .update(dayDirectorCommitments)
          .set({
            metadataJson: {
              ...(metadata as Record<string, unknown>),
              ...(item.missionType ? { missionType: item.missionType } : {}),
              ...(label ? { scheduleLabel: label } : {}),
            },
          })
          .where(and(eq(dayDirectorCommitments.tenantId, p.tenantId), eq(dayDirectorCommitments.id, row.id)));
      }
      // The accepted canonical commitment is the execution authority. Keep
      // the originating durable objective's lifecycle in sync for outcome binding.
      await db
        .update(goalCycleObjectives)
        .set({
          status: "accepted",
          statusReason: `Exact proposal approval ${firstApproval.id}; canonical commitment ${row.id}`,
        })
        .where(
          and(
            eq(goalCycleObjectives.tenantId, p.tenantId),
            eq(goalCycleObjectives.canonicalOperatorId, p.canonicalOperatorId),
            eq(goalCycleObjectives.selectedRef, item.candidateId),
            eq(goalCycleObjectives.status, "presented")
          )
        );
      actionIds.push(row.id);
      // Approval of a rescheduled item retires the commitment it replaces (kept as cancelled history).
      for (const supersededId of item.supersedesCommitmentIds ?? [])
        await cancelDayLineItem({
          tenantId: p.tenantId,
          actorId: input.identity.dayDirectorActorId,
          item: {
            sourceType: "day_director_commitment",
            sourceId: supersededId,
            displayTitle: item.title,
            editableCapabilities: [],
            status: "active",
          },
          reason: `Rescheduled to ${item.businessDate} by approved plan revision ${p.revision.slice(0, 12)}`,
        }).catch(() => undefined);
    } catch {
      failedItems.push(item.id);
    }
  }
  return {
    speech: failedItems.length
      ? `${actionIds.length} accepted item(s) verified in storage; ${failedItems.length} could not be verified. The failed items are not confirmed as added.`
      : `${actionIds.length} approved item(s) added and verified in the Day Line: ${itemIds.map(id => p.items.find(i => i.id === id)!.title).join("; ")}.`,
    actionIds,
    failedItems,
    responseId: response.id,
  };
}

export async function reviseStrategicProposal(input: {
  identity: CanonicalOperatorIdentity;
  proposalId: string;
  revision: string;
  itemId: string;
  title: string;
  businessDate?: string;
  now?: Date;
  source?: "authenticated_app" | "authenticated_voice";
}): Promise<StrategicPlanningProposal> {
  if (
    !["owner", "admin", "operator"].includes(
      input.identity.membership.source
    ) ||
    !["owner", "admin", "operator"].includes(
      input.identity.membership.canonical
    )
  )
    throw new Error("Authenticated operator approval required");
  const p = await loadStrategicProposal(input.identity, input.proposalId);
  if (!p || p.revision !== input.revision)
    throw new Error("Exact proposal revision required");
  if (
    !input.title.trim() ||
    input.title.length > 255 ||
    !p.items.some(i => i.id === input.itemId)
  )
    throw new Error("Valid item and concise replacement title required");
  const priorResponses = await strategicResponses(input.identity, p.id);
  if (priorResponses.some(r => r.action === "approve"))
    throw new Error("Accepted work must be changed through Day Director");
  const now = input.now ?? new Date();
  if (Date.parse(p.expiresAt) <= now.getTime())
    throw new Error("Proposal is stale; refresh before revising");
  if (
    input.businessDate &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate) ||
      input.businessDate < p.businessDate ||
      input.businessDate < p.weekStart ||
      input.businessDate >
        new Date(Date.parse(p.weekStart + "T00:00:00Z") + 4 * 86400000)
          .toISOString()
          .slice(0, 10))
  )
    throw new Error(
      "Revision must remain in the proposal's remaining weekday horizon"
    );
  const items = p.items.map(i =>
    i.id === input.itemId
      ? {
          ...i,
          title: input.title.trim(),
          objective: input.title.trim() === i.title ? i.objective : input.title.trim(),
          businessDate: input.businessDate ?? i.businessDate,
        }
      : i
  );
  const revision = createHash("sha256")
    .update(
      JSON.stringify([p.revision, items, input.identity.canonicalOperatorId])
    )
    .digest("hex");
  await recordStrategicResponse(
    {
      id: `response_${revision.slice(0, 40)}`,
      proposalId: p.id,
      revision: p.revision,
      tenantId: p.tenantId,
      canonicalOperatorId: p.canonicalOperatorId,
      operatorUserId: input.identity.canonicalOpenId,
      action: "revise",
      itemIds: [input.itemId],
      source: input.source ?? "authenticated_app",
      note: input.title.trim(),
    },
    now
  );
  return persistStrategicProposal(
    {
      ...p,
      id: `proposal_${revision.slice(0, 40)}`,
      revision,
      items,
      preparedAt: now.toISOString(),
      expiresAt: p.expiresAt,
      uncertainty: [
        ...p.uncertainty,
        `Operator revision to ${input.itemId}; original strategy hypothesis may need review.`,
      ],
      opening: `Revised pending proposal: ${items.map(i => `${i.businessDate}: ${i.title}`).join("; ")}. Approve selected items, revise, reject, or defer.`,
    },
    p.id
  );
}

/** Read port: application status requires canonical commitment plus persisted approval lineage. */
export async function readVerifiedStrategicApprovalItemIds(
  identity: CanonicalOperatorIdentity,
  proposal: StrategicPlanningProposal
): Promise<string[]> {
  if (
    proposal.tenantId !== identity.tenantId ||
    proposal.canonicalOperatorId !== identity.canonicalOperatorId
  )
    throw new Error("Proposal owner mismatch");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const responses = await strategicResponses(identity, proposal.id);
  const stored = await db
    .select()
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, identity.tenantId),
        eq(dayDirectorCommitments.actorId, identity.dayDirectorActorId)
      )
    );
  return proposal.items
    .filter(item =>
      stored.some(row => {
        const approval = (
          row.metadataJson as {
            strategicApproval?: {
              proposalId: string;
              revision: string;
              itemId: string;
              responseId: string;
              canonicalOperatorId: string;
            };
          } | null
        )?.strategicApproval;
        return (
          approval?.proposalId === proposal.id &&
          approval.revision === proposal.revision &&
          approval.itemId === item.id &&
          approval.canonicalOperatorId === identity.canonicalOperatorId &&
          responses.some(
            r =>
              r.id === approval.responseId &&
              r.action === "approve" &&
              r.itemIds.includes(item.id)
          ) &&
          row.title === item.title &&
          row.sourceText === item.objective &&
          row.businessDate === item.businessDate
        );
      })
    )
    .map(item => item.id);
}
