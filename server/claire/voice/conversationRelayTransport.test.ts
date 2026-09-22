import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import { evaluateTwilioCapability } from "../../twilioPlatform/capabilities";
import { TWILIO_CAPABILITY_REASONS } from "@shared/twilioPlatform";
import { isValidTwilioWebhook } from "../conversation/twilioSignature";
import { isConfirmedHeardClaireSpeech, SPEECH_DELIVERY } from "../conversation/speechDelivery";
import { claireDeliveryForOccurrence } from "../narratorPresentationConsumer";
import { preDriveConversationTwiML } from "../claireTwilio";
import {
  applyBargeIn,
  beginGeneratedSpeech,
  CLAIRE_SPEECH_PHASES,
  markHeardCompletely,
  markPlaybackStarted,
  markSpeechQueued,
} from "./claireSpeechLifecycle";
import { singleChunkSpeechSource } from "./claireStreamingSpeechSource";
import { claireVoiceSession } from "./claireVoiceSession";
import {
  CLAIRE_CONVERSATION_RELAY_PATH,
  ConversationRelayVoiceTransport,
  createClaireVoiceTransport,
  ExistingGatherVoiceTransport,
  renderClaireOpeningVoice,
} from "./claireVoiceTransport";

vi.mock("../../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "test-secret",
    xaiApiKey: "",
    claireXaiTtsEnabled: false,
    claireXaiTtsVoiceId: "eve",
    ownerOpenId: "adam-admin",
  },
}));

const FULL_SENTENCE = "The lantern on the Louise is out.";
const NARRATIVE = {
  narratorOccurrenceLedgerId: "occ-louise",
  narratorBeatId: "beat-louise",
  narrativePresentationId: "pres-louise",
};

function relayEnv(flag: string | undefined, extras: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    TWILIO_ACCOUNT_SID: "AC_test",
    TWILIO_AUTH_TOKEN: "auth_test",
    CLAIRE_TWILIO_FROM_NUMBER: "+13105550000",
    CLAIRE_OPERATOR_PHONE: "+13105550001",
    ...(flag === undefined ? {} : { CLAIRE_TWILIO_CONVERSATION_RELAY: flag }),
    ...extras,
  } as NodeJS.ProcessEnv;
}

describe("Conversation Relay transport — flag off", () => {
  it("keeps conversationRelay DISABLED with feature_flag_off and does not mark it LIVE", () => {
    const record = evaluateTwilioCapability("conversationRelay", relayEnv(undefined));
    expect(record).toEqual({
      id: "conversationRelay",
      state: "DISABLED",
      reason: TWILIO_CAPABILITY_REASONS.featureFlagOff,
    });
    expect(record.state).not.toBe("LIVE");
    expect(createClaireVoiceTransport(relayEnv(undefined)).kind).toBe("existing_gather");
    expect(createClaireVoiceTransport(relayEnv("false")).kind).toBe("existing_gather");
  });

  it("preserves Gather byte for byte when the relay flag is off", () => {
    const input = {
      text: "Two stops today.",
      token: "signed-token",
      opening: true,
      hints: "Louise, Wilshire",
    };
    const gather = preDriveConversationTwiML(input);
    const selected = renderClaireOpeningVoice({
      ...input,
      publicBaseUrl: "https://api.example.test",
      renderGather: preDriveConversationTwiML,
      env: relayEnv(undefined),
    });
    expect(selected).toBe(gather);
    expect(selected).toContain("<Gather");
    expect(selected).toContain('speechTimeout="3"');
    expect(selected).toContain('voice="Polly.Ruth-Generative"');
    expect(selected).not.toContain("ConversationRelay");
    expect(selected).not.toContain("<Stream");
  });

  it("is zero behavior change while relay is disabled, including an explicit false flag", () => {
    const input = { text: "The Louise.", token: "t" };
    const gather = preDriveConversationTwiML(input);
    expect(
      renderClaireOpeningVoice({
        ...input,
        publicBaseUrl: "https://api.example.test",
        renderGather: preDriveConversationTwiML,
        env: relayEnv("false"),
      })
    ).toBe(gather);
    expect(gather).toContain('speechTimeout="auto"');
  });
});

