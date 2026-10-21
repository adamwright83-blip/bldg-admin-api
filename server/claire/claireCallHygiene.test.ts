/**
 * Call hygiene at the Twilio boundary — replays of real production calls.
 *
 *   D13  2026-10-19 07:30 PT morning_readiness 453795a2: Claire's call reached Adam's voicemail
 *        and she spoke eight more times to its prompts across 19 turns.
 *   D16  2026-10-15 17:30 PT pre_drive 958159a5: "Go ahead, I'm listening." landed 3-10 seconds
 *        after her own reply, twice, because every empty Gather webhook got a prompt.
 *   D17  18 inbound / ad hoc sessions sat `in_progress` with no `endedAt` since 2026-10-01.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "./turn/conversationStateStore";
import { issueClaireToken } from "./claireToken";

const AUTH_TOKEN = "auth_test";

const hoisted = vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "auth_test";
  process.env.CLAIRE_TWILIO_FROM_NUMBER = "+13105550000";
  process.env.CLAIRE_OPERATOR_PHONE = "+13105550001";
  process.env.JWT_SECRET = "test-secret-long-enough-for-signing";
  return {
    endCallLedger: vi.fn(async (_input: Record<string, unknown>) => undefined),
    finalizeLedger: vi.fn(async (_input: Record<string, unknown>) => undefined),
    persistBoth: vi.fn(async (_input: Record<string, unknown>) => undefined),
    runClaireTurn: vi.fn(async () => {
      throw new Error("a voicemail prompt must never reach a Claire turn");
    }),
  };
});

vi.mock("../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "test-secret",
    xaiApiKey: "",
    claireXaiTtsEnabled: false,
    claireXaiTtsVoiceId: "eve",
    ownerOpenId: "adam-admin",
  },
}));

vi.mock("twilio", async importOriginal => {
  const actual = (await importOriginal()) as { default?: Record<string, unknown> } & Record<string, unknown>;
  const real = (actual.default ?? actual) as Record<string, unknown>;
  const factory = Object.assign(() => ({ calls: { create: vi.fn() } }), real, { twiml: real.twiml });
  return { ...actual, default: factory };
});

vi.mock("./conversation/ledgerService", () => ({
  createConversationSession: vi.fn(async () => undefined),
  attachCallSid: vi.fn(async () => undefined),
  attachConversationKind: vi.fn(async () => undefined),
  persistSpokenTurn: vi.fn(async () => undefined),
}));

vi.mock("./turn/claireTurn", async importOriginal => {
  const actual = await importOriginal<typeof import("./turn/claireTurn")>();
  return { ...actual, runClaireTurn: (...args: unknown[]) => (hoisted.runClaireTurn as (...a: unknown[]) => unknown)(...args) };
});

vi.mock("./conversation/liveCall", () => ({
  safeClaireLedger: async (work: () => Promise<unknown>) => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  },
  persistOperatorAndClaire: (input: Record<string, unknown>) => hoisted.persistBoth(input),
  linkClaireCallAction: vi.fn(async () => undefined),
  linkClaireActionIds: vi.fn(async () => undefined),
  endClaireCallLedger: (input: Record<string, unknown>) => hoisted.endCallLedger(input),
  finalizeClaireCallLedger: (input: Record<string, unknown>) => hoisted.finalizeLedger(input),
}));

vi.mock("./conversation/pipeline", () => ({
  handleCallCompleted: vi.fn(async () => undefined),
  handleRecordingStatus: vi.fn(async () => undefined),
}));

import {
  isOutboundConversation,
  registerClaireRoutes,
  renderConversationRelayConnectAction,
  runRelayAuthoritativeTurn,
} from "./claireTwilio";
import { claireConversationStateStore } from "./turn/conversationStateStore";
import { BOUNDED_VOICEMAIL_TEXT, looksLikeVoicemailPrompt, voicemailTurnDecision } from "./amdVoicemail";
import { QUIET_AFTER_SPEECH_MS, estimateClaireSpeechMs, silencePromptDecision } from "./voice/silencePrompt";

const TENANT = "laundry_farm";
const OPERATOR = "adam-admin";

function stateKey(conversationId: string) {
  return `claire-call:${conversationId}`;
}

async function seedCall(conversationId: string, over: Record<string, unknown> = {}) {
  await claireConversationStateStore().save(
    stateKey(conversationId),
    { tenantId: TENANT, operatorUserId: OPERATOR, surface: "voice" },
    {
      tenantId: TENANT,
      actorId: OPERATOR,
      dayDirectorActorId: "42",
      brief: "This week is about: Get to 50 active customers.",
      context: { phase: "pre_drive", businessDate: "2026-10-19", blockers: [], relevantTimeline: [], nextFixedCommitment: null },
      turns: 0,
      touchedAt: Date.now(),
      sessionKind: "morning_readiness",
      inboundContextReady: true,
      history: [{ speaker: "claire", text: "Good morning, it's Claire. This week is about: Get to 50 active customers.", at: Date.now() - 20_000 }],
      ...over,
    },
    60 * 60 * 1000
  );
}

beforeEach(() => {
  setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
  hoisted.endCallLedger.mockClear();
  hoisted.finalizeLedger.mockClear();
  hoisted.persistBoth.mockClear();
});

afterEach(() => {
  setClaireConversationStateStoreForTests(null);
  vi.useRealTimers();
});

/** Operator-slot transcripts of session 453795a2, turns 2-18, verbatim. */
const VOICEMAIL_TURNS_453795A2 = [
  "You've reached Adam. Leave a message, and I'll call you right back.",
  "You have reached the maximum time permitted for recording your message.",
  "If you're satisfied with the message, press 1. To listen to your message, press 2.",
  "Erase and rerecord, press 3.",
  "If you're satisfied with the message, press 1.",
  "To listen to your message, press 2. To erase and rerecord, press 3.",
  "Sorry you're having trouble. Your message has been sent.",
];

