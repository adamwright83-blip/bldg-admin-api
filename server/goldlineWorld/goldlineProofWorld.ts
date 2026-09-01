import { assertProofModeAllowed } from "../_core/proofMode";
import { resetGoldlineProofWorld } from "../../scripts/goldline-living-world-proof-seed";

/**
 * Proof-only. Restores the disposable tenant to the deterministic living-world
 * fixture so Fast Goldline specs cannot poison each other, and so a human does
 * not have to DROP DATABASE between smoke runs.
 */
export async function resetProofWorldFromApi() {
  assertProofModeAllowed("resetProofWorld");
  await resetGoldlineProofWorld();
  return { ok: true as const };
}