describe("Conversation Relay transport — experimental flag on", () => {
  it("stays CONFIGURED rather than LIVE and renders Connect ConversationRelay", () => {
    const env = relayEnv("true");
    const record = evaluateTwilioCapability("conversationRelay", env);
    expect(record.state).toBe("CONFIGURED");
    expect(record.reason).toBeNull();
    expect(record.state).not.toBe("LIVE");
    const xml = renderClaireOpeningVoice({
      text: "Hey Adam. What's up?",
      token: "signed token",
      publicBaseUrl: "https://api.example.test",
      renderGather: preDriveConversationTwiML,
      env,
    });
    expect(xml).toContain("<ConversationRelay");
    expect(xml).toContain(CLAIRE_CONVERSATION_RELAY_PATH);
    expect(xml).toContain("wss://api.example.test");
    expect(xml).toContain("interruptible=\"speech\"");
    expect(xml).toContain("preemptible=\"false\"");
    expect(xml).toContain("/api/claire/twilio/conversation-relay/action?token=");
    expect(xml).not.toContain("<Gather");
    expect(xml).not.toContain("<Stream");
    expect(xml).not.toContain("welcomeGreeting");
    expect(xml).not.toContain("ttsProvider");
  });

  it("does not switch off Gather when the flag is on but the account is missing", () => {
    const env = { CLAIRE_TWILIO_CONVERSATION_RELAY: "true" } as NodeJS.ProcessEnv;
    expect(evaluateTwilioCapability("conversationRelay", env).state).not.toBe("LIVE");
    expect(evaluateTwilioCapability("conversationRelay", env).state).not.toBe("DISABLED");
    const input = { text: "Still Gather.", token: "t" };
    expect(
      renderClaireOpeningVoice({
        ...input,
        publicBaseUrl: "https://api.example.test",
        renderGather: preDriveConversationTwiML,
        env,
      })
    ).toBe(preDriveConversationTwiML(input));
  });
});

describe("shared Claire voice contract", () => {
  it("gives Gather and Relay the same operator, conversation, and boundaries", () => {
    const gather = new ExistingGatherVoiceTransport();
    const relay = new ConversationRelayVoiceTransport();
    const input = { tenantId: "tenant-1", operatorUserId: "adam-admin", conversationId: "conv-1" };
    expect(gather.boundaries).toBe(relay.boundaries);
    expect(gather.sessionFor(input)).toEqual(relay.sessionFor(input));
    expect(gather.sessionFor(input).conversationStateKey).toBe("claire-call:conv-1");
    expect(readFileSync(new URL("../claireTwilio.ts", import.meta.url), "utf8")).toContain(
      "claire-call:${conversationId}"
    );
  });
});

describe("speech lifecycle", () => {
  it("keeps generated, queued, playback started, and heard completely distinct", () => {
    expect(new Set(CLAIRE_SPEECH_PHASES).size).toBe(4);
    const generated = beginGeneratedSpeech(FULL_SENTENCE);
    const queued = markSpeechQueued(generated);
    const started = markPlaybackStarted(queued);
    const heard = markHeardCompletely(started);
    expect([generated.phase, queued.phase, started.phase, heard.phase]).toEqual([
      "generated",
      "queued",
      "playback_started",
      "heard_completely",
    ]);
    expect(generated.heardCompletely).toBe(false);
    expect(queued.heardCompletely).toBe(false);
    expect(started.heardCompletely).toBe(false);
    expect(heard.heardCompletely).toBe(true);
    expect(markHeardCompletely(generated).phase).toBe("generated");
    expect(markHeardCompletely(queued).phase).toBe("queued");
  });

  it("does not mark a full generated chunk as heard", async () => {
    const chunks = [];
    for await (const chunk of singleChunkSpeechSource(async () => FULL_SENTENCE).generate({
      ...claireVoiceSession({ tenantId: "t", operatorUserId: "op", conversationId: "c" }),
      utterance: "hello",
    })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ text: FULL_SENTENCE, last: true }]);
    const queued = markSpeechQueued(beginGeneratedSpeech(chunks[0]!.text));
    expect(queued.text).toBe(FULL_SENTENCE);
    expect(queued.phase).toBe("queued");
    expect(queued.heardCompletely).toBe(false);
    expect(isConfirmedHeardClaireSpeech({ speechDelivery: SPEECH_DELIVERY.GENERATED_QUEUED, heardConfirmed: false })).toBe(
      false
    );
  });
});

describe("barge-in", () => {
  it("does not mark complete speech heard when playback stops", async () => {
    const source = singleChunkSpeechSource(async () => {
      throw new Error("opening speech must not call the model again");
    });
    const session = new ConversationRelayVoiceTransport().openSession({
      identity: claireVoiceSession({
        tenantId: "tenant-1",
        operatorUserId: "adam-admin",
        conversationId: "conv-barge",
      }),
      source,
      openingText: FULL_SENTENCE,
      narrative: NARRATIVE,
    });

    const spoken = await session.handle({ type: "setup", callSid: "CA_barge" });
    expect(spoken).toEqual([{ type: "text", token: FULL_SENTENCE, last: true, preemptible: false }]);
    expect(session.speech?.phase).toBe("queued");
    expect(session.speech?.heardCompletely).toBe(false);

    session.notePlaybackStarted();
    expect(session.speech?.phase).toBe("playback_started");
    expect(session.speech?.heardCompletely).toBe(false);
    expect(session.phasesSeen).toEqual(["generated", "queued", "playback_started"]);

    const afterInterrupt = await session.handle({
      type: "interrupt",
      utteranceUntilInterrupt: "wait",
      durationUntilInterruptMs: 400,
    });
    expect(afterInterrupt).toEqual([]);
    expect(session.speech?.text).toBe(FULL_SENTENCE);
    expect(session.speech?.phase).toBe("interrupted");
    expect(session.speech?.heardCompletely).toBe(false);
    expect(session.phasesSeen).not.toContain("heard_completely");

    session.notePlaybackCompleted();
    expect(session.speech?.heardCompletely).toBe(false);
    expect(session.speech?.phase).toBe("interrupted");

    const metadata = session.ledgerMetadata();
    expect(metadata?.speechDelivery).toBe(SPEECH_DELIVERY.CONFIRMED_NOT_HEARD);
    expect(metadata?.heardConfirmed).toBe(false);
    expect(metadata?.claireSpeechPhase).toBe("interrupted");
    expect(isConfirmedHeardClaireSpeech(metadata)).toBe(false);
    const delivery = claireDeliveryForOccurrence(metadata);
    expect(delivery).toMatchObject({
      occurrenceLedgerEntryId: "occ-louise",
      speechDelivery: SPEECH_DELIVERY.CONFIRMED_NOT_HEARD,
      heardConfirmed: false,
    });
  });

  it("refuses to treat barge-in of started playback as heard even through the pure transition", () => {
    const started = markPlaybackStarted(markSpeechQueued(beginGeneratedSpeech(FULL_SENTENCE)));
    const stopped = applyBargeIn(started);
    expect(stopped.text).toBe(FULL_SENTENCE);
    expect(stopped.heardCompletely).toBe(false);
    expect(markHeardCompletely(stopped)).toMatchObject({ phase: "interrupted", heardCompletely: false });
  });
});

