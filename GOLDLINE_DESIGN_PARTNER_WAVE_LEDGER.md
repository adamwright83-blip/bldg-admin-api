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

## Slice 6 — Vehicle Cargo
Built real Driver affordance and full vehicle view. Additive explicit custody ledger separates unassigned real pickups, in-vehicle unprocessed, at processor, and in-vehicle processed; delivered/cancelled orders disappear. Physical transfers require user confirmation; GPS cannot mutate custody. Per-driver vehicle id and tenant joins prevent cross-tenant cargo. Existing order status supplies authoritative pickup/ready/delivered constraints, while the custody ledger supplies physical holder. View uses an honest CSS/SVG-like x-ray schematic because no production vehicle shell asset exists. Visual art is a user review item. Persistence DB proof and processor-location prompt browser proof pending.

## Slice 7 — solo Tower Wars
Added general arena projector with explicit zero, founding, ghost and holding rivalry modes. Tests prove zero creates no tower; founding enemy is labelled fictional entropy; ghost requires and displays actual prior cents; rivalry uses two supplied legitimate holdings. Generalized new-tenant presentation component added without changing Adam's two-building legacy arena. Wiring new-tenant Tower Wars route to evidence query remains pending before release claim.

## Slice 8 — reveal / day two
Commit bb97d4e. The reveal renders counts it actually computed (deterministic territory count, evidence-derived known/unmapped), one primary mission CTA and the New Order / Customers / Active Orders portals. Two real day-two defects fixed: a completed session routed to the persistent world rather than the interview, and Driver no longer pins itself to the first mission forever — it hands back to the real controller once field evidence is recorded AND the fictional encounter is closed. The reveal is never mounted without the world and mission it dereferences.

## Slice 9 — design-partner release proof
Commits fcd4229, 8ea5d30. Three personas exercise the real compilers: LA laundry route (evidence-lit territories, playable scout, two-holding rivalry), Phoenix (same compositor/skin, different city, no hardcoded geography, Founding Siege), Atlanta (CSV duplicates collapse, unresolved rows stay unresolved, no filler holdings). Truth-falsification suite pins the firewall at its breakable points.

Regressions found and fixed: three suites (driverMobileActions, adminDriverLiveSync, commercialMissionBuilderContract) pinned the literal text of Driver's default return, which Slice 6 changed by rendering Vehicle Cargo alongside the controller. Each now asserts the law, not the spelling.

Baseline comparison at START_SHA 522de90: 5 failures reproduce (operations-event ×3, resident-intake, marketplace dry-run) and 42 TypeScript errors. Final state: same 5 failures, same 42 errors, 4630 tests passing, build clean.

## Routing + WRIGHT CONTRACTORS demo wave
Commits 57cfe31, e388de9, 441816f, 326d587, fdd5c18, c931b87, f1db49a, 15fc48c, d82fd88.

Routing: bldg.chat → www.bldg.chat public landing (unchanged). admin.bldg.chat/onboarding is first-run onboarding; admin.bldg.chat is the returning-customer world. driver.bldg.chat untouched. Vercel rewrite added for /onboarding.

Demo access: dark unless GOLDLINE_DEMO_BYPASS=true (routes 404, client renders nothing). One compile-time fixture tenant goldline-dp-wright-contractors that no request can steer; server refuses to boot if that id ever collides with a real tenant; reset scoped to that tenant alone. laundry_farm was deliberately NOT reused — it is a real legacy tenant id and live business unit.

Production defects found only by live verification, all fixed:
- goldline_world_events did not exist in production. migrate.mjs never runs drizzle/*.sql, so the first mission's evidence write would have failed at RECORD FIELD OUTCOME. Now created by the bootstrap.
- physical_entities and goldline_territory_definitions likewise missing, which made the onboarding state query return 500 for every tenant. Now created, and hasExistingWorld can no longer be taken down by one missing table.
- GOOGLE_GEOCODING_API_KEY is the literal placeholder "your_generated_key" and every real Google key on the deployment is restricted to its own API, so geocoding answered REQUEST_DENIED. Added a Places Text Search fallback reporting provider google_places_text_search, never overstating provenance.
- Places answered a prose service-area description with a bowling alley. Added geocodableServiceArea (one resolvable place name covering all described areas) and an area-type filter that returns ambiguous rather than anchoring a world to a storefront.
- ANTHROPIC_API_KEY was unset; the existing ANTHROPIC_API_KEY_GoldlineAdminProduction is now referenced.
- The demo reset became unreachable after completion, so the demo could run once. /onboarding now shows a handoff with the reset control when demo access is on.

LIVE VERIFIED on admin.bldg.chat: /onboarding entry → BYPASS LOGIN → five scenes → interpret (claude-sonnet-4-6, provenance ai_interpretation) → skip CSV → reveal → redirect to admin root; reload keeps the world and never returns to the interview; /growth/tower-wars shows the truthful ZERO_HOLDING state with no fabricated tower; revisiting /onboarding leaves session id, topology id and completedAt unchanged; RESET returns to question one.

USER REVIEW: West Los Angeles resolves to a viewport yielding 1 territory. That count is deterministic from real extent and inflating it would break the truth firewall, so the divisor in compileLocalWorld is a deliberate tuning question, not a defect.
