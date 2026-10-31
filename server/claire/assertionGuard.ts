/**
 * Assertion Guard & Verified Fact Inventory (Guardrail G4)
 *
 * Enforces order of operations:
 * verify facts -> give Claire verified facts -> generate speech (never the reverse).
 *
 * Claire receives a verified fact inventory: each factual entry has a claim id,
 * provenance, and epistemic status (`verified | pending | unknown`).
 *
 * State-changing assertions (sent / queued / scheduled / created / counted) may be supplied
 * to generation only after `assertionGuard` verifies them against written state.
 *
 * Post-generation lint is defense-in-depth only.
 */

export type ClaimedState = "queued" | "scheduled" | "sent" | "created" | "counted" | "updated" | "removed" | "completed" | "replied";
export type EpistemicStatus = "verified" | "pending" | "unknown";

/**
 * Someone outside the business the operator wrote to (or who wrote back), named in the operator's own mail. A claim
 * about a counterpart is scoped to them: it licenses speech only in a clause that names them, and never the claim
 * class at large ("the note to Elena was sent" says nothing about any other message).
 */
export type InventoryCounterpart = { name: string | null; address: string | null };

export type WriteReceipt = {
  writtenAt: string | Date;
  entityId: string;
  confirmedState: ClaimedState;
  writeRef?: string;
};

export type AssertionCheckInput = {
  claimedState: ClaimedState;
  entityRef: string;
  sourceSnapshotId?: string | null;
  writeReceipt?: WriteReceipt | null;
  writtenTruthStatus?: ClaimedState | "draft" | "pending" | "not_found" | null;
};

export type FactInventoryEntry = {
  claimId: string;
  statement: string;
  entityRef: string;
  status: EpistemicStatus;
  claimedState?: ClaimedState;
  provenance: string;
  /** Set only on a claim about one named counterpart; see InventoryCounterpart. */
  counterpart?: InventoryCounterpart;
};

export class AssertionGuard {
  /**
   * Verify an assertion against written state.
   */
  static verifyClaim(input: AssertionCheckInput): EpistemicStatus {
    // 1. Direct write receipt confirming the exact state
    if (input.writeReceipt && input.writeReceipt.confirmedState === input.claimedState) {
      return "verified";
    }

    // 2. Authoritative written truth status
    if (input.writtenTruthStatus === input.claimedState) {
      return "verified";
    }

    // 3. Draft or pending state means not yet verified
    if (
      input.writtenTruthStatus === "draft" ||
      input.writtenTruthStatus === "pending" ||
      input.writeReceipt != null
    ) {
      return "pending";
    }

    if (input.writtenTruthStatus === "not_found") {
      return "unknown";
    }

    return "unknown";
  }
}

/**
 * Builds a structured VerifiedFactInventory from raw candidates.
 */
export class VerifiedFactInventoryBuilder {
  private entries: FactInventoryEntry[] = [];

  addClaim(entry: {
    claimId: string;
    statement: string;
    entityRef: string;
    claimedState: ClaimedState;
    provenance: string;
    writeReceipt?: WriteReceipt | null;
    writtenTruthStatus?: ClaimedState | "draft" | "pending" | "not_found" | null;
    sourceSnapshotId?: string | null;
    counterpart?: InventoryCounterpart;
  }): this {
    const status = AssertionGuard.verifyClaim({
      claimedState: entry.claimedState,
      entityRef: entry.entityRef,
      sourceSnapshotId: entry.sourceSnapshotId,
      writeReceipt: entry.writeReceipt,
      writtenTruthStatus: entry.writtenTruthStatus,
    });

    this.entries.push({
      claimId: entry.claimId,
      statement: entry.statement,
      entityRef: entry.entityRef,
      status,
      claimedState: entry.claimedState,
      provenance: entry.provenance,
      ...(entry.counterpart ? { counterpart: entry.counterpart } : {}),
    });
    return this;
  }

