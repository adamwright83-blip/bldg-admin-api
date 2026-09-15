# HANDOFF — Goldline: One World

You are taking over an in-progress implementation of the **GOLDLINE: ONE WORLD**
master prompt. Phases 1–4 are committed. Phase 6 is started but uncommitted.
Phase 5 has not been started.

Read this whole file before touching anything.

---

## 1. Where things stand

Branch: **`goldline/one-world`**, forked from `main` at `276f807`.

```
12d3885 Phase 4: psychological world signals
8975e42 Phase 3: the causal spectacle engine
05470b1 Phase 2: spatial traversal and same-entity routing
0c54ab6 Phase 1: canonical visual identity
276f807 (main) fix: single OPUS ball across the whole swing
```

Test suite: **176 passing** (155 through Phase 4, plus 21 new sandbox tests).

### Uncommitted, and intentional

- `shared/sandboxScenarios.ts` + `shared/sandboxScenarios.test.ts` — Phase 6
  foundation, 21 tests green. Commit these as the start of Phase 6.
- `client/src/pages/Admin.tsx` (modified) — **the user's own work in progress.
  DO NOT COMMIT IT. DO NOT REVERT IT. DO NOT STAGE IT.** It was swept into a
  commit once already and had to be surgically removed. Use explicit paths when
  staging; never `git add -A` or `git commit -a`.
- The untracked SVGs under `client/public/assets/admin/control-room/` and the
  `artifacts/*` directories are also the user's, and are likewise not yours to
  commit.
- `client/public/cpe-check.png` is my scratch verification render. Delete it.

---

## 2. Non-negotiable rules

These come from the user directly and override any instinct to the contrary.

1. **Never fabricate business truth.** Every visual claim traces to an
   authoritative record.
2. **Effort is never upgraded to outcome.** A door knock must not animate like a
   paid order. This is enforced by `spectacleMagnitude` in
   `client/src/components/admin/control-room/spectacle.ts`.
3. **Animation earns authority only from genuinely unseen real events.** A
   refetch is not an event. A cold first load replays nothing.
4. **Real people stay real people.** Contacts are never rendered as creatures,
   monsters, or goblins. A psych signal attaches to a *situation id*, never a
   person — enforced by the shape of `SignalContext`.
5. **Presentation state never flows into business state.** One direction only.
6. **Real data wins every conflict.**
7. **The sandbox must never write.** Not to `orders`,
   `cleancloud_paid_orders`, customers, revenue, `tower_wars_promises`,
   canonical building state, settlement history, cadence truth, or the
   chronicle.
8. **Do not merge.** Open the single PR when the program is done and stop. The
   user merges.
9. Do not log secrets. Server-only credentials stay server-side.

### Two corrections the user issued that you must not re-break

- **Tower Wars unspent charge does NOT carry across business days.** Each
  business date folds independently from a zero accumulator. Resetting
  theatrical ammunition does not destroy revenue — real revenue is tracked
  separately in `lifetime`. I argued against this once and was wrong.
- **The attack threshold is `TOWER_WARS_ATTACK_THRESHOLD_CENTS = 5000`**
  (`shared/goldlineGameConfig.ts`). It is $50, not $75. Any doc saying $75 is
  stale.

---

## 3. Asset boundary

The user supplied `~/Desktop/goldline_psych_assets/`, 10 PNGs.

- **The six square 1254×1254 RGBA images are the only approved production
  assets.** They are already identified, renamed, and shipped to
  `client/public/assets/admin/control-room/signals/` as `ghost.png`,
  `goblins.png`, `fog.png`, `vines.png`, `clock-creature.png`,
  `ruinbound.png`.
- **The four landscape 1536×1024 images are storyboard/reference only.** Do not
  ship them, do not crop elements out of them, do not wire them into the app. A
  test in `psychSignals.test.ts` guards against this.

Transition art (Phase 2b) comes from canonical repo building assets or
procedural/vector effects — never extracted from the landscape boards.

---

## 4. What each committed phase actually did

