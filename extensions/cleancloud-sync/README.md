# Goldline CleanCloud browser sync — implementation candidate

## Status

This is an isolated extension + backend implementation, **not a deployed or live-verified integration**. Main checkout and shared route/migration files are deliberately untouched. See `BACKEND-HANDOFF.md` before installation. No paid CleanCloud API is used.

## Install locally

1. Have the backend owner integrate the handoff, apply the isolated SQL migration in a test environment, and verify it before production deployment.
2. In Chrome Extensions, enable Developer mode and choose **Load unpacked**, selecting this directory. This is a development install; inspect/approve the permissions yourself. Do not paste tokens into the extension.
3. Sign into CleanCloud and `https://admin.bldg.chat` normally. Pin **Goldline · CleanCloud Sync**, then click it.
4. Choose an explicit period ending today or earlier in Los Angeles. Click **Connect and prepare sync** and grant access to the two named sites.
5. Verify the source store and destination tenant, then confirm import. On an existing pairing the server will reject any different store. Watch the receipt, not just an animation.

No copying files or cookies. The normal report download may remain in Chrome; the extension does not delete user files. Extraction may create entries in CleanCloud's export history but cannot edit orders, charge payments, or send notifications.

## Permissions

- `scripting`: only fixed functions in signed-in CleanCloud/Goldline tabs.
- `storage`: local progress and receipts; transient download metadata in session storage. Raw CSV stays in memory, not extension storage.
- `downloads`: a passive `onCreated` listener for the active report; no history search, file access, deletion, or arbitrary download actions.
- Optional hosts: exactly `https://cleancloudapp.com/*` and `https://admin.bldg.chat/*`.
- No cookies, debugger, all-sites, browsing history, native messaging, remote executable code, or model API. Source page contents cannot issue extension commands.

## Observed source journey

2026-09-03: authenticated CleanCloud store → menu `#accountShow` → Metrics `#slide6` → Data Export → `Orders (Sales)` → one selected store → explicit calendar range → `#submit_export_button`.

The normal export navigated to `/include/data-export-endpoint.php` with `type=1`, day/month/year bounds, one numeric store ID, and an empty group. The development browser reported `ERR_BLOCKED_BY_CLIENT`; the user subsequently reported normal export worked. **That is not proof this extension can capture the download.** Do not disable browser security to make the test pass.

The dropdown, calendar selectors and one-store label are grounded in observed DOM. CSV columns are grounded in an existing user CleanCloud Orders (Sales) CSV and the existing backend normalizer. The adapter rejects unrecognized layouts/formats. It requests the captured export URL again in the source origin to read the bytes because Chrome's downloads API does not supply file contents. This second read may add a second export-history entry.

## Current scope and limitations

- One CleanCloud store per Goldline tenant. Store reassignment requires an administrator migration because existing paid-order keys do not include a store ID.
- Only **Orders (Sales)**, up to 32 calendar days / 4 MB / 15,000 rows. No invented Revenue endpoint mapping.
- Re-running the same period performs changed-row reconciliation. This is **not complete incremental coverage of older orders**: a payment/refund/correction on an order created outside the selected period is not captured. Revenue-report support and coverage tracking remain required before claiming full automatic reconciliation.
- User-triggered only; Chrome/computer and the sync tab must remain open. Service-worker download observation survives popup closure, but the sync page is intentionally not a popup.
- The Cancel button is available before import only. An interrupted import is marked outcome unknown. **Check interrupted import** waits on the server's transaction lock and either returns the committed receipt or installs a cancellation tombstone, preventing a late original request from executing. Only then is a fresh run allowed.
- Pairing uses the existing authenticated Goldline session and tenant-aware tRPC middleware. No session credentials leave their source sites. Fixed same-origin content-script requests retain existing CSRF protections.
- Imported rows enter `cleancloud_paid_orders`, which Tower Wars reads. This does **not** fix its initial-event animation suppression, daily battle scope, or prove Lantern City's customer association is wired.
- Normal CSV imports and browser imports share unique keys. Browser sync serializes its own imports; concurrent legacy import jobs must be paused for initial proof or coordinated by the backend owner.

## Checks

`node --test extensions/cleancloud-sync/core.test.mjs`

`pnpm exec vitest run server/cleancloudBrowserSync/validation.test.ts`

`pnpm exec tsx server/cleancloudBrowserSync/localDatabaseProof.ts --run-local-db`

The database proof uses the already-running local `goldline-mysql` container and clones only three table structures from `goldline_daylight` into a uniquely named disposable database. It never uses the inherited `DATABASE_URL`, logs credentials, copies existing customer records, or changes the source database. The disposable test database is removed afterward.

Live acceptance still requires: install approval, backend integration, real report capture, authorized import, repeat-import proof, interrupted request recovery, account mismatch checks, and direct Tower Wars/Lantern City verification. Never count fixture tests as this evidence.
