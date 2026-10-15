/**
 * Prepared Android handset path for personal-number outreach.
 * Production does not transmit. Live pairing and the controlled self-send are human gates.
 * This file does not shell out, does not call undocumented SMS binders, and does not buy a number.
 * Simulated results exist only for tests and are labeled simulated. They are not carrier receipts.
 */

import { isStrictUsE164 } from "./personalSenderHealth";

export const ANDROID_DEVICE_SENDER = {
  id: "android_telephony_handset",
  status: "BLOCKED",
  reason:
    "BLOCKED: the authorized alternative is the operator's existing Android handset, reading the telephony line and a sent-message read-back (originating number, destination, and body) after the phone's own messaging app accepts the message. That bridge is not paired. Live pairing and the controlled self-send stay blocked until the operator approves the originating number, the recipient number, the exact body, and an immediate send. Silence is not approval. No ADB private SMS call, new number, or paid gateway is used. No customer may receive a message.",
} as const;

export const PERSONAL_SENDER_HUMAN_GATES = {
  livePairing: {
    status: "BLOCKED",
    reason:
      "BLOCKED pending operator approval. Live pairing has not been approved. Silence is not approval. This process will not pair, sign the operator out, or open a second Google Messages session.",
  },
  controlledSelfSend: {
    status: "BLOCKED",
    reason:
      "BLOCKED pending operator approval of the originating number, the recipient number, the exact body, and an immediate send. Silence is not approval. No customer may receive a message.",
  },
} as const;

export type PersonalDraftContext = {
  tenantId: string;
  operatorId: string;
  messageId: string;
  recipientPhone: string;
  body: string;
  revisionCount: number;
};

export type PersonalPreflight =
  | { phase: "ready" }
  | { phase: "not_started"; blockReason: string; evidenceName: string };

export type PersonalExecuteResult =
  | { phase: "not_started"; blockReason: string; evidenceName: string }
  | {
      phase: "ambiguous";
      blockReason: string;
      evidenceName: "ambiguous_transmission";
    }
  | {
      phase: "simulated_observed";
      evidenceName: "simulated_personal_send";
      localObservationId: string;
    };

export interface PersonalNumberTransport {
  readonly transportLabel: "simulated" | "blocked_browser" | "blocked_device";
  preflight(ctx: PersonalDraftContext): PersonalPreflight;
  /** Runs after the dispatch lease is held and before transmission. */
  afterClaim?: () => Promise<void> | void;
  execute(ctx: PersonalDraftContext): Promise<PersonalExecuteResult>;
}

export type SimulatedScript =
  | "verified"
  | "lost_pairing"
  | "offline"
  | "malformed_sender"
  | "malformed_recipient"
  | "wrong_sender"
  | "wrong_device"
  | "wrong_recipient"
  | "before_send_crash"
  | "ambiguous_after_possible_send"
  | "observed_without_receipt";

export type SimulatedPersonalTransport = PersonalNumberTransport & {
  readonly transportLabel: "simulated";
  preflightCount: number;
  executeCount: number;
};

const NOT_CARRIER = "This is not a carrier delivery receipt.";

function notStarted(blockReason: string, evidenceName: string): PersonalPreflight {
  return { phase: "not_started", blockReason, evidenceName };
}

export function createSimulatedPersonalTransport(options: {
  script: SimulatedScript;
  observedSenderPhone: string;
  authorizedSenderPhone: string;
  observedDeviceId: string;
  authorizedDeviceId: string;
  authorizedRecipientPhone: string;
  /**
   * Tests that need to pass the preflight must set this. It does not approve a
   * production send and is ignored when NODE_ENV is not test.
   */
  humanGateBypassForTest?: boolean;
  beforeExecute?: () => Promise<void> | void;
}): SimulatedPersonalTransport {
  const state = { preflightCount: 0, executeCount: 0 };

  function preflight(ctx: PersonalDraftContext): PersonalPreflight {
    state.preflightCount += 1;
    if (process.env.NODE_ENV !== "test") {
      return notStarted(
        "Simulated personal-number transport is refused outside tests.",
        "simulated_transport_refused"
      );
    }
    if (!options.humanGateBypassForTest) {
      return notStarted(
        PERSONAL_SENDER_HUMAN_GATES.controlledSelfSend.reason,
        "human_gate_blocked"
      );
    }
    if (
      options.script === "malformed_sender" ||
      !isStrictUsE164(options.observedSenderPhone) ||
      !isStrictUsE164(options.authorizedSenderPhone)
    ) {
      return notStarted(
        "Fail closed: the originating personal number is missing or malformed.",
        "malformed_sender_phone"
      );
    }
    if (options.script === "malformed_recipient" || !isStrictUsE164(ctx.recipientPhone)) {
      return notStarted(
        "Fail closed: the destination number is missing or malformed.",
        "malformed_recipient_phone"
      );
    }
    if (options.script === "lost_pairing") {
      return notStarted(
        "Requires Pairing. The Android handset pairing was lost before transmission.",
        "lost_pairing"
      );
    }
    if (options.script === "offline") {
      return notStarted("Disconnected. The Android handset is offline.", "device_offline");
    }
    if (
      options.script === "wrong_sender" ||
      options.observedSenderPhone !== options.authorizedSenderPhone
    ) {
      return notStarted(
        "Fail closed: the observed originating number does not match the authorized personal sender.",
        "wrong_sender"
      );
    }
    if (
      options.script === "wrong_device" ||
      options.observedDeviceId !== options.authorizedDeviceId
    ) {
      return notStarted(
        "Fail closed: the observed handset does not match the authorized personal device.",
        "wrong_device"
      );
    }
    if (
      options.script === "wrong_recipient" ||
      ctx.recipientPhone !== options.authorizedRecipientPhone
    ) {
      return notStarted(
        "Fail closed: the destination does not match the authorized recipient on this draft.",
        "wrong_recipient"
      );
    }
    if (!ctx.body.trim() || !ctx.tenantId || !ctx.operatorId || !ctx.messageId) {
      return notStarted(
        "Fail closed: tenant, operator, message, or body could not be verified.",
        "unverified_message"
      );
    }
    return { phase: "ready" };
  }

  return {
    transportLabel: "simulated",
    afterClaim: options.beforeExecute,
    get preflightCount() {
      return state.preflightCount;
    },
    get executeCount() {
      return state.executeCount;
    },
    preflight,
    async execute(ctx) {
      const gate = preflight(ctx);
      if (gate.phase !== "ready") {
        return gate;
      }
      state.executeCount += 1;
      if (options.script === "before_send_crash") {
        return {
          phase: "not_started",
          evidenceName: "crash_before_send",
          blockReason:
            "Crash before send. Transmission did not start. The draft was not handed to the handset.",
        };
      }
      if (options.script === "ambiguous_after_possible_send") {
        return {
          phase: "ambiguous",
          evidenceName: "ambiguous_transmission",
          blockReason: `Ambiguous transmission. The worker crashed after a possible send and before any verified result. Automatic retry is refused. ${NOT_CARRIER}`,
        };
      }
      if (options.script === "observed_without_receipt") {
        return {
          phase: "ambiguous",
          evidenceName: "ambiguous_transmission",
          blockReason: `Ambiguous transmission. A local send may have been observed, but no delivery receipt exists. Observed transmission is not carrier delivery. Automatic retry is refused. ${NOT_CARRIER}`,
        };
      }
      return {
        phase: "simulated_observed",
        evidenceName: "simulated_personal_send",
        localObservationId: `local_${ctx.messageId}_r${ctx.revisionCount}`,
      };
    },
  };
}
