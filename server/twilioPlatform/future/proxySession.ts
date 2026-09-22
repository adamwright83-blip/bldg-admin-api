import type { GoldlineProxyAnchor, MaskedCommunicationSession } from "@shared/twilioFuture";
import { evaluateTwilioCapability, TwilioCapabilityUnavailableError } from "../capabilities";

export type MaskedSessionPlan =
  | {
      ok: false;
      created: false;
      state: "UNCONFIGURED" | "DISABLED" | "CONFIGURED_FAILING";
      reason: string;
      session: null;
    }
  | {
      ok: false;
      created: false;
      state: "REFUSED";
      reason: "anonymous_proxy_refused";
      session: null;
    }
  | {
      ok: true;
      created: false;
      state: "DESCRIBED";
      reason: "production_sessions_not_activated";
      session: MaskedCommunicationSession;
    };

function anchorId(anchor: GoldlineProxyAnchor): string {
  switch (anchor.kind) {
    case "order":
      return anchor.orderId.trim();
    case "deliveryJob":
      return anchor.deliveryJobId.trim();
    case "customer":
      return anchor.customerId.trim();
    case "driver":
      return anchor.driverId.trim();
  }
}

/**
 * Describes a masked session scoped to a tenant and one Goldline entity.
 * Unconfigured Proxy fails closed. This function does not open a Twilio session.
 */
export function planMaskedCommunicationSession(input: {
  env?: NodeJS.ProcessEnv;
  tenantId: string;
  anchor: GoldlineProxyAnchor | null;
}): MaskedSessionPlan {
  const env = input.env ?? process.env;
  const capability = evaluateTwilioCapability("proxy", env);
  if (capability.state !== "CONFIGURED" && capability.state !== "LIVE") {
    return {
      ok: false,
      created: false,
      state: capability.state as "UNCONFIGURED" | "DISABLED" | "CONFIGURED_FAILING",
      reason: capability.reason ?? "proxy_unavailable",
      session: null,
    };
  }
  const tenantId = input.tenantId.trim();
  if (!tenantId || !input.anchor || !anchorId(input.anchor)) {
    return {
      ok: false,
      created: false,
      state: "REFUSED",
      reason: "anonymous_proxy_refused",
      session: null,
    };
  }
  return {
    ok: true,
    created: false,
    state: "DESCRIBED",
    reason: "production_sessions_not_activated",
    session: {
      kind: "masked_communication_session",
      tenantId,
      anchor: input.anchor,
      liveSessionCreated: false,
      proxySessionSid: null,
    },
  };
}

/** Production masked sessions are not part of this slice. */
export function createProductionMaskedSession(env: NodeJS.ProcessEnv = process.env): never {
  const capability = evaluateTwilioCapability("proxy", env);
  if (capability.state !== "CONFIGURED" && capability.state !== "LIVE") {
    throw new TwilioCapabilityUnavailableError(capability);
  }
  throw new Error("production masked sessions are not activated");
}
