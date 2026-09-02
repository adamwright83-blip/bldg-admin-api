# GOLDLINE V1 ONE-WORLD WAVE — LEDGER

| | |
|---|---|
| Starting main SHA | `6ccc2037832cd2aaa27a2d7b18ea9adf1689c954` |
| Branch | `claude/goldline-v1-one-world` |
| Branch start SHA | `6ccc203` |
| Wave start | 2026-09-02 |
| Current phase | A (playable city) |
| Current slice | 1 |

Status vocabulary: NOT STARTED · IN PROGRESS · ALREADY SATISFIED ·
IMPLEMENTED · BLOCKED · HUMAN PROOF REQUIRED

---

## SLICE 0 — AUTH + REPRODUCIBLE LOCAL WORLD — **IMPLEMENTED**

**Starting-state evidence (runtime).** Authenticated Admin surfaces returned
403; after login, `canonicalBuilding.world` and
`admin.countNewCoordinatedRequests` returned 500 on missing tables. Lantern
City rendered blank.

**Ownership trace (git + provisioning, not grep).** `scripts/migrate.mjs` is
the production bootstrap (`pnpm start`) and contains zero references to
`bldg_users` / `service_requests`. No `drizzle/*.sql` creates either — `0015`
creates the different `vendor_peer_service_requests`. `service_requests`
entered the schema in "Add Requests tab: coordinated requests from resident
app"; `bldg_users` came with the initial baseline.
`scripts/check-bldg-users-columns.mjs` exists to INSPECT the upstream shape.
**Conclusion: upstream (app.bldg.chat) owns them. Default 0B applied — no
production migration change.**

**What changed.** Added `scripts/goldline-admin-dev-setup.ts` (+ npm script),
a committed dev/test harness creating upstream-compatible stand-ins on a
disposable localhost DB. Double-guarded: refuses without
`GOLDLINE_ADMIN_DEV_SETUP=true`, and refuses any non-localhost DATABASE_URL.
Columns mirror `schema.ts` exactly, not just the subset today's queries read.

**Verification.** Dropped the database entirely and rebuilt from committed
scripts only. Lantern City renders 2 lanterns / 2 towers with deterministic
phases (-6.79s, -1.35s) — identical to the pre-drop run.

**Caveat.** Admin auth uses the legitimate `POST /api/auth/login` dev path; no
production authorization was bypassed or modified.

---

## SLICE 0b — MOUNT REGRESSION — **IMPLEMENTED**

**Why.** Commit `612af8c` spliced a helper between `export default` and
`function LanternCityAtlas(`, making `lanternPhaseSeconds` the default export.
Lantern City went blank. tsc passed, the build passed, and the ambient tests
passed because they assert source text.

**What changed.** `lanternCityAtlasMount.test.ts` asserts module/runtime
semantics: the default export is named `LanternCityAtlas`, is not a helper that
returns a number for a string, and has component arity.

**Verification.** Reintroduced the exact broken shape: the new guard **fails 2
tests** (`expected 'lanternPhaseSeconds' to be 'LanternCityAtlas'`) while the
old source-text suite **still passed 10/10** — proving source assertions would
have shipped the blank page again.

**Standard adopted.** Visual slices now require mount proof AND behaviour proof.

---

## PHASE A — PLAYABLE CITY

| Slice | Status | Note |
|---|---|---|
| 1 world interaction language | IN PROGRESS | hover/focus partly done for lanterns + towers |
| 2 one excellent tower loop | NOT STARTED | OPUS LA locked, do not re-audit |
| 3 Tower Wars game feel | NOT STARTED | swing/recoil/projectile already exist |
| 4 Guardians as characters | NOT STARTED | engine + dialogue exist; manifestation is the work |
| 5 Strongholds legible | NOT STARTED | |
| 6 regeneration completes loop | IMPLEMENTED (visual proof pending) | dated evidence → projection → facade |
| 7 territory strategic | NOT STARTED | renders today; strategic legibility is the work |
| 8 Gold Line direction | NOT STARTED | |

### Already-landed work on this branch
| Commit | What |
|---|---|
| `f7c1d98` | Lantern City takes the screen |
| `eeea496` | City can heal, not only scar |
| `6a72b3e` | Healing dated + rendered on facade |
| `bad1d73` | Home: world takes the page |
| `0137991` | Restored a caption fix wrongly discarded |
| `c7d8060` | Regeneration sourced from real pickup instant |
| `e5aaef4` | OPUS geometry unified to one source |
| `612af8c` | Lantern ambient life (introduced the blank-page bug) |
| `1b961d3` | Tower presence in identity colours |
| `119f85d` | Fixed the blank page |

---

## DEFERRED (Phase F)
- `waywardStage.spec.ts:14` runner-timing sensitivity.
- `adminLiveModel.test.ts` brittle source-string assertion.
