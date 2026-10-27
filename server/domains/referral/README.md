# Referrals

One JOYSTICK feature, two tiers. Rules: `shared/referralProgram.ts`. Persistence and reads: `referralService.ts`.
Admin page: Growth → Referrals (`client/src/pages/ReferralsPage.tsx`). tRPC: `referrals.*`.

| | CleanCloud businesses | Native POS businesses |
|---|---|---|
| Who runs referrals | CleanCloud | JOYSTICK |
| JOYSTICK's job | Show the setup steps (`CLEANCLOUD_SETUP_STEPS`), then copy CleanCloud's Referral Code Usage list (`importCleanCloudReferralUsage`) | Codes (`ensureReferralCode`), referrals (`recordReferral`), and the referrer's credit earned from the paid-order ledger |
| Who applies credit | CleanCloud | JOYSTICK, automatically: the new customer's credit at signup, the referrer's on the new customer's first paid order; `chargeCard` spends it |

Rules that must not drift:

- The referrer's credit is earned only by the new customer's **first paid order with money in it**. A free first order
  (FIRSTWASH) counts as an order but does not earn it. Same behaviour as CleanCloud's scheme as Adam tested it.
- On the CleanCloud tier a missing referral looks like no referral, so every surface shows how old the copy is
  (`referralSyncFreshness`).
- A referral counts toward a neighbourhood only once the new customer has ordered (`convertedReferrals`).

How the native tier works on laundrybutler.bldg.chat:

- The pickup form (`SchedulePickupModal.tsx`) has a **Referral code** box, prefilled from a shared `?ref=CODE` link.
  `orders.create` records the referral (`recordReferralAtSignup`: new customers only, one per phone, never blocks the
  order) and returns the customer's own code, shown on the card step.
- Credit lives in `customer_credit_entries`. `chargeCard` takes it off the charge with `planCreditRedemption`: credit
  comes out of the platform fee, the cleaner's payout never changes, Stripe's $0.50 minimum stays, and leftover credit
  carries over. Credit is spent only after Stripe captured and the payment was admitted; the customer's text, receipt,
  sheet and owner alert all show the amount actually charged.
- The same admitted payment pays the referrer (`creditReferrerOnFirstPaidOrder`) if it's the referred customer's first
  order with money in it.

How the CleanCloud tier stays current:

- **GumballPals** (0.4.0) reads Admin → Discounts & Promos → Invite Codes / Referrals → View Referral Activity after
  every import and posts the rows to `system.gumball.referralUsage`, with the address the window loaded from.
- **Jawbreaker** fetches that address with its own session after the exports (`syncCleanCloudReferralUsage`). Until
  GumballPals has run once it reports `no_address_yet`.
- Neither ever fails a sales sync. The page's freshness label shows when the copy is old.

Not verified yet: GumballPals' clicks against the live CleanCloud page (controls are found by visible text from
screenshots), the window's response format for Jawbreaker, and a real charge with credit on production.
