/**
 * Release-only controls for Daphne V2's NEW memory pipeline.
 * Existing Daphne style correction/adaptation authorization remains independent.
 *
 * Both capabilities are off when their explicit flag is absent. A non-empty
 * tenant allowlist restricts an enabled capability to those tenant IDs; an
 * enabled capability with no list is an explicit all-tenant rollout.
 */
export const DAPHNE_CONVERSATION_INGESTION_FLAG =
  "DAPHNE_V2_CONVERSATION_INGESTION_ENABLED" as const;
export const DAPHNE_CONSOLIDATION_WORKER_FLAG =
  "DAPHNE_V2_CONSOLIDATION_WORKER_ENABLED" as const;

function explicitlyOn(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true" || value?.trim() === "1";
}

export function daphneReleaseTenantAllowlist(
  key: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return [...new Set((env[key] ?? "").split(",").map(id => id.trim()).filter(Boolean))];
}

function allowed(
  flag: string,
  allowlistKey: string,
  tenantId: string,
  env: NodeJS.ProcessEnv
): boolean {
  if (!explicitlyOn(env[flag])) return false;
  const tenants = daphneReleaseTenantAllowlist(allowlistKey, env);
  return tenants.length === 0 || (Boolean(tenantId.trim()) && tenants.includes(tenantId));
}

export function isDaphneConversationIngestionEnabled(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return allowed(
    DAPHNE_CONVERSATION_INGESTION_FLAG,
    "DAPHNE_V2_CONVERSATION_INGESTION_TENANTS",
    tenantId,
    env
  );
}

/** Boot must not even create a scheduler without explicit worker approval. */
export function isDaphneConsolidationWorkerConfigured(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return explicitlyOn(env[DAPHNE_CONSOLIDATION_WORKER_FLAG]);
}

export function isDaphneConsolidationWorkerEnabled(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return allowed(
    DAPHNE_CONSOLIDATION_WORKER_FLAG,
    "DAPHNE_V2_CONSOLIDATION_WORKER_TENANTS",
    tenantId,
    env
  );
}
