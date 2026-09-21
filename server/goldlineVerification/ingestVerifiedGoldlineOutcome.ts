/**
 * Downstream Narrator ingestion after an authoritative Goldline mutation.
 *
 * Narrator is not on the business critical path. If persistence fails after
 * the real mutation succeeded, this helper never throws to the caller and
 * never asks the business system to roll back.
 */
import { recordVerifiedGoldlineOutcome } from "../narratorOs/ledger";
import type { VerifiedGoldlineReceipt } from "../narratorOs/verifiedGoldlineReceipt";
import type { NarratorStore, OperatorScope } from "../narratorOs/store";

export type GoldlineNarratorIngestResult =
  | { recorded: true; receiptId: string }
  | { recorded: false; receiptId: string; reason: string };

/**
 * Persist a legitimately issued production receipt into the Narrator ledger.
 * Does not fire beats, mutate WORLD_TRUTH, mutate Claire lived biography,
 * or produce Claire speech.
 */
export async function ingestVerifiedGoldlineOutcome(input: {
  store: NarratorStore;
  scope: OperatorScope;
  receipt: VerifiedGoldlineReceipt;
}): Promise<void> {
  await recordVerifiedGoldlineOutcome({
    store: input.store,
    scope: input.scope,
    receipt: input.receipt,
  });
}

/**
 * Best-effort ingest for production mutation call sites. Catch-and-log only.
 * Call after the business write has already succeeded.
 */
export async function ingestVerifiedGoldlineOutcomeBestEffort(input: {
  store: NarratorStore;
  scope: OperatorScope;
  receipt: VerifiedGoldlineReceipt;
}): Promise<GoldlineNarratorIngestResult> {
  try {
    await ingestVerifiedGoldlineOutcome(input);
    return { recorded: true, receiptId: input.receipt.receiptId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      "[goldlineVerification] Narrator ingest failed after business mutation; business truth is unchanged",
      { receiptId: input.receipt.receiptId, reason }
    );
    return { recorded: false, receiptId: input.receipt.receiptId, reason };
  }
}
