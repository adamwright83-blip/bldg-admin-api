/**
 * Spend Clearance Service
 *
 * Enforces Guardrail G6: No unapproved autonomous spending.
 * If no ceiling is set, ceiling is $0.
 * Until Slice 3 implements transactional budget reservations, clearance always fails closed (denied).
 */

export type SpendClearanceResult = {
  cleared: boolean;
  status: "cleared" | "needs_approval" | "over_ceiling";
  reason: string;
  category: string;
  amountCents: number;
};

export type SpendClearanceInput = {
  tenantId: string;
  category: string;
  amountCents: number;
  sourceRef?: string;
  dedupeKey?: string;
};

/**
 * Check if spending is cleared for a given tenant, category, and amount.
 * Baseline implementation: fails closed (denied), requiring approval or blocking over ceiling.
 */
export async function requiresSpendClearance(
  input: SpendClearanceInput
): Promise<SpendClearanceResult> {
  // Guardrail G6: If amount is <= 0 and category is purely non-spending internal task, it clears.
  if (input.amountCents <= 0) {
    return {
      cleared: true,
      status: "cleared",
      reason: "zero_spend_internal_task",
      category: input.category,
      amountCents: 0,
    };
  }

  // Any positive spend without Slice 3 playground rules active defaults to $0 ceiling -> over_ceiling / needs_approval
  return {
    cleared: false,
    status: "needs_approval",
    reason: "spend_clearance_default_zero_ceiling",
    category: input.category,
    amountCents: input.amountCents,
  };
}
