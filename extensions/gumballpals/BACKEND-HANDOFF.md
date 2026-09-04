# Shared-file handoff to the admin-repo owner

Owner of this branch: Codex. Shared integration is now implemented; deployment still requires explicit approval.

## Implemented integration and remaining release checks

1. The existing browser-sync router is imported in the system router.
2. It is registered as `gumball`; the extension uses `/api/trpc/system.gumball.{context,pair,import,receipt,resolve}`.
3. The additive schema is integrated into `scripts/migrate.mjs` with required-column checks. Do not apply it to production without review/approval.
4. Verify session-derived tenant ownership and existing mutation-origin guard remain active. No extension-origin CORS exception is needed: requests run from the signed-in Goldline tab.

## Contract

`context` GET → protocolVersion=1, tenantId, actorId, accountLabel, binding or null.

`pair` POST (tenant admin only) → `{tenantId,actorId,storeId,storeLabel}`. Pins one store per tenant; never switches existing binding silently.

`import` POST → above account/source + `{bindingId,requestId,from,to,exportUrl,csv}`. Actor and tenant must still match. Fixed source URL, schema, rows, payment evidence validated before writes. Binding row lock serializes browser imports. Batch + normalized paid-order upserts + receipt + last-success are one DB transaction. Same request ID/content returns original receipt; changed content under the same request ID is rejected.

`receipt` GET → `{tenantId,actorId,requestId}`; returns `{receipt:null|object}` for that tenant only.

`resolve` POST → same input; locks the tenant's binding. Returns a committed receipt if present, otherwise writes a cancellation tombstone that rejects any delayed original request. This is the safe retry barrier after an uncertain connection failure; a plain missing receipt is never called success/rollback.

Receipt: source store, actor, bounds, digest, requestId, batchId, inserted/updated/unchanged/skipped counts, unresolved count, aggregate paid cents by canonical property group and actual Pacific payment date. No raw CSV in receipt. Report totals are explicitly not labelled incremental revenue.

## Must review before production

- Existing paid data provenance: the first binding is a user-confirmed claim, not a cryptographic attestation from gumball. Validate the store against existing imported data before enabling additional tenants.
- The existing paid-order normalizer is reused; browser import writes the same table atomically instead of calling the legacy partial-write importer. No UI, geography resolver, combat, or churn service was modified.
- Browser sync does not populate `normalizedOrders` / `normalizedCustomers` through `runTenantImport`. Confirm which Lantern City/customer read model should consume these paid rows. Do not claim it does until verified.
- Validate concurrent legacy import behavior; browser locking cannot serialize a legacy writer that ignores that lock.
- Complete live import and duplicate tests against an isolated database before merge.
