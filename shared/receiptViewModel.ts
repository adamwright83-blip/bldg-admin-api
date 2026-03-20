/**
 * Vendor-neutral receipt view model for BLDG / resident surfaces.
 *
 * **BldgReceiptViewModel** is the intended public abstraction: branding and copy
 * come from data (payload, vendor config, building config), not from hard-coded
 * vendor strings inside the paper component.
 *
 * **LaundryButlerReceiptViewModel** / **LaundryButlerReceiptLine** are legacy
 * aliases of the same shapes. They exist for this repo’s laundry vertical only
 * and must not be treated as the long-term cross-vendor contract name in
 * app.bldg.chat or other consumers.
 */

/** One line on the receipt (vendor-neutral). */
export type BldgReceiptLine = {
  item: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

/**
 * Vendor-neutral receipt payload rendered by a generic receipt paper component.
 * `order.serviceType` is a vendor-defined label key or short code (e.g. wash_fold).
 */
export type BldgReceiptViewModel = {
  schemaVersion: 1;
  branding: {
    /** Main header — from data (e.g. vendor display name), not hard-coded in UI */
    title: string;
    /** Service or category subtitle — from data */
    serviceSubtitle: string;
    businessName: string;
    addressLine1: string;
    addressLine2: string;
    phoneDisplay: string;
  };
  order: {
    id: number;
    customerName: string;
    /** Vendor-specific; e.g. wash_fold | dry_cleaning for Laundry Butler */
    serviceType: string;
  };
  meta: {
    /**
     * ISO 8601 — when the customer originally placed the order (`orders.createdAt`).
     * Not card charge time or processing completion time.
     */
    orderPlacedAt: string;
    dueDisplay: string;
    /** e.g. "03/14/26, 11:35PM, Card" or "Pending" */
    paymentDisplay: string;
  };
  lines: BldgReceiptLine[];
  totals: {
    subtotal: string;
    discount: string;
    total: string;
    payment: string;
  };
  footerMessage: string;
};

/** @deprecated Use {@link BldgReceiptLine}. Laundry vertical legacy name only. */
export type LaundryButlerReceiptLine = BldgReceiptLine;

/** @deprecated Use {@link BldgReceiptViewModel}. Laundry vertical legacy name only. */
export type LaundryButlerReceiptViewModel = BldgReceiptViewModel;
