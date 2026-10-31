import { describe, expect, it, vi } from "vitest";
import {
  AWAITING_REPLIES_RULE,
  SIGNUP_KNOWLEDGE_RULE,
  type AwaitingReplies,
  type SignupKnowledgeBriefing,
} from "../../shared/firstTenMinutesKnowledge";
import { inventoryPlusReceipts, lintPostGenerationStateVerbs } from "./assertionGuard";
import type { ClaireDriveContext } from "./contextAssembler";
import { answerClairePreDriveFollowUp, contextKnowledgeRule } from "./preDriveConversation";
import {
  G4_UNVERIFIED_STATE_VERB_FALLBACK,
  assembleGuardedClaireSpeak,
  buildClaireVerifiedFactInventory,
} from "./verifiedFactInventoryFromContext";
import { defaultClaireTurnDeps, runClaireTurn } from "./turn/claireTurn";
import { productionClaireV2PrimaryDeps } from "./brain/live/primaryTurn";

/**
 * Claire's main turn engine (the phone, the mobile text line, Brain V2 on the desk) knows what JOYSTICK learned at
 * signup and who the operator is waiting on, as the Desk's showrunner does, and its assertion guard holds those
 * sources to what they actually show.
 */

const base: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: "2026-10-31T16:00:00.000Z",
  businessDate: "2026-10-31",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: null,
  blockers: [],
  relevantTimeline: [],
  mission: null,
};

type Message = NonNullable<SignupKnowledgeBriefing["message"]>;

function signup(message: Partial<Message> | null = {}): SignupKnowledgeBriefing {
  return {
    readAt: "2026-10-28",
    business: "Fixture Laundry",
    owner: "Sam",
    readFrom: ["google (sam@fixture.test)"],
    facts: [
      { id: "finding-confirmed", kind: "service", statement: "Wash and fold is $2.25 a pound", status: "confirmed", learnedAt: "2026-10-28", source: "Gmail, 2026-10-20" },
      { id: "finding-changed", kind: "customer", statement: "The Wilshire sends linens every Tuesday", status: "changed", learnedAt: "2026-10-28", source: null },
      { id: "finding-proposed", kind: "customer", statement: "Elena Park runs the front desk at The Wilshire", status: "proposed", learnedAt: "2026-10-28", source: null },
    ],
    moreFacts: 0,
    opportunity: {
      factId: "finding-opportunity",
      person: { name: "Elena Park", address: "elena@wilshire.test" },
      wants: "a quote for weekly linens",
      askedAt: "2026-10-26T17:00:00.000Z",
      subject: "Linens",
    },
    message:
      message === null
        ? null
        : { to: "Elena Park", subject: "Weekly linens", sent: true, declined: false, sentOn: "2026-10-30", verified: true, reply: "none_seen", replyOn: null, ...message },
  };
}

const NOT_SENT: Partial<Message> = { sent: false, sentOn: null, verified: false, reply: "not_sent" };

function awaiting(extra: Partial<AwaitingReplies> = {}): AwaitingReplies {
  return {
    checkedAt: "2026-10-31T16:00:00.000Z",
    account: "sam@fixture.test",
    items: [
      {
        person: { name: "Marco Diaz", address: "marco@hotel.test" },
        subject: "Pilot pricing",
        sentAt: "2026-10-24T18:00:00.000Z",
        waitingDays: 6,
        lastLine: "Could we start the pilot on Monday?",
        asked: true,
        messageId: "msg-sent-marco",
        threadId: "thread-marco",
        url: null,
      },
    ],
    replies: [],
    unavailable: null,
    scanned: { sent: 10, received: 20, days: 30 },
    ...extra,
  };
}

function marcoReply() {
  return { person: { name: "Marco Diaz", address: "marco@hotel.test" }, subject: "Re: Pilot pricing", at: "2026-10-31T15:00:00.000Z", snippet: "Monday works.", messageId: "msg-in-marco", threadId: "thread-marco", url: null };
}

const withSignup = (message: Partial<Message> | null = {}): ClaireDriveContext => ({ ...base, signupKnowledge: signup(message) });
const passes = (text: string, context: ClaireDriveContext | null) =>
  lintPostGenerationStateVerbs(text, buildClaireVerifiedFactInventory(context)).pass;

