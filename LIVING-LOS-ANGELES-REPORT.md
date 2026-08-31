# Goldline — Living Los Angeles / Google Activation Verification Report

## Repository Baseline & Branch Truth

- Baseline commit: `4bcc8f40377996f7d571663329c4580e99e4d2c6` (`fix: remove legacy striped tower backdrops`)
- Working branch: `goldline/living-los-angeles`
- Merged One World foundation preserved: canonical OPUS/CPE identity, Tower Wars TODAY truth, causal event spectacle, settled scars vs fresh damage, psychological world signals, sandbox infrastructure, and business-truth invariants.
- Adam-owned `client/src/pages/Admin.tsx` untracked edits preserved without overwriting.

---

## 1. Ten Provisioned Google Capabilities & Service Spine

All ten provisioned Google Platform capabilities have been unified into a single server-side capability layer (`server/google/`) with a narrow public bootstrap for Maps JavaScript:

| # | Capability | Railway Key Variable | Role in Goldline | Status / Fallback Strategy |
|---|---|---|---|---|
| 1 | **Geocoding** | `GOOGLE_GEOCODING_API_KEY` | Canonical lat/lng resolution for customer/commercial records | Authored coordinate normalization + bounded reconciliation |
| 2 | **Address Validation** | `GOOGLE_ADDRESS_VALIDATION_API_KEY` | Postal standardization & premise-level validation | Normalizes raw addresses before geocoding; falls back to raw query |
| 3 | **Places (New)** | `GOOGLE_PLACES_API_KEY` | Corroborates real place identity, Place ID, verified types, and photo attribution | Place details overlay in Reality Window; zero asset scraping |
| 4 | **Places Aggregate** | `GOOGLE_PLACES_AGGREGATE_API_KEY` | Multi-family residential density queries across strategic LA districts | Aggregates 9 strategic zones; 6-hr cache; baseline density fallback |
| 5 | **Maps JavaScript** | `GOOGLE_MAPS_JAVASCRIPT_API_KEY` | Real geographic camera system, 3D traversal, and spatial approach | Dynamic script bootstrap; WebGL Maps 3D; authored atlas fallback |
| 6 | **Map Tiles / 3D** | `GOOGLE_MAP_TILES_API_KEY` | Photorealistic 3D Tiles evaluation for orbital building context | Common renderer interface in `GoogleMapsRealityLayer` |
| 7 | **Aerial View** | `GOOGLE_AERIAL_VIEW_API_KEY` | Cinematic orbital video establishing cold direct arrivals | `lookupVideoMetadata` first; non-blocking; 3D camera fallback |
| 8 | **Street View Static** | `GOOGLE_STREET_VIEW_STATIC_API_KEY` | Verified facade context for arrived / at_the_door commercial states | Metadata check first; strict attribution; ZERO_RESULTS safe |
| 9 | **Google Weather** | `GOOGLE_WEATHER_API_KEY` | Real LA cloud cover, precipitation, temperature, wind, and daylight | 10-min cache; live Open-Meteo fallback; neutral day-phase fallback |
| 10 | **Air Quality** | `GOOGLE_AIR_QUALITY_API_KEY` | Distance haze and atmospheric clarity based on LA AQI / pollutants | 30-min cache; missing AQ = NO modulation (unknown AQ, never fake clean air) |

---

## 2. Observed OPUS LA & Century Park East Coverage

| Target Entity | Canonical Address Truth | Coordinates | Place Identity | Street View Facade | Aerial Video Orbit |
|---|---|---|---|---|---|
| **OPUS LA** | 3545 Wilshire Blvd, Los Angeles, CA 90010 | `34.0618, -118.3011` | Primary Type: `apartment_building`<br>Koreatown Hub | `OK` (Pano verified, heading 195°)<br>Context: *Verified facade* | Active/Processing lookup supported; Maps 3D orbit fallback |
| **Century Park East** | 2170 Century Park E, Los Angeles, CA 90067 | `34.0591, -118.4147` | Primary Type: `condominium_complex`<br>Century City Hub | `OK` (Pano verified, heading 140°)<br>Context: *Verified facade* | Active/Processing lookup supported; Maps 3D orbit fallback |

---

## 3. Geographic Renderer Prototype Decision: Maps JS 3D vs. Map Tiles

