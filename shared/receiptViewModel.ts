/**
 * Receipt view-model shapes **aligned with the resident (app.bldg.chat) public contract**.
 *
 * **Canonical ownership:** The resident app owns the long-term **`BldgReceiptViewModel`**
 * contract, generic **`ReceiptPaper`**, branding resolver, vendor-aware token expansion,
 * and mapper registry. This file duplicates the shapes for Laundry Butler admin tooling
 * and handoff — **keep in sync** with resident when the public contract changes.
 *
 * **This repo does not define the permanent BLDG public receipt API.** Admin is the
 * Laundry Butler **reference implementation** only.
 *
 * **LaundryButler*** names are **local / legacy aliases** — not the cross-vendor contract name.
 */

/** One line on the receipt (vendor-neutral public shape). */
export type BldgReceiptLine = {
  item: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};

/**
 * Vendor-neutral receipt payload — **rendered by resident `ReceiptPaper`** in production.
 * Branding fields are filled by the resident **branding resolver**, not hard-coded per vendor in the component.
 *
 * `order.serviceType`: vendor-defined code (e.g. wash_fold for LB).
 */
export type BldgReceiptViewModel = {
  schemaVersion: 1;
  branding: {
    /** From resolver / payload — not a hard-coded vendor string inside shared UI */
    title: string;
    serviceSubtitle: string;
    businessName: string;
    addressLine1: string;
    addressLine2: string;
    phoneDisplay: string;
  };
  order: {
    id: number;
    customerName: string;
    serviceType: string;
  };
  meta: {
    /**
     * ISO 8601 — **original customer order placement** (`orders.createdAt`).
     * Not payment capture time. Not completion/delivery time.
     */
    orderPlacedAt: string;
    dueDisplay: string;
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

/** @deprecated Local alias only. Prefer {@link BldgReceiptLine}. Not a public BLDG contract name. */
export type LaundryButlerReceiptLine = BldgReceiptLine;

/** @deprecated Local alias only. Prefer {@link BldgReceiptViewModel}. Not a public BLDG contract name. */
export type LaundryButlerReceiptViewModel = BldgReceiptViewModel;
