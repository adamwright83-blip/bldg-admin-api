/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";
/** Receipt shapes aligned with resident-owned public contract; see receiptViewModel.ts */
export type {
  BldgReceiptLine,
  BldgReceiptViewModel,
  LaundryButlerReceiptLine,
  LaundryButlerReceiptViewModel,
} from "./receiptViewModel";