describe("relay session lifecycle", () => {
  it("passes the shared session into the speech source and does not decide the prompt", async () => {
    const speak = vi.fn(async () => "Noted.");
    const identity = claireVoiceSession({
      tenantId: "tenant-1",
      operatorUserId: "adam-admin",
      conversationId: "conv-2",
    });
    const session = new ConversationRelayVoiceTransport().openSession({
      identity,
      source: singleChunkSpeechSource(speak),
      openingText: "Hey Adam. What's up?",
    });
    await session.handle({ type: "setup" });
    const reply = await session.handle({ type: "prompt", voicePrompt: "What should I do first?", last: true });
    expect(reply).toEqual([{ type: "text", token: "Noted.", last: true, preemptible: false }]);
    expect(speak).toHaveBeenCalledWith({ ...identity, utterance: "What should I do first?" });
    expect(session.speech?.heardCompletely).toBe(false);
    expect(session.speech?.phase).toBe("queued");
  });

  it("treats silence, partial prompts, and DTMF as transport events with no speech and no dial", async () => {
    const speak = vi.fn(async () => "should-not-speak");
    const session = new ConversationRelayVoiceTransport().openSession({
      identity: claireVoiceSession({ tenantId: "t", operatorUserId: "op", conversationId: "c" }),
      source: singleChunkSpeechSource(speak),
      openingText: "Opening.",
    });
    expect(await session.handle({ type: "dtmf", digit: "1" })).toEqual([]);
    expect(await session.handle({ type: "prompt", voicePrompt: "   ", last: true })).toEqual([]);
    expect(await session.handle({ type: "prompt", voicePrompt: "still talking", last: false })).toEqual([]);
    expect(speak).not.toHaveBeenCalled();
    expect(session.lifecycle.map(event => event.kind)).toEqual(["dtmf", "silence", "partial_prompt"]);
  });
});

describe("webhooks and dialer boundary", () => {
  it("accepts a valid Twilio webhook signature and rejects an invalid one", () => {
    const authToken = "auth_test";
    const url = "https://api.example.test/api/claire/twilio/inbound";
    const body = { CallSid: "CA_ok", From: "+13105550001", To: "+13105550000" };
    expect(
      isValidTwilioWebhook({
        authToken,
        signature: twilio.getExpectedTwilioSignature(authToken, url, body),
        urls: [url],
        body,
        nodeEnv: "production",
      })
    ).toBe(true);
    expect(
      isValidTwilioWebhook({
        authToken,
        signature: "not-a-real-signature",
        urls: [url],
        body,
        nodeEnv: "production",
      })
    ).toBe(false);
    expect(
      isValidTwilioWebhook({
        authToken,
        signature: "",
        urls: [url],
        body,
        nodeEnv: "production",
      })
    ).toBe(false);
  });

  it("does not add an autonomous Claire dialer", () => {
    const voiceDir = [
      "claireVoiceSession.ts",
      "claireSpeechLifecycle.ts",
      "claireStreamingSpeechSource.ts",
      "conversationRelaySession.ts",
      "claireVoiceTransport.ts",
      "conversationRelaySignature.ts",
      "conversationRelayFrames.ts",
      "conversationRelayRuntime.ts",
      "conversationRelayUpgrade.ts",
    ];
    const source = voiceDir
      .map(name => readFileSync(new URL(`./${name}`, import.meta.url), "utf8"))
      .join("\n");
    expect(source).not.toContain("calls.create");
    expect(source).not.toContain("getTwilioPlatformClient");
    expect(source).not.toContain("startClairePreDriveCall");
    expect(source).not.toContain("runClaireTurn");
    expect(source).not.toContain("from \"./reasoning\"");
    expect(source).not.toContain("from \"./voiceCommitmentLoop\"");
    expect(source).not.toContain("weeklyMission");
    expect(source).not.toContain("dailyCommand");
    expect(source).not.toContain("<Stream");
  });
});
