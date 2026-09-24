/**
 * Production authority for capability.rook.contact.
 *
 * Wayward voyage progress lives in same-device localStorage
 * (client/src/pages/goldline/stages/waywardProgress.ts). The Colosseum
 * binding re-reads open-channel outcomes; nothing equivalent records the
 * authored Wayward CONTACT beat. A client consequence string is not that
 * proof. Until a server-authoritative beat exists, production fails closed.
 */
import {
  ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
  ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE,
  WAYWARD_ROOK_CONTACT_CONSEQUENCE,
} from "../../shared/rookContact";
import { grantRookContactCapability } from "./capabilityGrantStore";
import { ProgressionNotPermittedError } from "./progressionContract";

export {
  ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE,
  ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE,
};

export type ServerAuthoritativeWaywardContactProof = {
  proven: false;
  reason: "no_server_authoritative_wayward_contact_beat";
};

export function findServerAuthoritativeWaywardContactProof(_input: {
  tenantId: string;
  operatorId: string;
}): ServerAuthoritativeWaywardContactProof {
  return {
    proven: false,
    reason: "no_server_authoritative_wayward_contact_beat",
  };
}

/** No registered source is production authority today. */
export function rookContactGrantIsProductionAuthority(
  grant: { grantSource: string } | null
): boolean {
  if (!grant) return false;
  if (grant.grantSource === WAYWARD_ROOK_CONTACT_CONSEQUENCE) return false;
  if (grant.grantSource === ROOK_CONTACT_ISOLATED_PREVIEW_GRANT_SOURCE) return false;
  if (grant.grantSource === ROOK_CONTACT_EXECUTION_FIXTURE_SOURCE) return false;
  return false;
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
