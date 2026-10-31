import { formatInTimeZone } from "date-fns-tz";
import type { AwaitingReplies, SignupKnowledgeBriefing } from "../../shared/firstTenMinutesKnowledge";
import { CLAIRE_BUSINESS_TIME_ZONE, type ClaireDriveContext, type ClaireTimelineItem } from "./contextAssembler";
import {
  lintPostGenerationStateVerbs,
  lintReceiptBackedCommitSpeech,
  lintSpokenClock,
  type InventoryCounterpart,
  type MutationReceipt,
  VerifiedFactInventory,
  VerifiedFactInventoryBuilder,
} from "./assertionGuard";

export const G4_UNVERIFIED_STATE_VERB_FALLBACK =
  "I won't claim that happened until it's written. What do we actually know?";

/**
 * Assemble Guardrail G4 inventory from already-assembled Claire context.
 * Does not invent write receipts. Outreach is never verified-as-sent here —
 * drafts stay pending. Scheduled field items may be verified as scheduled
 * only when Field Today / the snapshot already recorded a scheduledAt.
 */
export function buildClaireVerifiedFactInventory(
  context: ClaireDriveContext | null | undefined
): VerifiedFactInventory {
  const builder = new VerifiedFactInventoryBuilder();
  if (!context) return builder.build();

  const seen = new Set<string>();

  const identity = context.identityTruth;
  if (identity) {
    builder.addGeneralFact({
      claimId: "identity:platform:joystick",
      statement: `${identity.platform.productName} is the ${identity.platform.productDefinition}`,
      entityRef: "platform:joystick",
      status: "verified",
      provenance: "claire.identityTruth.platform",
    });
    builder.addGeneralFact({
      claimId: "identity:platform:goldline",
      statement: `${identity.platform.gameName} is ${identity.platform.gameDefinition} and is not the operator business name`,
      entityRef: "platform:goldline",
      status: "verified",
      provenance: "claire.identityTruth.platform",
    });
    builder.addGeneralFact({
      claimId: "identity:platform:claire",
      statement: `${identity.platform.claireName} is the ${identity.platform.claireRole}`,
      entityRef: "platform:claire",
      status: "verified",
      provenance: "claire.identityTruth.platform",
    });
    identity.tenant.businesses.forEach((business, index) => {
      builder.addGeneralFact({
        claimId: `identity:tenant:business:${index + 1}`,
        statement:
          business.registeredName === business.brandName
            ? `Registered business/brand: ${business.brandName}`
            : `Registered business: ${business.registeredName}; operating brand: ${business.brandName}`,
        entityRef: `tenant:${identity.tenant.tenantId}`,
        status: "verified",
        provenance: `claire.identityTruth.${business.provenance}`,
      });
    });
  }
  const addScheduled = (item: Pick<ClaireTimelineItem, "id" | "title" | "scheduledAt">, provenance: string) => {
    if (!item.scheduledAt) return;
    const claimId = `scheduled:${item.id}`;
    if (seen.has(claimId)) return;
    seen.add(claimId);
    builder.addClaim({
      claimId,
      statement: `${item.title} is on the calendar at ${item.scheduledAt}`,
      entityRef: item.id,
      claimedState: "scheduled",
      provenance,
      writtenTruthStatus: "scheduled",
    });
  };

  if (context.nextFixedCommitment) {
    addScheduled(context.nextFixedCommitment, "field_today.nextFixedCommitment");
  }
  for (const item of context.relevantTimeline ?? []) {
    addScheduled(item, "field_today.relevantTimeline");
  }
  for (const item of context.workPicture?.today.items ?? []) {
    addScheduled(item, "field_today.today");
  }
  for (const item of context.strategySnapshot?.payload.commitments.today ?? []) {
    if (!item.scheduledAt) continue;
    const claimId = `scheduled:${item.id}`;
    if (seen.has(claimId)) continue;
    seen.add(claimId);
    builder.addClaim({
      claimId,
      statement: `${item.title} is scheduled`,
      entityRef: item.id,
      claimedState: "scheduled",
      provenance: "strategy_snapshot.commitments",
      writtenTruthStatus: "scheduled",
    });
  }

  for (const item of context.runtime?.workItems ?? []) {
    if (!item.alreadyExists) continue;
    builder.addClaim({
      claimId: `created:${item.id}`,
      statement: `${item.title} already exists on the work picture`,
      entityRef: item.id,
      claimedState: "created",
      provenance: "claire.runtime.workItems",
      writtenTruthStatus: "created",
    });
  }

  const outcome = context.mission?.visitOutcome;
  if (outcome?.outcome) {
    builder.addGeneralFact({
      claimId: `visit-outcome:${context.mission!.id}`,
      statement: `Visit outcome recorded as ${outcome.outcome}`,
      entityRef: `mission:${context.mission!.id}`,
      status: "verified",
      provenance: "commercial_mission.visitOutcome",
    });
  }

  if (context.signupKnowledge) addSignupKnowledge(builder, context.signupKnowledge);
  if (context.awaitingReplies) addAwaitingReplies(builder, context.awaitingReplies, context.clock?.timeZone ?? CLAIRE_BUSINESS_TIME_ZONE);

  // Rook / recovery drafts are prepared, never sent, unless a write receipt exists.
  builder.addClaim({
    claimId: "outreach-sent:default",
    statement: "Customer outreach has been sent",
    entityRef: "outreach:unspecified",
    claimedState: "sent",
    provenance: "claire_proactive_doctrine",
    writtenTruthStatus: "draft",
  });

  builder.addClaim({
    claimId: "queue-unspecified",
    statement: "Claire queued an action",
    entityRef: "queue:unspecified",
    claimedState: "queued",
    provenance: "assertion_guard.default",
    writtenTruthStatus: "not_found",
  });

  return builder.build();
}