describe("fact inventory: signup knowledge and the operator's own mail, each with its receipt", () => {
  it("carries every signup fact under its finding id; only the operator's own confirmation or correction verifies one", () => {
    const inventory = buildClaireVerifiedFactInventory(withSignup());
    expect(inventory.getClaim("signup-fact:finding-confirmed")).toMatchObject({
      status: "verified",
      entityRef: "first_ten_finding:finding-confirmed",
      provenance: "first_ten.signup_knowledge.confirmed",
    });
    expect(inventory.getClaim("signup-fact:finding-confirmed")?.statement).toMatch(/history, not current business truth/);
    expect(inventory.getClaim("signup-fact:finding-changed")?.status).toBe("verified");
    expect(inventory.getClaim("signup-fact:finding-proposed")).toMatchObject({ status: "unknown", entityRef: "first_ten_finding:finding-proposed" });
    expect(inventory.getClaim("signup-fact:finding-proposed")?.statement).toMatch(/only read, never confirmed by them/);
    expect(inventory.getClaim("signup-fact:finding-changed")?.statement).toMatch(/the operator's own correction/);
  });

  it("a Google-confirmed signup send is verified for that recipient only, never for the claim class at large", () => {
    const inventory = buildClaireVerifiedFactInventory(withSignup());
    expect(inventory.getClaim("signup-message:sent")).toMatchObject({
      status: "verified",
      claimedState: "sent",
      entityRef: "first_ten_finding:finding-opportunity",
      counterpart: { name: "Elena Park", address: "elena@wilshire.test" },
    });
    expect(inventory.hasVerifiedClaim("sent", "first_ten_finding:finding-opportunity")).toBe(true);
    expect(inventory.hasVerifiedClaim("sent")).toBe(false);
    // the default outreach doctrine is untouched
    expect(inventory.getClaim("outreach-sent:default")?.status).toBe("pending");
  });

  it("an operator-reported send is pending, a note still at the table or kept is not a send, and none-seen is not a reply", () => {
    expect(buildClaireVerifiedFactInventory(withSignup({ verified: false })).getClaim("signup-message:sent")?.status).toBe("pending");
    expect(buildClaireVerifiedFactInventory(withSignup(NOT_SENT)).getClaim("signup-message:sent")?.status).toBe("unknown");
    expect(buildClaireVerifiedFactInventory(withSignup({ ...NOT_SENT, declined: true })).getClaim("signup-message:sent")?.statement).toMatch(/chose to keep it/);
    const noneSeen = buildClaireVerifiedFactInventory(withSignup()).getClaim("signup-message:reply");
    expect(noneSeen).toMatchObject({ status: "unknown", claimedState: "replied" });
    expect(noneSeen?.statement).toMatch(/nothing seen is not "no reply"/);
    expect(buildClaireVerifiedFactInventory(withSignup({ reply: "replied", replyOn: "2026-10-31" })).getClaim("signup-message:reply")?.status).toBe("verified");
  });

  it("each person the operator is waiting on is a verified send with no reply seen, receipts the Gmail message and thread ids", () => {
    const inventory = buildClaireVerifiedFactInventory({ ...base, awaitingReplies: awaiting({ replies: [] }) });
    expect(inventory.getClaim("awaiting:sent:msg-sent-marco")).toMatchObject({
      status: "verified",
      claimedState: "sent",
      entityRef: "gmail:message:msg-sent-marco",
      counterpart: { name: "Marco Diaz", address: "marco@hotel.test" },
    });
    expect(inventory.getClaim("awaiting:sent:msg-sent-marco")?.statement).toContain("2026-10-24");
    expect(inventory.getClaim("awaiting:reply:thread-marco")).toMatchObject({ status: "unknown", claimedState: "replied", entityRef: "gmail:thread:thread-marco" });
    expect(inventory.hasVerifiedClaim("sent")).toBe(false);
  });

  it("someone who wrote back is a verified reply, its receipt the Gmail message id", () => {
    const inventory = buildClaireVerifiedFactInventory({ ...base, awaitingReplies: awaiting({ items: [], replies: [marcoReply()] }) });
    expect(inventory.getClaim("reply:msg-in-marco")).toMatchObject({ status: "verified", claimedState: "replied", entityRef: "gmail:message:msg-in-marco" });
    expect(inventory.hasVerifiedClaim("replied")).toBe(false);
  });

  it("adds nothing when the fields are absent or Gmail could not be read", () => {
    const before = buildClaireVerifiedFactInventory(base).entries;
    expect(buildClaireVerifiedFactInventory({ ...base }).entries).toEqual(before);
    const unavailable = buildClaireVerifiedFactInventory({ ...base, awaitingReplies: awaiting({ items: [], unavailable: "Gmail isn't connected to this workspace." }) });
    expect(unavailable.entries).toEqual(before);
  });
});

describe("assertion guard: a send to someone the operator wrote to", () => {
  it("accepts the send when Google confirmed it", () => {
    expect(passes("Your note to Elena was sent on Friday.", withSignup())).toBe(true);
    expect(passes("Your note to Elena went on Friday.", withSignup())).toBe(true);
    expect(passes("You already sent Elena the note.", withSignup())).toBe(true);
  });

  it("rejects the same claim when the note was not sent or was kept", () => {
    expect(passes("Your note to Elena went on Friday.", withSignup(NOT_SENT))).toBe(false);
    expect(passes("Your note to Elena was sent on Friday.", withSignup(NOT_SENT))).toBe(false);
    expect(passes("Your note to Elena went out when you signed up.", withSignup(NOT_SENT))).toBe(false);
    expect(passes("Your note to Elena went on Friday.", withSignup({ ...NOT_SENT, declined: true }))).toBe(false);
  });

  it("still lets Claire say plainly that it hasn't gone", () => {
    expect(passes("Your note to Elena hasn't gone yet.", withSignup(NOT_SENT))).toBe(true);
    expect(passes("Your note to Elena is still waiting at the table.", withSignup(NOT_SENT))).toBe(true);
    expect(passes("Do you want your note to Elena to go today?", withSignup(NOT_SENT))).toBe(true);
    expect(passes("Elena sent you a message on the 26th.", withSignup(NOT_SENT))).toBe(true);
  });

  it("an operator-reported send is not contradicted, and still never licenses 'was sent'", () => {
    expect(passes("Your note to Elena went on Friday.", withSignup({ verified: false }))).toBe(true);
    expect(passes("Your note to Elena was sent on Friday.", withSignup({ verified: false }))).toBe(false);
  });

  it("licenses nothing beyond that person: other sends, first-person sends and other names are judged as before", () => {
    expect(passes("The win-back text to Sophie was sent.", withSignup())).toBe(false);
    expect(passes("Your note to Elena was sent and the win-back text to Sophie was sent too.", withSignup())).toBe(false);
    expect(passes("Your note to Elena with the win-back to Sophie was sent.", withSignup())).toBe(false);
    expect(passes("I sent your note to Elena.", withSignup())).toBe(false);
    expect(passes("I've sent your note to Elena.", withSignup())).toBe(false);
    expect(passes("Your note to Elena was sent by me on Friday.", withSignup())).toBe(false);
    expect(passes("Your note to Elena was sent on Friday.", base)).toBe(false);
  });

  it("an email in the operator's Sent folder is a verified send to that person", () => {
    const context = { ...base, awaitingReplies: awaiting() };
    expect(passes("Your email to Marco was sent on October 24.", context)).toBe(true);
    expect(passes("The recovery text to Sophie was sent.", context)).toBe(false);
  });
});

describe("assertion guard: a reply from someone the operator wrote to", () => {
  it("accepts a reply that was seen", () => {
    const replied = withSignup({ reply: "replied", replyOn: "2026-10-31" });
    expect(passes("Elena replied on Thursday.", replied)).toBe(true);
    expect(passes("Elena Park wrote back about the linens.", replied)).toBe(true);
    const marco = { ...base, awaitingReplies: awaiting({ items: [], replies: [marcoReply()] }) };
    expect(passes("Marco wrote back this morning: Monday works.", marco)).toBe(true);
  });

  it("rejects the same claim when no reply was seen, the note bounced, or it never went", () => {
    for (const message of [{}, { reply: "bounced" as const, replyOn: "2026-10-30" }, NOT_SENT]) {
      expect(passes("Elena replied on Thursday.", withSignup(message))).toBe(false);
    }
    expect(passes("Elena has written back.", withSignup())).toBe(false);
    expect(passes("You heard back from Elena yesterday.", withSignup())).toBe(false);
    expect(passes("Elena’s reply came in this morning.", withSignup())).toBe(false);
    expect(passes("Since Elena replied, the next step is the quote.", withSignup())).toBe(false);
    expect(passes("Good news: Elena got back to you.", withSignup())).toBe(false);
    expect(passes("Marco wrote back yesterday.", { ...base, awaitingReplies: awaiting() })).toBe(false);
    expect(passes("Elena hasn't replied, but Marco responded on Tuesday.", { ...base, awaitingReplies: awaiting() })).toBe(false);
  });

  it("a matching reply in the inbox outweighs a signup note with none seen", () => {
    const elena = { person: { name: "Elena Park", address: "elena@wilshire.test" }, subject: "Re: Weekly linens", at: "2026-10-31T15:00:00.000Z", snippet: "Yes please.", messageId: "msg-in-elena", threadId: "thread-elena", url: null };
    const context = { ...withSignup(), awaitingReplies: awaiting({ items: [], replies: [elena] }) };
    expect(passes("Elena replied on Thursday.", context)).toBe(true);
  });

  it("never blocks a true statement that no reply was seen, a question, a condition, or the operator's own reply", () => {
    const context = { ...withSignup(), awaitingReplies: awaiting() };
    for (const text of [
      "Elena hasn't replied yet.",
      "I haven't seen a reply from Elena.",
      "Has Elena replied?",
      "If Elena replies, send the quote.",
      "You replied to Elena on Friday.",
      "You said Elena replied.",
      "You're waiting to hear back from Marco Diaz, six days now.",
      "Marco hasn't written back since the 24th.",
    ]) {
      expect(passes(text, context), text).toBe(true);
    }
  });

  it("leaves people these sources don't mention, and contexts without them, exactly as before", () => {
    expect(passes("Sophie replied this morning.", { ...withSignup(), awaitingReplies: awaiting() })).toBe(true);
    expect(passes("Elena replied on Thursday.", base)).toBe(true);
  });
});

describe("main engine: the guard runs on what Claire actually says", () => {
  const turn = (context: ClaireDriveContext, speech: string) =>
    runClaireTurn(
      { tenantId: "tenant-1", operatorUserId: "op-1", dayDirectorActorId: "actor-1", utterance: "good morning", surface: "voice", state: {}, context, conversationKey: "signup-knowledge" },
      { doctrineTurn: async () => speech, now: () => new Date("2026-10-31T16:00:00.000Z"), timeZone: () => "America/Los_Angeles" }
    );

  it("runClaireTurn keeps a backed send and replaces the same send when the facts say it never went", async () => {
    expect((await turn(withSignup(), "Your note to Elena was sent on Friday.")).speak).toBe("Your note to Elena was sent on Friday.");
    expect((await turn(withSignup(NOT_SENT), "Your note to Elena went on Friday.")).speak).toBe(G4_UNVERIFIED_STATE_VERB_FALLBACK);
  });

  it("runClaireTurn keeps a seen reply and replaces an unseen one", async () => {
    expect((await turn(withSignup({ reply: "replied", replyOn: "2026-10-31" }), "Elena replied on Thursday.")).speak).toBe("Elena replied on Thursday.");
    expect((await turn(withSignup(), "Elena replied on Thursday.")).speak).toBe(G4_UNVERIFIED_STATE_VERB_FALLBACK);
  });

  it("Brain V2's guard (inventory plus this turn's write receipts) keeps the counterpart scope", () => {
    const receipts = [{ claimedState: "created" as const, entityId: "commitment-1", statement: "Call Elena added" }];
    const merged = inventoryPlusReceipts(buildClaireVerifiedFactInventory(withSignup()), receipts);
    expect(merged.hasVerifiedClaim("sent")).toBe(false);
    expect(assembleGuardedClaireSpeak({ conversational: "Your note to Elena was sent on Friday.", inventory: merged, mutationReceipts: receipts })).toBe(
      "Your note to Elena was sent on Friday."
    );
    expect(assembleGuardedClaireSpeak({ conversational: "Elena replied on Thursday.", inventory: merged, mutationReceipts: receipts })).toBe(
      G4_UNVERIFIED_STATE_VERB_FALLBACK
    );
    expect(assembleGuardedClaireSpeak({ conversational: "The win-back text to Sophie was sent.", inventory: merged, mutationReceipts: receipts })).toBe(
      G4_UNVERIFIED_STATE_VERB_FALLBACK
    );
  });
});

describe("main engine prompt: the rule rides with the field, and only with it", () => {
  it("runClaireTurn and Brain V2 both speak through the same guarded organ", () => {
    expect(defaultClaireTurnDeps().followUp).toBe(answerClairePreDriveFollowUp);
    expect(
      productionClaireV2PrimaryDeps({
        tenantId: "tenant-1",
        operatorUserId: "op-1",
        dayDirectorActorId: "actor-1",
        conversationKey: "k",
        timeZone: "America/Los_Angeles",
        surface: "text",
      }).speak
    ).toBe(answerClairePreDriveFollowUp);
  });

  it("points the Desk's rule lines at currentContext and changes nothing else", () => {
    const rule = contextKnowledgeRule(SIGNUP_KNOWLEDGE_RULE);
    expect(rule).not.toContain("BRIEFING.");
    expect(rule).toContain("currentContext.signupKnowledge is what JOYSTICK's crew read");
    expect(rule).toContain("currentContext.signupKnowledge.message is the message they prepared at signup");
    expect(rule.replace(/currentContext\./g, "BRIEFING.")).toBe(SIGNUP_KNOWLEDGE_RULE);
    const awaitingRule = contextKnowledgeRule(AWAITING_REPLIES_RULE);
    expect(awaitingRule).toContain("currentContext.awaitingReplies lists people");
    expect(awaitingRule.replace(/currentContext\./g, "BRIEFING.")).toBe(AWAITING_REPLIES_RULE);
  });

  async function prompt(context: ClaireDriveContext, extra: Partial<Parameters<typeof answerClairePreDriveFollowUp>[0]> = {}) {
    const invokeText = vi.fn().mockResolvedValue("Your note to Elena went on Friday; I haven't seen a reply.");
    await answerClairePreDriveFollowUp(
      { tenantId: "tenant-1", utterance: "Did Elena ever get back to me?", brief: null, context, ...extra },
      { invokeText, biographyVerifier: async () => true, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const messages = invokeText.mock.calls[0]![0].messages as Array<{ role: string; content: string }>;
    return { system: messages[0]!.content, current: JSON.parse(messages[messages.length - 1]!.content).currentContext };
  }

  it("carries both fields and both rules when both are present (the phone and text line, and Brain V2 on the desk)", async () => {
    const context = { ...withSignup(), awaitingReplies: awaiting() };
    for (const extra of [{}, { semanticAuthority: "brain_v2" as const, surface: "desktop" as const }]) {
      const { system, current } = await prompt(context, extra);
      expect(system).toContain(contextKnowledgeRule(SIGNUP_KNOWLEDGE_RULE));
      expect(system).toContain(contextKnowledgeRule(AWAITING_REPLIES_RULE));
      expect(system).not.toContain("BRIEFING.");
      expect(current.signupKnowledge).toEqual(context.signupKnowledge);
      expect(current.awaitingReplies).toEqual(context.awaitingReplies);
      expect(current.factInventory).toContain("(signup-message:sent)");
      expect(current.factInventory).toContain("(awaiting:reply:thread-marco)");
    }
  });

  it("carries neither field nor rule when they are absent", async () => {
    const { system, current } = await prompt(base);
    expect(system).not.toContain("signupKnowledge");
    expect(system).not.toContain("awaitingReplies");
    expect(current).not.toHaveProperty("signupKnowledge");
    expect(current).not.toHaveProperty("awaitingReplies");
  });

  it("carries each rule only with its own field", async () => {
    const onlyAwaiting = await prompt({ ...base, awaitingReplies: awaiting() });
    expect(onlyAwaiting.system).toContain(contextKnowledgeRule(AWAITING_REPLIES_RULE));
    expect(onlyAwaiting.system).not.toContain("currentContext.signupKnowledge");
    expect(onlyAwaiting.current).not.toHaveProperty("signupKnowledge");
    const onlySignup = await prompt(withSignup());
    expect(onlySignup.system).toContain(contextKnowledgeRule(SIGNUP_KNOWLEDGE_RULE));
    expect(onlySignup.system).not.toContain("currentContext.awaitingReplies");
    expect(onlySignup.current).not.toHaveProperty("awaitingReplies");
  });
});
