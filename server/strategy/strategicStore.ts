import { and, desc, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import {
  legacyDayforgeSaasTenants,
  strategicDiagnoses,
  strategicPlanningProposals,
  strategicProposalResponses,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type {
  StrategicDiagnosis,
  StrategicPlanningProposal,
} from "../../shared/strategicIntelligence";

export type StrategicOwner = { tenantId: string; canonicalOperatorId: string };
const json = <T>(v: unknown): T =>
  (typeof v === "string" ? JSON.parse(v) : v) as T;
export async function persistStrategicDiagnosis(
  d: StrategicDiagnosis
): Promise<StrategicDiagnosis> {
  const db = await getDb();
  if (!db) throw new Error("Durable strategy database unavailable");
  if (d.quality.structuralErrors.length)
    throw new Error(
      `Invalid strategic diagnosis: ${d.quality.structuralErrors.join("; ")}`
    );
  await db
    .insert(strategicDiagnoses)
    .values({
      id: d.id,
      tenantId: d.tenantId,
      canonicalOperatorId: d.canonicalOperatorId,
      businessDate: d.businessDate,
      payloadJson: d,
    })
    .onDuplicateKeyUpdate({ set: { id: d.id } });
  const [row] = await db
    .select()
    .from(strategicDiagnoses)
    .where(
      and(
        eq(strategicDiagnoses.id, d.id),
        eq(strategicDiagnoses.tenantId, d.tenantId),
        eq(strategicDiagnoses.canonicalOperatorId, d.canonicalOperatorId)
      )
    )
    .limit(1);
  if (!row) throw new Error("Strategic diagnosis readback failed");
  return json<StrategicDiagnosis>(row.payloadJson);
}
export async function latestStrategicDiagnosis(
  owner: StrategicOwner,
  businessDate?: string
): Promise<StrategicDiagnosis | null> {
  const db = await getDb();
  if (!db) throw new Error("Durable strategy database unavailable");
  const conditions = [
    eq(strategicDiagnoses.tenantId, owner.tenantId),
    eq(strategicDiagnoses.canonicalOperatorId, owner.canonicalOperatorId),
  ];
  if (businessDate)
    conditions.push(eq(strategicDiagnoses.businessDate, businessDate));
  const [row] = await db
    .select()
    .from(strategicDiagnoses)
    .where(and(...conditions))
    .orderBy(desc(strategicDiagnoses.createdAt), desc(strategicDiagnoses.id))
    .limit(1);
  return row ? json<StrategicDiagnosis>(row.payloadJson) : null;
}
export async function loadStrategicDiagnosis(
  owner: StrategicOwner,
  id: string
): Promise<StrategicDiagnosis | null> {
  const db = await getDb();
  if (!db) throw new Error("Durable strategy database unavailable");
  const [row] = await db
    .select()
    .from(strategicDiagnoses)
    .where(
      and(
        eq(strategicDiagnoses.id, id),
        eq(strategicDiagnoses.tenantId, owner.tenantId),
        eq(strategicDiagnoses.canonicalOperatorId, owner.canonicalOperatorId)
      )
    )
    .limit(1);
  return row ? json<StrategicDiagnosis>(row.payloadJson) : null;
}
export async function persistStrategicProposal(
  p: StrategicPlanningProposal,
  expectedPredecessorId?: string
): Promise<StrategicPlanningProposal> {
  const db = await getDb();
  if (!db) throw new Error("Durable proposal database unavailable");
  return db.transaction(async tx => {
    // Publication and decision admission share the existing tenant mutex.
    // This also gives separate processes one total order of current revisions.
    const [tenant] = await tx
      .select({ id: legacyDayforgeSaasTenants.id })
      .from(legacyDayforgeSaasTenants)
      .where(eq(legacyDayforgeSaasTenants.id, p.tenantId))
      .for("update");
    if (!tenant) throw new Error("Proposal tenant unavailable");
    const rows = await tx
      .select()
      .from(strategicPlanningProposals)
      .where(
        and(
          eq(strategicPlanningProposals.tenantId, p.tenantId),
          eq(
            strategicPlanningProposals.canonicalOperatorId,
            p.canonicalOperatorId
          ),
          eq(strategicPlanningProposals.weekStart, p.weekStart)
        )
      )
      .orderBy(
        desc(strategicPlanningProposals.createdAt),
        desc(strategicPlanningProposals.id)
      );
    // A retry of an old generated proposal must not resurrect it over a revision.
    const duplicate = rows.find(row => row.id === p.id);
    if (duplicate) {
      if (duplicate.revision !== p.revision)
        throw new Error("Proposal identity collision");
      return json<StrategicPlanningProposal>(rows[0]!.payloadJson);
    }
    if (expectedPredecessorId && rows[0]?.id !== expectedPredecessorId)
      throw new Error("Proposal was superseded; refresh before revising");
    const createdAt = new Date(
      Math.max(Date.now(), (rows[0]?.createdAt.getTime() ?? 0) + 1)
    );
    await tx
      .insert(strategicPlanningProposals)
      .values({
        id: p.id,
        tenantId: p.tenantId,
        canonicalOperatorId: p.canonicalOperatorId,
        weekStart: p.weekStart,
        revision: p.revision,
        payloadJson: p,
        createdAt,
      });
    const [stored] = await tx
      .select()
      .from(strategicPlanningProposals)
      .where(
        and(
          eq(strategicPlanningProposals.id, p.id),
          eq(strategicPlanningProposals.tenantId, p.tenantId),
          eq(
            strategicPlanningProposals.canonicalOperatorId,
            p.canonicalOperatorId
          )
        )
      );
    if (!stored || !isDeepStrictEqual(json(stored.payloadJson), p))
      throw new Error("Proposal readback failed");
    return json<StrategicPlanningProposal>(stored.payloadJson);
  });
}
export async function loadStrategicProposal(
  owner: StrategicOwner,
  id: string
): Promise<StrategicPlanningProposal | null> {
  const db = await getDb();
  if (!db) throw new Error("Durable proposal database unavailable");
  const [row] = await db
    .select()
    .from(strategicPlanningProposals)
    .where(
      and(
        eq(strategicPlanningProposals.tenantId, owner.tenantId),
        eq(
          strategicPlanningProposals.canonicalOperatorId,
          owner.canonicalOperatorId
        ),
        eq(strategicPlanningProposals.id, id)
      )
    )
    .limit(1);
  return row ? json<StrategicPlanningProposal>(row.payloadJson) : null;
}
export async function latestStrategicProposal(
  owner: StrategicOwner,
  weekStart: string
): Promise<StrategicPlanningProposal | null> {
  const db = await getDb();
  if (!db) throw new Error("Durable proposal database unavailable");
  const [row] = await db
    .select()
    .from(strategicPlanningProposals)
    .where(
      and(
        eq(strategicPlanningProposals.tenantId, owner.tenantId),
        eq(
          strategicPlanningProposals.canonicalOperatorId,
          owner.canonicalOperatorId
        ),
        eq(strategicPlanningProposals.weekStart, weekStart)
      )
    )
    .orderBy(
      desc(strategicPlanningProposals.createdAt),
      desc(strategicPlanningProposals.id)
    )
    .limit(1);
  return row ? json<StrategicPlanningProposal>(row.payloadJson) : null;
}
export type StrategicResponse = {
  id: string;
  proposalId: string;
  revision: string;
  tenantId: string;
  canonicalOperatorId: string;
  operatorUserId: string;
  action: "approve" | "reject" | "defer" | "revise";
  itemIds: string[];
  source: "authenticated_app" | "authenticated_voice";
  note: string | null;
};
/** Immutable operator decision; writes do not broaden the accepted item set on retry. */
export async function recordStrategicResponse(
  r: StrategicResponse,
  now = new Date()
): Promise<StrategicResponse> {
  const db = await getDb();
  if (!db) throw new Error("Durable approval database unavailable");
  await db.transaction(async tx => {
    const [tenant] = await tx
      .select({ id: legacyDayforgeSaasTenants.id })
      .from(legacyDayforgeSaasTenants)
      .where(eq(legacyDayforgeSaasTenants.id, r.tenantId))
      .for("update");
    if (!tenant) throw new Error("Proposal tenant unavailable");
    const [proposal] = await tx
      .select()
      .from(strategicPlanningProposals)
      .where(
        and(
          eq(strategicPlanningProposals.id, r.proposalId),
          eq(strategicPlanningProposals.tenantId, r.tenantId),
          eq(
            strategicPlanningProposals.canonicalOperatorId,
            r.canonicalOperatorId
          )
        )
      )
      .for("update");
    if (!proposal || proposal.revision !== r.revision)
      throw new Error("Proposal revision mismatch");
    const decisions = await tx
      .select()
      .from(strategicProposalResponses)
      .where(
        and(
          eq(strategicProposalResponses.tenantId, r.tenantId),
          eq(strategicProposalResponses.proposalId, r.proposalId)
        )
      );
    const prior = decisions.map(row =>
      json<StrategicResponse>(row.responseJson)
    );
    const payload = json<StrategicPlanningProposal>(proposal.payloadJson);
    if (Date.parse(payload.expiresAt) <= now.getTime())
      throw new Error("Proposal is stale; refresh before approving");
    const [current] = await tx
      .select({ id: strategicPlanningProposals.id })
      .from(strategicPlanningProposals)
      .where(
        and(
          eq(strategicPlanningProposals.tenantId, r.tenantId),
          eq(
            strategicPlanningProposals.canonicalOperatorId,
            r.canonicalOperatorId
          ),
          eq(strategicPlanningProposals.weekStart, proposal.weekStart)
        )
      )
      .orderBy(
        desc(strategicPlanningProposals.createdAt),
        desc(strategicPlanningProposals.id)
      )
      .limit(1);
    const acceptedIds = new Set(
      prior.filter(p => p.action === "approve").flatMap(p => p.itemIds)
    );
    const acceptedRetry =
      r.action === "approve" &&
      r.itemIds.length > 0 &&
      r.itemIds.every(id => acceptedIds.has(id));
    if (current?.id !== proposal.id && !acceptedRetry)
      throw new Error("Proposal was superseded; refresh before approving");
    if (
      r.action === "approve" &&
      (!r.itemIds.length ||
        r.itemIds.some(id => !payload.items.some(i => i.id === id)))
    )
      throw new Error("Exact proposed item scope required");
    if (
      !prior.some(p => p.id === r.id) &&
      prior.some(
        p =>
          p.action === "reject" || p.action === "revise" || p.action === "defer"
      )
    )
      throw new Error("Proposal was rejected or revised; load a new revision");
    if (r.action !== "approve" && prior.some(p => p.action === "approve"))
      throw new Error(
        "Already accepted work needs an explicit Day Director change"
      );
    await tx
      .insert(strategicProposalResponses)
      .values({
        id: r.id,
        proposalId: r.proposalId,
        tenantId: r.tenantId,
        canonicalOperatorId: r.canonicalOperatorId,
        responseJson: r,
      })
      .onDuplicateKeyUpdate({ set: { id: r.id } });
  });
  const [row] = await db
    .select()
    .from(strategicProposalResponses)
    .where(
      and(
        eq(strategicProposalResponses.id, r.id),
        eq(strategicProposalResponses.tenantId, r.tenantId),
        eq(
          strategicProposalResponses.canonicalOperatorId,
          r.canonicalOperatorId
        )
      )
    )
    .limit(1);
  const stored = row ? json<StrategicResponse>(row.responseJson) : null;
  if (!stored || !isDeepStrictEqual(stored, r))
    throw new Error("Approval lineage readback mismatch");
  return stored;
}
export async function strategicResponses(
  owner: StrategicOwner,
  proposalId: string
): Promise<StrategicResponse[]> {
  const db = await getDb();
  if (!db) throw new Error("Durable approval database unavailable");
  const rows = await db
    .select()
    .from(strategicProposalResponses)
    .where(
      and(
        eq(strategicProposalResponses.tenantId, owner.tenantId),
        eq(
          strategicProposalResponses.canonicalOperatorId,
          owner.canonicalOperatorId
        ),
        eq(strategicProposalResponses.proposalId, proposalId)
      )
    )
    .orderBy(desc(strategicProposalResponses.createdAt));
  return rows.map(row => json<StrategicResponse>(row.responseJson));
}

/** Read-only lifecycle check. Dispatch repeats it while holding the publication mutex. */
export function strategicProposalIsCallable(
  p: StrategicPlanningProposal,
  responses: StrategicResponse[],
  now: Date
): boolean {
  const accepted = new Set(
    responses.filter(r => r.action === "approve").flatMap(r => r.itemIds)
  );
  return (
    Date.parse(p.expiresAt) > now.getTime() &&
    p.items.length > 0 &&
    !responses.some(r => ["reject", "revise", "defer"].includes(r.action)) &&
    p.items.some(i => !accepted.has(i.id))
  );
}
export async function requireCallableStrategicProposal(
  owner: StrategicOwner,
  id: string,
  now = new Date()
) {
  const p = await loadStrategicProposal(owner, id);
  if (
    !p ||
    (await latestStrategicProposal(owner, p.weekStart))?.id !== id ||
    !strategicProposalIsCallable(p, await strategicResponses(owner, id), now)
  )
    throw new Error(
      "Prepared proposal is stale, superseded, deferred, closed, or fully accepted; no call placed"
    );
  return p;
}
export async function originalStrategicProposal(
  owner: StrategicOwner,
  weekStart: string
) {
  const db = await getDb();
  if (!db) throw new Error("Durable proposal database unavailable");
  const [row] = await db
    .select()
    .from(strategicPlanningProposals)
    .where(
      and(
        eq(strategicPlanningProposals.tenantId, owner.tenantId),
        eq(
          strategicPlanningProposals.canonicalOperatorId,
          owner.canonicalOperatorId
        ),
        eq(strategicPlanningProposals.weekStart, weekStart)
      )
    )
    .orderBy(
      strategicPlanningProposals.createdAt,
      strategicPlanningProposals.id
    )
    .limit(1);
  return row ? json<StrategicPlanningProposal>(row.payloadJson) : null;
}
