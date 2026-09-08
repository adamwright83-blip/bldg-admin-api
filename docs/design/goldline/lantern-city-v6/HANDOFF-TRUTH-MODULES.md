# Handoff — Lantern City truth modules and what comes next

Branch: `lantern-city-finish-v6`. Read `CREATIVE-BRIEF.md` in this folder
first; it is the authority. This note only says what landed on 2026-09-08 and
what the next sessions should do, in order.

## Landed (shared, tested, not yet rendered)

| Module | What it decides | Test |
|---|---|---|
| `shared/lanternDecayForecast.ts` | Days until a territory's visual state worsens, and which customer's reorder holds it | `lanternDecayForecast.test.ts` |
| `shared/lanternFrontierCap.ts` | Which five frontier objects are visible; the rest are quiet | `lanternFrontierCap.test.ts` |
| `shared/lanternFrontierPresentation.ts` | Lost ground uses a different machine than the prize that left (wired into `composeLanternCityScene`) | `lanternFrontierCap.test.ts` |
| `shared/rekindlingArsenal.ts` | Tool truth classes, spark/ember/flame, cooldowns, Golden Seal cost, sent line | `rekindlingArsenal.test.ts` |

Run: `npx vitest run shared/lanternDecayForecast.test.ts shared/lanternFrontierCap.test.ts shared/rekindlingArsenal.test.ts client/src/components/admin/control-room/LanternCitySceneV6`

Already true without new code: visual state is derived per business date
(`deriveTerritoryVisualState` over that date's cadence), so decline only
appears when the business date rolls. That satisfies brief §11.1. Do not add
a stored decay table.

## Codex tasks (render only; may not add fields to shared types or services)

1. Field Intel: render `decayForecastLine(forecastTerritoryDecay(...))` under
   the district counts. Server should compute the forecast in
   `lanternCityOverviewService.projectLanternCityOverview` from the dossier's
   customers and pass it in the dossier; the client only prints the line.
2. Scene: run frontier candidates through `applyFrontierCap` in
   `composeLanternCityScene` before placing objects. `quiet` renders dark
   with no object and no lock.
3. Chip labels per brief §4: no GUARDED, no LOCKED; object verb only.
   "At risk" shows its definition.
4. Dossier: drop any authored tagline; add lifetime paid value.
5. Top bar: add recurring accounts once the server exposes it (see below).
6. Empty state as world, not a toast. Weather out of the bar.
7. Arsenal dock: a panel that lists `ARSENAL_TOOLS`, shows `cooldownVerdict`
   and `goldenSealCost`, and dispatches the existing outreach mutations. The
   state badge comes from `rekindlingStateFor(highest impact class reached)`.

## Claude tasks (truth; needs a fresh high-effort session)

1. **Recurring / hearth state.** There is no recurring-pickup concept in the
   schema today. Define it as a customer attribute derived from real
   scheduled orders (a standing weekly or biweekly schedule with at least
   two fulfilled cycles), expose `recurring: boolean` on the atlas customer,
   and add `hearth` as a lantern presentation of `active` with slower
   dimming. Add the top-bar figure with provenance.
2. **Replace as rescue.** Building-level rescue: a first order from a new
   resident in a building that has a dark lantern counts toward RESTORE
   DORMANT LIGHTS in that territory. Extend the operation objectives in
   `lanternCityOverviewService`, tests first.
3. **Arsenal events.** Append `goldline_world_events` for each tool use with
   the tool's truth class as `verificationClass`, and derive the customer's
   rekindling state from the highest impact class since the operation began.
4. **The Night Shift.** Server-side director behind `GOLDLINE_NIGHT_SHIFT`
   (default off). Runs after the LA business date rolls. Reads: overview
   projection, decay forecasts, obligations, tomorrow's real stops, calendar.
   Writes exactly one `authored_day` row with provenance ids on every line,
   via a strict output schema like `dayDirectorService`. It may only
   reference entity ids that exist. It never writes business truth. The
   Driver reads it at dawn; Launch Operation on desktop commits the same row.

## Never

- Store decay. Derive it.
- Show decay, lost ground, or locks on any public surface.
- Let a tool use pass `spark` without a response-class event.
- Let anything in the featured operation complete without the real event.
