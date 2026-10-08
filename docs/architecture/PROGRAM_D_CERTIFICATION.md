# Program D — Architecture convergence certification

## Verdict

**ARCHITECTURE CONVERGENCE CERTIFIED** for the Program A–D authority boundaries audited here, on production source main `85415cb7292e6803092cb5fe835f4f0325f7907c` (C20 / PR #498). This final documentation/test PR changes no production authority. Its merged commit is the final campaign checkpoint; exact head and post-merge checks are recorded in the accompanying evidence bundle.

No genuine native Orders/Payment, Commercial conversion, external-evidence, game-business-truth or canonical paid-dollar bypass remains in the reviewed call paths. This is not a declaration that every repository test, hosted CI job, historical ownership record, provider integration or business release gate is green.

The original campaign started at `897e7c03ea36af7bb305d53ab6db099f83b1b5a8`. ChatGPT subsequently merged C5–C9 through `f9c97d9816d313093339dff4c85fb1ac84edb066`, leaving final certification unfinished. Codex resumed, verified that work, merged C10–C20 and B6, and completed this final audit. Program E remains a separate roadmap, outside this authorization.

## Program results

| Program | Result | Evidence and boundary |
| --- | --- | --- |
| A | Certified | Orders owns native creation/revision/transition/deletion. Payment alone admits native paid truth. Driver routes through Orders. Tenant/status/payment CAS fences concurrent pickup/delivery. The post-merge AST scan covers server and operational scripts, including aliases, namespace access and raw SQL. |
| B | Certified | Recovery completion is not payment; paid-customer/game progression requires owning source evidence; Commercial won is verbal conversion. Tower Wars paid dollars use canonical admitted captures, and Command Sky first-order wins require source-bound tenant-owned Payment occurrence. Browser/local state cannot establish business authority. |
| C | Certified | Narrow Orders/Payment/Commercial/external-evidence readers replace shadow reconstruction across history, resident/referral assets, geography, revenue, freshness, vendor payouts, receipts and capability metrics. Quote is separate from capture. Unknown historical native amounts remain unknown. |
| D | Certified | Final hostile scan, owning-domain traces, exact provider/import binding witnesses, real MySQL execution, clean migrations, schema recovery and production startup validate these boundaries. Four contract failures are reproduced on exact starting main and are not hidden as passing tests. |

See [A5](./PROGRAM_A_SLICE_5.md), [B audit](./PROGRAM_B_AUDIT.md), [C audit](./PROGRAM_C_AUDIT.md), and [classified hostile inventory](./PROGRAM_D_HOSTILE_INVENTORY.jsonl).

## Final authority findings

| Seam | Final owner and disposition |
| --- | --- |
| Resident tool / core resident intake | `createOrReuseResidentOrder`, after existing identity/tenant admission; raw persistence helper callers removed. |
| Driver lifecycle | `transitionNativeOrderStatus`; Driver owns assignment/membership admission, not lifecycle rules. |
| Router intake/building/vendor/Stripe references | Named Orders application functions; `server/routers.ts` President import/router registration is an independent protected hunk. |
| Historical workbook insertion | `importCustomerOrderHistory` is an explicit history-admission boundary. It supplies explicit tenant and creates unpaid history through Orders. It cannot manufacture Payment or captured revenue. |
| Delivery | Canonical transition requires current matching Payment admission, including when captured amount remains unknown. Frozen tenant/processor reference participates in the write fence. |
| Native paid writes | `paymentAdmission.ts` owns receipt and paid admission. Orders creation/revision cannot assign paid state or alter frozen fee/payout/recipient snapshots. |
| Provider capture reuse | Global indexed provider claim locks reject another order/tenant and concurrent duplicate claims. Existing ambiguous multiple bindings retain occurrence evidence but withhold their native dollar amount. |
| Historical amount | Immutable `amount_received`, succeeded status, USD currency and provider/order/tenant consistency establish captured cents. Historical receipts without amount evidence do not borrow current edited quote. |
| Historical NULL tenant | Payment preparation and production migration hold the item unresolved. They do not assign default ownership or admit a payment receipt. The seeded migration witness remains NULL with zero receipts. |
| Paid-window/revenue date | Payment receipt occurrence governs the canonical native paid window; edited `orders.paidAt` cannot move a capture into another period. |
| Commercial | Won remains conversion, not paid revenue. Capture-backed money respects existing refund/review projections; unknown refund/financial review cannot be promoted to exact gross revenue. |
| CleanCloud | External observation remains distinct from native Payment. Canonical ledger, customer projection and economic outcome admission match tenant/order/import receipt evidence. Paid flags alone cannot license progression or economic credit. |
| Vendor payout | Gross capture stays provider-backed; payout/fee attribution requires the frozen connected-account recipient, never today's newly assigned vendor account. |
| Staff/core receipt and CSV | Matching owning Payment facts provide status, amount and occurrence; current quote/item pricing remains explicitly separate. Unavailable or unverified evidence is not silently paid. |
| Analytics source availability | Explicit-tenant Orders candidates plus matching Payment admission; import availability labels candidates, not exact paid revenue. |
| Command Sky | First admitted payment per tenant/customer provides label/order/dedupe; unsupported manual/legacy first-order rows do not count as paid customers. Verbal commitments remain operator observations. |
| External card-reader correlation | Clearent native quote/date matches suggest correlation only. `matchedOrderId` does not enter canonical analytics/money admission. External settlement evidence remains separately qualified. |

## Hostile-scan classification

The final scan covers production `.ts`, `.tsx` and `.mjs` in `server`, `shared`, `client/src` and `scripts`, excluding tests, test-support, fixture paths and archives. It records **578 hits across 210 files**. Each hit has a path, line, enclosing-function hint, tags, owning lane and disposition in the JSONL appendix. The scan is triage; call-path traces, admission tests and the AST guard establish ownership.

| Tag | Hits | Disposition |
| --- | ---: | --- |
| Raw Orders write | 16 | Internal Orders persistence/application owner, sole Payment admission owner, or named disposable proof/demo fixture. The stronger AST scan independently reports zero unauthorized production callers/direct writes/SQL writes. |
| `orders.paid` | 21 | Owned persistence or candidate/current-state reads licensed by Payment before any canonical paid claim; unpaid outreach/quote diagnostics are not revenue. |
| `orders.paidAt` | 2 | Orders candidate/history read and external correlation only; canonical native financial windows use receipt occurrence. |
| `orders.total` | 10 | Current quote/intake, operational service mix, candidate projection or correlation diagnostic; no historical native paid-dollar reconstruction. |
| Processor ID | 10 | Receipt lookup/provider matching or diagnostic; ID alone never admits payment. |
| Tenant default | 77 | Established compatibility/context/diagnostic paths. No new default ownership was added; historical native Payment now explicitly holds unresolved ownership. |
| Commercial won | 8 | Owning conversion projection, read/render label or explicit conversion fixture; no Payment implication. |
| Truth-events reference | 1 | Procurement contract declaration, not alternate native persistence. |
| Fire-and-forget / swallowed optional failure | 437 | Primarily UI render/audio/media/telemetry/cache/request handling, optional diagnostics, cleanup, worker control and derived presentation. Consequential native/economic mutations cross the owning admitted operation; economic publication has persisted tenant/source/lease/attempt/retry witnesses. |

The following execution distinctions were traced explicitly rather than treated as automatic regex violations:

- Economic outbox scheduling wakes persisted, leased work with retry/error state and idempotent destinations. Process-local worker concurrency state does not replace persistence.
- Field Journal saves a durable journal/source/status before its local wakeup; actions are grounded, idempotent, operator-reported **ATTESTED** observations, never invented provider-verified visits or wins. Tower Forge similarly persists job/source state before local wakeup. Their local wakeups are best effort; this report does not certify universal crash-complete journal/forge processing.
- Optional campaign/Day Line/appointment diagnostics follow the owning result. Proof-upload cleanup has persisted guards. Temporary audio cleanup and pickup SMS retain their established best-effort behavior; they do not admit paid, won or delivered truth.
- `recordWarActionSafe` instruments an already-owned action into derived presentation; it cannot write Orders, Payment or Commercial. Client requests still cross server admission even when the UI does not await a cache refresh.
- The older in-memory admin aggregate helper has no production callers. Authoritative aggregates use admitted Payment facts. Pure mapping/fixture helpers are not additional runtime admission paths.

## Deliberate historical exceptions and data holds

1. `cleancloud_legacy_orders` remains an unresolved data-policy exception. This campaign did not assign tenant ownership, deduplicate, alter uniqueness or migrate its ownership. Modern admitted CleanCloud evidence uses a separate explicit tenant/import boundary.
2. Historical native captured amounts without durable provider amount evidence remain **unknown**. The reconciliation CLI is available, but no production provider reconciliation, charge or data rewrite was executed. Any optional estimate must stay separately non-authoritative and out of canonical revenue, customer value and game truth.
3. Older rows previously assigned a tenant by historical bootstrap were not retrospectively reassigned. C17 prevents further default assignment for unresolved native history. Establishing ownership of old ambiguous rows requires record-specific evidence/data policy.
4. Established unknown-host/default resolver and legacy resident signup census compatibility remain documented; they do not newly admit missing native historical ownership or paid dollars. Signup counts are not paying-customer SaaS authority.
5. Named demo/proof seed/reset files are disposable fixtures, not production admission. They are exact-file AST exemptions, not general directory permissions.

These exceptions are not evidence of historical data completeness or unrestricted multi-tenant ownership.

## Verification

Production source verified: `85415cb7292e6803092cb5fe835f4f0325f7907c`.

| Proof | Result |
| --- | --- |
| TypeScript | Pass; final documentation/test head checked again before merge. |
| Nomenclature / tenant ratchet / vertical dependencies / domain boundaries | Pass; exact-head/post-merge ratchets repeated. |
| Broad relevant contracts | **769 passed, 4 baseline failures, 6 skipped**, 106 files. Includes Orders, Payment, ownership, Commercial, CleanCloud, SaaS, workers/action gates, outbox, game truth and reader contracts. Skips are not counted as proof. |
| Real MySQL combined | **68 passed, 22 files**, including native capture/refund/tenant/provider fences, pickup/delivery, reminder/Strategy admission, Commercial, resident assets, Tower Wars, Command Sky, CleanCloud customer/outcome import binding, payment coverage, durable stores, outbox and Mitch event inbox. |
| Fresh-database SaaS exams | **25 passed across six separately migrated databases**: hostile tenant 11, billing 2, COGS 3, export/deletion 3, two-tenant coexistence 3, acquisition 3. Fake provider SDK evidence only. |
| Clean numbered release migrations | All through `0127_native_provider_capture_lookup.sql` pass on an empty disposable MySQL database. |
| Clean production bootstrap | Pass on empty disposable MySQL; schema drift fixture, repair, repeated migration and synthetic rollback release exam pass. No required migration failures. |
| Unresolved historical tenant migration witness | Repeated production migration leaves seeded tenant NULL and admits zero native Payment receipts. |
| Production build / boot | Build passes; exact production `pnpm start` with disposable DB/fake provider configuration returns HTTP 200 from the established health endpoint. Proof server stopped afterwards. No live provider operations. |
| Post-merge Orders scan | Exact final merged checkpoint reruns Orders ownership/architecture guards and the four repository gates. |

### Baseline failures, proved rather than assumed

On exact starting main `4bc98a0884cf74916050f45c34645e5f7a6ee587`, the three relevant files reproduce **23 passes and the same four failures**:

- `geography/gumballCustomerTruth.test.ts`: payload digest fixture expects `51079…`, actual `59612…`.
- `money/moneyProjectionService.test.ts`: missing-native-proof fixture expects zero but its admitted external CleanCloud evidence yields 73,739 recorded cents.
- `towerWars/towerWarsDayDirector.test.ts`: two actor/commitment identity fixtures expect a visible/found promise but receive an empty state/not-found result.

These product/fixture failures were not rewritten to obtain green certification. Independent Daphne PR #475 already fixed the older three Claire decision-record failures; those older failures are not reported as current. Hosted CI status is preserved in the evidence bundle, and this report does not claim all hosted jobs pass.

## Protected concurrent work

Current main and live open PRs were fetched before each slice and merge. Protected heads at the final audit:

| PR | Head |
| --- | --- |
| President #375 | `6e6c765aaf65fa0d7e48f3541407e7c2237b91cf` |
| President #411 | `d8429126d4473a4c55ab9593052fc6bf19b82777` |
| #374 | `5ab3e720f9a4f94a37e59ef70fe514cf9769526f` |
| #359 | `94e00dcd630944f4dc6bec835c45e83a9f0d162f` |
| Mitch #361 | `fd94c17a317c941f27d7fe2517d11db946afa993` |
| Daphne/Claire #476 | `d7a844f64acd43ec740897b3c367c856f4a98731` |

No protected branch was modified, rebased, force-pushed, merged, closed or deleted. Shared large-file hunks were inspected semantically: #375's President router registration and #411/#375's President schema/bootstrap additions are independent of Orders/Payment changes. Daphne #463 was already closed; #464/#475 landed independently. The original checkout's unrelated dirty operator UI files and prior stashes were preserved.

ChatGPT's temporary audit PR #484 is evidence only and is closed without merging; #481–#483 were consolidated into #479, not separate merged slices.

## Merged slice ledger

Exact PR head and merge commit provide rollback/review boundaries. Historical slice proof counts are in their A/B/C audit entries; final combined proof above is the current-source certification.

| Slice | PR | Exact head | Merge commit |
| --- | --- | --- | --- |
| A5 Orders writes | [#465](https://github.com/adamwright83-blip/bldg-admin-api/pull/465) | `bb3e517d7bdbe791b7ff5397d8026eaf4faf6bea` | `096ca68c72e4eb812b8f20d3f441394663ddd0c3` |
| B1 recovery truth | [#466](https://github.com/adamwright83-blip/bldg-admin-api/pull/466) | `ea16ec0998d829630efca31880ec6cfe48f8f0ca` | `464a44f55b238edb02615f5c4c5eb6e456f6288c` |
| B2 Payment read admission | [#467](https://github.com/adamwright83-blip/bldg-admin-api/pull/467) | `1d14f840e2f67b507599784b0e63aaae4927241e` | `c2d2564598f63fa0532cb9a4e063b8d1e864f8d7` |
| B3 Commercial world reader | [#468](https://github.com/adamwright83-blip/bldg-admin-api/pull/468) | `9f100aaa483a5c2deba785bfa40ab87b625f24fe` | `bd124b461a65480995d00b9453b02610a4a5579e` |
| B4 payment occurrence history | [#469](https://github.com/adamwright83-blip/bldg-admin-api/pull/469) | `67c7da0b04de46005cb94126198d1b78ec7954ea` | `1e93cac20001844105db8e7a4e1ecc57d6ca29d0` |
| C1 Orders history reader | [#470](https://github.com/adamwright83-blip/bldg-admin-api/pull/470) | `d4d3d983a77cae0a9b7440245f08929996eb5108` | `c9bc2eb14068b7c4edabd63ac456cb9fe6aee076` |
| C2 reminder payment proof | [#471](https://github.com/adamwright83-blip/bldg-admin-api/pull/471) | `c16a4432230cd416fd1c4a699e11a7b566bd60c3` | `95c63d3e0f5aa4a45ea7f9e0dfd5a9a7157cf0e2` |
| C3 captured dollars / unknown history | [#472](https://github.com/adamwright83-blip/bldg-admin-api/pull/472) | `90c7814192c6b486a3ff7eafbe3bb20268673777` | `7209fc50ab7876e878e58ca9d3300831c978258d` |
| B5 Tower Wars economic truth | [#473](https://github.com/adamwright83-blip/bldg-admin-api/pull/473) | `8687768de6b00d0c0a8a203c88b0aaf02b271b80` | `b146df4c356de982d44c158d75fbbe65b6daf25e` |
| C4 resident/referral source facts | [#477](https://github.com/adamwright83-blip/bldg-admin-api/pull/477) | `ff0da93f4ea515c7148e3884958d41c37490ec34` | `cf4893ef6d9c0ca0be444a9bf774de96f5439e96` |
| C5 admin/staff payment facts | [#478](https://github.com/adamwright83-blip/bldg-admin-api/pull/478) | `8f6e5a0417ed055cd0aeb6d50c877542c40a2ecc` | `fec1eb1d61a5c3809ea420f1260edf3f3f80f336` |
| C6 unknown money display | [#480](https://github.com/adamwright83-blip/bldg-admin-api/pull/480) | `130515b5e708ad0435a7dbaf210127361339b6ee` | `b05f9080589ba200d0c8a42a410619161ef70279` |
| C7–C9 freshness/vendor/capability readers | [#479](https://github.com/adamwright83-blip/bldg-admin-api/pull/479) | `45a4f746dc6e6a6fe74d01e018eacaf5c7def260` | `f9c97d9816d313093339dff4c85fb1ac84edb066` |
| C10 Strategy proof admission | [#485](https://github.com/adamwright83-blip/bldg-admin-api/pull/485) | `f9a44b05a8ad51b27555d4c0532dea2b17a6e2c6` | `dfe02b9c9958a8b76aff37d39814d735069fad14` |
| C11 Commercial capture-backed decision | [#486](https://github.com/adamwright83-blip/bldg-admin-api/pull/486) | `1e906576673efaa9b65638ec6e4ae8fd0a3ccf3a` | `c5e856e7420e11b06ccb509ce64e08923d26bfdc` |
| C12 delivery payment proof | [#487](https://github.com/adamwright83-blip/bldg-admin-api/pull/487) | `c4595de6c8796cb640c76b2e054ff9f3d3005922` | `4a7c8b6f88dc834a532f6865f42d8cfbe579f805` |
| C13 receipt occurrence window | [#488](https://github.com/adamwright83-blip/bldg-admin-api/pull/488) | `775960bcb04dd69433eb8bf67ae5b8ecc1918d83` | `cdc748f17e8a7dcff5e7dc06e0cc09c49b1a2b35` |
| B6 Command Sky source-bound wins | [#489](https://github.com/adamwright83-blip/bldg-admin-api/pull/489) | `2c074035e93a4144eaf8e2eb8f70d37c43b6543a` | `20b4b57e7ce94991027b5b13a42da600d9bbd0be` |
| C14 receipt API/vendor recipient binding | [#490](https://github.com/adamwright83-blip/bldg-admin-api/pull/490) | `10999361193dfdda4d49717ce8091e4866dc2ed7` | `d625d495b9140b6a24026a2f3b8167be71fe4e93` |
| C15 provider capture ownership | [#492](https://github.com/adamwright83-blip/bldg-admin-api/pull/492) | `4ed4b37ff1a97edd67d6566ad9b8b9521fc630c1` | `879759e81f60e6d46547a81ffb7f78711389dd77` |
| C16 prior-payment enrollment | [#493](https://github.com/adamwright83-blip/bldg-admin-api/pull/493) | `067986ab89471055756b032fd7e45f2caf1795d4` | `e29fbf71e653325c8bb64c914043f95daf244c33` |
| C17 unresolved historical tenant hold | [#494](https://github.com/adamwright83-blip/bldg-admin-api/pull/494) | `8685379b9bdf625e8f4211a27f0c02b3fd2da890` | `4bc98a0884cf74916050f45c34645e5f7a6ee587` |
| C18 CleanCloud customer admission | [#496](https://github.com/adamwright83-blip/bldg-admin-api/pull/496) | `9b0caa53212b87c80823ede13d175251c0ea42e2` | `bc1e03498a1087b0cbf25aac4b18708548a0e607` |
| C19 payment source availability | [#497](https://github.com/adamwright83-blip/bldg-admin-api/pull/497) | `d8b26cbdc0c1029b6719f74cb6f6298cd74b6a0c` | `4730030d8770025aebb555f966ad2e23ed6bd46d` |
| C20 CleanCloud economic import binding | [#498](https://github.com/adamwright83-blip/bldg-admin-api/pull/498) | `b7610b57543235fb4c4a1f7edfc925ffdb6ae286` | `85415cb7292e6803092cb5fe835f4f0325f7907c` |
