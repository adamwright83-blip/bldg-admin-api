/**
 * Self / Social Memory adapter — read-only.
 *
 * Wraps the existing progression/entitlement system. It does not grant disclosure
 * and does not compute rapport; it reports what the authoritative progression store
 * already decided.
 *
 * Hard boundary: this compartment may influence TONE and PERSONAL DISCLOSURE only.
 * It may never manufacture, suppress, or alter business truth, and it may never
 * grant business-action authority. Everything emitted here is stamped `self_state`
 * or `disclosure_entitlement` — never `current_business_truth` — so the governor's
 * evidence rules make a business claim built on rapport impossible to render.
 *
 * Reads are entitlement accounting. Rapport is never earned from call or chat volume.
 */

import { readPersonalProgressionContext, type PersonalProgressionContext } from "../../progression/service";
import { getProgressionStore } from "../../progression/drizzleStore";
import type { SelfMemoryRequest } from "../contracts/retrieval";
import type { EvidenceItem } from "../contracts/evidence";

export type SelfMemoryContext = {
  tenantId: string;
  operatorUserId: string;
  conversationId: string;
  nowIso: string;
};

export type SelfMemoryDeps = {
  /** Injected; there is no default that reaches the database on its own. */
  loadProgression: (ctx: SelfMemoryContext) => Promise<PersonalProgressionContext | null>;
};

export const noSelfMemory: SelfMemoryDeps = {
  loadProgression: async () => null,
};

/**
 * Strictly read-only progression state.
 *
 * Deliberately `readPersonalProgressionContext`, NOT `loadPersonalProgressionContext`:
 * the latter releases expired reservations, which is a write. An observer must not
 * consume or alter entitlement state, so it accepts a slightly staler view instead.
 */
export const readOnlySelfMemoryDeps: SelfMemoryDeps = {
  loadProgression: ctx =>
    readPersonalProgressionContext(
      getProgressionStore(),
      { tenantId: ctx.tenantId, operatorUserId: ctx.operatorUserId },
      ctx.conversationId
    ),
};

/**
 * Entitlement state as evidence. `operatorVisible` is about synthetic-data filtering,
 * not about whether Claire may SAY any of this — that remains an entitlement decision
 * made by Executive Function when it mints a disclosure grant.
 */
export function evidenceFromProgression(
  progression: PersonalProgressionContext,
  observedAtIso: string
): EvidenceItem[] {
  const entitlement = progression.unusedEntitlement;
  const items: EvidenceItem[] = [
    {
      id: `relationship_state:${progression.scope.operatorUserId}`,
      type: "relationship_state",
      source: "loadPersonalProgressionContext",
      provenance: { reader: "loadPersonalProgressionContext" },
      observedAt: observedAtIso,
      asOf: observedAtIso,
      freshness: null,
      coverage: null,
      // Self state. Deliberately NOT current_business_truth.
      authoritativeFor: ["self_state"],
      payload: {
        // Warmth only. Rapport never touches business truth or action authority.
        rapportBand: progression.grant.rapportBand,
        personalRung: progression.grant.personalRung,
        unusedEntitlementCount: progression.unusedEntitlementCount,
        consumedEntitlementCount: progression.consumedEntitlementCount,
        priorRefusedTopics: progression.priorRefusedTopics,
        disclosedFragmentCount: progression.disclosedFragmentIds.length,
      },
      operatorVisible: true,
    },
  ];

  if (entitlement) {
    items.push({
      id: `disclosure_entitlement:${entitlement.id}`,
      type: "disclosure_entitlement",
      source: "loadPersonalProgressionContext",
      provenance: { reader: "loadPersonalProgressionContext" },
      observedAt: observedAtIso,
      asOf: observedAtIso,
      freshness: null,
      coverage: null,
      authoritativeFor: ["self_state"],
      payload: { entitlementId: entitlement.id },
      operatorVisible: true,
    });
  }
  return items;
}

export async function retrieveSelfEvidence(
  request: SelfMemoryRequest,
  ctx: SelfMemoryContext,
  deps: SelfMemoryDeps = noSelfMemory
): Promise<EvidenceItem[]> {
  const progression = await deps.loadProgression(ctx);
  if (!progression) return [];
  const items = evidenceFromProgression(progression, ctx.nowIso);
  if (request.kind === "disclosure_entitlement") {
    return items.filter(item => item.type === "disclosure_entitlement" || item.type === "relationship_state");
  }
  return items;
}
