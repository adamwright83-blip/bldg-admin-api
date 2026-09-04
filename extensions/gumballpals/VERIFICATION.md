# Verification — 2026-09-03

## Passed

- Eight extension-core tests: Pacific midnight boundary, future/invalid dates, bounded range, exact report origin/query/store validation, CSV quoting, malformed/duplicate data, account binding, interruption state, minimum manifest permissions.
- Six backend validation tests: real cents/payment date and canonical building projection, unknown addresses, unpaid orders, invalid evidence, retry digest, invalid calendar/DST values.
- Local **real MySQL** proof (disposable database, synthetic orders): atomic import, forced mid-transaction rollback, same-request retry, repeated and concurrent report reconciliation without duplicate revenue, changed-payload retry rejection, actor/tenant/store rejection, cross-tenant receipt isolation, invalid-batch no writes, server cancellation tombstone blocking a late request, recovery of an already committed receipt.
- That database proof reads its persisted order through the existing authoritative-event compiler and Tower Wars reducer: $51 at Century Park East yields one `century_valet_bazooka` attack. This is compiler/data-path evidence, **not live animation evidence**.
- A pre-existing real historical gumball Orders (Sales) CSV validated successfully (five rows). No source customer data was committed to this repository and no production import was performed. Unrecognized addresses stayed unresolved.
- Backend router bundles successfully with esbuild.
- Desktop and exact 390×844 browser **preview** renders in daylight, no warning/error console entries in the inspected preview; mobile has no horizontal overflow. Buttons deliberately disabled outside an installed extension. This is layout evidence only.

## Not yet verified / release blockers

1. Extension installed in actual Chrome and granted site/download permissions.
2. Actual normal gumball report download captured by the extension, followed by authenticated CSV retrieval. Observed normal browser export encountered `ERR_BLOCKED_BY_CLIENT`; user reported their manual export works. Neither fact proves extension capture.
3. Backend route registration and migration by shared-file owner; this branch deliberately does not edit shared registration/migration files or deploy.
4. Complete installed-extension → authenticated backend → real current customer data → live Tower Wars / Lantern City journey.
5. Full incremental coverage of older orders paid/refunded after their creation-report window. Current adapter reconciles changed rows only within the selected Orders (Sales) window.
6. Read-model propagation to Lantern City/tenant-normalized customers. Existing paid-order storage is reused but no downstream world integration was changed here.

Do not describe this branch as production-ready or the user program as complete. It is an isolated implementation candidate with database/security evidence and an explicit integration handoff.
# Daily scheduling and hosted entry follow-up

- Production build passes, including an allowlisted eight-file extension ZIP.
- Eleven extension/schedule tests and six backend validation tests pass. Schedule tests cover summer/winter offsets, both DST transitions and missed-run detection.
- Local database proof re-run passes: atomic rollback, retries, duplicate protection, tenant/account/store isolation, cancellation barrier and imported-row Tower Wars compilation.
- Hosted route renders in a real Chrome tab at localhost; with frontend-only development hosting the API is unavailable and the page shows a connection error, not fake success.
- Full repository TypeScript check still fails in other existing areas; it is not a clean release gate.
- NOT proven: actual installed extension execution, real current export capture/import, alarm-driven import, full historical payment coverage, production deployment or Lantern City consumption. These remain release work.