  addGeneralFact(entry: {
    claimId: string;
    statement: string;
    entityRef: string;
    status: EpistemicStatus;
    provenance: string;
  }): this {
    this.entries.push(entry);
    return this;
  }

  build(): VerifiedFactInventory {
    return new VerifiedFactInventory([...this.entries]);
  }
}

export class VerifiedFactInventory {
  constructor(public readonly entries: readonly FactInventoryEntry[]) {}

  get verifiedEntries(): FactInventoryEntry[] {
    return this.entries.filter(e => e.status === "verified");
  }

  get pendingEntries(): FactInventoryEntry[] {
    return this.entries.filter(e => e.status === "pending");
  }

  get unknownEntries(): FactInventoryEntry[] {
    return this.entries.filter(e => e.status === "unknown");
  }

  /**
   * Without an entityRef this answers for the claim class at large, so a counterpart-scoped claim never counts: the
   * operator's own note to one person being sent does not license "the outreach was sent".
   */
  hasVerifiedClaim(claimedState: ClaimedState, entityRef?: string): boolean {
    return this.entries.some(
      e =>
        e.status === "verified" &&
        e.claimedState === claimedState &&
        (entityRef ? e.entityRef === entityRef : !e.counterpart)
    );
  }

  /** Claims of this state about named counterparts (the operator's own correspondents). */
  counterpartClaims(claimedState: ClaimedState): FactInventoryEntry[] {
    return this.entries.filter(e => e.claimedState === claimedState && Boolean(e.counterpart));
  }

  getClaim(claimId: string): FactInventoryEntry | undefined {
    return this.entries.find(e => e.claimId === claimId);
  }

  /**
   * Generates prompt instructions representing the inventory.
   * State changes can be asserted as fact ONLY if status is verified.
   */
  toPromptSection(): string {
    const lines: string[] = ["### VERIFIED FACT INVENTORY (GUARDRAIL G4)"];

    if (this.entries.length === 0) {
      lines.push("No specific state assertions provided.");
      return lines.join("\n");
    }

    lines.push("Rule: Only cite 'VERIFIED' items as accomplished facts.");
    lines.push("For 'PENDING' or 'UNKNOWN', phrase non-committally (e.g. 'I am setting that up', 'I will look into that').");

    for (const entry of this.entries) {
      lines.push(
        `- [${entry.status.toUpperCase()}] (${entry.claimId}) ${entry.statement} (ref: ${entry.entityRef}, provenance: ${entry.provenance})`
      );
    }

    return lines.join("\n");
  }
}

export type MutationReceipt = {
  claimedState: ClaimedState;
  entityId: string;
  statement: string;
};

export function inventoryPlusReceipts(
  inventory: VerifiedFactInventory,
  receipts: readonly MutationReceipt[] | undefined
): VerifiedFactInventory {
  if (!receipts?.length) return inventory;
  const builder = new VerifiedFactInventoryBuilder();
  for (const entry of inventory.entries) {
    if (entry.claimedState) {
      builder.addClaim({
        claimId: entry.claimId,
        statement: entry.statement,
        entityRef: entry.entityRef,
        claimedState: entry.claimedState,
        provenance: entry.provenance,
        writtenTruthStatus: entry.status === "verified" ? entry.claimedState : entry.status === "pending" ? "pending" : "not_found",
        counterpart: entry.counterpart,
      });
    } else {
      builder.addGeneralFact(entry);
    }
  }
  for (const receipt of receipts) {
    builder.addClaim({
      claimId: `receipt:${receipt.claimedState}:${receipt.entityId}`,
      statement: receipt.statement,
      entityRef: receipt.entityId,
      claimedState: receipt.claimedState,
      provenance: "mutation_receipt",
      writeReceipt: {
        writtenAt: new Date().toISOString(),
        entityId: receipt.entityId,
        confirmedState: receipt.claimedState,
      },
      writtenTruthStatus: receipt.claimedState,
    });
  }
  return builder.build();
}

