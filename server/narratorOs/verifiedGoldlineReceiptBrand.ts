/**
 * Brand token for VerifiedGoldlineReceipt. Not a factory. Production index
 * does not re-export this module. Assembly of receipts belongs only in the
 * Goldline verification issuer, test support (env-gated), or ledger
 * rehydration of already-ingested evidence. Rehydration is not issuance.
 */
export const VERIFIED_GOLDLINE_RECEIPT_BRAND: unique symbol = Symbol(
  "narratorOs.VerifiedGoldlineReceipt"
);
