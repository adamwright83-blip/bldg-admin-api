import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV,
  CLOUDFLARE_AI_GATEWAY_ENABLED_ENV,
  CLOUDFLARE_AI_GATEWAY_ID_ENV,
  GatewayMetadataError,
  buildAuthenticatedGatewayMetadata,
  gatewayMetadataFromFields,
  resolveCloudflareAiGatewayConfig,
} from "./cloudflareAiGateway";

const ANTHROPIC_URL = "https://api.anthropic.com";
const XAI_URL = "https://api.x.ai/v1/tts";
const OPENAI_URL = "https://api.openai.com/v1";
const ACCOUNT_ID = "a1b2c3d4e5f6789012345678abcdef01";
const GATEWAY_ID = "joystick-claire";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: undefined,
    [CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV]: undefined,
    [CLOUDFLARE_AI_GATEWAY_ID_ENV]: undefined,
    ...overrides,
  };
}

function enabledWithIds(extra: Record<string, string | undefined> = {}) {
  return env({
    [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: "true",
    [CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV]: ACCOUNT_ID,
    [CLOUDFLARE_AI_GATEWAY_ID_ENV]: GATEWAY_ID,
    ...extra,
  });
}

function anthropic(overrides: Record<string, string | undefined> = {}, metadata?: Record<string, unknown>) {
  return resolveCloudflareAiGatewayConfig({
    provider: "anthropic",
    existingBaseUrl: ANTHROPIC_URL,
    env: env(overrides),
    metadata,
  });
}

describe("Cloudflare AI Gateway adapter", () => {
  it("returns the original base URL when the flag is off", () => {
    const config = anthropic({
      [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: "false",
      [CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV]: ACCOUNT_ID,
      [CLOUDFLARE_AI_GATEWAY_ID_ENV]: GATEWAY_ID,
    });
    expect(config.baseUrl).toBe(ANTHROPIC_URL);
    expect(config.routedThroughGateway).toBe(false);
  });

  it("treats a missing or non-exact flag as off", () => {
    expect(anthropic().baseUrl).toBe(ANTHROPIC_URL);
    expect(anthropic({ [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: "TRUE" }).baseUrl).toBe(ANTHROPIC_URL);
    expect(anthropic({ [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: "1" }).baseUrl).toBe(ANTHROPIC_URL);
  });

  it("stays on the original URL when the flag is on without both ids", () => {
    expect(
      anthropic({ [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: "true" }).baseUrl
    ).toBe(ANTHROPIC_URL);
    expect(
      anthropic({
        [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: "true",
        [CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV]: ACCOUNT_ID,
      }).baseUrl
    ).toBe(ANTHROPIC_URL);
    expect(
      anthropic({
        [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: "true",
        [CLOUDFLARE_AI_GATEWAY_ID_ENV]: GATEWAY_ID,
        [CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV]: "   ",
      }).baseUrl
    ).toBe(ANTHROPIC_URL);
    expect(
      anthropic({
        [CLOUDFLARE_AI_GATEWAY_ENABLED_ENV]: "true",
        [CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID_ENV]: "acct/../other",
        [CLOUDFLARE_AI_GATEWAY_ID_ENV]: GATEWAY_ID,
      }).baseUrl
    ).toBe(ANTHROPIC_URL);
  });

  it("uses the Anthropic gateway URL when the flag and both ids are present", () => {
    const config = resolveCloudflareAiGatewayConfig({
      provider: "anthropic",
      existingBaseUrl: ANTHROPIC_URL,
      env: enabledWithIds(),
    });
    expect(config.baseUrl).toBe(
      `https://gateway.ai.cloudflare.com/v1/${ACCOUNT_ID}/${GATEWAY_ID}/anthropic`
    );
    expect(config.routedThroughGateway).toBe(true);
  });

  it("does not send OpenAI or xAI through the Anthropic gateway URL", () => {
    const openai = resolveCloudflareAiGatewayConfig({
      provider: "openai",
      existingBaseUrl: OPENAI_URL,
      env: enabledWithIds(),
    });
    const xai = resolveCloudflareAiGatewayConfig({
      provider: "xai",
      existingBaseUrl: XAI_URL,
      env: enabledWithIds(),
    });
    expect(openai.baseUrl).toBe(OPENAI_URL);
    expect(xai.baseUrl).toBe(XAI_URL);
    expect(openai.routedThroughGateway).toBe(false);
    expect(xai.routedThroughGateway).toBe(false);
  });

  it("disables request/response logging and response caching", () => {
    for (const config of [
      anthropic(),
      resolveCloudflareAiGatewayConfig({
        provider: "anthropic",
        existingBaseUrl: ANTHROPIC_URL,
        env: enabledWithIds(),
        metadata: { tenantId: "ten_8f3a", correlationId: "corr_44" },
      }),
    ]) {
      expect(config.requestLogging).toBe(false);
      expect(config.responseLogging).toBe(false);
      expect(config.responseCaching).toBe(false);
      expect(config.headers["cf-aig-collect-log"]).toBe("false");
      expect(config.headers["cf-aig-collect-log-payload"]).toBe("false");
      expect(config.headers["cf-aig-skip-cache"]).toBe("true");
      expect(config.headers).not.toHaveProperty("cf-aig-cache-key");
      expect(config.headers).not.toHaveProperty("cf-aig-cache-ttl");
    }
  });

  it("sends only an opaque tenant id and correlation id when routed", () => {
    const config = resolveCloudflareAiGatewayConfig({
      provider: "anthropic",
      existingBaseUrl: ANTHROPIC_URL,
      env: enabledWithIds(),
      metadata: { tenantId: "ten_8f3a", correlationId: "corr_44" },
    });
    expect(config.headers["cf-aig-metadata"]).toBe(
      JSON.stringify({ tenant_id: "ten_8f3a", correlation_id: "corr_44" })
    );
  });

  it("rejects a phone-like field and a name field", () => {
    expect(() => gatewayMetadataFromFields({ phone: "+1 310 555 0199" })).toThrow(
      GatewayMetadataError
    );
    expect(() => gatewayMetadataFromFields({ phone: "+1 310 555 0199" })).toThrow(
      /phone-like/
    );
    expect(() => gatewayMetadataFromFields({ customerName: "Ada Lovelace" })).toThrow(
      /name field/
    );
    expect(() => gatewayMetadataFromFields({ name: "Ada" })).toThrow(/name field/);
    expect(() =>
      gatewayMetadataFromFields({ tenantId: "+13105550199", correlationId: "corr_44" })
    ).toThrow(/phone-like/);
    expect(() => gatewayMetadataFromFields({ prompt: "call this customer" })).toThrow(
      /prompt body/
    );
  });

  it("does not take a tenant id from a browser parameter", () => {
    expect(() =>
      gatewayMetadataFromFields({ tenantId: "ten_8f3a" }, "browser-parameter")
    ).toThrow(/browser parameter/);
    expect(() =>
      buildAuthenticatedGatewayMetadata({
        correlationId: "corr_44",
        browserParameters: new URLSearchParams("tenantId=from-the-browser"),
      })
    ).toThrow(/browser parameter/);

    const metadata = buildAuthenticatedGatewayMetadata({
      tenantId: "ten_8f3a",
      correlationId: "corr_44",
      browserParameters: { tenantId: "ten_8f3a", name: "Ada", phone: "3105550199" },
    });
    expect(metadata).toEqual({ tenantId: "ten_8f3a", correlationId: "corr_44" });
    expect(JSON.stringify(metadata)).not.toMatch(/Ada|3105550199|name|phone/);
  });
});
