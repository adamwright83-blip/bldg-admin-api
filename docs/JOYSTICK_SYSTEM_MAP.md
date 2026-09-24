# JOYSTICK system map

Current ontology. One meaning per noun. Read this before `docs/GOLDLINE-TASKS.md`.

## 1. Product tree

```
product.joystick
├── surface.admin
│   ├── admin.lantern_city
│   └── admin.tower_wars
├── surface.driver
│   └── domain.goldline
│       ├── protagonist.trailblazer
│       ├── world.overworld
│       ├── ship.wayward
│       ├── kingdom.brass_republic
│       │   └── level.colosseum
│       │       └── boss.clockhead
│       ├── kingdom.boreslay
│       │   └── minigame.boreslay_duel
│       ├── companion.rook
│       │   └── capability.rook.contact
│       │       └── rook.outreach_drafting
│       ├── encounter.*
│       └── minigame.*
├── system.claire
├── system.mission_director
├── plan.day_line
├── objective
│   ├── mission
│   ├── challenge
│   └── hybrid_objective
├── system.reality_bridge
├── system.narrator_os
├── growth_campaign.*
├── kingdom_binding.*
└── business.laundry_farm
    └── service.laundry_butler
```

`system.claire`, `system.mission_director`, `plan.day_line`, `objective`, `system.reality_bridge`, and `system.narrator_os` are cross-surface. They are not Companions and not inside one Kingdom. `encounter.*` is the playable sequence around an Objective, not the Objective.

Later Kingdoms have no locked place-name. Do not invent one.

## 2. Domain definitions

- `product.joystick` — The commercial product customers buy.
- `surface.admin` — JOYSTICK Admin (desktop/operator).
- `surface.driver` — JOYSTICK Driver (mobile field/play).
- `domain.goldline` — Internal playable reality↔fantasy domain. Not the customer-facing product name.
- `system.claire` — Cross-surface executive agent. Not a Companion, Narrator, or reward.
- `system.mission_director` — Existing planner. It can prioritize both Missions and Challenges. The slug stays. Do not create a second planner or director. The name is legacy implementation vocabulary and does not mean the planner handles field Objectives only.
- `plan.day_line` — Today's prioritized Objectives: Missions, Challenges, or Hybrid Objectives. “DayForge Today” is not current vocabulary. A legacy phrase such as “today’s mission” does not mean the work is a field Objective.
- `objective` — Neutral umbrella for real work that can satisfy a `kingdom_binding`.
- `mission` — Field Objective. Requires physical presence / in-person action. Player-facing: MISSIONS = go out into the field and physically do something. Visiting Greystar properties in person is a Mission. Hanging Beverly Hills door hangers is a Mission.
- `challenge` — Remote Objective. Completed through phone, text, email, browser, Admin, and the like. Player-facing: CHALLENGES = do the real work from the phone or computer. Texting dormant customers is a Challenge. Cold Call Burst is a Challenge. Sending follow-up emails is a Challenge.
- `hybrid_objective` — Hybrid Objective. Requires both Mission and Challenge components. An authored sequence that requires both is a Hybrid Objective.
- `system.reality_bridge` — Contract: verified real evidence → allowed fantasy consequence. Not a UI. Not a character.
- `system.narrator_os` — Selects authored story eligibility from verified truth + canon. Cannot create business truth.
- `world.overworld` — Driver fantasy connective world. Exists before `level.colosseum`. Trailblazer can travel it while Colosseum is the only unlocked destination.
- `admin.lantern_city` — Admin real-business territory visualization. Not the Overworld.
- `admin.tower_wars` — Specific Admin visualization/mode. Legacy-feeling gameplay may remain visual-only. Not the Overworld.
- `ship.wayward` — Trailblazer's in-world ship/home. Nothing else.
- `kingdom.brass_republic` — Kingdom One.
- `level.colosseum` — Level inside `kingdom.brass_republic`. Not the Kingdom.
- `boss.clockhead` — Boss of that Level. Not the Kingdom and not the Level.
- `companion.rook` — First Companion. Not Claire. Not a DayForge coach.
- `capability.rook.contact` — Rook's player-facing mechanic (CONTACT).
- `rook.outreach_drafting` — Underlying implementation capability id. Not the Companion.
- `kingdom.boreslay` — Kingdom Two. Never the product.
- `minigame.boreslay_duel` — That Kingdom's 1v1 game (Head Ball 2-influenced). Not the product.
- `growth_campaign.*` — Reusable real-business growth motions (campaign library).
- `kingdom_binding.*` — Explicit attachment of authoritative real work to authored fiction. Not a synonym of `growth_campaign`. Completing a Mission or a Challenge may satisfy the real-world side of a binding.
- `encounter.*` — Playable sequence around an Objective. Not the Objective.
- `minigame.*` — Bounded videogame grammar inside a Kingdom or encounter.
- `business.laundry_farm` — Adam's real operating laundry business / tenant using JOYSTICK. Never platform identity.
- `service.laundry_butler` — A real service/product offered by that operating business. Never JOYSTICK platform identity.
- `legacy.laundry_butler_chrome` — Historical app/login/title branding that incorrectly made Laundry Butler look like the platform itself.
- `protagonist.trailblazer` — Canonical playable protagonist. Cash and Spark are not JOYSTICK protagonists.

