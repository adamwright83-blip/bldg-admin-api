/**
 * Production authority for capability.rook.contact.
 *
 * Ordinary Wayward presentation progress still lives in same-device localStorage,
 * but CONTACT authority does not. The exact authored inspector/parley gate is
 * recorded in the existing server progression row using a server-started run.
 * A client consequence string, localStorage flag, or Rook ownership alone is
 * not proof.
 */
import {
  ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
  ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE,
  ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE,
  WAYWARD_ROOK_CONTACT_CONSEQUENCE,
} from "../../shared/rookContact";
import { hasServerAuthoritativeWaywardContactGate } from "./progressionStore";
import { grantRookContactCapability } from "./capabilityGrantStore";
import { ProgressionNotPermittedError } from "./progressionContract";

export {
  ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
  ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE,
};

export type ServerAuthoritativeWaywardContactProof =
  | { proven: true; source: typeof ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE }
  | {
      proven: false;
      reason: "no_server_authoritative_wayward_contact_beat";
    };

export async function findServerAuthoritativeWaywardContactProof(input: {
  tenantId: string;
  operatorId: string;
}): Promise<ServerAuthoritativeWaywardContactProof> {
  const proven = await hasServerAuthoritativeWaywardContactGate(input);
  return proven
    ? { proven: true, source: ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE }
    : {
        proven: false,
        reason: "no_server_authoritative_wayward_contact_beat",
      };
}

/** Only the durable server Wayward gate grant source is production authority. */
export function rookContactGrantIsProductionAuthority(
  grant: { grantSource: string } | null
): boolean {
  if (!grant) return false;
  if (grant.grantSource === WAYWARD_ROOK_CONTACT_CONSEQUENCE) return false;
  if (grant.grantSource === ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE) return false;
  if (grant.grantSource === ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE) return false;
  return grant.grantSource === ROOK_CONTACT_WAYWARD_GATE_GRANT_SOURCE;
}

/**
 * Lets #241 execution tests reach prepare/start when a fixture row is
 * already stored. A request cannot set this. Production never honors it.
 * The client consequence and the preview source never count.
 */
export function rookContactGrantAllowsExecution(
  grant: { grantSource: string } | null
): boolean {
  if (!grant) return false;
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.ROOK_CONTACT_EXECUTION_FIXTURE !== "1") return false;
  return grant.grantSource === ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE;
}

/**
 * Test/preview writer. The row is not production authority, and this
 * function refuses to run when NODE_ENV is production.
 */
export async function recordIsolatedPreviewRookContactGrant(input: {
  tenantId: string;
  operatorId: string;
  grantedAt: Date;
}): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new ProgressionNotPermittedError(
      "isolated preview cannot grant capability.rook.contact in production"
    );
  }
  await grantRookContactCapability({
    tenantId: input.tenantId,
    operatorId: input.operatorId,
    grantSource: ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE,
    grantedAt: input.grantedAt,
  });
}
