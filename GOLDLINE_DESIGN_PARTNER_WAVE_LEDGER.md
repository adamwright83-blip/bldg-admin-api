# Goldline design-partner wave ledger

START_SHA: 522de90fa0e57d208c05a01fbd5edd15b00b813f
START_TAG: goldline-design-partner-start-20260904-104128-522de90f (pushed)
Working directory: /Users/adamwrightpfi/Desktop/goldline-v1 (existing main worktree; original checkout on geography branch left intact).

## Slice 0 — archaeology / assets
- Auth/tenant: server/_core/trpc.ts tenant procedures; server/saas/tenantAccess.ts. Existing-world compatibility must query canonical entities/territories, never reset them.
- Lantern City: components/admin/control-room/LanternCityAtlas.tsx, server/goldlineWorld/cityWorldService.ts.
- Territories/veil/Guardians: shared/goldlineTerritoryCompiler.ts, shared/goldlineTerritories.ts, server/goldlineWorld/territoryService.ts; TerritoryWorldLayer/TerritoryVeilLayer.
- Chronicle/evidence: server/goldlineWorld/worldEventStore.ts; identityResolver.ts; fieldJournalProcessingService.ts.
- Campaign: goldlineWorld/campaignService.ts, campaignTravelAdapter.ts; shared/goldlineCampaignRuntime.ts.
- Driver runtime: pages/driver/GoldlineDriverController.tsx; game/expedition; pages/goldline/Day1FieldMission.tsx; Today’s Line/openChannel.
- Geography: server/geography/geographicTruthService.ts and GoogleGeocoder. Real-place infrastructure: server/territory and commercialPipeline.
- Import: server/saas/tenantImportService.ts, tenantImportProviders.ts, saasStore.ts; existing normalized external customers, no second database.
- Voice: existing journal capture/transcription infrastructure; onboarding typing must remain unconditional.
- Cargo: authoritativeCargo.test.ts tests expedition pickup evidence. No physical Vehicle Cargo UI found. Orders have new/collected/processing/ready/delivered statuses; ready alone does not establish in-vehicle custody. Explicit transfer evidence required.
- Admin: App.tsx, AdminHostApp.tsx, admin/adminPaths.ts; /new-order /customers /operations portals.
- Tower Wars: shared/towerWars.ts and server/towerWars; existing hardcoded comparable building rules need careful bypass preservation.
- Existing onboarding: SaaS setup in DayforgeOnboardingPage, not five-question world onboarding.

### Asset audit
Found supplied archive on Desktop. Installed at client/public/assets/goldline/procedural-world-v1. All 11 PNGs decoded with Pillow; exact dimensions, nonzero-alpha bounds, transparent/partial counts in audit.json. Production pack is 2:1 dimetric-style strategic art; supplied projection.json has proposed normalized pivots/sockets. Contact sheet visually inspected. Scale is reusable presentation, never literal geographic scale.
Four bridges are TWO canonical geometries plus exact 180° rotations (pixel-difference verified). Rotated derivatives invert upright architecture: use upright 03 and 05. Generic island contains illustrated buildings: these are explicitly fantasy scenery, never customer holdings. No dynamic labels are baked in. Single lush city artwork is not climate-specific. Background itself has alpha: composite over opaque water. Vehicle-shell art absent from this pack; final cargo art requires review.

## Execution status
Slice 0: complete; kit audit installed. Commit tracked in git history.
Slices 1–9: pending.
Production has not been modified beyond pushing the rollback tag.

## Slice 1 — tenant domain / interpreter
Added durable tenant-keyed JSON session with optimistic version checks, five sequential answers, separate strict AI interpretation via existing configured invokeLLM abstraction, and canonical-world bypass. Additive required startup migration. Raw answers cannot write customer/order/world evidence. Four domain tests pass. Broad typecheck started; results tracked below. No production data touched.

## Slice 2 — five-question scene
World-first full-bleed interview, one required answer at a time, answer-specific echo, durable resume, optional browser mic reused from existing browserSpeechRecognition utility. Typing always works. New worlds enter from Admin world home; existing worlds bypass. Initial scene projection never writes business facts. Browser proof deferred until compositor/reveal fixture is connected. Not yet claimed release-complete.

## Slice 3 — topology / Water-Land
Renderer-independent deterministic local graph and separate WATER_LAND registry/compositor. Anchor provenance and evidence-derived known state. Same compositor tested for LA/Phoenix/Atlanta/Dallas. 1/4/9-island socket transforms and both-endpoint alignment tested (8 tests pass). Canonical upright bridge artwork reused; no per-city layout offsets. Measured deck/shoreline sockets are code-owned calibration distinct from kit's approximate anchors. SVG labels dynamic. Visual browser audit pending.

## Slice 4 — customer import
CSV preview reuses existing parser and normalized tenant import spine. Stable identity hashes deduplicate repeated data through existing unique keys; no second customer database. Tolerant headers, quoted fields, incomplete rows retained for review; no map placement without geocoding. Explicit preview/import/skip UI. Three focused tests pass. Screenshot import is not reused because no equally safe general customer adapter was identified. End-to-end persistence/geocoding proof pending.

## Slice 5 — first mission
Durable primary Territory Scout compiled from interpreted objective/avoidance and canonical local geocode, with existing Guardian roster. Uses real GoldlineOverworld traversal callback and GuardianEncounter runtime. Atomic tenant-locked evidence write + session update; gameplay traversal does not create evidence, report requires explicit presence attestation, GPS remains context, Guardian defeat remains game_projection and requires saved report. Completion persists across day boundaries. No synthetic customer/contact/order. Full loop browser/DB proof pending; deployment not yet claimed.
