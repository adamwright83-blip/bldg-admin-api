import { and, asc, eq, inArray, notExists, or, sql } from "drizzle-orm";
import {
  daphneObservations,
  daphneEpistemicClaims,
  daphneMetaPreferences,
  daphneMetricEvents,
  daphneGoals,
} from "../../../drizzle/schema";
import { getDb } from "../../db";
import { recordDaphneEpistemicClaim } from "./epistemicStore";
import { createDaphneGoal, setDaphneMetaPreference } from "./goalsPreferences";
import { isDaphneV2ClaireEnabled } from "./claireAdapter";
import {
  daphneReleaseTenantAllowlist,
  isDaphneConsolidationWorkerConfigured,
} from "./releaseSafety";
import type { DaphneConversationItem } from "./conversationIngestion";
import { recordDaphneMetricEvent } from "./metrics";
import { ingestVerifiedDaphneStage3bOutcome } from "./stage3bLearning";

const VERSION = "daphne-consolidation-v1";

/** The immutable observation is the durable work item; its receipt is a derived claim. */
export async function runDaphneConsolidationBatch(
  input: { limit?: number; observationId?: string } = {}
) {
  const enabledTenants = (process.env.DAPHNE_V2_CLAIRE_TENANTS ?? "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  // A preexisting Daphne flag never implicitly enables the NEW worker.
  if (!isDaphneConsolidationWorkerConfigured()) return { processed: 0 };
  const workerTenants = daphneReleaseTenantAllowlist("DAPHNE_V2_CONSOLIDATION_WORKER_TENANTS");
  const globallyEnabled = isDaphneV2ClaireEnabled("");
  if (!globallyEnabled && !enabledTenants.length) return { processed: 0 };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  let failing: {
    tenantId: string;
    canonicalOperatorId: string;
    id: string;
  } | null = null;
  try {
    return await db.transaction(
      async tx => {
        const conditions = [
          or(
            eq(daphneObservations.sourceType, "claire_conversation_ingestion"),
            and(
              eq(
                daphneObservations.observationKind,
                "verified_operational_outcome"
              ),
              sql`json_extract(${daphneObservations.payloadJson}, '$.interventionId') is not null`
            )
          )!,
          notExists(
            tx
              .select({ id: daphneEpistemicClaims.id })
              .from(daphneEpistemicClaims)
              .where(
                and(
                  eq(
                    daphneEpistemicClaims.tenantId,
                    daphneObservations.tenantId
                  ),
                  eq(
                    daphneEpistemicClaims.canonicalOperatorId,
                    daphneObservations.canonicalOperatorId
                  ),
                  eq(
                    daphneEpistemicClaims.idempotencyKey,
                    sql`concat('consolidated:', ${daphneObservations.id})`
                  )
                )
              )
          ),
          notExists(
            tx
              .select({ id: daphneMetricEvents.id })
              .from(daphneMetricEvents)
              .where(
                and(
                  eq(daphneMetricEvents.sourceReference, daphneObservations.id),
                  eq(daphneMetricEvents.eventName, "consolidation_failed"),
                  sql`${daphneMetricEvents.occurredAt} > date_sub(now(), interval 30 second)`
                )
              )
          ),
          sql`(select count(*) from ${daphneMetricEvents} where ${daphneMetricEvents.sourceReference} = ${daphneObservations.id}
    and ${daphneMetricEvents.eventName} = 'consolidation_failed') < 5`,
        ];
        if (input.observationId)
          conditions.push(eq(daphneObservations.id, input.observationId));
        if (!globallyEnabled)
          conditions.push(inArray(daphneObservations.tenantId, enabledTenants));
        if (workerTenants.length)
          conditions.push(inArray(daphneObservations.tenantId, workerTenants));
        const rows = await tx
          .select()
          .from(daphneObservations)
          .where(and(...conditions))
          .orderBy(
            asc(daphneObservations.occurredAt),
            asc(daphneObservations.id)
          )
          .limit(Math.max(1, Math.min(input.limit ?? 20, 50)))
          .for("update", { skipLocked: true });
        let processed = 0;
        for (const row of rows) {
          failing = {
            tenantId: row.tenantId,
            canonicalOperatorId: row.canonicalOperatorId,
            id: row.id,
          };
          const scope = {
            tenantId: row.tenantId,
            canonicalOperatorId: row.canonicalOperatorId,
          };
          // A stable existing source row serializes each operator's derived writes.
          // The lock is transaction-scoped and recovers automatically on disconnect.
          await tx
            .select({ id: daphneObservations.id })
            .from(daphneObservations)
            .where(
              and(
                eq(daphneObservations.tenantId, row.tenantId),
                eq(
                  daphneObservations.canonicalOperatorId,
                  row.canonicalOperatorId
                )
              )
            )
            .orderBy(
              asc(daphneObservations.createdAt),
              asc(daphneObservations.id)
            )
            .limit(1)
            .for("update");
          const prefs = await tx
            .select()
            .from(daphneMetaPreferences)
            .where(
              and(
                eq(daphneMetaPreferences.tenantId, row.tenantId),
                eq(
                  daphneMetaPreferences.canonicalOperatorId,
                  row.canonicalOperatorId
                )
              )
            )
            .orderBy(sql`${daphneMetaPreferences.version} desc`);
          const latest = new Map<string, (typeof prefs)[number]>();
          for (const pref of prefs)
            if (!latest.has(pref.preferenceKey))
              latest.set(pref.preferenceKey, pref);
          const disabled = ["adaptation_enabled", "memory_recall"].some(key => {
            const p = latest.get(key);
            return p?.status === "revoked" || p?.valueJson === false;
          });
          const payload = row.payloadJson as {
            schemaVersion?: number;
            items?: DaphneConversationItem[];
          } | null;
          let eligible =
            isDaphneV2ClaireEnabled(row.tenantId) &&
            !disabled &&
            row.agentId === "claire" &&
            row.actorType === "user" &&
            row.verificationStatus === "attested" &&
            payload?.schemaVersion === 1;
          const derivedIds: string[] = [];
          if (
            row.observationKind === "verified_operational_outcome" &&
            !disabled &&
            isDaphneV2ClaireEnabled(row.tenantId)
          ) {
            const result = await ingestVerifiedDaphneStage3bOutcome(
              { ...scope, observationId: row.id },
              tx
            );
            derivedIds.push(result.outcome.id);
            eligible = true;
          }
          if (eligible && Array.isArray(payload?.items))
            for (const [index, item] of payload.items.entries()) {
              if (item.kind === "fact") {
                const old = await tx
                  .select()
                  .from(daphneEpistemicClaims)
                  .where(
                    and(
                      eq(daphneEpistemicClaims.tenantId, row.tenantId),
                      eq(
                        daphneEpistemicClaims.canonicalOperatorId,
                        row.canonicalOperatorId
                      ),
                      eq(daphneEpistemicClaims.agentId, "claire"),
                      eq(daphneEpistemicClaims.claimKey, item.key),
                      eq(daphneEpistemicClaims.claimType, "direct_fact")
                    )
                  );
                const claim = await recordDaphneEpistemicClaim(
                  {
                    ...scope,
                    agentId: "claire",
                    claimType: "direct_fact",
                    claimKey: item.key,
                    claim: { statement: item.statement },
                    sourceObservationIds: [row.id],
                    supportingEvidence: [
                      {
                        sourceOccurredAt: row.occurredAt.toISOString(),
                        explicitCorrection: item.correction,
                      },
                    ],
                    uncertainty: { epistemic: 0 },
                    validFrom: row.occurredAt,
                    modelVersion: VERSION,
                    idempotencyKey: `conversation-fact:${row.id}:${index}`,
                  },
                  tx
                );
                derivedIds.push(claim.id);
                // Late delivery of old evidence cannot regain authority over a newer correction.
                for (const previous of old) {
                  const support = previous.supportingEvidenceJson as Array<{
                    sourceOccurredAt?: string;
                    explicitCorrection?: boolean;
                  }> | null;
                  if (
                    !support?.some(
                      e =>
                        e.explicitCorrection &&
                        e.sourceOccurredAt &&
                        new Date(e.sourceOccurredAt) > row.occurredAt
                    )
                  )
                    continue;
                  const sourceId = (
                    previous.sourceObservationIdsJson as string[]
                  )[0];
                  await recordDaphneEpistemicClaim(
                    {
                      ...scope,
                      agentId: "claire",
                      claimType: "supersession",
                      claimKey: item.key,
                      claim: { replacementClaimId: previous.id },
                      supersedesClaimId: claim.id,
                      sourceObservationIds: [sourceId],
                      modelVersion: VERSION,
                      idempotencyKey: `conversation-supersede:${sourceId}:${claim.id}`,
                    },
                    tx
                  );
                }
                if (item.correction)
                  for (const previous of old) {
                    const [source] = await tx
                      .select()
                      .from(daphneObservations)
                      .where(
                        eq(
                          daphneObservations.id,
                          (previous.sourceObservationIdsJson as string[])[0]
                        )
                      )
                      .limit(1);
                    if (!source || source.occurredAt > row.occurredAt) continue;
                    await recordDaphneEpistemicClaim(
                      {
                        ...scope,
                        agentId: "claire",
                        claimType: "supersession",
                        claimKey: item.key,
                        claim: { replacementClaimId: claim.id },
                        supersedesClaimId: previous.id,
                        sourceObservationIds: [row.id],
                        modelVersion: VERSION,
                        idempotencyKey: `conversation-supersede:${row.id}:${previous.id}`,
                      },
                      tx
                    );
                  }
              } else if (item.kind === "goal") {
                const goal = await createDaphneGoal(
                  {
                    ...scope,
                    goalKey: item.key,
                    horizon: "near",
                    statement: item.statement,
                    constraints: {
                      sourceOccurredAt: row.occurredAt.toISOString(),
                    },
                    sourceObservationId: row.id,
                  },
                  tx
                );
                derivedIds.push(goal.id);
                await tx
                  .update(daphneGoals)
                  .set({ status: "superseded", closedAt: new Date() })
                  .where(
                    and(
                      eq(daphneGoals.tenantId, row.tenantId),
                      eq(
                        daphneGoals.canonicalOperatorId,
                        row.canonicalOperatorId
                      ),
                      eq(daphneGoals.goalKey, item.key),
                      eq(daphneGoals.status, "active"),
                      sql`${daphneGoals.id} <> ${goal.id}`,
                      sql`coalesce(json_unquote(json_extract(${daphneGoals.constraintsJson}, '$.sourceOccurredAt')), '') <= ${row.occurredAt.toISOString()}`
                    )
                  );
                const newer = await tx
                  .select({ id: daphneGoals.id })
                  .from(daphneGoals)
                  .where(
                    and(
                      eq(daphneGoals.tenantId, row.tenantId),
                      eq(
                        daphneGoals.canonicalOperatorId,
                        row.canonicalOperatorId
                      ),
                      eq(daphneGoals.goalKey, item.key),
                      eq(daphneGoals.status, "active"),
                      sql`json_unquote(json_extract(${daphneGoals.constraintsJson}, '$.sourceOccurredAt')) > ${row.occurredAt.toISOString()}`
                    )
                  )
                  .limit(1);
                if (newer.length)
                  await tx
                    .update(daphneGoals)
                    .set({ status: "superseded", closedAt: new Date() })
                    .where(eq(daphneGoals.id, goal.id));
              } else if (item.kind === "preference") {
                // The same source may be retried after a crash; do not create another version.
                if (
                  !prefs.some(
                    p =>
                      p.preferenceKey === item.key &&
                      p.sourceObservationId === row.id
                  )
                )
                  await setDaphneMetaPreference(
                    {
                      ...scope,
                      preferenceKey: item.key,
                      value: item.value,
                      sourceObservationId: row.id,
                    },
                    tx
                  );
              }
            }
          // State and relationship evidence stay in the existing observation store.
          // They are compiled with TTL/dyadic rules; no frozen summary can revive them.
          await recordDaphneEpistemicClaim(
            {
              ...scope,
              agentId: "claire",
              claimType: "statistical_regularity",
              claimKey: `consolidation:${row.id}`,
              claim: {
                status: eligible ? "processed" : "consent_or_evidence_denied",
                derivedIds,
              },
              scope: { purpose: "consolidation_receipt" },
              sourceObservationIds: [row.id],
              modelVersion: VERSION,
              idempotencyKey: `consolidated:${row.id}`,
            },
            tx
          );
          processed++;
        }
        return { processed };
      },
      { isolationLevel: "read committed" }
    );
  } catch (error) {
    const scope = failing as {
      tenantId: string;
      canonicalOperatorId: string;
      id: string;
    } | null;
    if (scope) {
      await db
        .transaction(async tx => {
          const [source] = await tx
            .select({ id: daphneObservations.id })
            .from(daphneObservations)
            .where(
              and(
                eq(daphneObservations.id, scope.id),
                eq(daphneObservations.tenantId, scope.tenantId),
                eq(
                  daphneObservations.canonicalOperatorId,
                  scope.canonicalOperatorId
                )
              )
            )
            .limit(1)
            .for("update");
          if (!source) return;
          const previous = await tx
            .select({ id: daphneMetricEvents.id })
            .from(daphneMetricEvents)
            .where(
              and(
                eq(daphneMetricEvents.sourceReference, scope.id),
                eq(daphneMetricEvents.eventName, "consolidation_failed")
              )
            )
            .catch(() => []);
          await recordDaphneMetricEvent(
            {
              ...scope,
              eventName: "consolidation_failed",
              sourceReference: scope.id,
              properties: {
                retryable: previous.length < 4,
                attempt: previous.length + 1,
                deadLetter: previous.length >= 4,
              },
              idempotencyKey: `consolidation-failed:${scope.id}:${Date.now()}`,
            },
            tx
          );
        })
        .catch(() => undefined);
    }
    throw error;
  }
}

export function startDaphneConsolidationWorker() {
  if (!isDaphneConsolidationWorkerConfigured()) return async () => {};
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let inFlight: Promise<unknown> | undefined;
  const tick = () => {
    if (stopped) return;
    inFlight = runDaphneConsolidationBatch()
      .then(() => {
        failures = 0;
      })
      .catch(() => {
        failures++;
        console.warn(
          "[Daphne] consolidation failed; durable work remains pending"
        );
      })
      .finally(() => {
        if (!stopped) {
          timer = setTimeout(
            tick,
            Math.min(60_000, 5_000 * 2 ** Math.min(failures, 4))
          );
          timer.unref();
        }
      });
  };
  tick();
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    await inFlight;
  };
}