describe("D13 — a voicemail greeting is never answered twice (session 453795a2)", () => {
  it("recognises every real voicemail prompt from that call", () => {
    for (const text of VOICEMAIL_TURNS_453795A2) {
      expect(looksLikeVoicemailPrompt(text), text).toBe(true);
    }
  });

  it("does not mistake a human for a mailbox", () => {
    for (const text of [
      "Hey Claire, it's Adam.",
      "Did you get my voicemail?",
      "Leave it for now, I'll deal with it after lunch.",
      "I sent a message to Dana yesterday.",
      "Press on with the Louise follow-up.",
      "Yes.",
    ]) {
      expect(looksLikeVoicemailPrompt(text), text).toBe(false);
    }
  });

  it("an inbound caller can never be a mailbox", () => {
    expect(voicemailTurnDecision({ utterance: VOICEMAIL_TURNS_453795A2[0]!, outbound: false, alreadyDetected: false })).toEqual({ action: "none" });
  });

  it("the live call: one bounded line, the call ends, and every later prompt gets silence", async () => {
    await seedCall("vm-call");
    const spoken: string[] = [];
    let ended = false;
    for (const prompt of VOICEMAIL_TURNS_453795A2) {
      const turn = await runRelayAuthoritativeTurn({ conversationId: "vm-call", utterance: prompt, callSid: "CA_vm", token: "t" });
      if (turn.speak) spoken.push(turn.speak);
      expect(turn.endCall).toBe(true);
      ended = ended || turn.endCall;
    }
    expect(ended).toBe(true);
    // At most one Claire line after recognition, and it is the bounded voicemail message.
    expect(spoken).toEqual([BOUNDED_VOICEMAIL_TEXT]);
    // The call was completed with the voicemail reason; no Claire turn ever ran.
    expect(hoisted.endCallLedger).toHaveBeenCalled();
    expect(hoisted.endCallLedger.mock.calls.every(call => call[0].reason === "voicemail_detected")).toBe(true);
    expect(hoisted.runClaireTurn).not.toHaveBeenCalled();
  });

  it("only an outbound call is eligible (brief present or a scheduled kind)", () => {
    expect(isOutboundConversation({ brief: "Good morning.", sessionKind: undefined })).toBe(true);
    expect(isOutboundConversation({ brief: null, sessionKind: "evening_debrief" })).toBe(true);
    expect(isOutboundConversation({ brief: null, sessionKind: "pre_drive" })).toBe(false);
  });
});