/** Words from someone's mailbox, made safe to quote in a single inventory line. */
function plain(value: string, max = 160): string {
  const words = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return words.length > max ? `${words.slice(0, max - 1)}…` : words;
}

/**
 * What JOYSTICK's crew read at signup. Every fact keeps its finding id as its receipt; only the operator's own
 * confirmation (or correction) makes one verified, and even then it is history, not current business truth. The
 * note they prepared is a send to one named person: verified only on Google's own send receipt, pending on the
 * operator's report, unknown while it has not left. A reply to it is verified only when one was seen; "none seen" is
 * not "no reply" either, so it stays unknown and Claire says nothing was seen, not that no one answered.
 */
function addSignupKnowledge(builder: VerifiedFactInventoryBuilder, signup: SignupKnowledgeBriefing): void {
  for (const fact of signup.facts) {
    const how = fact.status === "proposed" ? "only read, never confirmed by them" : fact.status === "changed" ? "the operator's own correction" : "confirmed by the operator";
    builder.addGeneralFact({
      claimId: `signup-fact:${fact.id}`,
      statement: `Signup history, not current business truth (${how}; ${fact.learnedAt}): ${plain(fact.statement)}`,
      entityRef: `first_ten_finding:${fact.id}`,
      status: fact.status === "proposed" ? "unknown" : "verified",
      provenance: `first_ten.signup_knowledge.${fact.status}`,
    });
  }

  const message = signup.message;
  if (!message) return;
  const to = plain(message.to, 80);
  const person = signup.opportunity?.person;
  // The briefing names the recipient by name, or by address when it has no name; the opportunity fills in the other.
  const counterpart: InventoryCounterpart = to.includes("@")
    ? { name: person && person.address.toLowerCase() === to.toLowerCase() ? person.name : null, address: to }
    : { name: to, address: person && person.name?.trim() === to ? person.address : null };
  const receipt = signup.opportunity ? `first_ten_finding:${signup.opportunity.factId}` : "first_ten:signup_message";
  const note = `The operator's signup note to ${to}`;

  builder.addClaim({
    claimId: "signup-message:sent",
    statement:
      message.sent && message.verified
        ? `${note} was sent on ${message.sentOn}; Google confirmed the send`
        : message.sent
          ? `${note}: the operator reported sending it on ${message.sentOn}; Google has not confirmed it`
          : message.declined
            ? `${note} was not sent: the operator chose to keep it`
            : `${note} is prepared and has not been sent`,
    entityRef: receipt,
    claimedState: "sent",
    provenance:
      message.sent && message.verified
        ? "first_ten.signup_knowledge.message (Google send receipt)"
        : message.sent
          ? "first_ten.signup_knowledge.message (operator report)"
          : "first_ten.signup_knowledge.message",
    // verified on Google's receipt; pending on the operator's own report (neither licensed nor contradicted); a note
    // still at the table or kept is not sent (unknown: the guard refuses a claim that it went)
    writtenTruthStatus: message.sent && message.verified ? "sent" : message.sent ? "pending" : "not_found",
    counterpart,
  });
  builder.addClaim({
    claimId: "signup-message:reply",
    statement:
      message.reply === "replied"
        ? `${to} replied to the operator's signup note${message.replyOn ? ` on ${message.replyOn}` : ""}`
        : message.reply === "bounced"
          ? `${note} bounced${message.replyOn ? ` on ${message.replyOn}` : ""}: it did not arrive, and no reply came`
          : message.reply === "none_seen"
            ? `No reply from ${to} to the operator's signup note has been seen; nothing seen is not "no reply"`
            : `${note} was not sent, so there is no reply to it`,
    entityRef: receipt,
    claimedState: "replied",
    provenance: "first_ten.signup_knowledge.message.reply",
    writtenTruthStatus: message.reply === "replied" ? "replied" : "not_found",
    counterpart,
  });
}

