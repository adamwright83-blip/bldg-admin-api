# Laundry Butler receipt — handoff (admin reference vs resident public layer)

This document describes how **bldg-admin-api** relates to the **resident (app.bldg.chat)** receipt system. It is **not** the authority for BLDG’s long-term public receipt contract.

## Canonical ownership (final architecture)

| Concern | **Owner (canonical)** | **This admin repo** |
|--------|------------------------|---------------------|
| Public receipt contract (`BldgReceiptViewModel`, evolution, versioning) | **Resident app** | Includes **aligned** types in [`shared/receiptViewModel.ts`](../shared/receiptViewModel.ts) for handoff and Laundry Butler tooling — **keep in sync** with resident when the contract changes. |
| Generic renderer (`ReceiptPaper`) + print CSS | **Resident** | [`DigitalReceiptPage.tsx`](../client/src/pages/DigitalReceiptPage.tsx) is a **staff-only LB visual prototype** — layout reference for parity, not the shared production renderer. |
| Branding / title / footer resolution | **Resident** (central resolver + config) | Admin hard-codes LB defaults + env for **this vertical only**. |
| Vendor-aware JWT / token expansion → view model | **Resident** | Admin issues LB JWTs (`chargeCard`); **expansion and registry** live in resident. |
| Vendor mapper registry (LB, future vendors) | **Resident** | Admin provides **Laundry Butler reference mapper**: [`buildReceiptLines`](../shared/receipt.ts), LB pricing rules, sample payloads. |

**Admin does not define the permanent public receipt contract.** It is the **first vendor-specific implementation** and **reference mapper** for Laundry Butler. **`LaundryButler*`** naming anywhere is **local / reference only** — not the BLDG-wide API surface.

## BLDG vs this admin repo (summary)

| Layer | Responsibility |
|--------|----------------|
| **Resident / app.bldg.chat** | Owns **`BldgReceiptViewModel`**, **`ReceiptPaper`**, **branding resolver**, **vendor-aware token expansion**, **mapper registry**. Renders all building vendors’ receipts for residents. |
| **This admin app** | Laundry Butler order intake, charge, staff receipt at **`/receipt/:orderId`**. Ships LB line-item logic and samples so resident’s **LB mapper** can match behavior. |
| **`LaundryButler*` types** | Deprecated aliases in this repo only — **do not** use as the public contract name in resident. |
| **Samples** | `docs/samples/laundry-butler-receipt*.json` — **LB fixture data** for tests; not a global receipt schema registry. |

**Contract rule:** The **resident app** is the canonical home for the public multi-vendor receipt contract. This repo must **not** be documented as defining BLDG’s permanent API.

## 1. Source files in this repo (Laundry Butler reference)

| Piece | Role |
|--------|------|
| [`client/src/pages/DigitalReceiptPage.tsx`](../client/src/pages/DigitalReceiptPage.tsx) | **LB staff receipt** — visual/layout reference; not `ReceiptPaper`. |
| [`shared/receipt.ts`](../shared/receipt.ts) | **`buildReceiptLines`** — **first vendor mapper** (Laundry Butler only). Same shape as `BldgReceiptLine` when mapped. |
| [`shared/receiptViewModel.ts`](../shared/receiptViewModel.ts) | **`BldgReceiptViewModel`** / **`BldgReceiptLine`** — shapes aligned with **resident-owned** contract for handoff. **`LaundryButler*`** = legacy alias, reference naming only. |
| [`docs/samples/laundry-butler-receipt.sample.json`](samples/laundry-butler-receipt.sample.json) | LB dry-cleaning fixture. |
| [`docs/samples/laundry-butler-receipt-wash-fold.sample.json`](samples/laundry-butler-receipt-wash-fold.sample.json) | LB wash-and-fold fixture. |

## 2. Branding (admin vs resident)

**This admin app (Laundry Butler only):**

- May use **LAUNDRY BUTLER** as the default header and LB env defaults (`VITE_RECEIPT_*`).
- Subtitle: `Wash & Fold` or `Dry Cleaning` from `order.serviceType`.
- Footer default: *Thanks for your business. Have an amazing day!*

**Resident / BLDG (all vendors):**

- **Parity** with admin = **layout, table, totals, print quality** — not mandating the literal **LAUNDRY BUTLER** string for non-LB vendors.
- **Branding resolver** supplies title, subtitle, business block, footer per vendor/building.