### Phase 1 — canonical visual identity (`0c54ab6`)

The seam problem: one street address had four different renderings. Fixed so a
building is unmistakably the same object on Home, in Lantern City, and in Tower
Wars, in every damage state, at every role.

- `client/src/components/admin/control-room/buildingArt.ts` — the single
  registry. `BUILDING_ART` maps each canonical building to its plate, weapon
  overlay, projectile and `weaponGeometry` (pivot, muzzle, strike direction).
  `RETIRED_BUILDING_ART` lists superseded files so they cannot creep back.
- `CanonicalBuildingArt.tsx` — composes plate → settled scars → fresh damage →
  weapon → charge meter. **Scale lives on the container**, so every layer
  inherits one transform. All layers use `viewBox="0 0 800 1200"` +
  `preserveAspectRatio="xMidYMax meet"` to match the CSS
  `object-fit: contain; object-position: center bottom`.
- `freshDamage.ts` / `FreshDamageLayer.tsx` — today's damage only, distinct from
  permanent settled scars.
- **Identity owns geometry.** Position, size and weapon-facing belong to the
  building. Roles (leader/trailer) are badges and colour only. Previously the
  left slot was the *losing* building and role drove height, so a lead change
  made the buildings physically swap and resize. There is a test asserting a
  lead flip changes zero geometry — verified in-browser: OPUS `441×538 @ 18,152`,
  CPE `288×469 @ 504,221`, identical either way.

Two art bugs fixed here that you should not reintroduce: CPE's crater was baked
into its tower image (so it looked devastated on a $0 day), and OPUS rendered a
*second* golf ball because one was baked into the overlay while CSS drew another.
**Never verify an animation from a final resting screenshot** — step it
frame-by-frame with `pause()` + `currentTime`.

### Phase 2 — spatial traversal (`05470b1`)

- `worldTransition.ts` — FLIP maths. `flipTransform(source, destination)`,
  `TRAVERSAL_MS = 900`, `ESTABLISHING_MS = 420`, `REDUCED_MS = 160`.
- `WorldTransitionProvider.tsx` — mounted inside the persistent `cr-shell`.
  Critical guard: `if (!destRect || !current.sourceRect) return null;` — it
  never fabricates a journey it cannot actually measure.
- Verified in-browser: city `148×188 @ 92,250` → mid `294×363 @ 315,201` →
  landed `441×538 @ 538,152`. It is one continuous object moving, not a cut.

### Phase 3 — the causal spectacle engine (`8975e42`)

- `spectacle.ts`. `spectacleMagnitude(impactClass)` maps the impact ladder onto
  `whisper → murmur → beat → surge → detonation`, monotonically.
- `adoptWithoutSpectacle(eventIds, cursor)` — on a cold first load
  (`cursor.seen.length === 0`) it adopts silently and plays nothing. Opening
  Tower Wars at 4pm must not replay the whole day.
- The seen cursor lives in per-viewer local storage and is **never sent to the
  server** — there is a test grepping for `fetch(` / `trpc.` / `mutation`.
- `dischargePlan({chargedBeforeCents, orderValueCents, thresholdCents})` returns
  `{strikes, remainderCents}`. The visible charge meter matters: without it a
  $20 order arrives, nothing fires, and the user reads it as a bug.

### Phase 4 — psychological world signals (`12d3885`)

- `psychSignals.ts`. Six signals derived from *gaps* in the impact ladder plus
  elapsed business time:
  `ghost` (silence), `goblins` (the story about the silence), `fog` (ambiguity),
  `vines` (avoidance), `clock` (real dated commitment), `ruinbound` (execution
  friction).
- **Goblins cannot spawn without a non-null `expectedReplyDays`.** We never
  invent a deadline so a creature has something to be anxious about.
- `SignalContext` deliberately contains no view count, session count, open count
  or refetch count. Opening a thread fifty times cannot clear a ghost. The
  anti-rumination guarantee is enforced by the type, and there is a test that
  greps the type for `viewCount`/`opens`/`sessionCount`/`refetch`/`visits`.
