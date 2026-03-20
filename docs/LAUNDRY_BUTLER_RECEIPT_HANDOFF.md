# Laundry Butler digital receipt — handoff for resident app

Use this doc (and `docs/samples/*.json`) to align **OrderReceipt** / **Receipt** in the resident app with the admin **visual prototype**. This admin repo remains **Laundry Butler processing only**; BLDG must serve **many vendors** over time.

## BLDG vs this admin repo

| Layer | Responsibility |
|--------|----------------|
| **Resident / app.bldg.chat** | **`BldgReceiptViewModel`** (vendor-neutral) + a dumb **`ReceiptPaper`** (or `BldgReceiptPaper`). Branding (title, subtitle, footer, business block) always from **data** — payload, vendor config, or building config — never hard-coded vendor strings in the component. |
| **Per-vendor mappers** | e.g. `mapLaundryButlerOrderToBldgReceipt` — first mapper; future: grooming, car wash, etc. |
| **This admin app** | LB order intake, charge, receipt at `/receipt/:orderId`. Types named `LaundryButler*` are **legacy aliases** of `Bldg*` for this vertical only. |
| **Samples** | `docs/samples/laundry-butler-receipt*.json` are **Laundry Butler fixtures** for tests/Storybook; add more fixtures per vertical later. |

**Contract rule:** The resident app must **not** treat `LaundryButlerReceiptViewModel` or the literal title **LAUNDRY BUTLER** as the permanent public receipt contract for BLDG. Use **`BldgReceiptViewModel`** as the documented resident/public abstraction.

## 1. Source files in this repo (prototype)

| Piece | Location |
|--------|-----------|
| Receipt page (React + Tailwind) | [`client/src/pages/DigitalReceiptPage.tsx`](../client/src/pages/DigitalReceiptPage.tsx) |
| Line items from DB intake | [`shared/receipt.ts`](../shared/receipt.ts) — `buildReceiptLines()`, `ReceiptLine` |
| Vendor-neutral view model | [`shared/receiptViewModel.ts`](../shared/receiptViewModel.ts) — **`BldgReceiptViewModel`**, **`BldgReceiptLine`** |
| Legacy laundry aliases | Same file — `LaundryButlerReceiptViewModel` = `BldgReceiptViewModel` (deprecated name) |
| Sample JSON (dry cleaning) | [`docs/samples/laundry-butler-receipt.sample.json`](samples/laundry-butler-receipt.sample.json) |
| Sample JSON (wash & fold) | [`docs/samples/laundry-butler-receipt-wash-fold.sample.json`](samples/laundry-butler-receipt-wash-fold.sample.json) |

## 2. Branding (admin vs resident)

**This admin app (Laundry Butler receipt page):**

- May use **LAUNDRY BUTLER** as the default header and LB env defaults (`VITE_RECEIPT_*`) — unchanged product behavior for staff.
- Subtitle: `Wash & Fold` or `Dry Cleaning` from `order.serviceType`.
- Footer default: *Thanks for your business. Have an amazing day!*

**Resident / BLDG:**

- **Parity** means **shared layout, typography, table structure, totals block, and print quality** — not copying the literal **LAUNDRY BUTLER** string for every vendor.
- Each receipt’s **title, subtitle, business block, and footer** must come from **payload or config** for that vendor.

## 3. Layout & styles (Tailwind reference — “paper”)

Outer shell:

- Page: `min-h-screen bg-neutral-100 py-8 px-4 print:bg-white print:py-4`
- Card: `max-w-md mx-auto bg-white border border-neutral-200 shadow-sm print:shadow-none print:border-neutral-300`

Sections (top → bottom):

1. Brand block: centered, bottom border `border-neutral-100`, padding `pt-8 pb-6 px-6`.
2. Order `#id` + customer name: centered, `text-2xl font-bold` for `#id`, `text-lg font-medium` for name.
3. Two-column grid: `grid grid-cols-2 gap-4 px-6 pb-6 text-sm border-b border-neutral-200` — left business, right metadata: **Total**, **Order placed** (see below), **Due**, **Payment** (labels `text-black/50`).
4. Line table: full width, header row uppercase small caps style `text-xs uppercase tracking-wide`, columns Item | Qty | Unit (right) | Amount (right).
5. Totals block: right-aligned column ~`w-48`, rows Subtotal, Discount, Total (bold + top border), Payment.
6. Footer strip: `bg-neutral-50 border-t` + footer text.

**Order placed (metadata):**

- **Label:** `Order placed:` (human-readable date/time, same formatting family as other meta lines).
- **Source:** `orders.createdAt` — when the customer originally placed the order. **Not** card capture time (`Payment:` uses last update when paid, typically post-charge) and not processing completion.

