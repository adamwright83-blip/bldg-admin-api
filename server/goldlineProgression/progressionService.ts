/**
 * Tenant/operator progression. Reads do not insert rows. The authored
 * Clockhead finale records level.colosseum and then companion.rook.
 * Kingdom completion is not written.
 */
import { getDay1TenDoorsMissionReadOnly } from "../openChannel/day1TenDoorsService";
import { WAYWARD_ROOK_CONTACT_CONSEQUENCE } from "../../shared/rookContact";
import { findRookContactGrant, grantRookContactCapability } from "./capabilityGrantStore";
import { COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE } from "../../shared/colosseumAuthoredFinale";
import {
  assertLevelColosseumRecordPermitted,
  attemptRecordKingdomBrassRepublicCompleted,
  projectGoldlineProgression,
  ProgressionNotPermittedError,
  rejectClientProgressionForge,
  type GoldlineProgressionRead,
} from "./progressionContract";
import { findDomainProgression, recordAuthoredColosseumFinale } from "./progressionStore";
import { recordRookFromOutcomes } from "./progressionWrites";

async function loadOutcomes(input: { tenantId: string; operatorId: string }): Promise<{
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
}> {
  try {
    const mission = await getDay1TenDoorsMissionReadOnly({
      tenantId: input.tenantId,
      driverId: input.operatorId,
    });
    return { outcomesAvailable: true, outcomes: mission?.outcomes ?? {} };
  } catch {
    return { outcomesAvailable: false, outcomes: null };
  }
}

/**
 * CONTACT authority is goldline_domain_capability_grants for this operator.
 * Companion unlocks and companionRookOwnedAt are not consulted. An unreadable
 * grant table stays uncertain.
 */
async function loadCapability(input: {
  tenantId: string;
  operatorId: string;
}): Promise<{
  granted: boolean;
  readable: boolean;
}> {
  const found = await findRookContactGrant({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
  });
  if (!found.readable) return { granted: false, readable: false };
  return { granted: found.grant != null, readable: true };
}

export async function readGoldlineProgression(input: {
  tenantId: string;
  /** Day 1 openId. Progression rows and mission outcomes use this key. */
  operatorId: string;
  /**
   * Retained for callers. Companion unlocks were stored under the numeric
   * user id. That key is not capability.rook.contact authority.
   */
  capabilityOperatorId: string | null;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);
  const [outcomes, capability, stored] = await Promise.all([
    loadOutcomes({ tenantId: input.tenantId, operatorId: input.operatorId }),
    loadCapability({
      tenantId: input.tenantId,
      operatorId: input.operatorId,
    }),
    findDomainProgression({ tenantId: input.tenantId, operatorId: input.operatorId }).catch(() => ({
      readable: false as const,
    })),
  ]);
  return projectGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    outcomes: outcomes.outcomes,
    outcomesAvailable: outcomes.outcomesAvailable,
    capabilityRookContactGranted: capability.granted,
    capabilityRookContactReadable: capability.readable,
    stored,
  });
}

/**
 * Separate authored write for companion.rook. Requires the level timestamp
 * already stored for this tenant and operator and the Clockhead finale's
 * authored consequence. Idempotent. Does not complete the Kingdom and does
 * not grant capability.rook.contact. Five visits are not this write.
 */
export async function recordCompanionRookOwned(input: {
  tenantId: string;
  operatorId: string;
  capabilityOperatorId?: string | null;
  authoredConsequence?: unknown;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  const outcomes = await loadOutcomes(input);
  await recordRookFromOutcomes({ ...input, ...outcomes });
  return readGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    capabilityOperatorId: input.capabilityOperatorId ?? null,
  });
}

/**
 * Production acknowledgement of the authored Clockhead finale.
 * Tenant and operator come from the session. The exact consequence is
 * checked, then kingdom_binding.level.colosseum is re-read. An unsatisfied
 * binding writes nothing. A satisfied binding records level.colosseum and
 * then companion.rook in one transaction. This is the only production
 * caller that writes levelColosseumResolvedAt.
 */
export async function acknowledgeColosseumAuthoredFinale(input: {
  tenantId: string;
  operatorId: string;
  capabilityOperatorId?: string | null;
  authoredConsequence: unknown;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  if (input.authoredConsequence !== COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE) {
    throw new ProgressionNotPermittedError(
      "level.colosseum and companion.rook require the authored Clockhead finale clockhead_finale.rook_joined_the_party"
    );
  }
  const outcomes = await loadOutcomes(input);
  assertLevelColosseumRecordPermitted({
    outcomes: outcomes.outcomes,
    outcomesAvailable: outcomes.outcomesAvailable,
    clientPayload: input.clientPayload,
  });
  await recordAuthoredColosseumFinale({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    at: new Date(),
  });
  return readGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    capabilityOperatorId: input.capabilityOperatorId ?? null,
  });
}

/**
 * Grants capability.rook.contact after companion.rook is already owned.
 * The only accepted consequence is wayward.rook_contact_demonstrated.
 * Does not own Rook, resolve Colosseum, complete Brass Republic, or complete
 * a mission or challenge. Entering Wayward is not this acknowledgement.
 */
export async function acknowledgeWaywardRookContact(input: {
  tenantId: string;
  operatorId: string;
  authoredConsequence: unknown;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  if (input.authoredConsequence !== WAYWARD_ROOK_CONTACT_CONSEQUENCE) {
    throw new ProgressionNotPermittedError(
      "capability.rook.contact requires the authored consequence wayward.rook_contact_demonstrated"
    );
  }
  const before = await findDomainProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
  });
  if (!before.readable) {
    throw new ProgressionNotPermittedError(
      "companion.rook ownership is uncertain; capability.rook.contact is not granted"
    );
  }
  if (!before.row?.companionRookOwnedAt) {
    throw new ProgressionNotPermittedError(
      "capability.rook.contact requires companion.rook; owning Rook is not automatic and this acknowledgement does not own him"
    );
  }
  const levelStamp = before.row.levelColosseumResolvedAt;
  const rookStamp = before.row.companionRookOwnedAt;
  const kingdomStamp = before.row.kingdomBrassRepublicCompletedAt;
  await grantRookContactCapability({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    grantSource: WAYWARD_ROOK_CONTACT_CONSEQUENCE,
    grantedAt: new Date(),
  });
  const after = await findDomainProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
  });
  if (
    !after.readable ||
    after.row?.levelColosseumResolvedAt !== levelStamp ||
    after.row?.companionRookOwnedAt !== rookStamp ||
    after.row?.kingdomBrassRepublicCompletedAt !== kingdomStamp
  ) {
    throw new ProgressionNotPermittedError(
      "capability.rook.contact grant must not change level.colosseum, companion.rook, or kingdom.brass_republic"
    );
  }
  return readGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    capabilityOperatorId: null,
  });
}

/** Kingdom completion stays refused. The Colosseum binding is not that write. */
export async function recordKingdomBrassRepublicCompleted(input: {
  tenantId: string;
  operatorId: string;
  outcomes: Record<string, unknown> | null;
  outcomesAvailable: boolean;
  clientPayload?: unknown;
}): Promise<never> {
  return attemptRecordKingdomBrassRepublicCompleted(input);
}
