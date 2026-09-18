import type { SmsSendReceipt } from "../_core/sms";
import { sendSMSWithReceipt } from "../_core/sms";

export type OutboundSendInput = {
  to: string;
  body: string;
  idempotencyKey: string;
};

export type OutboundSendAdapter = {
  send(input: OutboundSendInput): Promise<SmsSendReceipt>;
};

/**
 * Production adapter. Automated tests must inject a fake — never this.
 */
export const twilioOutboundSendAdapter: OutboundSendAdapter = {
  async send(input) {
    return sendSMSWithReceipt(input.to, input.body, { idempotencyKey: input.idempotencyKey });
  },
};

export function createFakeOutboundSendAdapter(options?: {
  mode?: "accept" | "reject" | "unconfigured" | "ambiguous";
  onAttempt?: (input: OutboundSendInput) => void;
}): OutboundSendAdapter & { attempts: OutboundSendInput[] } {
  const attempts: OutboundSendInput[] = [];
  const accepted = new Map<string, SmsSendReceipt>();
  const mode = options?.mode ?? "accept";
  return {
    attempts,
    async send(input) {
      attempts.push(input);
      options?.onAttempt?.(input);
      const existing = accepted.get(input.idempotencyKey);
      if (existing) return existing;
      if (mode === "reject") {
        return {
          accepted: false,
          providerMessageId: null,
          providerStatus: null,
          evidenceName: "provider_rejected",
        };
      }
      if (mode === "unconfigured") {
        return {
          accepted: false,
          providerMessageId: null,
          providerStatus: null,
          evidenceName: "provider_unconfigured",
        };
      }
      if (mode === "ambiguous") {
        return {
          accepted: false,
          providerMessageId: null,
          providerStatus: null,
          evidenceName: "send_outcome_unknown",
        };
      }
      const receipt: SmsSendReceipt = {
        accepted: true,
        providerMessageId: `SM_fake_${input.idempotencyKey}`,
        providerStatus: "queued",
        evidenceName: "provider_accepted",
      };
      accepted.set(input.idempotencyKey, receipt);
      return receipt;
    },
  };
}
