import {
  applyBargeIn,
  beginGeneratedSpeech,
  markHeardCompletely,
  markSpeechQueued,
  type ClaireSpeechAccount,
} from "./claireSpeechLifecycle";
import type { ConversationRelayInbound } from "./conversationRelaySession";
import type { ClaireVoiceSession } from "./claireVoiceSession";

/**
 * Socket adapter. Semantic last:true prompts share the authoritative Claire
 * voice turn. This module does not call the model and does not own Gather's
 * pause-fragment policy. Interrupt, close, provider error, and intentional
 * end do not wait on that turn.
 */

export const RELAY_COMPLETE_TEXT_LAST = true as const;

export type RelaySemanticTurnInput = {
  conversationId: string;
  tenantId: string;
  operatorUserId: string;
  utterance: string;
  callSid: string | null;
  token: string;
  allowFragmentWait: false;
};

export type RelaySemanticTurnResult = {
  speak: string;
  endCall: boolean;
  listenOnly: boolean;
};

export type RelayWireMessage =
  | { type: "text"; token: string; last: true; preemptible: false }
  | { type: "end"; handoffData: string };

const INTENTIONAL_END_HANDOFF = JSON.stringify({ reason: "claire_end_call" });

export class ConversationRelaySocketRuntime {
  readonly identity: ClaireVoiceSession;
  speech: ClaireSpeechAccount | null = null;
  readonly sent: RelayWireMessage[] = [];
  partialPrompts = 0;
  intentionalEnd = false;

  private chain: Promise<void> = Promise.resolve();
  private side: Promise<void> = Promise.resolve();
  private generation = 0;
  private inflightGeneration = 0;
  private readonly stoppedGenerations = new Set<number>();
  private callSid: string | null = null;

  constructor(
    private readonly options: {
      identity: ClaireVoiceSession;
      token: string;
      send: (message: RelayWireMessage) => void;
      loadOpening: () => Promise<{ text: string; queued: boolean }>;
      noteCallSid: (callSid: string) => Promise<void>;
      runTurn: (input: RelaySemanticTurnInput) => Promise<RelaySemanticTurnResult>;
      markIntentionalEnd: () => Promise<void>;
    }
  ) {
    this.identity = options.identity;
  }

  accept(message: ConversationRelayInbound | { type: "close" }): void {
    if (
      message.type === "interrupt" ||
      message.type === "error" ||
      message.type === "close"
    ) {
      this.bypassOutput(message.type === "interrupt");
      return;
    }
    if (message.type === "setup") {
      const callSid = message.callSid?.trim() || "";
      if (callSid) {
        this.callSid = callSid;
        this.enqueueSide(() => this.options.noteCallSid(callSid));
      }
      this.enqueueSide(() => this.queueOpeningOnce());
      return;
    }
    if (message.type === "prompt") {
      if (message.last === false) {
        this.partialPrompts += 1;
        return;
      }
      const utterance = (message.voicePrompt ?? "").trim();
      if (!utterance) return;
      const generation = ++this.generation;
      this.chain = this.chain
        .then(() => this.runGeneration(generation, utterance))
        .catch(error => {
          console.error("[Claire] conversation relay turn failed", {
            event: "relay_turn_failed",
            conversationId: this.identity.conversationId,
            reason: error instanceof Error ? error.message : "relay_turn_failed",
          });
        });
      return;
    }
  }

  /** Claire is done. Does not wait for a queued semantic turn. */
  requestIntentionalEnd(): void {
    if (this.intentionalEnd) return;
    this.intentionalEnd = true;
    this.stoppedGenerations.add(this.inflightGeneration);
    this.enqueueSide(async () => {
      await this.options.markIntentionalEnd();
      this.emit({ type: "end", handoffData: INTENTIONAL_END_HANDOFF });
    });
  }

  notePlaybackCompleted(): void {
    if (!this.speech) return;
    this.speech = markHeardCompletely(this.speech);
  }

  idle(): Promise<void> {
    return Promise.all([this.chain, this.side]).then(() => undefined);
  }

  private bypassOutput(bargeIn: boolean): void {
    if (this.inflightGeneration > 0) this.stoppedGenerations.add(this.inflightGeneration);
    if (bargeIn) {
      this.speech = applyBargeIn(this.speech ?? beginGeneratedSpeech(""));
    }
  }

  private enqueueSide(work: () => Promise<void>): void {
    this.side = this.side.then(work).catch(error => {
      console.error("[Claire] conversation relay side work failed", {
        event: "relay_side_failed",
        conversationId: this.identity.conversationId,
        reason: error instanceof Error ? error.message : "relay_side_failed",
      });
    });
  }

  private emit(message: RelayWireMessage): void {
    this.sent.push(message);
    this.options.send(message);
  }

  private async queueOpeningOnce(): Promise<void> {
    const opening = await this.options.loadOpening();
    if (!opening.queued || !opening.text.trim()) return;
    this.speech = markSpeechQueued(beginGeneratedSpeech(opening.text));
    this.emit({
      type: "text",
      token: opening.text,
      last: RELAY_COMPLETE_TEXT_LAST,
      preemptible: false,
    });
  }

  private async runGeneration(generation: number, utterance: string): Promise<void> {
    if (this.intentionalEnd || this.stoppedGenerations.has(generation)) return;
    this.inflightGeneration = generation;
    const result = await this.options.runTurn({
      conversationId: this.identity.conversationId,
      tenantId: this.identity.tenantId,
      operatorUserId: this.identity.operatorUserId,
      utterance,
      callSid: this.callSid,
      token: this.options.token,
      allowFragmentWait: false,
    });
    if (this.intentionalEnd || this.stoppedGenerations.has(generation)) {
      this.speech = applyBargeIn(
        markSpeechQueued(beginGeneratedSpeech(result.speak || this.speech?.text || ""))
      );
      if (result.endCall) this.requestIntentionalEnd();
      return;
    }
    if (result.listenOnly) return;
    const speak = result.speak.trim();
    if (speak) {
      this.speech = markSpeechQueued(beginGeneratedSpeech(speak));
      this.emit({
        type: "text",
        token: speak,
        last: RELAY_COMPLETE_TEXT_LAST,
        preemptible: false,
      });
    }
    if (result.endCall) this.requestIntentionalEnd();
  }
}
