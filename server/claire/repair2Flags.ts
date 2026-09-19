/**
 * Claire Intelligence Repair, Part 2 — behavior flags.
 *
 * Program rule: "Every behavior change is flagged (`claire.repair2.<slice>`),
 * tenant-scoped, default off in production, on in test fixtures, with the
 * deterministic path still reachable as fallback."
 *
 * Slice A changes no answer, but it does add persistence and log volume to a
 * live phone path, so it ships behind the same switch as everything else.
 *
 * Configuration is one env var per slice, holding a comma-separated tenant
 * allowlist (`*` for every tenant):
 *
 *   CLAIRE_REPAIR2_A_ROUTING_TELEMETRY="goldline,another-tenant"
 *   CLAIRE_REPAIR2_A_ROUTING_TELEMETRY="*"
 *
 * Unset means off in production and on outside it, so test fixtures and local
 * runs exercise the instrumented path without configuration.
 */

export type ClaireRepair2Slice = "a_routing_telemetry";

const ENV_VAR: Record<ClaireRepair2Slice, string> = {
  a_routing_telemetry: "CLAIRE_REPAIR2_A_ROUTING_TELEMETRY",
};

function allowlist(slice: ClaireRepair2Slice): string[] {
  return (process.env[ENV_VAR[slice]] ?? "")
    .split(",")
    .map(entry => entry.trim())
    .filter(Boolean);
}

/** The flag's name as it appears in the program document and in telemetry. */
export function claireRepair2FlagName(slice: ClaireRepair2Slice): string {
  return `claire.repair2.${slice}`;
}

export function isClaireRepair2Enabled(slice: ClaireRepair2Slice, tenantId: string): boolean {
  const entries = allowlist(slice);
  if (entries.includes("*")) return true;
  if (entries.includes(tenantId)) return true;
  // Unset: on everywhere except production, so fixtures and local runs are
  // instrumented by default and production stays opt-in.
  return entries.length === 0 && process.env.NODE_ENV !== "production";
}
