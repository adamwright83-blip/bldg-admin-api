# Day Line hygiene: close the duplicate "Call Dana" rows, the junk titles, and the test data

Status: **NOT RUN against production.** This is the exact, reviewed plan. Every id below was read
from production MySQL (read-only, `MYSQL_PUBLIC_URL` from `railway variables --service MySQL`)
on 2026-10-20. Re-read each row before acting; ids are stable, statuses may not be.

Scope: tenant `default`, Day Director actor `1` (the operator row the Day Line reads; it is not
`adam-admin`), table `day_director_commitments`.

## 1. The four open "Call Dana" commitments

| id | businessDate | title | provenance | decision |
|---|---|---|---|---|
| `a9205d11-573e-4ced-88fb-35f58ee6c7eb` | 2026-09-21 | Call Dana | user_reported | close (fold into the keeper) |
| `8baa4898-0bfd-4081-bd39-51b76d1e2a89` | 2026-09-22 | Call Dana | user_reported | close (fold into the keeper) |
| `cf7f48fb-2d57-45d7-a847-f4dc12bc2ff7` | 2026-09-29 | Call Dana Tuesday | user_reported | close (fold into the keeper) |
| `e758bb5d-7851-4b1b-80e7-a9317fef1ffd` | 2026-10-13 | Call Dana to resolve the overdue Louise follow-up | manual | **keep** as the one open thread |

Keep the most recent row because it carries the reason (the overdue Louise follow-up) and Adam's
own words on 2026-10-13 ("I will resolve this so that you never talk about it again").
The three older rows are the same commitment restated on later calls.

Closing is done through the governed overlay, never by `DELETE` or by flipping `status`.
`cancelDayLineItem` (server/planning/dayline/dayLineMutationService.ts) writes
`metadataJson.dayLine = { notPursuing: true, cancelledAt, cancelledBy, cancelledReason }`, and
`getDayDirectorState` then hides the row. Equivalent SQL, one row at a time, after reading it back:

```sql
-- Read first. Expect status='open' and no existing dayLine overlay.
SELECT id, title, status, JSON_EXTRACT(metadataJson,'$.dayLine') FROM day_director_commitments
 WHERE id IN ('a9205d11-573e-4ced-88fb-35f58ee6c7eb','8baa4898-0bfd-4081-bd39-51b76d1e2a89','cf7f48fb-2d57-45d7-a847-f4dc12bc2ff7');

UPDATE day_director_commitments
   SET metadataJson = JSON_SET(COALESCE(metadataJson, JSON_OBJECT()),
         '$.dayLine', JSON_OBJECT(
           'notPursuing', true,
           'cancelledAt', DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%dT%H:%i:%sZ'),
           'cancelledBy', 'adam-admin',
           'cancelledReason', 'duplicate of e758bb5d-7851-4b1b-80e7-a9317fef1ffd (same commitment restated); folded 2026-10-20'))
 WHERE tenantId='default' AND actorId='1' AND status='open'
   AND id IN ('a9205d11-573e-4ced-88fb-35f58ee6c7eb','8baa4898-0bfd-4081-bd39-51b76d1e2a89','cf7f48fb-2d57-45d7-a847-f4dc12bc2ff7');
-- Expect 3 rows affected. Then re-run the SELECT: overlay present on all three.
```

If Adam says the call to Dana happened, complete the keeper through
`completeDayDirectorCommitment` instead (it sets `status='completed'`, `completedAt`). If he
says "drop it", cancel the keeper with the same overlay and reason `operator: drop it`.

The item Claire actually keeps raising ("74 days overdue" on 2026-10-20) is not a commitment. It
is the open commercial follow-up `aea4bdae-c62d-4b27-833a-ab0181289f09` (pipeline 8, account 8
"The Louise", due 2026-08-07 22:00, note "Email Dana in 3 hours"). Closing the Dana rows does not
silence it. Resolve it through the pipeline: `completeCommercialFollowUp` with the real outcome,
or `rescheduleCommercialFollowUp` to a date Adam names, or `cancelDayLineItem` on its mission
(which sets `commercial_follow_ups.status='cancelled'`). Decide with Adam; do not pick for him.

