# Sales truth audit

Original main: `045f96f96db671f2b7dba54440408a688cb50521`.

KEEP: `canonicalRevenue` is the revenue authority; `paidOrderLedger` deduplicates
CleanCloud report twins by order ID and retains signed amounts. Identity resolution
uses connected phone/email/resident/CleanCloud ID evidence, never names alone.
Source coverage owns freshness and completeness. Business periods already implement
comparable MTD. Authority Receipts remain consequential-action authority.

EXTEND: independent company/service-line dimensions; ingestion receipts; historical
source certificate; canonical reconciliation before every business metric.

REPLACE: sibling-company language in Claire; customer/composition/proactive reads
that consume unreconciled ledger events.

DO NOT TOUCH: President, Mitch, Honcho, Small Comforts, Lost Property; P&L and
settlement semantics; positive-payment bridge invariants.

MISSING: durable cross-system same/distinct decisions (explicit links currently
exist only as reconciliation inputs), complete residential lookup in the live
account path, proactive trend artifacts, production historical certificate.

The native ledger requires Stripe evidence. CleanCloud twins prefer Orders net
amount (`Total after Credit Used`) and payment date. Suspected customer/day/amount
cross-source matches are withheld by canonicalRevenue, but customer metrics and
composition currently bypass that reconciliation. Negative amounts survive the
ledger; positive-payment growth bridges intentionally exclude them. CSV normalizer
retains credit/discount/subtotal/raw provenance. Browser ingestion is transactional
and idempotent by tenant/order/report and has digest/counter receipts; browser
range validation is limited to 32 days. Commercial account lookup reads only
commercialAccounts, separate from residential order identities.

Local exports independently reproduce 533 unique Orders, 492 unique Revenue,
zero missing Revenue IDs, 41 Orders-only IDs, and 2,724,697 cents in Revenue and
matching Orders net. Three overlapping orders differ from Orders gross Total.
Order 141 is a paid -1,000-cent net refund absent from Revenue. Raw exports stay
outside the repository. These controls prove the supplied exports, not production
completeness, processor settlement, or service-line attribution.
