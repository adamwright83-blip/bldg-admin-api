import twilio from "twilio";
import { evaluateTwilioCapability } from "../../twilioPlatform/capabilities";
import { readTwilioPlatformConfig } from "../../twilioPlatform/config";
import {
  CLAIRE_CONVERSATION_RELAY_PATH,
  conversationRelayWebSocketUrl,
} from "./conversationRelaySignature";
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

export { CLAIRE_CONVERSATION_RELAY_PATH };

/**
 * WebSocket path on the existing HTTP server. Gather webhook URLs are unchanged.
 * The Relay flag stays off until a production upgrade to this path is proven.
 */
/** HTTPS Connect action. Same Claire token, existing HTTP signature validation. */
export const CLAIRE_CONVERSATION_RELAY_ACTION_PATH = "/api/claire/twilio/conversation-relay/action";
/** One unexpected Relay failure may return to Gather. The next one must not. */
export const RELAY_GATHER_FALLBACK_CAP = 1;

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
   * Connect TwiML only. No welcomeGreeting: the persisted Claire opening is
   * queued once on the socket after setup. interruptible "speech" and
   * preemptible false are the SDK's documented barge-in attributes. Text
   * frames omit interruptible so they do not override "speech" with boolean
   * true (speech and DTMF). TTS provider and voice stay unset unless a
   * Relay-specific env seam is present; Gather/xAI is not reused here.
   * Playback events are not subscribed: this SDK's ConversationRelay
   * attributes have no `events` field, and the websocket message reference
   * does not publish tokens-played or speaker-events payloads.
   */
  openingDocument(input: {
    token: string;
    publicBaseUrl: string;
    hints?: string | null;
    env?: NodeJS.ProcessEnv;
  }): string {
    const env = input.env ?? process.env;
    const httpBase = input.publicBaseUrl.replace(/\/$/, "");
    const url = conversationRelayWebSocketUrl({
      publicBaseUrl: httpBase,
      token: input.token,
      env,
    });
    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect({
      action: `${httpBase}${CLAIRE_CONVERSATION_RELAY_ACTION_PATH}?token=${encodeURIComponent(input.token)}`,
      method: "POST",
    });
    const hints = input.hints?.trim();
    const ttsProvider = env.CLAIRE_TWILIO_RELAY_TTS_PROVIDER?.trim();
    const voice = env.CLAIRE_TWILIO_RELAY_VOICE?.trim();
    connect.conversationRelay({
      url,
      language: "en-US",
      interruptible: "speech",
      preemptible: false,
      ...(hints ? { hints } : {}),
      ...(ttsProvider ? { ttsProvider } : {}),
      ...(voice ? { voice } : {}),
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
    env: input.env,
  });
}
