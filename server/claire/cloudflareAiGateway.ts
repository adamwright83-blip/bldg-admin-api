/**
 * Optional Cloudflare AI Gateway adapter. Default off.
 *
 * The helper returns the caller-supplied provider base URL unless the
 * server flag is exactly "true" and both the account id and the gateway id
 * are present. Only `provider: "anthropic"` may then use
 * `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`.
 * Every other provider keeps the URL it already uses. This module does not
 * read `ANTHROPIC_BASE_URL`; that SDK default applies to every Anthropic
 * client in the process and is not a Claire-only switch.
 *
 * Not wired into a live client. Claire's model calls construct Anthropic
 * twice inside `server/_core/llm.ts` (`invokeLLM` and `invokeTextLLM`) with
 * no shared base-URL argument. President web research constructs its own
 * Anthropic client, President cycle posts straight to api.anthropic.com,
 * and Claire speech posts to api.x.ai. There is no single base-URL seam to
 * wrap without choosing which of those paths moves. Production traffic stays
 * on the current provider until a separate approval.
 *
 * Request and response logging stay off (`cf-aig-collect-log` and
 * `cf-aig-collect-log-payload`). Response caching stays off
 * (`cf-aig-skip-cache`). Authenticated metadata may carry an opaque tenant
 * id and a correlation id from the server session. It never reads a browser
 * parameter and never accepts a name, phone, or prompt body.
 */

export const CLOUDFLARE_AI_GATEWAY_ENABLED_ENV = "CLOUDFLARE_AI_GATEWAY_ENABLED";
export const CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV = "CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID";
export const CLOUDFLARE_AI_GATEWAY_ID_ENV = "CLOUDFLARE_AI_GATEWAY_ID";

export const ANTHROPIC_GATEWAY_PROVIDER = "anthropic";

const GATEWAY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const OPAQUE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const ALLOWED_METADATA_KEYS = new Set(["tenantId", "correlationId"]);

export type GatewayMetadataSource = "authenticated-session" | "browser-parameter";

export type AuthenticatedGatewayMetadata = {
  tenantId?: string;
  correlationId?: string;
};

export type CloudflareAiGatewayHeaders = {
  "cf-aig-collect-log": "false";
  "cf-aig-collect-log-payload": "false";
  "cf-aig-skip-cache": "true";
  "cf-aig-metadata"?: string;
};

export type CloudflareAiGatewayConfig = {
  baseUrl: string;
  provider: string;
  routedThroughGateway: boolean;
  requestLogging: false;
  responseLogging: false;
  responseCaching: false;
  headers: CloudflareAiGatewayHeaders;
};

export type EnvLike = Record<string, string | undefined>;

export class GatewayMetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayMetadataError";
  }
}

