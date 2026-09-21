/**
 * Brand token for an authorized Goldline producer capability.
 * Not a factory. Production barrels do not re-export this module.
 * Assembly of production capabilities is file-private and currently empty.
 * Tests assemble via env-gated test support only.
 */
export const GOLDLINE_PRODUCER_CAPABILITY_BRAND: unique symbol = Symbol(
  "goldlineVerification.ProducerCapability"
);
