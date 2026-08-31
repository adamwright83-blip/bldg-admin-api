# Goldline — Living Los Angeles / Google Activation Verification Report

Every status below is backed by an observation made during this verification
pass. Where something was not observed, it says so. Nothing in this document is
carried over from an earlier agent's claim.

Status vocabulary: `implemented`, `unit-tested`, `configured`, `live-exercised`,
`available`, `coverage_missing`, `permission_denied`, `provider_failure`,
`fallback`, `not_implemented`.

## 0. Scope — nine integrated capabilities, one deferred

This PR integrates **nine** Google capabilities. It is not a "ten capability
activation", and earlier wording that said so was wrong.

- **Production-integrated and live-exercised (7):** Weather, Air Quality,
  Address Validation, Places, Places Aggregate (Area Insights), Street View
  Static, Maps JavaScript 3D.
- **Integrated, exercised, partial real-world coverage (1):** Aerial View —
  active for OPUS, genuinely `coverage_missing` for Century Park East. That is
  a true fact about the world, not a failure.
- **Integrated, exercised, failing on configuration (1):** Geocoding — the
  Railway key is malformed, so it returns `permission_denied`. Not blocking;
  it is fallback only behind Address Validation, and it is Adam's to fix (§3).
- **Deferred, not implemented (1):** Map Tiles / Photorealistic 3D Tiles. No
  prototype was built, nothing was rendered, nothing was measured, and no
  comparison against Maps JS 3D was performed. `GOOGLE_MAP_TILES_API_KEY`
  remains provisioned and unused.

Maps JS 3D is the production geographic renderer for this PR because it has
been observed working end to end, not because Tiles was evaluated and
rejected.

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
| Map Tiles / Photorealistic 3D Tiles | `not_implemented` — **deferred from this PR** | — | Never implemented, never exercised, never compared. See §5 |

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
| Lantern City → OPUS | Full five-state journey (see §4d) |
| Reverse — Tower Wars → city | Full five-state reverse; correct entity and return context (§4f) |
| Overlay geography in Google mode | Zero atlas-positioned overlays; renderer-native markers at canonical coordinates (§4e) |
| Degradation — no Maps key / renderer error | Falls back to the authored transition; business truth and the authored game remain usable |

Attribution was present in every sampled phase in which Google content was
visible (`approach`, `contamination`, `threshold`, `authored_landing`) and
absent only after Google had fully exited.

### 4d. The journey was being lost to query cache temperature

Lantern City → Tower Wars committed instantly while Home → Tower Wars played the
full journey, with identical wiring, identical navigation and a healthy source
rect on both surfaces.

Tower Wars early-returns a "waiting for revenue truth" panel while
`towerWars.today` is null, so on a cold cache the arena — and therefore every
entry in `pieceRefs` — does not exist on the first render. `arrive()` was called
exactly once on mount with `pieceRefs.current[enteredFor] ?? null`, took the
null, correctly declined to fabricate a flight from missing geometry, and was
never retried because its dependencies never changed.

AdminHome already queries `towerWars.today`, so entering from Home found a warm
cache and a laid-out arena; Lantern City does not query it at all. The traversal
was being decided by React Query cache temperature rather than by anything about
the journey. `arrive()` now waits for real destination geometry and is retried
when it appears.

Observed after the fix:

```
+0ms (no stage) -> +125ms loading -> +4530ms approach -> +6321ms contamination
-> +7018ms threshold -> +7595ms authored_landing -> +8280ms complete
```

### 4e. Overlay geography — nothing atlas-positioned over real geography

Every entity overlay was positioned by atlas percentage and rendered in **both**
view modes, so all four classes were lying spatially whenever Google was
visible. The canonical towers were additionally clamped into an 8–94% box,
making their position a composition choice rather than a location. Only the
neighbourhood labels were correctly gated to the atlas.

The percentages were habit, not a data limitation: customers and pursuits carry
`latitude`/`longitude` alongside the atlas `x`/`y`, districts carry a real
`center`, and towers carry canonical coordinates.

Canonical towers, customer lanterns and pursued commercial locations are now
placed **renderer-natively** as `Marker3DElement` / `Marker3DInteractiveElement`
at their real coordinates whenever the 3D renderer is active, and the
atlas-percentage DOM overlays are not rendered at all in that mode.
`projectLatLngToLanternAtlas()` remains in use only for the illustrated JPG.

Observed on Lantern City:

| | atlas mode | Google mode |
|---|---|---|
| tower anchors (%) | 2 | **0** |
| district glows (%) | 9 | **0** |
| lanterns (%) | 0 | **0** |
| pursuit flames (%) | 0 | **0** |
| neighbourhood labels (%) | 9 | **0** |
| renderer-native 3D markers | 0 | **2** |

Marker coordinates were asserted, not just counted — present is not the same as
correct:

