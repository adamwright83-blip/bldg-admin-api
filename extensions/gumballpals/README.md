# Gumballpals — implementation candidate

## Status

The hosted entry route, backend registration, required migration and daily scheduler are implemented in this branch, **not yet deployed or live-verified**. See `BACKEND-HANDOFF.md` before release. No paid gumball API is used.

## Install locally

1. Deploy the reviewed frontend/backend and required migration with owner approval. The build generates `/gumballpals.zip`; `/gumballpals` provides installation and last-success status.
2. In Chrome Extensions, enable Developer mode and choose **Load unpacked**, selecting this directory. This is a development install; inspect/approve the permissions yourself. Do not paste tokens into the extension.
3. Sign into gumball and `https://admin.bldg.chat` normally. Pin **Gumballpals**, then click it.
4. Choose an explicit period ending today or earlier in Los Angeles. Click **Connect and prepare sync** and grant access to the two named sites.
5. Verify the source store and destination tenant, then confirm import. On an existing pairing the server will reject any different store. Watch the receipt, not just an animation.

No copying files or cookies. The normal report download may remain in Chrome; the extension does not delete user files. Extraction may create entries in gumball's export history but cannot edit orders, charge payments, or send notifications.

## Permissions

- `scripting`: only fixed functions in signed-in gumball/Goldline tabs.
- `storage`: local progress and receipts; transient download metadata in session storage. Raw CSV stays in memory, not extension storage.
- `downloads`: a passive `onCreated` listener for the active report; no history search, file access, deletion, or arbitrary download actions.
- `alarms`: the daily 6:00 PM America/Los_Angeles target, adjusted for DST. Missed runs catch up on browser startup. This cannot wake a closed browser or sleeping computer.
- Optional hosts: exactly `https://cleancloudapp.com/*` and `https://admin.bldg.chat/*`.
- No cookies, debugger, all-sites, browsing history, native messaging, remote executable code, or model API. Source page contents cannot issue extension commands.

## Observed source journey

2026-09-03: authenticated gumball store → menu `#accountShow` → Metrics `#slide6` → Data Export → `Orders (Sales)` → one selected store → explicit calendar range → `#submit_export_button`.

The normal export navigated to `/include/data-export-endpoint.php` with `type=1`, day/month/year bounds, one numeric store ID, and an empty group. The development browser reported `ERR_BLOCKED_BY_CLIENT`; the user subsequently reported normal export worked. **That is not proof this extension can capture the download.** Do not disable browser security to make the test pass.

The dropdown, calendar selectors and one-store label are grounded in observed DOM. CSV columns are grounded in an existing user gumball Orders (Sales) CSV and the existing backend normalizer. The adapter rejects unrecognized layouts/formats. It requests the captured export URL again in the source origin to read the bytes because Chrome's downloads API does not supply file contents. This second read may add a second export-history entry.

## Current scope and limitations

- One gumball store per Goldline tenant. Store reassignment requires an administrator migration because existing paid-order keys do not include a store ID.
- Only **Orders (Sales)**, up to 32 calendar days / 4 MB / 15,000 rows. No invented Revenue endpoint mapping.
- Re-running the same period performs changed-row reconciliation. This is **not complete incremental coverage of older orders**: a payment/refund/correction on an order created outside the selected period is not captured. Revenue-report support and coverage tracking remain required before claiming full automatic reconciliation.
- Manual sync plus opt-in daily sync after a successful manual import verifies the pairing. Automatic runs require the saved actor, tenant and store to match, and never prompt for new permissions or pair an unknown account. Chrome/computer and the sync tab must remain open. Failed automatic runs expose their status and wait for attention rather than silently retrying uncertain imports.
- The Cancel button is available before import only. An interrupted import is marked outcome unknown. **Check interrupted import** waits on the server's transaction lock and either returns the committed receipt or installs a cancellation tombstone, preventing a late original request from executing. Only then is a fresh run allowed.
- Pairing uses the existing authenticated Goldline session and tenant-aware tRPC middleware. No session credentials leave their source sites. Fixed same-origin content-script requests retain existing CSRF protections.
- Imported rows enter `cleancloud_paid_orders`, which Tower Wars reads. This does **not** fix its initial-event animation suppression, daily battle scope, or prove Lantern City's customer association is wired.
- Normal CSV imports and browser imports share unique keys. Browser sync serializes its own imports; concurrent legacy import jobs must be paused for initial proof or coordinated by the backend owner.

## Checks

`node --test extensions/gumballpals/core.test.mjs`

`pnpm exec vitest run server/cleancloudBrowserSync/validation.test.ts`

`pnpm exec tsx server/cleancloudBrowserSync/localDatabaseProof.ts --run-local-db`

The database proof uses the already-running local `goldline-mysql` container and clones only three table structures from `goldline_daylight` into a uniquely named disposable database. It never uses the inherited `DATABASE_URL`, logs credentials, copies existing customer records, or changes the source database. The disposable test database is removed afterward.

Live acceptance still requires: install approval, backend integration, real report capture, authorized import, repeat-import proof, interrupted request recovery, account mismatch checks, and direct Tower Wars/Lantern City verification. Never count fixture tests as this evidence.