describe("D16 — Claire never speaks into silence right after she spoke (session 958159a5)", () => {
  const REPLY_A = "Done. 7 on today's line.";
  const REPLY_B = "Before I leave work, I have to create new page for Laundry Farm is on the line.";

  it("replays the real timings: 3 s and 10 s after her reply are quiet, never a prompt", () => {
    for (const [reply, elapsedMs] of [
      [REPLY_A, 3_000],
      [REPLY_A, 6_000],
      [REPLY_B, 3_000],
      [REPLY_B, 10_000],
    ] as const) {
      expect(
        silencePromptDecision({ nowMs: 1_000_000 + elapsedMs, lastClaire: { text: reply, at: 1_000_000 }, promptedSinceOperator: false }),
        `${elapsedMs}ms after "${reply}"`
      ).toBe("listen_quietly");
    }
  });

  it("the window starts when she finishes speaking: a long reply gets a longer grace", () => {
    expect(estimateClaireSpeechMs(REPLY_B)).toBeGreaterThan(estimateClaireSpeechMs(REPLY_A));
    const at = 0;
    const done = estimateClaireSpeechMs(REPLY_B);
    expect(silencePromptDecision({ nowMs: done + QUIET_AFTER_SPEECH_MS - 1, lastClaire: { text: REPLY_B, at }, promptedSinceOperator: false })).toBe("listen_quietly");
    expect(silencePromptDecision({ nowMs: done + QUIET_AFTER_SPEECH_MS, lastClaire: { text: REPLY_B, at }, promptedSinceOperator: false })).toBe("prompt");
  });

  it("never prompts twice in a row", () => {
    expect(silencePromptDecision({ nowMs: 10 * 60_000, lastClaire: { text: REPLY_A, at: 0 }, promptedSinceOperator: true })).toBe("listen_quietly");
  });

  describe("through the real pre-drive webhook", () => {
    type Handler = (req: unknown, res: unknown) => Promise<unknown>;
    const routes = () => {
      const map = new Map<string, Handler>();
      registerClaireRoutes({ post: (path: string, handler: Handler) => map.set(path, handler), get: () => undefined } as never);
      return map;
    };
    async function emptyGather(handlers: Map<string, Handler>, token: string) {
      const path = "/api/claire/twilio/pre-drive";
      const originalUrl = `${path}?token=${encodeURIComponent(token)}`;
      const body = { CallSid: "CA_gap", SpeechResult: "" };
      const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, `https://api.example.test${originalUrl}`, body);
      const res = { body: "", statusCode: 200, type() { return this; }, status(code: number) { this.statusCode = code; return this; }, send(text: string) { this.body = text; return this; } };
      await handlers.get(path)!(
        { query: { token }, body, headers: { "x-twilio-signature": signature }, protocol: "https", get: () => "api.example.test", originalUrl },
        res
      );
      return res.body;
    }

    it("quiet at +3 s and +9 s, one prompt once her speech is long over, then the call ends instead of a second prompt", async () => {
      vi.useFakeTimers();
      const t0 = new Date("2026-10-15T17:30:00.000Z").getTime();
      vi.setSystemTime(t0);
      await seedCall("gap-call", {
        sessionKind: "pre_drive",
        history: [
          { speaker: "operator", text: "Add it.", at: t0 - 2_000 },
          { speaker: "claire", text: REPLY_A, at: t0 },
        ],
      });
      const token = issueClaireToken({ kind: "pre_drive_conversation", tenantId: TENANT, userId: OPERATOR, conversationId: "gap-call" });
      const handlers = routes();

      vi.setSystemTime(t0 + 3_000);
      const first = await emptyGather(handlers, token);
      expect(first).not.toContain("Go ahead, I'm listening.");
      expect(first).toContain("<Gather");

      vi.setSystemTime(t0 + 9_000);
      const second = await emptyGather(handlers, token);
      expect(second).not.toContain("Go ahead, I'm listening.");

      vi.setSystemTime(t0 + 20_000);
      const prompt = await emptyGather(handlers, token);
      expect(prompt).toContain("Go ahead, I'm listening.");

      vi.setSystemTime(t0 + 30_000);
      const after = await emptyGather(handlers, token);
      expect(after).not.toContain("Go ahead, I'm listening.");
      expect(after).not.toContain("<Gather");
      expect(after).toContain("I'll let you focus on the drive");
      expect(hoisted.endCallLedger).toHaveBeenCalledWith(expect.objectContaining({ reason: "empty_transcript" }));
    });
  });
});

describe("D17 — a closed relay completes the session (inbound calls never get Twilio's completed callback)", () => {
  it("finalizes the ledger with a relay_closed reason when the Connect action reports ended", async () => {
    await seedCall("relay-call", { brief: null, sessionKind: "pre_drive" });
    const token = issueClaireToken({ kind: "pre_drive_conversation", tenantId: TENANT, userId: OPERATOR, conversationId: "relay-call" });
    const twiml = await renderConversationRelayConnectAction({
      token,
      body: { CallSid: "CA_relay", SessionStatus: "ended" },
    });
    expect(twiml).toContain("<Hangup");
    expect(hoisted.finalizeLedger).toHaveBeenCalledWith(
      expect.objectContaining({ claireConversationId: "relay-call", callSid: "CA_relay", reason: "relay_closed" })
    );
  });
});
