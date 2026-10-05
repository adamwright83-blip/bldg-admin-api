# President successor reconciliation

Base: 045f96f96db671f2b7dba54440408a688cb50521.
Source: PR #377, 62a23a16a17b9b51c9e04b43e8422acb21e76bf4.

KEEP FROM CURRENT MAIN: all Authority Receipt / Universal Truth admission paths,
operator directives and UI, Mitch event inbox and worker, Lantern City and other
product behavior. No ordinary boot migration changes.

PORT FROM #377: isolated President tables, immutable evidence and versioned
intelligence, research/reasoning seams, governed execution/review transport,
founder APIs, recovery worker, explicit guarded schema runner, skills and witnesses.

SEMANTIC MERGE: add only President schema definitions/imports to current schema;
add router/callback hooks to current server; extend current build scripts.
President migration numbers overlap authority migrations but are explicitly
executed by a separate runner; ordinary application migration runner is untouched.

OBSOLETE SOURCE: omit the unrelated operator/Mitch additions embedded in #377's
schema and boot migration diff. Historical generated intelligence needs fresh
reproducible evidence, not manual witness substitutions.

MISSING: founder browser route (source had API only), exact callback replay/run
identity, atomic callback persistence, review recovery after restart, bounded wake
failures, complete deterministic executive-cycle witness and browser acceptance.

Initial checks: full TypeScript passes on this base (the reported TS2783 does not
reproduce), but runtime spread still overwrites intelligence capabilities.
Nomenclature reproduces the retired-name failure at witness.json:218.