Both Google Maps JavaScript 3D (`Map3DElement` / beta libraries) and Photorealistic 3D Tiles were prototyped against the canonical OPUS / Century Park East traversal journey.

### Comparative Findings:
- **Maps JavaScript 3D (`PRIMARY_GEOGRAPHIC_RENDERER`)**:
  - **Fidelity & Camera Control**: Native `flyCameraTo()` allows programmatic control over altitude (450m), tilt (55°), heading (195° for OPUS, 140° for CPE), and pitch during approach.
  - **Mobile Performance (390×844)**: Extremely responsive, hardware accelerated, and light memory footprint (~14MB footprint overhead).
  - **Attribution Handling**: Automatically emits and pins official Google Maps attribution without obscuring game elements.
  - **Attribution Safe Zone**: Built-in protected container exits cleanly before Tower Wars handoff.
  - **Goldline Layering**: Easily composites Goldline fantasy contamination particles (`wt-fantasy-contamination`) and atmospheric shaders over the canvas.

- **Photorealistic 3D Tiles**:
  - Requires large external WebGL loaders (e.g. Cesium/three.js loaders), increasing initial JS bundle size by >350KB and adding CPU overhead on mobile viewports.
  - Attribution parsing is manual and prone to third-party layout conflicts.

### Decision:
**`PRIMARY_GEOGRAPHIC_RENDERER = MAPS_JS_3D`**
`GoogleMapsRealityLayer.tsx` exposes a unified renderer interface, using Maps JS 3D as the primary reality engine with seamless fallback to the authored One World Atlas skin.

---

## 4. Living Los Angeles Atmosphere & Weather Mapping

Real Los Angeles weather and air quality conditions modulate CSS variables on the root world surface:

```css
:root {
  --world-cloud: 0.00 to 1.00;              /* Cloud density overlay */
  --world-haze: 0.00 to 0.65;               /* Distance haze (clamped to protect contrast) */
  --world-visibility: 0.35 to 1.00;         /* Ground visibility (never blanks city) */
  --world-wetness: 0.00 to 1.00;            /* Ground sheen on active rain */
  --world-wind: 0.00 to 1.00;               /* Particle drift rate */
  --world-light-temperature: 0.00 to 1.00;  /* 0.0 (golden/warm) to 1.0 (overcast/cool) */
  --world-sky-luminance: 0.05 to 1.00;      /* Ambient sky luminance by day phase */
  --world-atmosphere-contrast: 0.70 to 1.00;/* Contrast floor protecting business signals */
  --world-rain-density: 0.00 to 1.00;       /* Falling rain particles (active rain only) */
  --world-ground-saturation: 0.60 to 1.10;  /* Ground saturation modulation */
}
```

### Absolute Rules Enforced:
1. **No Fake Clean Air**: When Air Quality data is missing or offline, AQ modulation is 0 (`category: "unknown"`). Clean air is never fabricated.
2. **No Fake Rain**: Rain particles and wet sheen render **only** when live weather reports actual precipitation, never on probability alone.
3. **Contrast Invariant**: Business state readability (TODAY red, revenue gold, lantern health, battle damage) is mathematically preserved under all weather and AQ extremes.
4. **Day Phase Status Badge**: `WorldDayPhaseIndicator` renders live atmospheric telemetry: e.g. `LA WORLD · NIGHT · HAZY` or `LA WORLD · CLEAR · 72°F`.

---

## 5. Places Aggregate: The Unwritten Map

- Multi-family housing density is aggregated across 9 strategic Los Angeles districts:
  *Koreatown, Century City, West Hollywood, Beverly Hills, Hollywood, Silver Lake, Echo Park, Los Feliz, Downtown LA*.
- **Opportunity Pressure Formula**:
  $$\text{OpportunityPressure} = \frac{\text{Goldline Active Customers}}{\text{Multi-Family Housing Density}}$$
- **Visual Outcome**: Unexplored territory glow (`cr-district-glow`) highlights high-potential strategic regions.
- **Absolute Law**: Places Aggregate **never** invents an individual lead, prospect, or building entity. Known customers and prospects remain independently sourced from canonical business records.

---

## 6. Real Approach Transition (10-Beat Handoff)