```
[{"label":"Century Park East","lat":34.0591,"lng":-118.4147},
 {"label":"OPUS LA","lat":34.0618,"lng":-118.3011}]
```

Those are exactly the canonical coordinates. In the establishing frame over
downtown LA both markers are correctly *off-screen*, because Koreatown and
Century City genuinely are not in that view — previously they were pinned into
frame regardless of where the camera was looking.

**Deliberate deferral — opportunity regions.** Districts are areas of pressure,
and the data carries only a `center` point, not a boundary. Drawing a point
marker for a region would assert a precision that does not exist, so the
opportunity layer is hidden while Google is rendering rather than misplaced. It
remains fully present on the authored atlas, which is what it was drawn for.

**Not verifiable locally — customer lanterns and pursuits.** Railway MySQL is
unreachable from a local run, so there are zero geocoded customers and zero
pursuits to place; both counts are 0 in *both* modes above. The code path that
converts them to coordinates is exercised by the same `geographicEntities` prop
that the towers use, but it has not been observed carrying real records. This
is honest scaffolding-limited coverage, not a pass.

### 4f. Reverse journey

Verified once, end to end, in a real browser.

| Check | Result |
|---|---|
| Cold deep link fabricates a journey | **false** — `/growth/tower-wars?building=opus_la` entered cold shows no transition stage |
| Stale transition after outbound landing | **none** — stage is null once landed |
| Reverse plays the full grammar | `loading → approach → contamination → threshold → authored_landing` |
| Same canonical entity | `data-world-entity="opus_la"` |
| Return context | returns to `/`, the surface the journey departed from |
| Reduced-motion reverse | `loading → threshold → authored_landing` in 531ms, returns to `/` — same short grammar as the reduced-motion outbound |

Captured pixels and the machine-readable timeline are in
`artifacts/living-los-angeles-browser/`.

## 5. Renderer decision

```
PRIMARY_GEOGRAPHIC_RENDERER = MAPS_JS_3D
```

Chosen because it was observed working: real photorealistic geography rendering
in a real browser, a real `flyCameraTo()` approach to the canonical
coordinates, the authored tower and contamination FX compositing cleanly over
it, at both 1440×900 and 390×844, with Google's own attribution intact
throughout.

**Photorealistic 3D Tiles is deferred from this PR.** It was not implemented,
not prototyped, not rendered, not measured, and not compared. Any earlier
statement in this repository describing a Tiles prototype or a fidelity /
performance / attribution comparison was false and has been removed. What
actually existed was a code path that labelled an ordinary tilted 2D
`google.maps.Map` as `photorealistic_3d_tiles` — a renderer reporting a
fidelity it was not drawing. That label is gone; the fallback now names itself
`maps_js_2d_fallback`.

No second renderer was built to satisfy that earlier promise. Maps JS 3D
satisfies the intended experience and is the production renderer.

### Future work (not a commitment made by this PR)

A genuine Photorealistic 3D Tiles evaluation using `GOOGLE_MAP_TILES_API_KEY`
remains open, and would need to compare fidelity, camera choreography, startup
latency, mobile performance, overlay compositing, attribution obligations and
coverage against what Maps JS 3D now demonstrably delivers. Worth recording for
whoever picks it up: Maps JS 3D is already streaming photorealistic Earth mesh
from `keyhole-pa`, so the fidelity gap between the two paths may be much
smaller than previously assumed.

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

These are real. They are listed instead of being closed out.

1. **Photorealistic 3D Tiles deferred from this PR** (§0, §5). A deliberate
   product scope decision, not an oversight. Nothing was implemented,
   prototyped, rendered, measured or compared, and no wording in this
   repository should imply otherwise.
2. **Customer lanterns and pursued locations were not observed carrying real
   records in Google mode** (§4e). The coordinate path they use is the same one
   the canonical towers were proven on, but with no geocoded data reachable
   locally, both counts were zero in both view modes — so this is
   scaffolding-limited coverage, not a pass.
3. **Opportunity regions are intentionally hidden while Google renders** (§4e).
   The data carries a district `center` but no boundary, and a point marker
   would assert a precision that does not exist. Documented decision, not a gap
   to be silently filled.
4. **Business truth could not be exercised locally.** Railway MySQL is on a
   private network and is unreachable from a local run, so Home shows "Revenue
   unavailable" and Tower Wars compiles no ledger. The browser harness therefore
   compiles a *structurally real but empty* state through the production
   compilers — zero events, a genuine $0/$0 with no invented orders, customers
   or amounts — purely so the arena mounts and the camera can be observed. No
   revenue figure in this document comes from that scaffolding.
5. **Geocoding key malformed** (§3) — Railway configuration owned by Adam, and
   explicitly out of scope for this PR. Not blocking: Address Validation-first
   reconciliation is live-proven at PREMISE granularity for both canonical
   buildings, and Geocoding is fallback only.

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