/**
 * Who the operator is waiting on and who wrote back, from their own Gmail as last read (checkedAt). Each person they
 * are waiting on is one real message in their Sent folder (a verified send, its Gmail message id the receipt) with no
 * reply seen in that thread as of checkedAt (unknown, never "no reply"). Each person who wrote back is one real
 * message in their inbox (a verified reply). Nothing beyond checkedAt is claimed either way.
 */
function addAwaitingReplies(builder: VerifiedFactInventoryBuilder, awaiting: AwaitingReplies, timeZone: string): void {
  if (awaiting.unavailable) return;
  const day = (iso: string) => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? iso : formatInTimeZone(at, timeZone, "yyyy-MM-dd");
  };
  const read = `read ${awaiting.checkedAt}`;
  for (const item of awaiting.items) {
    const who = plain(item.person.name ?? item.person.address, 80);
    const counterpart: InventoryCounterpart = { name: item.person.name ? plain(item.person.name, 80) : null, address: item.person.address };
    builder.addClaim({
      claimId: `awaiting:sent:${item.messageId}`,
      statement: `The operator emailed ${who} on ${day(item.sentAt)}; the message is in their Sent folder`,
      entityRef: `gmail:message:${item.messageId}`,
      claimedState: "sent",
      provenance: `gmail.sent_folder (${read})`,
      writtenTruthStatus: "sent",
      counterpart,
    });
    builder.addClaim({
      claimId: `awaiting:reply:${item.threadId}`,
      statement: `No reply from ${who} to that email had been seen when their Gmail was read on ${day(awaiting.checkedAt)} (waiting ${item.waitingDays} days)`,
      entityRef: `gmail:thread:${item.threadId}`,
      claimedState: "replied",
      provenance: `gmail.awaiting_replies (${read})`,
      writtenTruthStatus: "not_found",
      counterpart,
    });
  }
  for (const reply of awaiting.replies ?? []) {
    const who = plain(reply.person.name ?? reply.person.address, 80);
    builder.addClaim({
      claimId: `reply:${reply.messageId}`,
      statement: `${who} wrote back to the operator on ${day(reply.at)}; the message is in their inbox`,
      entityRef: `gmail:message:${reply.messageId}`,
      claimedState: "replied",
      provenance: `gmail.inbox (${read})`,
      writtenTruthStatus: "replied",
      counterpart: { name: reply.person.name ? plain(reply.person.name, 80) : null, address: reply.person.address },
    });
  }
}

export function assertPostGenerationStateVerbs(
  generatedText: string,
  inventory: VerifiedFactInventory
): void {
  const lint = lintPostGenerationStateVerbs(generatedText, inventory);
  if (!lint.pass) {
    throw new Error(`G4 unverified state verb: ${lint.violations.join("; ")}`);
  }
}

/** Free-form / model-generated speech — never merge turn mutation receipts into this lint. */
export function sanitizeConversationalSpeak(
  speak: string,
  inventory: VerifiedFactInventory,
  localTime?: string | null
): string {
  if (!speak.trim()) return speak;
  const lint = lintPostGenerationStateVerbs(speak, inventory);
  const clock = lintSpokenClock(speak, localTime);
  if (lint.pass && clock.pass) return speak;
  console.warn("[Claire] G4 post-generation lint failed", { violations: [...lint.violations, ...clock.violations] });
  return G4_UNVERIFIED_STATE_VERB_FALLBACK;
}

export function assembleGuardedClaireSpeak(input: {
  conversational: string;
  inventory: VerifiedFactInventory;
  localTime?: string | null;
  receiptBackedCommit?: string;
  mutationReceipts?: readonly MutationReceipt[];
}): string {
  const conversational = sanitizeConversationalSpeak(input.conversational, input.inventory, input.localTime);
  const commit = input.receiptBackedCommit?.trim();
  if (!commit) return conversational;
  const commitLint = lintReceiptBackedCommitSpeech(commit, input.mutationReceipts ?? []);
  if (!commitLint.pass) {
    console.warn("[Claire] G4 commit renderer lint failed", { violations: commitLint.violations });
    return conversational || G4_UNVERIFIED_STATE_VERB_FALLBACK;
  }
  return [conversational, commit].filter(Boolean).join(" ");
}

/** Desktop / non-voice paths with no separate commit renderer. */
export function sanitizeSpeakAgainstInventory(
  speak: string,
  inventory: VerifiedFactInventory,
  options: { localTime?: string | null } = {}
): string {
  return sanitizeConversationalSpeak(speak, inventory, options.localTime);
}
