import type { ClaireDriveContext, ClaireTimelineItem } from "./contextAssembler";
import {
  lintPostGenerationStateVerbs,
  lintReceiptBackedCommitSpeech,
  lintSpokenClock,
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
