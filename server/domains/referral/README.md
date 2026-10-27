# Referrals

One JOYSTICK feature, two tiers. Rules: `shared/referralProgram.ts`. Persistence and reads: `referralService.ts`.
Admin page: Growth → Referrals (`client/src/pages/ReferralsPage.tsx`). tRPC: `referrals.*`.

| | CleanCloud businesses | Native POS businesses |
|---|---|---|
| Who runs referrals | CleanCloud | JOYSTICK |
| JOYSTICK's job | Show the setup steps (`CLEANCLOUD_SETUP_STEPS`), then copy CleanCloud's Referral Code Usage list (`importCleanCloudReferralUsage`) | Codes (`ensureReferralCode`), referrals (`recordReferral`), and the referrer's credit earned from the paid-order ledger |
| Who applies credit | CleanCloud | The operator, then "Mark applied". JOYSTICK has no credit wallet yet |

Rules that must not drift:

- The referrer's credit is earned only by the new customer's **first paid order with money in it**. A free first order
  (FIRSTWASH) counts as an order but does not earn it. Same behaviour as CleanCloud's scheme as Adam tested it.
- On the CleanCloud tier a missing referral looks like no referral, so every surface shows how old the copy is
  (`referralSyncFreshness`).
- A referral counts toward a neighbourhood only once the new customer has ordered (`convertedReferrals`).

Not built yet:

- **GumballPals / Jawbreaker** reading the Referral Code Usage window on their normal sync. Both should call
  `importCleanCloudReferralUsage` with cell rows. Until then the page has a paste box.
- **The code box at signup and automatic credit** for native customers. Laundry Butler's signup and checkout live in
  the resident app (`api.bldg.chat`, a separate repo), which should call `recordReferral` when that's built.
