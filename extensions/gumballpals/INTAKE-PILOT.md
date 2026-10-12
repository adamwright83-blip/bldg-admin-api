# CleanCloud intake pilot (0.3.0)

Connect the intake pilot from Gumball on the computer signed into CleanCloud and Goldline. Keep Chrome running. On the phone open Goldline admin → Intake → CleanCloud intake. Choose the exact order and enter the complete actual catalog items: pounds for laundry or whole quantities for each dry-cleaning product. CleanCloud supplies its own prices. Held pickup order IDs also block intake.

Prepare opens a dedicated CleanCloud draft tab. Requested catalog quantities replace pickup estimates; source notes, fees and pricing remain for inspection. Existing weighted bags stop preparation and require inspection in CleanCloud to avoid adding duplicate weight or changing bag-specific extras.

Show prepared CleanCloud order brings that computer tab forward. Inspect the customer, order ID, all items, quantities, ready date, fees and total. Return to Goldline, check the inspection acknowledgment, and press Approve and submit with the displayed amount. This is the only submission trigger and may charge the saved card according to CleanCloud settings. There is no unattended mode or automatic removal of review after 30 days.

A changed draft or expired approval stops submission. The worker persists an attempted marker before clicking. A lost response, closed draft, unfamiliar payment dialog, or missing saved evidence requires attention. Check saved result is read-only; it never retries Submit. Saved means the exact order and draft were verified in Cleaning, not that payment was verified. Complete an unfamiliar payment dialog yourself in CleanCloud, then use Check saved result.

The live payment behavior has not been tested by Codex. Initial use requires the owner to perform the approval and inspect the result. Synthetic browser, phone and disposable MySQL tests cover the workflow; no real order or card was used in those tests.

Version 0.3.0 adds intake only. The separate 6:50 AM route schedule and Ready/dropoff lifecycle are not implemented by this release. Historical report scheduling remains at 6 PM. The worker refreshes source queues while Chrome is running.