/**
 * Defense-in-depth: mutation verbs in speech require a verified claim for that same class of write.
 * Free-form model prose may discuss an action but may not originate added/saved/sent/scheduled/updated/removed/done.
 */
const FREE_FORM_MUTATION_SUCCESS_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "added", pattern: /\bI(?:'ve|\s+have)?\s+added\b/i },
  { label: "saved", pattern: /\bI(?:'ve|\s+have)?\s+saved\b/i },
  { label: "sent", pattern: /\bI(?:'ve|\s+have)?\s+sent\b/i },
  { label: "scheduled", pattern: /\bI(?:'ve|\s+have)?\s+scheduled\b/i },
  { label: "queued", pattern: /\bI(?:'ve|\s+have)?\s+queued\b/i },
  { label: "updated", pattern: /\bI(?:'ve|\s+have)?\s+updated\b/i },
  { label: "removed", pattern: /\bI(?:'ve|\s+have)?\s+(?:removed|deleted)\b/i },
  { label: "completed", pattern: /\bI(?:'ve|\s+have)?\s+completed\b/i },
  { label: "marked done", pattern: /\bmarked (?:it|that|them) done\b/i },
  { label: "adding to the Day Line", pattern: /\badding to the day ?line\b/i },
  { label: "sent to", pattern: /^sent to\b/i },
  { label: "commit-renderer Done", pattern: /\bdone\.\s[^\n]*\bline\b/i },
  { label: "commit-renderer Done (named items)", pattern: /^done\.\s+(?:added|recorded as|marked done|already saved)\b/i },
  { label: "commit-renderer Recorded as", pattern: /^recorded as\b[^\n]*:/i },
  { label: "Added prefix", pattern: /^Added:\s/i },
  { label: "Updated prefix", pattern: /^Updated:\s/i },
  { label: "Changed prefix", pattern: /^Changed it to\b/i },
  { label: "Removed prefix", pattern: /^Removed\b[^\n]*\bDay Line\b/i },
  { label: "Saved prefix", pattern: /^Saved(?:\.|\s+as\b|\s+on\b)/i },
  { label: "Day Line put confirmation", pattern: /^I put\b[^\n]*\bfollow-up\b[^\n]*\bline\b/i },
  { label: "pipeline move confirmation", pattern: /^I moved\b[^\n]*\bfollow-up\b[^\n]*\bpipeline\b/i },
];

export function lintPostGenerationStateVerbs(
  generatedText: string,
  inventory: VerifiedFactInventory
): { pass: boolean; violations: string[] } {
  const violations: string[] = [];

  // Free-form / model-generated speech may describe verified historical state, but it may not
  // originate a first-person/current mutation-success claim. Those claims belong exclusively to
  // typed mutation results rendered by a deterministic receipt-backed renderer. A static inventory
  // entry for task A must never license "I added task B" simply because both are classed "created".
  for (const check of FREE_FORM_MUTATION_SUCCESS_PATTERNS) {
    if (check.pattern.test(generatedText)) {
      violations.push(`Free-form mutation success claim '${check.label}' must come from a receipt-backed renderer`);
    }
  }
  const checks: Array<{ state: ClaimedState; label: string; patterns: RegExp[] }> = [
    {
      state: "sent",
      label: "sent",
      patterns: [
        /\bI(?:'ve|\s+have)\s+sent\b/i,
        /\bI\s+sent\b/i,
        /\balready\s+sent\b/i,
        /\bwas\s+sent\b/i,
        /^sent to\b/i,
        /\bsent to engineering\b/i,
      ],
    },
    {
      state: "queued",
      label: "queued",
      patterns: [/\bI(?:'ve|\s+have)\s+queued\b/i, /\bI\s+queued\b/i, /\bare\s+queued\b/i, /\bhave\s+been\s+queued\b/i],
    },
    {
      state: "scheduled",
      label: "scheduled",
      patterns: [/\bI(?:'ve|\s+have)\s+scheduled\b/i, /\bI\s+scheduled\b/i, /\bhas\s+been\s+scheduled\b/i],
    },
    {
      state: "created",
      label: "added/saved",
      patterns: [
        /\badding to the day ?line\b/i,
        /\badded (?:it|that|them|those|this)\b/i,
        /\bI(?:'ve|\s+have)\s+added\b/i,
        /\bI added\b/i,
        /\bI(?:'ve|\s+have)?\s+saved\b/i,
        /\bI saved\b/i,
      ],
    },
    {
      state: "updated",
      label: "updated",
      patterns: [/\bI(?:'ve|\s+have)\s+updated\b/i, /\bI\s+updated\b/i],
    },
    {
      state: "removed",
      label: "removed",
      patterns: [/\bI(?:'ve|\s+have)\s+removed\b/i, /\bI\s+removed\b/i, /\bI(?:'ve|\s+have)\s+deleted\b/i],
    },
    {
      state: "completed",
      label: "completed",
      patterns: [/\bI(?:'ve|\s+have)\s+completed\b/i, /\bI completed\b/i, /\bmarked (?:it|that|them) done\b/i],
    },
  ];

  for (const check of checks) {
    if (check.patterns.some(pattern => pattern.test(generatedText)) && !inventory.hasVerifiedClaim(check.state)) {
      // A send to one of the operator's own correspondents is licensed only by that person's own verified send, and
      // only in the clause that names them; every other word of the text is judged exactly as before.
      if (check.state === "sent" && !check.patterns.some(pattern => pattern.test(withoutLicensedCounterpartSends(generatedText, check.patterns, inventory)))) {
        continue;
      }
      violations.push(`State verb '${check.label}' claimed without verified write receipt`);
    }
  }
  violations.push(...lintCounterpartClaims(generatedText, inventory));

  // Model/free-form speech must not use commit-renderer "Done. N on … line" phrasing without inventory proof.
  if (/\bdone\.\s/i.test(generatedText) && !inventory.hasVerifiedClaim("created") && !inventory.hasVerifiedClaim("completed") && /\b(?:line|saved|marked)\b/i.test(generatedText)) {
    violations.push("State verb 'done' claimed without verified write receipt");
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}

// ------------------------------------------------------------------ claims about the operator's own correspondents

/**
 * Claims about a named counterpart are judged clause by clause, and only a plain assertion counts: a question, a
 * negation ("Elena hasn't replied"), a hedge or condition ("if Elena replies", "you're waiting on Elena") and
 * reported speech ("you said Elena replied") are never read as the claim. Ambiguity (a clause naming people the
 * evidence disagrees about) leaves the clause to the checks that existed before. Lexical, so defence in depth only:
 * the prompt rule and the fact inventory are the primary constraint.
 */
type Clause = { start: number; end: number; text: string; question: boolean };

const NEGATED = /\b(?:not|never|no|nothing|none|neither|nor|without|yet to)\b|n't\b/i;
/** What follows one of these is a condition or a time, not the claim: "if Elena replies", "once it's sent". */
const SUBORDINATE = /\b(?:if|once|when|whenever|after|before|until|unless|whether)\b/i;
const HEDGED =
  /\b(?:wait|waits|waiting|awaiting|expect|expecting|expected|hope|hoping|hopefully|might|may|maybe|perhaps|could|would|should|probably|likely|supposed)\b/i;
const REPORTED = /\b(?:you|they|she|he)\s+(?:said|say|says|mentioned|told me|reported|think|thought)\b|\baccording to you\b/i;
const NAME_STOPWORDS = new Set([
  "the", "a", "an", "and", "of", "for", "to", "at", "from", "via", "team", "inc", "llc", "ltd", "co", "company", "group",
  "mr", "mrs", "ms", "dr", "jr", "sr", "support", "info", "office", "sales", "admin", "hello", "hi", "your", "you", "my",
  "our", "service", "services", "customer", "care", "help",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sentences (a period inside an address or a figure does not end one), then clauses within them. */
function clausesOf(text: string): Clause[] {
  const out: Clause[] = [];
  for (const sentence of text.matchAll(/(?:[^.!?\n]|[.!?](?=\S))+[.!?]*/g)) {
    const base = sentence.index ?? 0;
    const body = sentence[0];
    const question = /\?\s*$/.test(body);
    let from = 0;
    for (const cut of body.matchAll(/[,;:()]|\s[—–-]\s|\b(?:but|and|while|though|although|whereas)\b/gi)) {
      const at = cut.index ?? 0;
      out.push({ start: base + from, end: base + at, text: body.slice(from, at), question });
      from = at + cut[0].length;
    }
    out.push({ start: base + from, end: base + body.length, text: body.slice(from), question });
  }
  return out.filter(clause => clause.text.trim());
}

/** Where a counterpart is named in a clause: their address, their full name, or one of their own name words. */
function occurrencesOf(text: string, who: InventoryCounterpart): Array<{ start: number; end: number }> {
  const patterns: RegExp[] = [];
  const address = who.address?.trim();
  if (address) patterns.push(new RegExp(`(?<![\\p{L}\\p{N}._%+-])${escapeRegExp(address)}(?![\\p{L}\\p{N}@])`, "giu"));
  const name = who.name?.replace(/\s+/g, " ").trim();
  if (name && !name.includes("@")) {
    const forms = new Set([name, ...name.split(" ").filter(word => word.length >= 2 && !NAME_STOPWORDS.has(word.toLowerCase()))]);
    for (const form of forms) {
      // as a name is written: "Elena", never the word "elena" inside other speech
      const written = form.charAt(0).toUpperCase() + form.slice(1);
      patterns.push(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(written)}(?![\\p{L}\\p{N}])`, "gu"));
    }
  }
  return patterns.flatMap(pattern => [...text.matchAll(pattern)].map(match => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length })));
}

const REPLY_VERB = /^((?:\s+[\p{L}'-]+){0,3}?)\s+(?:replied|wrote\s+back|written\s+back|responded|got\s+back|gotten\s+back)(?![\p{L}])/iu;
const REPLY_NOUN_BEFORE = /(?:heard\s+back|\b(?:a|an|the|her|his|their)\s+(?:reply|response|answer))\s+from\s+$/iu;
const REPLY_POSSESSIVE_AFTER = /^'s\s+(?:reply|response|answer|email|message|note)\s+(?:came|arrived|landed|is\s+in|is\s+here|got\s+here)(?![\p{L}])/iu;
const NOT_THE_REPLIER = /\b(?:you|i|we|was|were|been|being|is|are|be)\b/i;

/** "Elena replied", "Elena has written back", "you heard back from Elena", "Elena's reply came in". */
function assertsReplyFrom(text: string, who: InventoryCounterpart): boolean {
  return occurrencesOf(text, who).some(at => {
    const after = text.slice(at.end);
    const verb = REPLY_VERB.exec(after);
    if (verb && !NOT_THE_REPLIER.test(verb[1] ?? "")) return true;
    return REPLY_NOUN_BEFORE.test(text.slice(0, at.start)) || REPLY_POSSESSIVE_AFTER.test(after);
  });
}

const OUTBOUND_BEFORE = /\b(?:to|for|sent)\s+$/i;
const SEND_VERB = /\b(?:sent|went|gone\s+out|has\s+gone|is\s+out|(?:was|got)\s+delivered)\b/i;

/** "your note to Elena went on Friday", "you sent Elena the quote", "the message for Elena was sent". */
function assertsSendTo(text: string, who: InventoryCounterpart): boolean {
  return SEND_VERB.test(text) && occurrencesOf(text, who).some(at => OUTBOUND_BEFORE.test(text.slice(0, at.start)));
}

function sameCounterpart(a: InventoryCounterpart, b: InventoryCounterpart): boolean {
  const address = (value: string | null) => value?.trim().toLowerCase() || null;
  const name = (value: string | null) => value?.replace(/\s+/g, " ").trim().toLowerCase() || null;
  return Boolean((address(a.address) && address(a.address) === address(b.address)) || (name(a.name) && name(a.name) === name(b.name)));
}

type CounterpartVerdict = { who: InventoryCounterpart; status: EpistemicStatus };

/**
 * Per person, the best their own evidence says (verified > pending > unknown): verified means it was seen (a send
 * receipt, a reply in their inbox); pending means reported but not confirmed (the operator said they sent it), which
 * neither licenses nor contradicts; unknown means their evidence shows none.
 */
function counterpartVerdicts(inventory: VerifiedFactInventory, state: ClaimedState): CounterpartVerdict[] {
  const rank: Record<EpistemicStatus, number> = { verified: 2, pending: 1, unknown: 0 };
  const out: CounterpartVerdict[] = [];
  for (const claim of inventory.counterpartClaims(state)) {
    const known = out.find(verdict => sameCounterpart(verdict.who, claim.counterpart!));
    if (!known) out.push({ who: claim.counterpart!, status: claim.status });
    else if (rank[claim.status] > rank[known.status]) known.status = claim.status;
  }
  return out;
}

/** The part of a clause that plainly asserts something, or null: its main clause, unless negated, hedged or reported. */
function assertedPart(clause: Clause): string | null {
  if (clause.question) return null;
  const cut = SUBORDINATE.exec(clause.text);
  const main = cut ? clause.text.slice(0, cut.index) : clause.text;
  if (!main.trim() || NEGATED.test(main) || HEDGED.test(main) || REPORTED.test(main)) return null;
  return main;
}

const OUTBOUND_TARGET = /\b(?:to|for|sent)\s+(\p{Lu}[\p{L}'-]*)/gu;
/**
 * A send the operator made themselves (their own Sent folder, or a note they approved) licenses "your note went",
 * never Claire or JOYSTICK claiming to have sent it: first-person or Claire-as-agent clauses are never licensed.
 */
const SPEAKER_AS_SENDER = /\b(?:I|I've|I'd|I'll|me|we|we've|we'd|us|Claire|JOYSTICK)\b/;

/** Every named recipient in the clause ("to Elena", "for Marco") is one of these people. */
function onlyTheseRecipients(text: string, people: InventoryCounterpart[]): boolean {
  const spans = people.flatMap(who => occurrencesOf(text, who));
  return [...text.matchAll(OUTBOUND_TARGET)].every(match => {
    const at = (match.index ?? 0) + match[0].length - match[1]!.length;
    return spans.some(span => span.start <= at && at < span.end);
  });
}

/**
 * The text with every clause blanked that (a) itself makes a class-level sent claim and (b) is a send to a named
 * counterpart whose own send is verified, naming no one whose send is not. What remains is checked as before.
 */
function withoutLicensedCounterpartSends(generatedText: string, patterns: RegExp[], inventory: VerifiedFactInventory): string {
  const verdicts = counterpartVerdicts(inventory, "sent");
  if (!verdicts.some(verdict => verdict.status === "verified")) return generatedText;
  const text = generatedText.replace(/[’‘]/g, "'");
  // offsets from matchAll are UTF-16 code units; masking by code unit keeps them aligned
  const units = text.split("");
  for (const clause of clausesOf(text)) {
    if (!patterns.some(pattern => pattern.test(clause.text))) continue;
    const named = verdicts.filter(verdict => occurrencesOf(clause.text, verdict.who).length > 0);
    if (!named.length || named.some(verdict => verdict.status !== "verified")) continue;
    if (!named.some(verdict => assertsSendTo(clause.text, verdict.who))) continue;
    if (!onlyTheseRecipients(clause.text, named.map(verdict => verdict.who))) continue;
    if (SPEAKER_AS_SENDER.test(clause.text)) continue;
    for (let index = clause.start; index < clause.end; index++) units[index] = "#";
  }
  return units.join("");
}

/**
 * Against the operator's own correspondence: a reply from a named person may not be stated when their evidence shows
 * none seen, nor a send to them when their evidence shows none made. People the correspondence doesn't mention are
 * left alone (other evidence may speak for them), and so is a send the operator reported but Google hasn't confirmed.
 */
function lintCounterpartClaims(generatedText: string, inventory: VerifiedFactInventory): string[] {
  const replied = counterpartVerdicts(inventory, "replied");
  const sent = counterpartVerdicts(inventory, "sent");
  if (!replied.some(verdict => verdict.status === "unknown") && !sent.some(verdict => verdict.status === "unknown")) return [];
  const asserted = clausesOf(generatedText.replace(/[’‘]/g, "'"))
    .map(assertedPart)
    .filter((text): text is string => Boolean(text));
  const violations: string[] = [];
  const judge = (verdicts: CounterpartVerdict[], asserts: (text: string, who: InventoryCounterpart) => boolean, label: (who: string) => string) => {
    for (const verdict of verdicts) {
      if (verdict.status !== "unknown") continue;
      const claimed = asserted.some(text => {
        if (!asserts(text, verdict.who)) return false;
        // a clause that also names someone whose evidence does support it is ambiguous: left to the checks before this
        return !verdicts.some(other => other.status !== "unknown" && occurrencesOf(text, other.who).length > 0);
      });
      if (claimed) violations.push(label(verdict.who.name ?? verdict.who.address ?? "a correspondent"));
    }
  };
  judge(replied, assertsReplyFrom, who => `Reply from ${who} claimed, but no reply from them has been seen`);
  judge(sent, assertsSendTo, who => `Send to ${who} claimed, but their evidence shows no send`);
  return violations;
}

/**
 * Defense-in-depth for deterministic mutation confirmation only (`speakBriefingCommit` output).
 * Receipts must match the operation class described — no cross-authorization between created/completed.
 */
export function lintReceiptBackedCommitSpeech(
  commitText: string,
  receipts: readonly MutationReceipt[]
): { pass: boolean; violations: string[] } {
  const text = commitText.trim();
  if (!text) return { pass: true, violations: [] };

  const violations: string[] = [];
  const created = receipts.filter(receipt => receipt.claimedState === "created");
  const completed = receipts.filter(receipt => receipt.claimedState === "completed");
  const updated = receipts.filter(receipt => receipt.claimedState === "updated");
  const removed = receipts.filter(receipt => receipt.claimedState === "removed");
  const sent = receipts.filter(receipt => receipt.claimedState === "sent");
  const scheduled = receipts.filter(receipt => receipt.claimedState === "scheduled");

  if (/\bI(?:'ve|\s+have)\s+added\b/i.test(text) || /\badding to the day ?line\b/i.test(text) || /\bI(?:'ve|\s+have)\s+completed\b/i.test(text)) {
    violations.push("Commit renderer must not use free-form added/completed phrasing");
  }

  if (/^Added:\s/i.test(text) && created.length < 1) {
    violations.push("Added confirmation without a created receipt");
  }
  if ((/^Updated:\s/i.test(text) || /^Changed it to\b/i.test(text)) && updated.length < 1) {
    violations.push("Update confirmation without an updated receipt");
  }
  if (/^Removed\b[^\n]*\bDay Line\b/i.test(text) && removed.length < 1) {
    violations.push("Removal confirmation without a removed receipt");
  }
  if (/^Sent to engineering\b/i.test(text) && sent.length < 1) {
    violations.push("Engineering send confirmation without a sent receipt");
  }
  if (/^I saved the request\b/i.test(text) && created.length < 1) {
    violations.push("Engineering save confirmation without a created receipt");
  }
  if (/^Saved as operator-attested\b/i.test(text) && created.length + updated.length < 1) {
    violations.push("Field-save confirmation without a created/updated receipt");
  }
  if (/^Saved\.\s+[^\n]*\bfollow-up is on\b/i.test(text)) {
    if (created.length < 1) violations.push("Account follow-up Day Line save without a created receipt");
    if (scheduled.length < 1) violations.push("Account follow-up pipeline schedule without a scheduled receipt");
  }
  if (/^Saved on\b[^\n]*\bline\b/i.test(text) && created.length < 1) {
    violations.push("Account follow-up Day Line save without a created receipt");
  }
  if (/^I put\b[^\n]*\bfollow-up\b[^\n]*\bline\b/i.test(text) && created.length < 1) {
    violations.push("Account follow-up Day Line put confirmation without a created receipt");
  }
  if (/^I moved\b[^\n]*\bfollow-up\b[^\n]*\bpipeline\b/i.test(text) && scheduled.length < 1) {
    violations.push("Account follow-up pipeline move confirmation without a scheduled receipt");
  }

  if (/\bmarked done\b/i.test(text)) {
    const countMatch = /(\d+)\s+marked done/i.exec(text);
    const need = countMatch ? Number(countMatch[1]) : 1;
    if (completed.length < need) {
      violations.push("marked done without matching completed receipts");
    }
  }

  if (/^Done\./i.test(text)) {
    if (!created.length && !completed.length) {
      violations.push("Done summary without mutation receipts");
    }
    const aside = /That's (\d+) new items? in all/i.exec(text);
    if (aside && created.length + completed.length < Number(aside[1])) {
      violations.push("Day Line count aside exceeds created receipts");
    }
    const lineCounts = [...text.matchAll(/(\d+)\s+on(?:\s+\w+'s)?\s+line/gi)];
    if (lineCounts.length) {
      const totalOnLine = lineCounts.reduce((sum, match) => sum + Number(match[1]), 0);
      if (created.length < totalOnLine) {
        violations.push("Day Line counts exceed created receipts");
      }
    }
  }

  if (/\bI saved \d+/i.test(text) && created.length + completed.length === 0) {
    violations.push("partial save summary without receipts");
  }

  return { pass: violations.length === 0, violations };
}

const CLOCK_CLAIM = /\b(?:it's|it is)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i;

export function lintSpokenClock(
  generatedText: string,
  localTime: string | null | undefined
): { pass: boolean; violations: string[] } {
  const match = CLOCK_CLAIM.exec(generatedText);
  if (!match || !localTime?.trim()) return { pass: true, violations: [] };
  const claimed = match[1]!.replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const canonical = localTime.replace(/\./g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const hour12 = canonical.replace(/^0/, "");
  if (canonical.includes(claimed) || claimed.includes(hour12) || hour12.includes(claimed.split(" ")[0]!)) {
    return { pass: true, violations: [] };
  }
  // Compare hour loosely: "10:02 AM" vs "10 AM"
  const claimedHour = /^(\d{1,2})/.exec(claimed)?.[1];
  const localHour = /(\d{1,2})/.exec(canonical)?.[1];
  const claimedMeridiem = /am|pm/.exec(claimed)?.[0];
  const localMeridiem = /am|pm/.exec(canonical)?.[0];
  if (claimedHour && localHour && claimedHour === localHour && (!claimedMeridiem || claimedMeridiem === localMeridiem)) {
    return { pass: true, violations: [] };
  }
  return { pass: false, violations: [`Spoken clock '${match[1]}' contradicts operator-local time '${localTime}'`] };
}
