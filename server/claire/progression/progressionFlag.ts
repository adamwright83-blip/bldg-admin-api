/**
 * Shipping flag for the Earned Rapport + Guarded Disclosure mechanic.
 *
 * Slice 0 (human phone acceptance) is a shipping gate, not a test. Merging code must not activate
 * the mechanic. Following the Repair 2 flag convention:
 *
 *   CLAIRE_PROGRESSION="goldline,other-tenant"   (or "*")
 *
 *  - PRODUCTION: OFF unless the tenant is listed AND CLAIRE_PROGRESSION_CONTINUITY_REVIEWED=1.
 *    The second condition is deliberate: enabling replaces the old tier-based disclosure with a
 *    fresh, empty progression state, so a human must first inspect what the existing relationship
 *    state would do (scripts/claire-progression-continuity-report.ts) and consciously accept it.
 *  - NODE_ENV=test|development: ON unless the list is set and excludes the tenant, so tests and local
 *    runs exercise the new path. Any other NODE_ENV (including unset) behaves like production.
 *
 * When OFF, Claire behaves exactly as she did before this feature: tier-based canon eligibility,
 * the prior personal-answer recovery, no progression hooks in the turn path.
 */

export const CLAIRE_PROGRESSION_FLAG_NAME = "claire.progression.earned_rapport";

function tenants(): string[] {
  return (process.env.CLAIRE_PROGRESSION ?? "").split(",").map(entry => entry.trim()).filter(Boolean);
}

export function isClaireProgressionEnabled(tenantId: string): boolean {
  const listed = tenants();
  const explicitlyOn = listed.includes("*") || listed.includes(tenantId);
  if (process.env.NODE_ENV === "production") {
    return explicitlyOn && process.env.CLAIRE_PROGRESSION_CONTINUITY_REVIEWED === "1";
  }
  // Default-on ONLY for explicit test/development. An unset or unknown NODE_ENV is treated as
  // production-like, so the mechanic can never turn itself on in a deployed process.
  const nonProduction = process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";
  return explicitlyOn || (nonProduction && listed.length === 0);
}