export function anthropicGatewayBaseUrl(accountId: string, gatewayId: string): string {
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(accountId)}/${encodeURIComponent(gatewayId)}/anthropic`;
}

export function resolveCloudflareAiGatewayConfig(input: {
  provider: string;
  existingBaseUrl: string;
  env?: EnvLike;
  metadata?: Record<string, unknown> | null;
  metadataSource?: GatewayMetadataSource;
}): CloudflareAiGatewayConfig {
  const metadata = input.metadata
    ? gatewayMetadataFromFields(input.metadata, input.metadataSource ?? "authenticated-session")
    : undefined;
  const env = input.env ?? process.env;
  const enabled = env[CLOUDFLARE_AI_GATEWAY_ENABLED_ENV] === "true";
  const accountId = (env[CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV] ?? "").trim();
  const gatewayId = (env[CLOUDFLARE_AI_GATEWAY_ID_ENV] ?? "").trim();
  const idsPresent = GATEWAY_ID_PATTERN.test(accountId) && GATEWAY_ID_PATTERN.test(gatewayId);
  const routeAnthropic =
    input.provider === ANTHROPIC_GATEWAY_PROVIDER && enabled && idsPresent;

  return configFor(
    routeAnthropic ? anthropicGatewayBaseUrl(accountId, gatewayId) : input.existingBaseUrl,
    input.provider,
    routeAnthropic,
    metadata
  );
}

export function buildAuthenticatedGatewayMetadata(input: {
  tenantId?: string;
  correlationId?: string;
  browserParameters?: URLSearchParams | Record<string, unknown> | null;
}): AuthenticatedGatewayMetadata {
  const browserTenantId = readBrowserTenantId(input.browserParameters);
  if (browserTenantId && browserTenantId !== input.tenantId) {
    throw new GatewayMetadataError(
      "tenant id must come from the authenticated server session, not a browser parameter"
    );
  }
  const fields: Record<string, unknown> = {};
  if (input.tenantId !== undefined) fields.tenantId = input.tenantId;
  if (input.correlationId !== undefined) fields.correlationId = input.correlationId;
  return gatewayMetadataFromFields(fields, "authenticated-session");
}

export function gatewayMetadataFromFields(
  fields: Record<string, unknown>,
  source: GatewayMetadataSource = "authenticated-session"
): AuthenticatedGatewayMetadata {
  if (source === "browser-parameter") {
    throw new GatewayMetadataError(
      "tenant id must come from the authenticated server session, not a browser parameter"
    );
  }
  const metadata: AuthenticatedGatewayMetadata = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      throw new GatewayMetadataError(metadataFieldRejection(key, value));
    }
    if (value === undefined || value === null || value === "") continue;
    if (typeof value !== "string") {
      throw new GatewayMetadataError(`metadata rejects a non-opaque ${key}`);
    }
    assertOpaqueId(value, key);
    metadata[key as "tenantId" | "correlationId"] = value;
  }
  return metadata;
}

function configFor(
  baseUrl: string,
  provider: string,
  routedThroughGateway: boolean,
  metadata: AuthenticatedGatewayMetadata | undefined
): CloudflareAiGatewayConfig {
  const headers: CloudflareAiGatewayHeaders = {
    "cf-aig-collect-log": "false",
    "cf-aig-collect-log-payload": "false",
    "cf-aig-skip-cache": "true",
  };
  if (routedThroughGateway && metadata) {
    const body: Record<string, string> = {};
    if (metadata.tenantId) body.tenant_id = metadata.tenantId;
    if (metadata.correlationId) body.correlation_id = metadata.correlationId;
    if (Object.keys(body).length > 0) headers["cf-aig-metadata"] = JSON.stringify(body);
  }
  return {
    baseUrl,
    provider,
    routedThroughGateway,
    requestLogging: false,
    responseLogging: false,
    responseCaching: false,
    headers,
  };
}

function metadataFieldRejection(key: string, value: unknown): string {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    normalized === "tel" ||
    normalized.endsWith("tel") ||
    /phone|mobile|telephone/.test(normalized)
  ) {
    return "metadata rejects a phone-like field";
  }
  if (/name|firstname|lastname|fullname|displayname/.test(normalized)) {
    return "metadata rejects a name field";
  }
  if (typeof value === "string" && isPhoneLike(value)) {
    return "metadata rejects a phone-like field";
  }
  if (/prompt|message|body|content|transcript/.test(normalized)) {
    return "metadata rejects a prompt body field";
  }
  if (/query|searchparams|browserparameters|^params$/.test(normalized)) {
    return "tenant id must come from the authenticated server session, not a browser parameter";
  }
  return "metadata rejects an unsupported field";
}

function assertOpaqueId(value: string, field: string): void {
  if (isPhoneLike(value)) {
    throw new GatewayMetadataError(`metadata rejects a phone-like ${field}`);
  }
  if (!OPAQUE_ID_PATTERN.test(value)) {
    throw new GatewayMetadataError(`metadata rejects a non-opaque ${field}`);
  }
}

function isPhoneLike(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  const letters = value.replace(/[^A-Za-z]/g, "");
  return letters.length <= 2;
}

function readBrowserTenantId(
  parameters: URLSearchParams | Record<string, unknown> | null | undefined
): string | undefined {
  if (!parameters) return undefined;
  if (typeof URLSearchParams !== "undefined" && parameters instanceof URLSearchParams) {
    return parameters.get("tenantId") ?? parameters.get("tenant_id") ?? undefined;
  }
  const record = parameters as Record<string, unknown>;
  const value = record.tenantId ?? record.tenant_id;
  return typeof value === "string" && value.trim() ? value : undefined;
}
