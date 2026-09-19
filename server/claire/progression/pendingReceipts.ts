import type { DisclosureReceipt } from "./personalReveal";

/**
 * Delivery boundary for phone reveals. A reveal is reserved when its answer
 * clears validation, but it is only committed (fragment marked disclosed,
 * entitlement consumed) once the NEXT turn of the same call arrives, because
 * Twilio requests the next turn only after the previous line was spoken. If
 * the call drops or TTS fails first, the reservation simply expires back to
 * "unused" (see releaseExpiredReservations) — a lost delivery never burns a reveal.
 */
const pending = new Map<string, DisclosureReceipt[]>();

export function stashPendingDisclosure(conversationKey: string, receipt: DisclosureReceipt): void {
  pending.set(conversationKey, [...(pending.get(conversationKey) ?? []), receipt]);
}

export async function commitPendingDisclosures(conversationKey: string): Promise<number> {
  const receipts = pending.get(conversationKey) ?? [];
  pending.delete(conversationKey);
  let committed = 0;
  for (const receipt of receipts) {
    try {
      if (await receipt.commit()) committed += 1;
    } catch {
      // Commit failure must never surface mid-call; the reservation TTL returns it to unused.
    }
  }
  return committed;
}

export async function abandonPendingDisclosures(conversationKey: string): Promise<void> {
  const receipts = pending.get(conversationKey) ?? [];
  pending.delete(conversationKey);
  await Promise.all(receipts.map(receipt => receipt.abandon().catch(() => false)));
}

export function pendingDisclosureCountForTesting(conversationKey: string): number {
  return pending.get(conversationKey)?.length ?? 0;
}