## 3. Layout & styles (Tailwind reference — “paper”)

Use this section to match **resident `ReceiptPaper`** visually. Admin page is the LB staff implementation of the same pattern.

Outer shell:

- Page: `min-h-screen bg-neutral-100 py-8 px-4 print:bg-white print:py-4`
- Card: `max-w-md mx-auto bg-white border border-neutral-200 shadow-sm print:shadow-none print:border-neutral-300`

Sections (top → bottom):

1. Brand block: centered, bottom border `border-neutral-100`, padding `pt-8 pb-6 px-6`.
2. Order `#id` + customer name: centered, `text-2xl font-bold` for `#id`, `text-lg font-medium` for name.
3. Two-column grid: `grid grid-cols-2 gap-4 px-6 pb-6 text-sm border-b border-neutral-200` — left business, right metadata: **Total**, **Order placed**, **Due**, **Payment** (labels `text-black/50`).
4. Line table: Item | Qty | Unit (right) | Amount (right).
5. Totals block: Subtotal, Discount, Total, Payment.
6. Footer strip: `bg-neutral-50 border-t` + footer text.

**Order placed (metadata) — semantics (authoritative):**

- **`BldgReceiptViewModel.meta.orderPlacedAt`:** ISO 8601 — **original customer order creation** (`orders.createdAt`).
- **Not** card payment capture time, **not** order completion/delivery time.
- **Payment** line uses paid / charge-related timestamp when applicable (may differ from `orderPlacedAt`).
- **Label on admin prototype:** `Order placed:`

**Print / screenshot:** `print:` variants; hide chrome with `print:hidden`.

## 4. Data paths (ecosystem)

| Context | Mechanism | Owner of “full receipt” UX |
|--------|------------|----------------------------|
| **Admin** (`admin.bldg.chat`) | **`/receipt/:orderId`** + `trpc.admin.getOrder` | Admin (LB staff only). |
| **Resident** | **`/receipt/:token`**, JWT from LB `chargeCard` + **vendor-aware expansion** | **Resident** maps to `BldgReceiptViewModel`. |
| **Server-to-server** | **`GET /api/orders/:orderId/receipt`** + `x-app-shared-secret` | Raw LB JSON; **resident mapper** turns this into `BldgReceiptViewModel` when proxying. |

**Resident responsibilities (not admin):** `ReceiptPaper`, branding resolver, **mapper registry**, **token expansion** to neutral view model.

## 5. Mapping order → `BldgReceiptViewModel` (Laundry Butler mapper — reference)

This is the **first vendor mapper**; others follow the same output shape in resident.

1. **Lines:** [`buildReceiptLines`](../shared/receipt.ts) — **Laundry Butler pricing / intake rules only.** Output matches `BldgReceiptLine`.
2. **Totals:** `subtotal` / `total` from order strings; `discount = max(0, subtotal - total)`.
3. **Meta:**
   - **`orderPlacedAt`:** ISO 8601 from **`order.createdAt`** (placed — not paid, not completed).
   - **`dueDisplay`:** `deliveryDate` + `deliveryTimeWindow`.
   - **`paymentDisplay`:** paid time + “Card” or “Pending”.
4. **Branding:** In resident, from **resolver**; LB mapper may inject LB defaults when source is this admin API.

## 6. Open decisions (resident / platform)

- Receipt URL shape (unified vs vendor in path/query).
- JWT minimal vs fat vs expansion policy per vendor.
- Branding defaults storage; building → vendor mapping and routing.

## 7. Resident implementation checklist

- [ ] Canonical **`BldgReceiptViewModel`** + **`ReceiptPaper`** + **branding resolver** in resident.
- [ ] **Mapper registry**; register **Laundry Butler** using rules aligned with **`buildReceiptLines`** + admin samples.
- [ ] **Vendor-aware token expansion** for `/receipt/:token`.
- [ ] Keep shared types **in sync** with resident when contract evolves.

## 8. JWT reference (Laundry Butler — issued from admin)

`chargeCard` in `server/routers.ts` signs JWTs; claims include `orderId`, `customerId`, `totalWeight`, `finalAmount`, `currency`, `vendorName`. **Expansion to `BldgReceiptViewModel`** (including **`orderPlacedAt` from `createdAt`**) is a **resident** concern.