**Print / screenshot:**

- Use `print:` variants on the outer page and card as above.
- Hide non-receipt chrome with `print:hidden` (e.g. “Screenshot…” hint, “Back to admin” link).

## 4. Data: `/orders` only vs `/receipt/:token` (JWT)

There are **three** receipt-related paths in the ecosystem; they are **not** interchangeable.

| Context | Mechanism | Auth |
|--------|------------|------|
| **Admin** (`admin.bldg.chat`) | Client route **`/receipt/:orderId`** (numeric id). Renders [`DigitalReceiptPage`](../client/src/pages/DigitalReceiptPage.tsx). | Admin session + `trpc.admin.getOrder`. **No JWT** on this URL. |
| **Consumer app** (`app.bldg.chat`) | URL like **`/receipt/:token`** where `token` is a **JWT** issued at charge time (see `chargeCard` in `server/routers.ts`). Payload includes `orderId`, `finalAmount`, `totalWeight`, `currency`, `vendorName`, etc. | Validated by resident app; **enrich** with line items via a trusted API using `orderId` (and vendor identity as you define it). |
| **Server-to-server** | **`GET /api/orders/:orderId/receipt`** with header **`x-app-shared-secret: APP_SHARED_API_SECRET`**. | Returns JSON: `lineItems`, `drycleanItems`, `subtotal`, etc. Map to **`BldgReceiptViewModel`** (and `buildReceiptLines` rules for LB). |

**Recommendation for resident refactor:**

- Presentational component: **`ReceiptPaper({ model: BldgReceiptViewModel })`** — no data fetching.
- **Order list / `/orders`:** Resolve vendor + fetch the correct receipt endpoint → map → `BldgReceiptViewModel`.
- **`/receipt/:token`:** Prefer **minimal JWT + server expansion** to a neutral view model when possible; avoid fat tokens with full line items for every vertical unless product requires offline display.

## 5. Mapping order → `BldgReceiptViewModel` (Laundry Butler)

1. **Lines:** Use [`buildReceiptLines`](../shared/receipt.ts) with `serviceType`, `weightLbs`, `upchargesJson`, `drycleanItemsJson`, `subtotal`. Output matches `BldgReceiptLine`.
2. **Totals:** `subtotal` / `total` from order strings; `discount = max(0, subtotal - total)` as currency strings with 2 decimals.
3. **Meta:**
   - **`orderPlacedAt`:** ISO 8601 from **`order.createdAt`** (customer placed the order).
   - **`dueDisplay`:** from `deliveryDate` + `deliveryTimeWindow`.
   - **`paymentDisplay`:** from paid time + “Card” or “Pending” (charge time may differ from `orderPlacedAt`).
4. **Branding:** For LB-only mappers, title/subtitle/business block can match admin defaults; for BLDG, fill from vendor/building config.

## 6. Open decisions (not settled in this repo)

Document only — implement in resident / platform when ready.

- **Receipt URL shape:** Single pattern for all vendors vs vendor in path or query (e.g. `/orders/:vendorSlug/:orderId/receipt`) vs unified BLDG receipt service.
- **Token strategy:** Minimal JWT + server-side expansion to `BldgReceiptViewModel` vs fat JWT per vertical.
- **Vendor branding defaults:** Where default title, phone, and footer live when not embedded in payload (DB vs static config).
- **Building → vendor mapping:** Source of truth for which vendors serve a building and how receipt fetch is routed.

## 7. Refactor checklist (resident app)

- [ ] Introduce **`ReceiptPaper({ model: BldgReceiptViewModel })`** — no data fetching inside.
- [ ] Implement **`mapLaundryButler…ToBldgReceipt`** (or proxy + map) as the first mapper.
- [ ] Point **OrderReceipt** at mapper + paper; make vendor resolution explicit before fetch.
- [ ] **Receipt** (`/receipt/:token`): decode JWT; expand or fetch to **`BldgReceiptViewModel`** with vendor-aware routing.
- [ ] **Print CSS** once on the paper component.
- [ ] Use sample JSON fixtures; add non-LB samples as verticals ship.

## 8. JWT payload reference (charge flow — Laundry Butler)

Issued in `server/routers.ts` (`chargeCard`), signed with `JWT_SHARED_SECRET` / `JWT_SECRET` / `APP_SHARED_API_SECRET`. Claims include at least:

`orderId`, `customerId` (Stripe), `totalWeight`, `finalAmount` (cents), `currency`, `vendorName`.

Resident **`/receipt/:token`** should verify token and load full receipt via a trusted API; **order placed** time should still come from order **`createdAt`** when mapping to `BldgReceiptViewModel.meta.orderPlacedAt`.