- Likewise no `contactName`/`personName`/`customerName`/`contactId`.
- No `clearedBy` anywhere says "check again".

---

## 5. Phase 6 — what I built, and what remains

`shared/sandboxScenarios.ts` (uncommitted, 21 tests green).

Seven deterministic fixtures fed through the **real** `compileTowerWarsState`
and `settleTowerWars` — not a parallel mock implementation. That is the whole
point: the sandbox proves the production reducers, so it must not have its own.

The module has no database import, no tenant, and no persistence path, and a
test enforces that by grepping the source (comments stripped first — a guard
that trips on its own explanatory comment proves nothing; that mistake was made
twice already). Every synthetic id is namespaced `sandbox:`, every
`sourceEvidence` carries `sandbox: true`, and customers are named
"Sandbox Ava" etc.

`THREE_ORDER_BATTLE` resolves, out of the production reducer, to exactly the
spec: OPUS $60 + $100 → **$160 revenue, 3 strikes, $10 unspent**; CPE $125 →
**2 strikes, $25 unspent**; and the single $125 order is confirmed as one
revenue arrival producing two discharges.

### Remaining Phase 6 work

1. **`GOLDLINE_SANDBOX_ENABLED` gate.** Server-side env flag, default off,
   never on in production. When off, no sandbox route or UI exists at all.
2. **Persistent banner** whenever a scenario is active, so synthetic state can
   never be mistaken for real state.
3. **Scenario picker UI** in the control room, gated.
4. **Remaining scenarios:** `ACTION_ELIGIBILITY`, `CREATURE_MATRIX`,
   `TRANSITION_MATRIX`, `API_DEGRADATION`, and `REAL_DAY_REPLAY`
   (strictly read-only — it replays a real day's events through the renderer and
   must not write a single row).

I recommend finishing Phase 6 before Phase 5. It is the harness that proves
everything else, and several Phase 5 items (nightly settlement, lantern relight)
are far easier to build once they can be forced on demand.

---

## 6. Phase 5 — not started

- Consume the siege ladder: callbox at `phone_ready`, doors at `arrived`,
  elevator at `visit_completed`, lights at `account_won`.
- "Engineer the comeback" must not cut to a CRM — it stays in the world.
- Two *distinct* resident-territory reveals: `commercial_win` vs
  `preexisting_residents`.
- Resident penetration animates **quantity, never identity**.
- Lantern lifecycle transitions, including dark → relight.
- Route and destination treatments must transition, not pop.
- Nightly world settlement; morning reads as a new battle, with one shared
  day-phase indicator across the app.

Also outstanding from Phase 2: the reverse transition (Tower Wars → city),
establishing arrival on a direct link, and loading / feed-failure states that
never blank the world.

---

## 7. Known blocker

There are **no `GOOGLE_*` keys in `.env.local`** — they are Railway-only. The
Google 3D / Aerial / Street View prototype gate therefore cannot be evaluated
locally. Document the architecture and the attribution component, but do not
claim to have run that gate.

On attribution: hybrid fantasy-over-Google visualisation is **not** prohibited.
Google supports third-party overlays. During every frame where Google content is
visible, preserve all required attribution, keep it legible, unmodified and
unobscured, and display any required third-party tile/data credits. The
preferred architecture is that Google owns the geographic approach and exits
completely at the authored threshold, after which the scene is fully
Goldline-authored.

---

## 8. How to verify

Unit tests are necessary and not sufficient. Every phase was browser-verified.

```bash
npx vitest run && npx tsc --noEmit && npx vite build
```

Then in the browser: step animations deterministically with `pause()` +
`currentTime` rather than weakening production animation to make it observable.
Never accept a final resting screenshot as proof that an animation was correct
throughout.

Finish with **THE ADAM TEST** from the master prompt, answered honestly. The bar
is that a player reads this without text:

> this building got the order → it charged its weapon → it fired → the other
> building was hit → it is now damaged → that is why it was glowing red back in
> the city.

Then open **one PR** for the whole program. **Do not merge it.**
