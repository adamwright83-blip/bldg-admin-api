/**
 * A map refresh that dies with the process stays pending on the receipt.
 * The next boot or operator status read can see that row and try again.
 */
export type MapRefreshReceipt = {
  tenantId: string;
  requestId: string;
  receiptJson: unknown;
};

export function pendingMapRefreshTargets(rows: readonly MapRefreshReceipt[]): MapRefreshReceipt[] {
  const seen = new Set<string>();
  const pending: MapRefreshReceipt[] = [];
  for (const row of rows) {
    const receipt =
      row.receiptJson && typeof row.receiptJson === "object"
        ? (row.receiptJson as Record<string, unknown>)
        : null;
    if (!receipt) continue;
    if (receipt.status === "cancelled") continue;
    if (receipt.customerTruth !== "refreshed" || receipt.map !== "pending") continue;
    const key = `${row.tenantId}:${row.requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pending.push(row);
  }
  return pending;
}