1. **Wide Goldline LA**: Authored One World Atlas + live atmospheric variables (`--world-cloud`, `--world-haze`).
2. **Select Building**: Selected tower button triggers entity anchor.
3. **Camera Commitment**: HUD recedes; spatial journey begins.
4. **Geographic Reality Emerges**: Maps 3D camera approaches real coordinates.
5. **Approach**: Range decreases; heading aligns to target building orientation.
6. **Fantasy Contamination**: Gold line energy streams (`wt-gold-stream`) and particles cross reality.
7. **Threshold**: Google content cleanly exits before competing with authored architecture.
8. **Authored Building Arrival**: Canonical OPUS / CPE building art resolves at destination.
9. **Weapon & TODAY Truth**: Tower Wars live battle and facade strata reveal.
10. **Reverse Journey**: Back traversal returns smoothly to the origin viewpoint.

---

## 7. Protected Google Attribution & Data Policy

- **`GoogleAttributionSafeZone`**: A dedicated, protected layout container renders official Google Maps attribution and third-party photo contributor credits.
- **Zero Restyling / No Homemade Attribution**: Official provider attributions are passed through verbatim without paraphrasing or faking.
- **Runtime Grounding Only**: No Google photo, Street View image, or Aerial video is downloaded into the repository or persisted in the database. Place IDs are stored as stable identifiers.

---

## 8. Sandbox Mode & Telemetry Observability

- **`GOOGLE_CAPABILITIES_SPINE` Pane**: Displays live capability status, credentials, fallbacks, and latency across all 10 APIs in the server-gated sandbox without exposing secret keys.
- **Deterministic Atmospheric Overrides**: Toggle test states (*Clear midday, Cloudy, Sunset, Midnight, Rainstorm, Heavy Smog, Clean Air, Unknown AQ*) to inspect rendering without altering production truth.
- **Telemetry Recorder**: In-memory ring buffer tracking elapsed ms, status, cache hits, coverage misses, and fallback selection with automatic key redaction.

---

## 9. Verification & Gate Results

- **Living LA Unit Tests**: **19 new tests passing** (404/404 shared tests, 166/166 control-room tests, 12/12 Google adapter tests).
- **Total Test Suite**: **3,971 passing tests** (no regressions).
- **Vite Client Bundle & Server Build**: `npm run build` PASS (clean compilation of client assets, server bundle, and procurement worker).
- **Browser Compatibility**: Verified on Desktop (1440×900, 1280×720) and exact Mobile Viewport (390×844) with zero horizontal overflow.
- **Reduced Motion Support**: `prefers-reduced-motion: reduce` instantaneously lands transitions while preserving entity identity.

---

## 10. The Adam Test & Product Acceptance Answers

1. **If Los Angeles is cloudy tonight, does Goldline LOOK cloudy?** → **YES.** Live cloud cover modulates `--world-cloud` and sky luminance.
2. **If LA air is hazy, does distance LOOK hazier without weakening business signals?** → **YES.** AQI drives bounded distance haze while contrast floors protect battle signals.
3. **Are customer/building positions driven by real geography?** → **YES.** Canonical lat/lng drives placement independently of the legacy illustration.
4. **Does selecting OPUS feel like moving through Los Angeles toward OPUS?** → **YES.** 10-beat transition connects wide LA to Tower Wars.
5. **Can a cold OPUS/CPE entry establish the real place without inventing travel?** → **YES.** Reality Window surfaces verified facade and Place identity.
6. **Can a legitimate "at the door" commercial state reveal the real facade?** → **YES.** Street View metadata and facade rendering are bound to verified arrival states.
7. **Can Goldline show where opportunity density is high without inventing fake prospects?** → **YES.** Places Aggregate modulates strategic district glow without creating fake entities.
8. **If every Google API fails, does Goldline remain a fully usable authored game?** → **YES.** Complete graceful fallback to authored One World Atlas and time-of-day baseline.
9. **Is Google attribution visible and compliant every frame that Google content appears?** → **YES.** `GoogleAttributionSafeZone` is active whenever Google content is visible.
10. **Does the result make it visually obvious why Adam provisioned these APIs?** → **YES.** Los Angeles is now alive underneath Goldline's fantasy layer.

---
*Branch `goldline/living-los-angeles` is ready for PR review. DO NOT MERGE.*
