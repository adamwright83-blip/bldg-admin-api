/**
 * Brand token for VerifiedGoldlineReceipt. Not a factory. Production index
 * does not re-export this module. Assembly of receipts belongs only in
 * test support (env-gated) or a later trusted Goldline adapter.
 */
export const VERIFIED_GOLDLINE_RECEIPT_BRAND: unique symbol = Symbol(
  "narratorOs.VerifiedGoldlineReceipt"
);