## 3. Loops

Driver / Goldline loop:

Business Truth → `system.claire` + `system.mission_director` construct `plan.day_line` → Objective (a Mission, a Challenge, or a Hybrid Objective) → `system.reality_bridge` → `domain.goldline` reacts → `world.overworld` / `kingdom.*` / `encounter.*` / `companion.*` may change → `system.narrator_os` may become eligible → return to `world.overworld` / `plan.day_line`

Admin loop:

`admin.lantern_city` starts mostly obscured → established customers/activity are visible islands → verified sales/marketing action may reveal territory → map changes because business changed → next real action

These loops stay separate.

## 4. Naming registry (stable slugs)

| Slug | Meaning |
|---|---|
| `product.joystick` | Commercial product customers buy |
| `surface.admin` | JOYSTICK Admin |
| `surface.driver` | JOYSTICK Driver |
| `domain.goldline` | Internal reality↔fantasy domain |
| `system.claire` | Cross-surface executive agent |
| `system.mission_director` | Existing planner for Missions and Challenges; the name does not encode Objective type |
| `plan.day_line` | Today's prioritized Objectives |
| `objective` | Neutral umbrella for real work that can satisfy a `kingdom_binding` |
| `mission` | Field Objective: physical presence / in-person |
| `challenge` | Remote Objective: phone, text, email, browser, Admin, and the like |
| `hybrid_objective` | Requires both a Mission and a Challenge |
| `system.reality_bridge` | Verified evidence → allowed fantasy consequence |
| `system.narrator_os` | Authored story eligibility from verified truth + canon |
| `world.overworld` | Driver fantasy connective world |
| `admin.lantern_city` | Admin real-business territory visualization |
| `admin.tower_wars` | Admin visualization/mode |
| `ship.wayward` | Trailblazer's ship/home |
| `kingdom.brass_republic` | Kingdom One |
| `level.colosseum` | Level inside Kingdom One |
| `boss.clockhead` | Boss of that Level |
| `companion.rook` | First Companion |
| `capability.rook.contact` | Rook's player-facing mechanic |
| `rook.outreach_drafting` | Implementation capability id |
| `kingdom.boreslay` | Kingdom Two |
| `minigame.boreslay_duel` | Kingdom Two's 1v1 game |
| `growth_campaign.*` | Real-business growth-motion library |
| `kingdom_binding.*` | Attachment of real work to authored fiction |
| `encounter.*` | Playable sequence around an Objective, not the Objective |
| `minigame.*` | Bounded videogame grammar |
| `business.laundry_farm` | Operating laundry business / tenant |
| `service.laundry_butler` | Service offered by that business |
| `legacy.laundry_butler_chrome` | Historical platform-facing Laundry Butler branding |
| `protagonist.trailblazer` | Canonical playable protagonist |
| `legacy.dayforge` | Legacy product name |
| `legacy.saleslay` | Legacy product name |
| `legacy.boreslay_product` | Legacy landing that markets BORESLAY as the whole product |

## 5. Layer rule

One noun = one layer.

