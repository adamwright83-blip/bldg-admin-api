# Goldline: One World verification report

## Repository truth

- Base: `276f807`
- Branch: `goldline/one-world`
- Phase commits: `0c54ab6`, `05470b1`, `8975e42`, `12d3885`, `3de62c5`, `df7b402`, `1f24568`
- Browser-repair commit: `02be061`
- Adam-owned `client/src/pages/Admin.tsx`, pre-existing control-room SVGs, and `artifacts/*` were not staged, reverted, overwritten, or committed.

## Phase summary

- Phase 1: canonical plates and weapon compositions, identity-fixed arena geometry, deterministic fresh damage.
- Phase 2 / 2b: same-entity routing, persistent transition coordinator, towers in Lantern City at projected real coordinates, reverse traversal, direct-link establishing arrival, and neutral cold/failure continuity. Engineer the Comeback now retains the exact mission-owned pipeline id and the same canonical OPUS/CPE art while weapons withdraw; an absent linkage disables continuation instead of guessing an account.
- Phase 3: authoritative polling feeds an ordered unseen-event queue. Cold mounts silently adopt the ledger; each later order gets one revenue arrival, visible charge, N real threshold discharges, projectile/impact/damage progression, then cursor consumption. Feed interruption pauses without consuming the event.
- Phase 4: `deriveSignals` and `PsychSignalLayer` are wired to the production Commercial Pipeline situation. Only supported facts render: open overdue follow-ups produce vines, real future follow-ups produce clocks, and executing mission statuses produce Ruinbound. The production schema does not establish silence, reply cadence, or response meaning, so Ghost, Goblins, and Fog are deliberately not fabricated there. View/refetch state cannot clear anything.
- Phase 5: siege depth now changes building architecture; comeback begins inside the same losing building; commercial and resident axes remain distinct; route/destination treatments animate; a shared LA day phase persists across surfaces. Existing per-business-day settlement remains the authority for daily reset, settled scars, and lifetime memory.
- Phase 6: server-gated admin sandbox, permanent warning banner, deterministic production-reducer fixtures, required scenario matrix, frame/event stepping, disabled writes, API-degradation controls, and read-only past-day settlement replay with an isolated cursor. Gate-off navigation is projected from an always-readable server capability, hides the entry, and direct URLs remain unusable. Replay eligibility uses the Los Angeles business date; every synthetic timestamp is valid ISO even for large fixture ids.

## No-production-write proof

Sandbox fixtures are in-memory `TowerWarsBusinessEvent` values passed through `compileTowerWarsState` and `settleTowerWars`. Synthetic ids are `sandbox:` namespaced and evidence is labeled synthetic. The sandbox route exposes queries only. Its historical replay calls the production settlement read service and has no mutation path. Sandbox action controls are disabled.

## Exact three-order outcome

- OPUS: $160, 3 outgoing attacks, 2 incoming attacks, $10 unspent.
- Century Park East: $125, 2 outgoing attacks, 3 incoming attacks, $25 unspent.
- One $125 order remains one revenue arrival and produces two threshold discharges.

## Browser observations and the Adam Test

Tested with the local visual-admin harness on desktop and 390×844 mobile.

Initial Adam Test answer: **It still felt like screens during cold Tower Wars arrival because the world disappeared into centered “Compiling…” text. Century Park East was also clipped at the Lantern City atlas boundary, and the sandbox route rendered a local public 404.**

All three material issues were repaired during the browser pass. The cold state now retains authored Los Angeles architecture and the selected canonical building while explicitly withholding score, winner, charge, and damage claims. Atlas tower placement is edge-safe. The sandbox local route now reaches and visibly enforces its server gate.

Final closure Adam Test answer: **Home now communicates the right hierarchy: customer counts remain useful territory context, but only real TODAY Tower Wars revenue can put a building under pressure, and a tie has no red loser. Home → Lantern City → the selected canonical building remains a continuous authored world on desktop and mobile; direct links preserve the selected building during neutral cold establishment. The exact comeback-to-pipeline bindings and production signals are regression-proved, but cannot be honestly live-data browser-certified without the Railway database.**

## Gates

- Focused closure gate: 91/91 passing, including the strengthened same-entity transition suite.
- Full Vitest: 3,948 passing, 6 skipped, 7 failing. The same seven failures are pre-existing and outside One World: two operations-events-dashboard assertions, operations-events source assertion, driver-restoration source assertion, marketplace dry-run route policy fixture, resident-intake fixture, and day-director production-contract count.
- `npm run build` (Vite client plus server/worker bundles): PASS.
- `npx tsc --noEmit`: FAIL on pre-existing repository-wide errors outside One World. The production Vite build compiles the One World changes.
- Browser: desktop visual pass at 1280×720; exact 390×844 pass with no horizontal overflow; reduced-motion media query active; gate-off Sandbox absent from Growth and direct URL shows only the disabled state; OPUS/CPE direct-link cold states retain the selected architecture and withhold score/damage claims.

## Google API capability decision

All provisioned capabilities remain candidates with explicit roles: Geocoding/Address Validation for normalized geography; Places for corroborated place identity; Aggregate for non-entity opportunity pressure; Maps JS/Map Tiles for geographic approach; Aerial for cold establishing coverage; Street View for facade context; Weather for atmosphere; Air Quality only if haze has perceptual value.

The credentials are Railway-only and the local server cannot start without its Railway database and other required boot credentials. No safe branch-preview workflow for this application exists in the repository. Consequently, OPUS/CPE coverage, latency, mobile quality, hybrid layering, and attribution-safe transition frames were not exercised. The committed renderer retains the authored atlas/fallback architecture. The Google prototype gate is **outstanding verification**, not a rejection and not a PASS. No Google attribution claim is made because no Google content is currently displayed by the committed renderer.

## Remaining defects personally observed

- Live-data battle, both real comeback bindings, production signal mutation/removal, reverse landing, and gate-on sandbox could not be browser-exercised against business truth locally without the Railway backend. Their pure projections and source wiring are covered by regression tests; this is not represented as equivalent to live verification.
- The Google renderer prototype and attribution audit remain blocked on the provisioned Railway environment.
- Lantern City uses an edge-safe visual clamp for CPE because the fixed authored atlas projection extends beyond its crop; this is disclosed presentation correction, not altered geographic truth.
- Full Vitest and repository-wide TypeScript are not globally green for the unrelated failures listed above.

The PR must not be merged without explicit instruction.
