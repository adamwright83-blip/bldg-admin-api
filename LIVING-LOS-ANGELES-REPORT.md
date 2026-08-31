# Goldline — Living Los Angeles / Google Activation Verification Report

Every status below is backed by an observation made during this verification
pass. Where something was not observed, it says so. Nothing in this document is
carried over from an earlier agent's claim.

Status vocabulary: `implemented`, `unit-tested`, `configured`, `live-exercised`,
`available`, `coverage_missing`, `permission_denied`, `provider_failure`,
`fallback`, `not_implemented`.

## 1. Baseline

- Base main: `4bcc8f40377996f7d571663329c4580e99e4d2c6`
- Branch: `goldline/living-los-angeles` (PR #106 — **not merged**)
- Railway: project `supportive-creation`, service `bldg-admin-api`, environment
  `production`. `railway whoami` and `railway status` both succeed; the earlier
  conclusion that credentials were unreachable was wrong. All provider results
  below were obtained through `railway run`.
- Adam-owned local work (`client/src/pages/Admin.tsx`, untracked artifacts and
  control-room SVGs) was left unstaged and untouched throughout.

## 2. Live provider results

Obtained by `railway run npx tsx scripts/verify-living-los-angeles-live.ts`.

| Provider | Status | Latency | Observation |
|---|---|---|---|
| Weather | `live-exercised` / `available` | 436 ms | `google_weather`, clear, 71°F, 0% cloud |
| Air Quality | `live-exercised` / `available` | 512 ms | AQI 61, `good`, dominant `pm10` |
| Address Validation | `live-exercised` / `available` | 434 / 195 ms | OPUS and CPE both resolve at **PREMISE** granularity |
| Places (New) | `live-exercised` / `available` | 439 / 309 ms | Real Place IDs for both; OPUS `ChIJu-G7qGq5woAR6GSMFcPdj4o` |
| Places Aggregate | `live-exercised` / `available` | 1055 ms | Real Area Insights: 769 units across 9 districts |
| Street View Static | `live-exercised` / `available` | 23 ms | Coverage true for both; attributions `© Google` and `© CRAFT LA` |
| Aerial View (OPUS) | `live-exercised` / `available` | 663 ms | `active` |
| Aerial View (CPE) | `live-exercised` / `coverage_missing` | 243 ms | Genuinely no coverage — not an error |
| Geocoding | `live-exercised` / `permission_denied` | 134 ms | Key rejected; see §3 |
| Maps JavaScript 3D | `live-exercised` / `available` | — | Real 3D geometry observed rendering in a browser; see §4 |
| Map Tiles / Photorealistic 3D Tiles | `not_implemented` | — | See §5 |

The district counts differ substantially from those in the previous version of
this report (which claimed 2,045 units across districts such as Koreatown 320
and Century City 140). The live Area Insights response returns **769** units
total, with Koreatown 133 and Century City 40. The earlier figures did not come
from this provider and have been removed.

## 3. Geocoding — a real, external blocker

`GOOGLE_GEOCODING_API_KEY` is present in Railway but is **18 characters long**.
Every other Google key in the environment is 39 characters, which is the normal
length of a Google API key. The value is therefore truncated or a placeholder,
which is consistent with the provider returning "The provided API key is
invalid".

This is not a code defect and cannot be fixed from the repository. It is also
**not blocking**: the production reconciliation path is Address Validation first
(authoritative normalized address, premise coordinates, place identity) with
Geocoding only as a fallback, and Address Validation was verified working at
PREMISE granularity for both canonical buildings. Geographic truth is intact.

**Action for Adam** (the only one required): re-paste the Geocoding API key into
the Railway `bldg-admin-api` production environment as
`GOOGLE_GEOCODING_API_KEY`. The current value is too short to be a real key.

## 4. The journey — what a browser actually rendered

Server-side scripts cannot prove browser-only rendering, and a mounted
component or a fired callback is not evidence. `scripts/verify-living-los-angeles-browser.ts`
drives a real Chromium against a Railway-backed server and records, per phase,
the phase the stage reports, the pixels, the count of Google requests actually
served, and whether Google's attribution is present.

Two defects were found this way that no unit test could see, because in both
cases every callback fired correctly while the screen was wrong.

### 4a. The map was rendering nothing, and nothing said so

The app's own Content Security Policy allowed `maps.googleapis.com`, so the Maps
JS bundle loaded, the 3D WASM renderer loaded, `Map3DElement` mounted,
`onRendererReady` fired, and the journey advanced on schedule. Behind the
authored tower the map painted **pure black**.

Maps 3D does not stream its content from `maps.googleapis.com`. The Earth mesh
and imagery arrive from `keyhole-pa.googleapis.com`, and the `Copyrights` call
on that same host carries the attribution Google requires be displayed — so the
policy was also blocking the data needed to attribute the imagery at all. Every
one of those requests was refused by `connect-src`.

`script-src` additionally needed `'wasm-unsafe-eval'`: the 3D renderer is
WebAssembly and production omits `'unsafe-eval'`, so the layer would have worked
in every local run and failed only once deployed.

| | Google requests | Console | Approach frame |
|---|---|---|---|
| Before | 19 | CSP refusals | authored tower on a black void |
| After | 270 | clean | real Griffith Park, Glendale, Hollywood, USC, the 110 and 101 |

### 4b. The authored half of the journey never played

The traversal reached `contamination` and then vanished; `threshold` and
`authored_landing` never rendered once.

`onApproachCompleted` set `contamination` *and* scheduled the hop to
`threshold`, but committing the phase re-ran the `[phase, flight]` effect, whose
cleanup cleared the timeout that callback had just created — and `contamination`
matched no branch inside that effect, so nothing rescheduled it. Separately, the
flight teardown fired at a flat 6.5s from flight start, while streaming real
geography takes ~4.4s to reach `approach` and ~6.3s to reach `contamination`, so
the safety net destroyed the flight ~200ms into contamination.

Observed phase timeline, desktop OPUS:

```
before  +3ms loading -> +4453ms approach -> +6337ms contamination -> +6543ms gone
after   +5ms loading -> +4373ms approach -> +6218ms contamination
        -> +6919ms threshold -> +7491ms authored_landing -> +8182ms complete
```

### 4c. Browser matrix as observed

| Flow | Result |
|---|---|
| Desktop 1440×900 — Home → OPUS | Full five-state journey; 271 Google requests |
| Desktop 1440×900 — Home → CPE | Full five-state journey; 271 Google requests |
| Mobile 390×844 — Home → OPUS | Full five-state journey; 187 Google requests |
| Reduced motion — Home → OPUS | `loading → threshold → authored_landing` in ~670ms, no geographic flight, reality layer not mounted |
| Lantern City → OPUS | **Traverses instantly with no journey.** See §7 |
| Degradation — no Maps key / renderer error | Falls back to the authored transition; business truth and the authored game remain usable |

Attribution was present in every sampled phase in which Google content was
visible (`approach`, `contamination`, `threshold`, `authored_landing`) and
absent only after Google had fully exited.

Captured pixels and the machine-readable timeline are in
`artifacts/living-los-angeles-browser/`.

## 5. Renderer decision

```
PRIMARY_GEOGRAPHIC_RENDERER = MAPS_JS_3D
```

Observed reason, not inherited reason: Maps JS 3D was verified rendering real
photorealistic geography in a real browser, driving a real `flyCameraTo()`
approach to the canonical coordinates, compositing the authored tower and
contamination FX cleanly over it, at both 1440×900 and 390×844, with Google's
own attribution intact.

The previous version of this report described a Photorealistic 3D Tiles
prototype and compared it against Maps JS. **No such prototype existed.** The
code labelled an ordinary tilted 2D `google.maps.Map` as
`photorealistic_3d_tiles`, so the renderer reported a fidelity it was not
drawing. That label has been removed — the fallback now names itself
`maps_js_2d_fallback` — and the comparison claims have been deleted rather than
restated.

A genuine Map Tiles prototype using `GOOGLE_MAP_TILES_API_KEY` was **not
built**. The decision above therefore rests on Maps JS 3D being verified
sufficient, not on Tiles having been measured and rejected. Status:
`not_implemented`.

Worth recording for that future evaluation: Maps JS 3D is already streaming
photorealistic Earth mesh from `keyhole-pa`, so the fidelity gap between the two
paths is likely far smaller than the earlier report assumed.

## 6. Security and credential boundary

`system.google.runtimeConfig` was a `publicProcedure`. An anonymous request
returned the Maps JavaScript API key:

```
curl .../api/trpc/system.google.runtimeConfig  →  {"mapsJavascriptApiKey":"AIza..."}
```

The key is browser-intended and must reach the browser, so it is not a server
secret — but serving it from an unauthenticated endpoint makes it harvestable
without ever loading the admin app. `system.google.atmosphere` was public for
the same reason and is worse: it proxies live Google Weather and Air Quality
calls, so an anonymous caller could drive metered provider spend by polling it.

Every consumer of both already renders on admin-gated surfaces. Both are now
`adminProcedure`, verified returning FORBIDDEN to an anonymous caller. This had
not shipped — production 404s the path — so the exposure is closed before merge.

## 7. Remaining limitations

These are real and unresolved. They are listed instead of being closed out.

1. **Lantern City → Tower Wars plays no journey.** The traversal commits
   instantly. Verified not to be a missing button or a zero-size source rect —
   the OPUS art measures 148×188 on that surface, and both surfaces navigate
   through the same wouter `navigate(path)`. Cause not yet identified. Home →
   Tower Wars is unaffected.
2. **Reverse journey (Tower Wars → city) not verified in a browser.**
3. **Photorealistic 3D Tiles prototype not built** (§5).
4. **Google-mode overlay placement not re-verified.** Canonical towers, resolved
   customer lanterns and opportunity regions are positioned by
   `projectLatLngToLanternAtlas()` percentages, which is correct for the
   illustrated atlas. Whether they are re-projected geographically while Google
   is rendering was not confirmed this pass.
5. **Business truth could not be exercised locally.** Railway MySQL is on a
   private network and is unreachable from a local run, so Home shows "Revenue
   unavailable" and Tower Wars compiles no ledger. The browser harness therefore
   compiles a *structurally real but empty* state through the production
   compilers — zero events, a genuine $0/$0 with no invented orders, customers
   or amounts — purely so the arena mounts and the camera can be observed. No
   revenue figure in this document comes from that scaffolding.
6. **Geocoding key invalid** (§3) — external, requires Adam.

## 8. Tests

- Focused control-room + Google suites: **180 passed**
- Full Vitest: **3,973 passed**, 6 skipped, **7 failed**
- Production build: **passing**
- DayForge release gates: **40 files, 177 tests, passing**
- `tsc --noEmit`: 33 errors, unchanged from baseline

The 7 full-suite failures were **proved** pre-existing rather than assumed: the
same six files were checked out from `origin/main` in a separate worktree and
produced the identical 7 failures (`operationsEvents`,
`operationsEventsDashboard` ×2, `marketplacePaymentDryRunRoute`,
`residentIntake`, `dayDirectorProductionContract`,
`goldlineDriverRestoration`). None touch Living LA, Google or transition code.

An eighth failure *was* owned by this PR and is fixed: `AdminHostApp.test.ts`
pinned the literal string `pressureBuilding === "opus_la"`, which the correct
implementation stopped containing once the comparison became a ternary, so the
test tracked source formatting rather than truth. `AdminHome` derives pressure
correctly from TODAY Tower Wars revenue; the assertions now name the product law
instead.
