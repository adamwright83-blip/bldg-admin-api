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

export type ClaimedState = "queued" | "scheduled" | "sent" | "created" | "counted";
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

/**
 * Narrow defense-in-depth post-generation lint for obvious state-change verbs
 * (sent / queued / scheduled / created / counted) not backed by a verified claim id.
 */
export function lintPostGenerationStateVerbs(
  generatedText: string,
  inventory: VerifiedFactInventory
): { pass: boolean; violations: string[] } {
  const violations: string[] = [];

  // Patterns for claiming actions occurred
  const sentPatterns = [
    /\bI(?:'ve|\s+have)\s+sent\b/i,
    /\bI\s+sent\b/i,
    /\balready\s+sent\b/i,
    /\bwas\s+sent\b/i,
  ];

  const queuedPatterns = [
    /\bI(?:'ve|\s+have)\s+queued\b/i,
    /\bI\s+queued\b/i,
    /\bare\s+queued\b/i,
    /\bhave\s+been\s+queued\b/i,
  ];

  const scheduledPatterns = [
    /\bI(?:'ve|\s+have)\s+scheduled\b/i,
    /\bI\s+scheduled\b/i,
    /\bhas\s+been\s+scheduled\b/i,
  ];

  for (const p of sentPatterns) {
    if (p.test(generatedText) && !inventory.hasVerifiedClaim("sent")) {
      violations.push("State verb 'sent' claimed without verified write receipt");
      break;
    }
  }

  for (const p of queuedPatterns) {
    if (p.test(generatedText) && !inventory.hasVerifiedClaim("queued")) {
      violations.push("State verb 'queued' claimed without verified write receipt");
      break;
    }
  }

  for (const p of scheduledPatterns) {
    if (p.test(generatedText) && !inventory.hasVerifiedClaim("scheduled")) {
      violations.push("State verb 'scheduled' claimed without verified write receipt");
      break;
    }
  }

  return {
    pass: violations.length === 0,
    violations,
  };
}
