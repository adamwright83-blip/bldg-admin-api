import twilio from "twilio";
import { evaluateTwilioCapability } from "../../twilioPlatform/capabilities";
import { readTwilioPlatformConfig } from "../../twilioPlatform/config";
import type { ClaireStreamingSpeechSource } from "./claireStreamingSpeechSource";
import {
  ConversationRelaySession,
  type ConversationRelayNarrativeRef,
} from "./conversationRelaySession";
import {
  CLAIRE_VOICE_BOUNDARIES,
  claireVoiceSession,
  type ClaireVoiceSession,
} from "./claireVoiceSession";

/**
 * Experimental Conversation Relay socket path. Not registered on the Express
 * app: Gather webhooks stay the only production voice surface. A later mount
 * can adopt this path without changing those webhook URLs.
 */
export const CLAIRE_CONVERSATION_RELAY_PATH = "/api/claire/twilio/conversation-relay";

export type ClaireGatherOpeningInput = {
  text: string;
  token: string;
  opening?: boolean;
  hints?: string | null;
  listenOnly?: boolean;
};

export type ClaireVoiceTransportKind = "existing_gather" | "conversation_relay";

type ClaireVoiceSessionInput = {
  tenantId: string;
  operatorUserId: string;
  conversationId: string;
};

/**
 * Speech transport. Both kinds share operator identity, conversation id,
 * conversation state, and the rule that Relay does not replace Claire reasoning.
 */
export interface ClaireVoiceTransport {
  readonly kind: ClaireVoiceTransportKind;
  readonly boundaries: typeof CLAIRE_VOICE_BOUNDARIES;
  sessionFor(input: ClaireVoiceSessionInput): ClaireVoiceSession;
}

export class ExistingGatherVoiceTransport implements ClaireVoiceTransport {
  readonly kind = "existing_gather" as const;
  readonly boundaries = CLAIRE_VOICE_BOUNDARIES;

  sessionFor(input: ClaireVoiceSessionInput): ClaireVoiceSession {
    return claireVoiceSession(input);
  }

  openingDocument(
    input: ClaireGatherOpeningInput,
    renderGather: (input: ClaireGatherOpeningInput) => string
  ): string {
    return renderGather(input);
  }
}

export class ConversationRelayVoiceTransport implements ClaireVoiceTransport {
  readonly kind = "conversation_relay" as const;
  readonly boundaries = CLAIRE_VOICE_BOUNDARIES;

  sessionFor(input: ClaireVoiceSessionInput): ClaireVoiceSession {
    return claireVoiceSession(input);
  }

  /**
   * Connect TwiML only. No welcome greeting: opening speech is queued by the
   * session after setup so it can be interrupted before it is heard completely.
   * Does not place a call and does not select a global TTS provider.
   */
  openingDocument(input: { token: string; publicBaseUrl: string; hints?: string | null }): string {
    const httpBase = input.publicBaseUrl.replace(/\/$/, "");
    const wsBase = httpBase.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
    const url = `${wsBase}${CLAIRE_CONVERSATION_RELAY_PATH}?token=${encodeURIComponent(input.token)}`;
    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();
    const hints = input.hints?.trim();
    connect.conversationRelay({
      url,
      language: "en-US",
      interruptible: "speech",
      ...(hints ? { hints } : {}),
    });
    return response.toString();
  }

  openSession(input: {
    identity: ClaireVoiceSession;
    source: ClaireStreamingSpeechSource;
    openingText: string;
    narrative?: ConversationRelayNarrativeRef;
  }): ConversationRelaySession {
    return new ConversationRelaySession(input);
  }
}

/**
 * Flag off, or flag on without a configured account, stays on Gather.
 * CONFIGURED is the experimental state. This function does not mark the
 * capability LIVE.
 */
export function conversationRelayTransportSelected(env: NodeJS.ProcessEnv = process.env): boolean {
  if (!readTwilioPlatformConfig(env).conversationRelayEnabled) return false;
  return evaluateTwilioCapability("conversationRelay", env).state === "CONFIGURED";
}

export function createClaireVoiceTransport(
  env: NodeJS.ProcessEnv = process.env
): ExistingGatherVoiceTransport | ConversationRelayVoiceTransport {
  if (conversationRelayTransportSelected(env)) return new ConversationRelayVoiceTransport();
  return new ExistingGatherVoiceTransport();
}

/**
 * Opening-document selector. When Relay is off this returns `renderGather`
 * with the Gather input unchanged.
 */
export function renderClaireOpeningVoice(
  input: ClaireGatherOpeningInput & {
    publicBaseUrl: string;
    renderGather: (input: ClaireGatherOpeningInput) => string;
    env?: NodeJS.ProcessEnv;
  }
): string {
  const gatherInput: ClaireGatherOpeningInput = {
    text: input.text,
    token: input.token,
    opening: input.opening,
    hints: input.hints,
    listenOnly: input.listenOnly,
  };
  const transport = createClaireVoiceTransport(input.env);
  if (transport.kind === "existing_gather") {
    return transport.openingDocument(gatherInput, input.renderGather);
  }
  return transport.openingDocument({
    token: input.token,
    publicBaseUrl: input.publicBaseUrl,
    hints: input.hints,
  });
}