- `level.colosseum` resolved ≠ `kingdom.brass_republic` completed.
- Beating `boss.clockhead` does not complete `kingdom.brass_republic`. Kingdom completion is a separate authored state. Canon does not say a Clockhead defeat completes the Kingdom.
- `companion.rook` owned ≠ `capability.rook.contact` granted, unless an explicit authored rule and a permission rule both say the grant follows ownership.
- `growth_campaign` ≠ `kingdom_binding` ≠ `objective` ≠ `encounter.*`.
- `mission` is a Field Objective. `challenge` is a Remote Objective. `hybrid_objective` requires both. None of them is the Encounter.
- Completing a Mission or a Challenge may satisfy the real-world side of a `kingdom_binding`. It does not automatically defeat a Boss, resolve a Level, or complete a Kingdom.
- `system.mission_director` is not renamed. It can prioritize both Missions and Challenges. There is no second planner. Existing code, API, and system names containing `mission` are legacy implementation vocabulary and may still represent field, remote, or hybrid Objectives until explicitly migrated. Do not infer Objective type from an old identifier containing `mission`; infer it from the actual execution contract.
- `world.overworld` ≠ `admin.lantern_city`.
- `system.claire` ≠ `companion.*`.
- `kingdom.boreslay` ≠ `minigame.boreslay_duel` ≠ `legacy.boreslay_product`.
- `business.laundry_farm` ≠ `service.laundry_butler` ≠ `legacy.laundry_butler_chrome` ≠ `product.joystick`.

## 6. Legacy names

LEGACY — compatibility/history, not current architecture:

- `legacy.dayforge`
- `legacy.saleslay`
- `legacy.boreslay_product` — Old landing that markets BORESLAY as the whole product. `BoreslayLanding.tsx` is that superseded public page.
- `legacy.laundry_butler_chrome` — Old platform-facing title/LoginForm/product chrome. Not the current JOYSTICK product identity. Not `business.laundry_farm`. Not `service.laundry_butler`.

Compatibility may remain only when its legacy status is explicit:

- Existing code, API, and system names containing `mission`, including `system.mission_director`. They may still represent field, remote, or hybrid Objectives until explicitly migrated. Do not infer Objective type from the identifier; infer it from the actual execution contract. Do not rename them in this pass.
- `/api/saleslay/*` routes
- `BoreslayLanding.tsx` as a superseded public page
- historical comments that are clearly marked historical
- real-business use of the words Laundry Farm / Laundry Butler

### Retired DayForge name — repository rule

`legacy.dayforge` is the **only** semantic meaning of the retired DayForge name.

The previous rule allowing bare `dayforge_*` files, modules, CI jobs, symbols, and docs is revoked. Bare DayForge naming is ambiguous to humans and language models and must not represent current architecture.

Required treatment:

- Current product/domain code uses the current term: `product.joystick`, `plan.day_line`, Goldline game/system terms, or the actual domain concept.
- Retained compatibility code is namespaced structurally as `legacy/dayforge`, `legacyDayforge*`, or `legacy_dayforge_*`.
- Applied migration identifiers, deployed database names, environment-variable names, and public compatibility routes may preserve their historical literal only when changing the literal could break compatibility. Every such literal must live behind an explicitly named legacy compatibility seam or carry an adjacent `LEGACY DAYFORGE COMPATIBILITY` marker.
- New code must never introduce an unqualified `DayForge` / `dayforge` identifier.
- CI includes a nomenclature guard. An agent must not weaken its allowlist to make a new violation pass.
- See `docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md` for the compatibility inventory and migration rules.

Stored kingdom-row ids are not semantic slugs and are not renamed here: `kingdom-1-colosseum` (stored title “The Colosseum”) and `kingdom-2-the-last-valet` (stored title “The Last Valet”). “The Colosseum” in that row is not `kingdom.brass_republic`. “The Last Valet” is not a second name for `kingdom.boreslay` and is not `level.colosseum`.

## 7. Forbidden ambiguities

Forbidden for user-visible copy, docs, modules, symbols, filenames, and CI names unless explicitly marked as legacy compatibility:

- calling the product DayForge, Goldline, BORESLAY, or Laundry Butler
- using bare `DayForge` / `dayforge` as though it were a current subsystem or architecture namespace
- calling Claire a companion
- calling Rook a DayForge field coach
- introducing Cash or Spark as the JOYSTICK protagonist
- using “campaign” for both a growth-library motion and a Kingdom story arc without the `growth_campaign` / `kingdom_binding` split
- using Mission for remote work, or Challenge for in-person field work
- inferring Objective type from an existing code, API, or system name that contains `mission`
- renaming an existing API or system whose name contains `mission`, or adding a second planner beside `system.mission_director`
- treating a completed Mission or Challenge as a Boss defeat, a Level resolution, or Kingdom completion

The nomenclature guard is part of the repository contract.
