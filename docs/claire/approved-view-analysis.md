# Claire approved-view investigations

This extends the existing Claire model and conversational state. It does not add a financial ledger, strategist, mission ranker or execution authority.

## Recovery

Claude's unfinished implementation was found in `/Users/adamwrightpfi/Desktop/10132026/Cursor_bldg-admin-api-gmail` on `claude/claire-analyze-business-data`, based on `11b10416`. It contained sql.js dependencies, a draft approved-view materializer and a native open-order identity reader. Those files and unrelated local work were preserved. Implementation continues in the attached `codex/claire-general-business-intelligence-recovered` worktree. No changes were made to the original checkout's Daphne work.

## Data and authority

`approvedViews.ts` materializes only authenticated tenant records using `loadPaidOrderLedger → reconcileLedgerSpan → groupCustomers`. The native outstanding-order reader requires an exact tenant predicate. Materialization uses bounded source reads and rejects oversized datasets rather than silently dropping records. Orders, customers, native open orders, excluded sales and coverage are the only approved tables. Contacts and street addresses are excluded; IDs are tenant-derived opaque hashes. Display text is bounded and contact patterns are redacted. Retrieved text is untrusted data in the model prompt.

`sqlPolicy.ts` parses SELECTs structurally with node-sql-parser and regenerates SQL. It restricts tables, fields, functions, joins and query complexity. Administrative statements, metadata, recursion, implicit/CROSS joins, extensions and mutations are rejected. Model SQL never reaches production SQL connections.

`sandbox.ts` executes a fixed worker program against a fresh SQLite WASM database containing only approved rows. Model text cannot select code, module paths, filesystem or network operations. The trusted worker reads only its fixed WASM asset. Query-only mode, an 8 MiB database page limit, 128 MiB WASM declared memory maximum, V8 heap limits, 3-second worker termination, two concurrent queries, 50,000 dataset rows / 16 MiB, and 100 result rows / 64 KB / 32 columns bound execution. Abort paths terminate workers. Receipts carry tenant, as-of, query and dataset hashes, views, duration and truncation. This is layered confinement of SQL capabilities, not a claim that worker threads alone form an OS sandbox.

## Conversation and preparation

`analyzeBusinessData.ts` uses Claire's existing model through the structured Anthropic adapter. It chooses calculations, sees execution results and may refine them. The server owns execution, identities, values, receipts and final numerical rendering. No provider-generated receipt IDs or customer lists are trusted. Ordinary investigations allow five queries within 45 seconds; proactive investigations allow two within 25 seconds. Two investigation admission slots remain occupied while unabortable source reads finish. Provider requests support cancellation with retries disabled.

Claire's shared business conversation layer uses the model to assess whether an existing governed query fully answers the question. Existing 19-metric readers remain available. New evidence updates per-conversation customer context. Refinements are restricted server-side to the prior selected population; ordinal references use its actual stored ordering. Context expires after 20 minutes and cannot cross tenants.

Showrunner and strategic preparation use the same evidence tool with a bounded proactive budget and graceful fallback. Evidence enters existing strategic research as partial synthesized evidence. Mission Director retains ranking. An explicit operator request to put selected customers on the Day Line creates a pending revision through the existing proposal path. Existing exact-revision approval is still required. Analysis itself has no business mutation ports. Analytical claims retain executed backing but are not marked independently verified.

## Verification and limitations

The analysis tests exercise real SQLite workers, AST rejection, cancellation, exhaustion, tenant mismatch, result limits, canonical cross-source reconciliation, mocked model loops, continuity and exact-revision action separation. The real-model script uses synthetic records and a database-free provider process. The separate production acceptance script reads actual records only through canonical tenant-scoped readers and transfers approved data via RAM/IPC to a database-free model process. Its stdout contains redacted checks and hashes only. It never saves raw production fixtures or model traces.

CleanCloud outstanding orders are not synchronized. Native exclusions cannot establish complete outstanding-order absence. Costs are unavailable, so sales are not profit. ZIP membership is approximate geography. Activity is limited to the materialized window, and partial source coverage cannot establish churn or zero activity. Large datasets fail explicitly; there is no automatic unbounded scan.

The historical fourteen-customer result cannot be certified against an identical old snapshot because that snapshot was not retained. The production acceptance repeats the governed calculation at a frozen reporting clock against current canonical records and reports that distinction explicitly. This historical reproducibility gap remains a release consideration, even if the current-record acceptance passes.

No merge or deployment is authorized by this work. Review the PR and its actual acceptance results before release.