## 2. The three junk titles (chopped voice fragments)

| id | businessDate | title | sourceText (what Adam said) |
|---|---|---|---|
| `7f913f53-d73a-4d6b-b388-b78719ba78d4` | 2026-10-15 | Before I leave work, I have to create new page for Laundry Farm | "before I leave work, I have to create a new page for our Laundry Farm landing page website." |
| `1019eee6-e53e-4a59-919e-32e08f5c77f3` | 2026-10-19 | Figure out how to get out in streets | "I have to figure out how to get out in the streets and hand printouts out to people and basically hype our fluff" |
| `5442b244-5668-4763-b348-b981c240f76a` | 2026-10-19 | Fold service in person to people and try | "fold service in person to people and try to find interested people that'll become customers" |

All three were written by `commitBriefing` after `compressTitle` truncated the utterance at the
8-word target mid-clause (the trailing "and try" is the cut point; the next word in the source is
"to"). The first one is real work with a bad title; the other two are one thought split on "and".

Preferred fix (keeps the work, fixes the title) via `editDayLineItem`, which stores the new title
in the overlay (`metadataJson.dayLine.displayTitle`) and leaves `sourceText` as provenance:

| id | new title |
|---|---|
| `7f913f53-…` | Create new Laundry Farm landing page |
| `1019eee6-…` | Hand printouts out to people in the streets |
| `5442b244-…` | cancel with reason `duplicate: same thought as 1019eee6 (split on "and")` |

Both replacement titles use only words Adam said. If Adam would rather drop them, cancel all three
with the overlay in section 1 and reason `junk title from chopped voice fragment, 2026-10-20`.

## 3. The test data read aloud on 2026-10-19 and 2026-10-20

"Jojo Test" is **not** a commitment. It is native laundry order **706** (`orders.id=706`, tenant
`default`, firstName "Jojo", lastName "Test", pickup 2026-10-19, delivery 2026-10-20, status
`new`, address "4321 los feliz blvd"). It reaches the Day Line as a pickup/delivery stop.
Remove it through the Orders boundary only (`transitionNativeOrderStatus` to `cancelled`, or the
admin order cancel action). Never `DELETE` an order row.

Also in production and matched by the new test-data guard: two open commercial follow-ups on
pipeline 6, account 6 "CODEX PROPERTY MISSION E2E 184fdf60 — SAFE TO ARCHIVE"
(`a34bdc71-8993-417e-acc0-52fcdd16e54b`, `e97ba04d-de06-4724-bb00-1458b6fdce9f`, both due
2026-08-07, note "Synthetic verification follow-up"). Cancel them with
`UPDATE commercial_follow_ups SET status='cancelled' WHERE tenantId='default' AND id IN (...) AND status='open'`.

## 4. The duplicate Los Feliz Towers follow-ups

Two open follow-ups, same building, two pipeline records and two `commercial_accounts` rows with
the same name (accounts 15 and 17, different identityKeys):

| follow-up id | pipeline | account | due | note |
|---|---|---|---|---|
| `2abcfcae-36bb-4276-a7cc-4aae62096bd2` | 15 | 15 Los Feliz Towers | 2026-09-27 16:00 | email him with collateral |
| `d4f4356e-da5e-45f8-9acf-aba76e1d50d9` | 17 | 17 Los Feliz Towers | 2026-09-28 16:00 | Email him the collateral |

Keep `d4f4356e-…` (later, same action). Cancel `2abcfcae-…` with the follow-up UPDATE above and a
pipeline event noting `folded into d4f4356e-da5e-45f8-9acf-aba76e1d50d9`. "The Louise" (account 8)
and "The Louise Los Feliz" (account 10) are two account rows for one address; the reader should
speak one line per building (see the hand-over note), and the accounts should eventually be merged
by a human, not by this script.

## 5. How to verify after running

Place no call. Call `buildShowrunnerBriefing` for `morning_readiness` in a read-only script (or
read `GET /api/trpc/system.field.today`) and confirm the opening contains none of: "Jojo Test",
"Figure out how to get out in streets", "Fold service in person", "Call Dana" more than once,
"Los Feliz Towers" more than once, "CODEX" or "E2E".
