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
export function lintPostGenerationStateVerbs(
  generatedText: string,
  inventory: VerifiedFactInventory
): { pass: boolean; violations: string[] } {
  const violations: string[] = [];
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
      patterns: [/\bI(?:'ve|\s+have)\s+completed\b/i, /\bmarked (?:it|that|them) done\b/i],
    },
  ];

  for (const check of checks) {
    if (check.patterns.some(pattern => pattern.test(generatedText)) && !inventory.hasVerifiedClaim(check.state) && !(check.state === "completed" && inventory.hasVerifiedClaim("created")) && !(check.state === "created" && inventory.hasVerifiedClaim("completed"))) {
      violations.push(`State verb '${check.label}' claimed without verified write receipt`);
    }
  }

  // Deterministic commit renderer may say "Done." only when a created/completed receipt exists.
  if (/\bdone\.\s/i.test(generatedText) && !inventory.hasVerifiedClaim("created") && !inventory.hasVerifiedClaim("completed") && /\b(?:line|saved|marked)\b/i.test(generatedText)) {
    violations.push("State verb 'done' claimed without verified write receipt");
  }

  return {
    pass: violations.length === 0,
    violations,
  };
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
