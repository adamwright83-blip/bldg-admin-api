# Laundry Butler — Project TODO

- [x] Landing page layout matching mockup
- [x] Black header bar with hours, phone, location
- [x] Hero section with logo, headline, CTA, butler image
- [x] Pricing section with laurel decorations
- [x] Service description section with shirt image
- [x] Footer with "Laundry Butler — a BLDG.chat service"
- [x] Playfair Display + Cormorant Garamond typography
- [x] Textured paper background (seamless tiling)
- [x] Phone number clickable (tel: link)
- [x] Full-stack upgrade (web-db-user)
- [x] Stripe integration configured
- [x] Database schema: orders table
- [x] Backend: orders.create route
- [x] Backend: orders.createSetupIntent route (Stripe SetupIntent)
- [x] Backend: orders.confirmCard route
- [x] Modal Step 1: Service Selection (Wash & Fold / Dry Cleaning)
- [x] Modal Step 2: Pickup Schedule (date + time window)
- [x] Modal Step 3: Address & Details
- [x] Modal Step 4: Contact Info
- [x] Modal Step 5: Card on File (Stripe Elements)
- [x] Modal Step 6: Success screen
- [x] Back button on steps 2-5
- [x] Both CTA buttons trigger modal
- [x] Vitest tests for order creation
- [x] Update Step 2 time windows: 7–9am, 9–11am, 11am–1pm, 7pm–9pm
- [x] Owner notification on new confirmed order via Manus

## Admin + Driver Build
- [x] Add new fields to orders table (status, weight_lbs, bag_count, garment_count, subtotal, discount_percent, total, delivery_date, delivery_time_window, paid, stripe_payment_intent_id, is_first_paid_order, portal_jwt, upcharges_json, dryclean_items_json)
- [x] Push database migration
- [x] Backend: db helpers (getOrdersByStatus, getOrdersByDateAndStatus, updateOrderStatus, customer search by phone)
- [x] Backend: pricing logic (wash_fold with $45 min, upcharges, flat-rate textiles, dry cleaning items)
- [x] Backend: Stripe off-session PaymentIntent charge route
- [x] Backend: JWT generation for first-paid portal enrollment
- [x] Backend: New Order creation route (manual entry)
- [x] Admin UI: Top nav with 5 tabs (New Order, Intake, Processing, Ready, Pickups)
- [x] Admin UI: New Order tab (customer search by phone, form fields)
- [x] Admin UI: Intake tab (wash_fold weight+upcharges+textiles, dry_cleaning tile grid, charge button)
- [x] Admin UI: Processing tab (table + Mark Ready modal)
- [x] Admin UI: Ready tab (table + Mark Delivered)
- [x] Admin UI: Pickups tab (day toggle, pickup/delivery stop cards)ns)
- [x] Driver UI: /driver route (day toggle + pickups/deliveries + mark collected/delivered)
- [x] Wire /admin and /driver routes in App.tsx with auth protection
- [x] Vitest tests for acceptance criteria
- [x] First-paid portal link: Copy Portal Link button after successful charge
- [x] Opus Staff Protocol note on Opus stops in driver view
- [x] End-to-end browser testing of full flow

## Driver/Admin Stop Card Updates
- [x] Show full address (street, city/state/zip, unit) on stop cards
- [x] Tap address → open Google Maps with destination prefilled
- [x] Add Call + Text icons (one tap) near phone number
- [x] Apply to both /driver and /admin Pickups tab

## Multi-Tenant Prep & Building Config
- [x] Add tenantId to orders table
- [x] Add tenantId to users table
- [x] Push database migration
- [x] Create shared/buildings.ts config object (replace hardcoded Opus logic)
- [x] Update Driver.tsx to use building config instead of hardcoded strings
- [x] Update Admin.tsx Pickups tab if it references Opus (no Opus references in Admin.tsx)
- [x] Update backend queries to pass tenantId on order creation
- [x] Backfill existing rows with default tenantId
- [x] Run tests and verify

## Bug Fixes
- [x] Fix Create Order button disabled/unclickable when browser autofill populates fields (onBlur sync)
- [x] Fix: Orders placed via landing page modal show "No card on file" during Admin Intake despite successful card save

## Customer SMS Notifications
- [x] Install twilio package and add credentials to environment
- [x] Create SMS helper with three notification templates (pickup en route, card charged, delivery en route)
- [x] Wire SMS into mark collected (pickup en route)
- [x] Wire SMS into charge card (card charged)
- [x] Wire SMS into mark ready (delivery en route)
- [x] Test SMS sending end-to-end

## Cross-App JWT Handoff (Laundry Butler → app.bldg.chat)
- [x] Add JWT generation after successful order (15min expiry, includes phone/firstName/orderId/buildingSlug)
- [x] Add redirect to app.bldg.chat/welcome?token=... on success screen
- [x] Create GET /api/orders/:orderId/receipt endpoint with APP_SHARED_API_SECRET auth
- [x] Add APP_SHARED_API_SECRET env var to Laundry Butler
- [x] Receipt endpoint: verify paid=true and phone matches
- [ ] Switch to app.bldg.chat project
- [ ] Create users table (id, phone_e164, first_name, building_slug, created_at, last_login_at)
- [ ] Implement /welcome route (verify JWT, upsert user, create session, redirect to /orders/:orderId)
- [ ] Handle expired JWT with friendly error page
- [ ] Implement /orders/:orderId route with server-side receipt fetch from Laundry Butler API
- [ ] Add JWT_SECRET, APP_SHARED_API_SECRET, LAUNDRY_API_BASE_URL env vars to app.bldg.chat
- [ ] Test full flow end-to-end

## REST API for bldg-chat Integration
- [x] Add POST /api/intake/from-bldg endpoint with APP_SHARED_API_SECRET auth
- [x] Accept order creation from bldg-chat (service type, customer info, pickup details)
- [x] Return order ID on success
- [x] Test endpoint with vitest

## Admin Intake Improvements
- [x] Add delete order button to Intake tab
- [x] Create backend deleteOrder mutation
- [x] Add confirmation dialog before deletion
- [x] Test deletion functionality

## Mixed Order Support
- [x] Show both wash/fold and dry cleaning intake sections simultaneously
- [x] Remove conditional rendering in IntakeDetail component

## Mixed Order Calculation Fix
- [x] Update totals calculation to combine both W&F and DC items

## Date Handling Investigation
- [x] Diagnosed date shift issue in Pickups tab
- [x] Verified: dates are correct at all layers (DB, API, frontend) — no ops.bldg.chat bug
- [x] Removed debug overlay and diagnostic scripts
