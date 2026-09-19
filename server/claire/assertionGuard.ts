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

export type ClaimedState = "queued" | "scheduled" | "sent" | "created" | "counted" | "updated" | "removed" | "completed";
export type EpistemicStatus = "verified" | "pending" | "unknown";

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

  hasVerifiedClaim(claimedState: ClaimedState, entityRef?: string): boolean {
    return this.entries.some(
      e =>
        e.status === "verified" &&
        e.claimedState === claimedState &&
        (!entityRef || e.entityRef === entityRef)
    );
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

  // First-person / imperative mutation language is never licensed by static inventory.
  // Static context can prove that a state is true, but it cannot prove that Claire
  // performed the mutation being claimed in this turn. Those success sentences
  // come only from the deterministic receipt-backed commit renderer.
  const originatedMutationPatterns = [
    /\bI(?:'ve|\s+have)\s+(?:sent|queued|scheduled|added|saved|updated|removed|deleted|completed)\b/i,
    /\bI\s+(?:sent|queued|scheduled|added|saved|updated|removed|deleted|completed)\b/i,
    /\badding to the day ?line\b/i,
    /^sent to\b/i,
    /\bsent to engineering\b/i,
    /\bmarked (?:it|that|them) done\b/i,
  ];

  const originatedMutation = originatedMutationPatterns.some(pattern => pattern.test(generatedText));
  if (originatedMutation) {
    violations.push("Free-form speech may not originate mutation-success claims");
  }

  for (const check of checks) {
    if (
      check.patterns.some(pattern => pattern.test(generatedText)) &&
      !originatedMutation &&
      !inventory.hasVerifiedClaim(check.state)
    ) {
      violations.push(`State verb '${check.label}' claimed without verified written state`);
    }
  }

  // Model/free-form speech must not use commit-renderer "Done. N on … line" phrasing without inventory proof.
  if (/\bdone\.\s/i.test(generatedText) && !inventory.hasVerifiedClaim("created") && !inventory.hasVerifiedClaim("completed") && /\b(?:line|saved|marked)\b/i.test(generatedText)) {
    violations.push("State verb 'done' claimed without verified write receipt");
  }

  return {
    pass: violations.length === 0,
    violations,
  };
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
