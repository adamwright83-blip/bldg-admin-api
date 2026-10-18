import { cancelDayLineItem } from "../planning/dayline/dayLineMutationService";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, eq, inArray } from "drizzle-orm";
import { mergeDayLineOverlay, readDayLineOverlay } from "../../shared/goldlineDayLine";
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
import { proposalItemExecutionWindow } from "../../shared/weeklyMissionReadiness";
import { formatInTimeZone } from "date-fns-tz";
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
/** The operator's business-local date and time, the frame every execution window is judged in. */
function businessClock(timeZone: string, now: Date) {
  return { businessDate: formatInTimeZone(now, timeZone, "yyyy-MM-dd"), localTime: formatInTimeZone(now, timeZone, "HH:mm") };
}

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
  if (input.action === "approve") {
    const clock = businessClock(p.timeZone, now);
    const expired = p.items.filter(i => itemIds.includes(i.id) && proposalItemExecutionWindow(i, clock) === "expired");
    if (expired.length)
      throw new Error(
        `The time for ${expired.map(i => `"${i.title}"`).join(", ")} has passed. Reschedule it to a new day before approving; nothing was approved.`
      );
  }
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
      // Refuse before creating anything if an earlier slot cannot be retired.
      await assertSupersededRetirable(p.tenantId, input.identity, item.supersedesCommitmentIds ?? []);
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
        admission: { kind: "strategic_approval", approval: approved },
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
      // A rescheduled item replaces earlier commitments. The replacement exists
      // only if every earlier slot is retired; otherwise it is rolled back, the
      // earlier slots stay active, and the item is reported as not confirmed.
      await retireSupersededOrRollBack({
        tenantId: p.tenantId,
        identity: input.identity,
        replacementId: row.id,
        replacementTitle: item.title,
        supersededIds: item.supersedesCommitmentIds ?? [],
        reason: `Rescheduled to ${item.businessDate} by approved plan revision ${p.revision.slice(0, 12)}`,
      });
      actionIds.push(row.id);
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
  const target = p.items.find(i => i.id === input.itemId)!;
  if (
    input.businessDate &&
    proposalItemExecutionWindow({ ...target, businessDate: input.businessDate }, businessClock(p.timeZone, now)) === "expired"
  )
    throw new Error("That day's time has already passed. Choose a later day.");
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
          row.businessDate === item.businessDate &&
          // A replacement rolled back because its earlier slot could not be retired is not approved work.
          !readDayLineOverlay(row.metadataJson).cancelledReason?.startsWith("Rollback:")
        );
      })
    )
    .map(item => item.id);
}

type ApprovalIdentity = { dayDirectorActorId: string; dayDirectorActorIds: string[] };

async function supersededRows(tenantId: string, identity: ApprovalIdentity, ids: string[]) {
  if (!ids.length) return [];
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select()
    .from(dayDirectorCommitments)
    .where(
      and(
        eq(dayDirectorCommitments.tenantId, tenantId),
        inArray(dayDirectorCommitments.id, ids),
        inArray(dayDirectorCommitments.actorId, identity.dayDirectorActorIds)
      )
    );
}

export async function assertSupersededRetirable(tenantId: string, identity: ApprovalIdentity, ids: string[]) {
  const rows = await supersededRows(tenantId, identity, ids);
  for (const id of ids) {
    const row = rows.find(r => r.id === id);
    if (!row) throw new Error("Superseded commitment not found for this operator");
    if (row.status === "completed") throw new Error("Superseded commitment is already completed history");
  }
}

async function setCancellation(
  tenantId: string,
  id: string,
  overlay: { cancelledAt: string | null; cancelledBy: string | null; cancelledReason: string | null; notPursuing: boolean }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [row] = await db
    .select()
    .from(dayDirectorCommitments)
    .where(and(eq(dayDirectorCommitments.tenantId, tenantId), eq(dayDirectorCommitments.id, id)))
    .limit(1);
  if (!row) throw new Error("Commitment not found");
  await db
    .update(dayDirectorCommitments)
    .set({ metadataJson: mergeDayLineOverlay(row.metadataJson, overlay) })
    .where(and(eq(dayDirectorCommitments.tenantId, tenantId), eq(dayDirectorCommitments.id, id)));
}

const ROLLBACK_PREFIX = "Rollback:";

export async function retireSupersededOrRollBack(input: {
  tenantId: string;
  identity: ApprovalIdentity;
  replacementId: string;
  replacementTitle: string;
  supersededIds: string[];
  reason: string;
  cancel?: typeof cancelDayLineItem;
}) {
  if (!input.supersededIds.length) return;
  const cancel = input.cancel ?? cancelDayLineItem;
  // A retried approval reactivates a replacement an earlier attempt rolled back.
  const [replacement] = await supersededRows(input.tenantId, input.identity, [input.replacementId]);
  if (replacement && readDayLineOverlay(replacement.metadataJson).cancelledReason?.startsWith(ROLLBACK_PREFIX))
    await setCancellation(input.tenantId, input.replacementId, { cancelledAt: null, cancelledBy: null, cancelledReason: null, notPursuing: false });
  const retired: string[] = [];
  try {
    for (const id of input.supersededIds) {
      const [current] = await supersededRows(input.tenantId, input.identity, [id]);
      if (current && readDayLineOverlay(current.metadataJson).cancelledAt) continue; // already retired
      await cancel({
        tenantId: input.tenantId,
        actorId: input.identity.dayDirectorActorId,
        item: { sourceType: "day_director_commitment", sourceId: id, displayTitle: input.replacementTitle, editableCapabilities: [], status: "active" },
        reason: input.reason,
      });
      retired.push(id);
    }
  } catch (error) {
    // Never leave two active meetings: undo this attempt, keep the history.
    for (const id of retired)
      await setCancellation(input.tenantId, id, { cancelledAt: null, cancelledBy: null, cancelledReason: null, notPursuing: false }).catch(() => undefined);
    await setCancellation(input.tenantId, input.replacementId, {
      cancelledAt: new Date().toISOString(),
      cancelledBy: input.identity.dayDirectorActorId,
      cancelledReason: `${ROLLBACK_PREFIX} the earlier slot could not be retired, so this reschedule was not applied.`,
      notPursuing: true,
    });
    throw error;
  }
}
