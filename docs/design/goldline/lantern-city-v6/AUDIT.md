# Lantern City V6 audit

Baseline: `1368cc6`, main. Work branch: `codex/lantern-city-v6`.

The read-only audit preceded implementation. V5 files remain unchanged. Existing untracked handoff, art exports, screenshots, and atlas-v3 are user work and are excluded from this change.

## Findings

- `LanternCityAtlas` polls the geographic atlas every 15 seconds and city entities every 5 seconds. It independently places customers, pursuits, frontier objects and chrome.
- `customerGeography` clusters real records by normalized premise. Strongholds use canonical street-address identity or the existing geographic cover test. Customer cadence comes from the server, not screenshot counts.
- `lanternTerritories` classifies WGS84 polygon membership and derives guarded/conquered occupancy. The canonical ID for DTLA is `downtown`. Initial conquest and live cleared/pressureReturned history both matter.
- `LanternTerritoryStateLayer` separately derives cadence mix, fetches a 7680×4320 registered mask manifest, positions nameplates, and renders tint plus texture. The masks remain geographic evidence, not authored V6 display geometry.
- `LanternEnvironmentalProps` hashes independent positions for rat/roach, trash, vines or construction assets. These are supporting isolated props. The inspected construction asset is a palace scaffold, not a neglected LA landscape.
- `WorldGeographySurface` separately positions canonical towers and owns older presentation CSS. `CityTowerButton` initiates a geographic transition into `/growth/tower-wars?building=<id>`. Tower damage comes solely from evidence-sufficient `towerWars.today`.
- The V5 master is dense city artwork. Existing territory-v2 images are vector street-map exports, not painterly neighborhood state plates. They cannot meet the reference by being enlarged or tinted.
- Existing `WorldEntityInspector`, recovery arsenal, campaign chronicle and frontier intelligence provide real workflows worth retaining.
- Existing QA uses a local disposable MySQL database on port 3399 and proof server on port 4177. Its data is a test fixture, not current production evidence.

## Art experiment

A neutral atlas candidate was generated through the built-in image tool and saved in `art-candidates/neutral-atlas-draft.png`. It creates quiet clearings, but reads as tan vacant development lots and is less painterly/vibrant than the approved reference. It is **not accepted** and is deliberately not wired into the runtime. This experiment does not solve cross-state registration, environmental continuity or the authored neighborhood plate dependency.

## Boundaries

The V6 environment skin does not replace shared territory state. Mid-City and West Hollywood can wear empty-land decay while retaining guarded/conquered occupancy and true zero counts. For populated districts, existing cadence-derived state wins; no screenshot counts are injected. Dormancy is not the same as absence of customers.
