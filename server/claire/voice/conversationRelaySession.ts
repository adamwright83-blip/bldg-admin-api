import {
  applyBargeIn,
  beginGeneratedSpeech,
  claireSpeechLedgerMetadata,
  markHeardCompletely,
  markPlaybackStarted,
  markSpeechQueued,
  type ClaireSpeechAccount,
} from "./claireSpeechLifecycle";
import type { ClaireStreamingSpeechSource } from "./claireStreamingSpeechSource";
import {
  CLAIRE_VOICE_BOUNDARIES,
  CONVERSATION_RELAY_DOES_NOT_DECIDE,
  type ClaireVoiceSession,
} from "./claireVoiceSession";

/**
 * Conversation Relay speech session.
 * Handles speech in/out, stream tokens, interruptions, DTMF, silence, and
 * connection lifecycle. It does not decide business truth, Daily Command,
 * Weekly Mission, Narrator disclosures, commitments, or sales strategy,
 * and it does not place calls.
 */

export type ConversationRelayInbound =
  | { type: "setup"; callSid?: string | null }
  | { type: "prompt"; voicePrompt?: string | null; last?: boolean }
  | { type: "interrupt"; utteranceUntilInterrupt?: string | null; durationUntilInterruptMs?: number }
  | { type: "dtmf"; digit: string }
  | { type: "error"; description?: string | null };

export type ConversationRelayOutbound = {
  type: "text";
  token: string;
  last: boolean;
};

export type ConversationRelayLifecycle =
  | { kind: "connected"; callSid: string | null }
  | { kind: "dtmf"; digit: string }
  | { kind: "silence" }
  | { kind: "partial_prompt" }
  | { kind: "error"; description: string }
  | { kind: "interrupt"; utteranceUntilInterrupt: string | null }
  | { kind: "playback_stopped" };

export type ConversationRelayNarrativeRef = {
  narratorOccurrenceLedgerId: string;
  narratorBeatId: string;
  narrativePresentationId: string;
};

export class ConversationRelaySession {
  readonly kind = "conversation_relay" as const;
  readonly boundaries = CLAIRE_VOICE_BOUNDARIES;
  readonly doesNotDecide = CONVERSATION_RELAY_DOES_NOT_DECIDE;
  readonly identity: ClaireVoiceSession;
  readonly phasesSeen: ClaireSpeechAccount["phase"][] = [];
  readonly lifecycle: ConversationRelayLifecycle[] = [];
  speech: ClaireSpeechAccount | null = null;

  private readonly source: ClaireStreamingSpeechSource;
  private readonly openingText: string;
  private readonly narrative: ConversationRelayNarrativeRef | undefined;
  private stopPlayback = false;

  constructor(input: {
    identity: ClaireVoiceSession;
    source: ClaireStreamingSpeechSource;
    /** Already-generated Claire text. Not evidence the operator heard it. */
    openingText: string;
    narrative?: ConversationRelayNarrativeRef;
  }) {
    this.identity = input.identity;
    this.source = input.source;
    this.openingText = input.openingText;
    this.narrative = input.narrative;
  }

  ledgerMetadata(): ReturnType<typeof claireSpeechLedgerMetadata> | null {
    if (!this.speech) return null;
    return claireSpeechLedgerMetadata(this.speech, this.narrative);
  }

  /** Provider began speaking the queued sentence. This is not heard-completely. */
  notePlaybackStarted(): void {
    if (!this.speech || this.stopPlayback) return;
    this.observe(markPlaybackStarted(this.speech));
  }

  /** Explicit playback-complete evidence. Refused after barge-in or before playback starts. */
  notePlaybackCompleted(): void {
    if (!this.speech || this.stopPlayback) return;
    this.observe(markHeardCompletely(this.speech));
  }

  async handle(message: ConversationRelayInbound): Promise<ConversationRelayOutbound[]> {
    switch (message.type) {
      case "setup":
        this.lifecycle.push({ kind: "connected", callSid: message.callSid?.trim() || null });
        return this.enqueueFullText(this.openingText);
      case "prompt":
        return this.onPrompt(message.voicePrompt ?? "", message.last);
      case "interrupt":
        return this.onInterrupt(message.utteranceUntilInterrupt ?? null);
      case "dtmf":
        this.lifecycle.push({ kind: "dtmf", digit: message.digit });
        return [];
      case "error":
        this.lifecycle.push({
          kind: "error",
          description: (message.description ?? "").trim().slice(0, 200),
        });
        return [];
      default: {
        const unreachable: never = message;
        void unreachable;
        return [];
      }
    }
  }

  private async onPrompt(voicePrompt: string, last: boolean | undefined): Promise<ConversationRelayOutbound[]> {
    if (last === false) {
      this.lifecycle.push({ kind: "partial_prompt" });
      return [];
    }
    const utterance = voicePrompt.trim();
    if (!utterance) {
      this.lifecycle.push({ kind: "silence" });
      return [];
    }
    this.stopPlayback = false;
    const parts: string[] = [];
    const outbound: ConversationRelayOutbound[] = [];
    for await (const chunk of this.source.generate({ ...this.identity, utterance })) {
      if (this.stopPlayback) break;
      parts.push(chunk.text);
      outbound.push({ type: "text", token: chunk.text, last: chunk.last });
    }
    if (this.stopPlayback) {
      if (parts.length) {
        this.observe(beginGeneratedSpeech(parts.join("")));
        if (this.speech) this.observe(markSpeechQueued(this.speech));
        if (this.speech) this.observe(applyBargeIn(this.speech));
      }
      return [];
    }
    this.observe(beginGeneratedSpeech(parts.join("")));
    if (this.speech) this.observe(markSpeechQueued(this.speech));
    return outbound;
  }

  private onInterrupt(utteranceUntilInterrupt: string | null): ConversationRelayOutbound[] {
    this.stopPlayback = true;
    this.lifecycle.push({ kind: "interrupt", utteranceUntilInterrupt });
    this.lifecycle.push({ kind: "playback_stopped" });
    if (this.speech) this.observe(applyBargeIn(this.speech));
    return [];
  }

  private enqueueFullText(text: string): ConversationRelayOutbound[] {
    this.observe(beginGeneratedSpeech(text));
    if (this.speech) this.observe(markSpeechQueued(this.speech));
    return [{ type: "text", token: text, last: true }];
  }

  private observe(account: ClaireSpeechAccount): void {
    if (this.speech?.phase === account.phase && this.speech.heardCompletely === account.heardCompletely) {
      this.speech = account;
      return;
    }
    this.speech = account;
    this.phasesSeen.push(account.phase);
  }
}
