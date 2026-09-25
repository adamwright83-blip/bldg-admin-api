/**
 * Tenant/operator progression. Reads do not insert rows. The authored
 * Clockhead finale records level.colosseum and reveals Rook. Durable Rook
 * ownership is recorded only by the Coastal Market stealing/catch beat.
 * Kingdom completion is not written.
 */
import { randomUUID } from "node:crypto";
import { getDay1TenDoorsMissionReadOnly } from "../openChannel/day1TenDoorsService";
import {
  findRookContactGrant,
  grantRookContactCapability,
} from "./capabilityGrantStore";
import {
  findServerAuthoritativeWaywardContactProof,
  rookContactGrantIsProductionAuthority,
} from "./rookContactAuthority";
import {
  COASTAL_MARKET_ROOK_CATCH_CONSEQUENCE,
  COLOSSEUM_AUTHORED_FINALE_CONSEQUENCE,
} from "../../shared/colosseumAuthoredFinale";
import { ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE } from "../../shared/rookContact";
import {
  assertLevelColosseumRecordPermitted,
  attemptRecordKingdomBrassRepublicCompleted,
  projectGoldlineProgression,
  ProgressionNotPermittedError,
  rejectClientProgressionForge,
  type GoldlineProgressionRead,
} from "./progressionContract";
import {
  beginCoastalMarketRookHunt as beginCoastalMarketRookHuntReceipt,
  beginWaywardContactGate as beginWaywardContactGateReceipt,
  findDomainProgression,
  recordAuthoredCoastalMarketRookCatch,
  recordAuthoredColosseumFinale,
  recordWaywardContactGateCompleted,
} from "./progressionStore";
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
  return {
    granted: rookContactGrantIsProductionAuthority(found.grant),
    readable: true,
  };
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
 * Separate compatibility write for companion.rook. It now requires the
 * Coastal Market authored catch consequence; the Clockhead consequence can
 * no longer own Rook. The live route uses the server-started Coastal run
 * below so arbitrary client consequence text is not production authority.
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
 * Tenant and operator come from the session. A satisfied binding records
 * level.colosseum only. Rook is heard/revealed here but is not durably owned.
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
      "level.colosseum requires the authored Clockhead reveal clockhead_finale.rook_revealed_on_the_line"
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

export async function beginCoastalMarketRookHunt(input: {
  tenantId: string;
  operatorId: string;
}): Promise<{ runId: string }> {
  const runId = randomUUID();
  await beginCoastalMarketRookHuntReceipt({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    runId,
    startedAt: new Date(),
  });
  return { runId };
}

export async function completeCoastalMarketRookCatch(input: {
  tenantId: string;
  operatorId: string;
  runId: string;
}): Promise<GoldlineProgressionRead> {
  await recordAuthoredCoastalMarketRookCatch({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    runId: input.runId,
    at: new Date(),
  });
  return readGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    capabilityOperatorId: null,
  });
}

export async function beginWaywardContactGate(input: {
  tenantId: string;
  operatorId: string;
}): Promise<{ runId: string }> {
  const runId = randomUUID();
  await beginWaywardContactGateReceipt({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    runId,
    startedAt: new Date(),
  });
  return { runId };
}

export async function completeWaywardContactGate(input: {
  tenantId: string;
  operatorId: string;
  runId: string;
}): Promise<GoldlineProgressionRead> {
  await recordWaywardContactGateCompleted({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    runId: input.runId,
    at: new Date(),
  });
  const proof = await findServerAuthoritativeWaywardContactProof({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
  });
  if (!proof.proven) {
    throw new ProgressionNotPermittedError(
      "Wayward CONTACT gate was not durably recorded"
    );
  }
  await grantRookContactCapability({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    grantSource: ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE,
    grantedAt: new Date(),
  });
  return readGoldlineProgression({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    capabilityOperatorId: null,
  });
}

/**
 * Production acknowledgement of Wayward CONTACT. Fails closed.
 * The client literal wayward.rook_contact_demonstrated is not proof the
 * authored beat occurred. Owning Rook does not grant CONTACT. This write
 * does not own Rook, resolve Colosseum, complete Brass Republic, or
 * complete a mission or challenge.
 */
export async function acknowledgeWaywardRookContact(input: {
  tenantId: string;
  operatorId: string;
  authoredConsequence: unknown;
  clientPayload?: unknown;
}): Promise<GoldlineProgressionRead> {
  rejectClientProgressionForge(input);
  rejectClientProgressionForge(input.clientPayload);
  const proof = await findServerAuthoritativeWaywardContactProof({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
  });
  if (!proof.proven) {
    throw new ProgressionNotPermittedError(
      "capability.rook.contact is not granted. wayward.rook_contact_demonstrated is a client assertion, and no server-authoritative Wayward CONTACT beat is recorded."
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
