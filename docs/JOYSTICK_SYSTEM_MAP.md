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
- `system.mission_director` — Existing planner. It can prioritize both Missions and Challenges. The slug stays. Do not create a second planner or director. Older phrases such as “today’s mission” stay as compatibility language and are not renamed in this pass.
- `plan.day_line` — Today's prioritized Objectives: Missions, Challenges, or Hybrid Objectives. “DayForge Today” is not current vocabulary. The phrase “today’s mission” is compatibility language, not a rename of `plan.day_line`.
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
| `system.mission_director` | Existing planner for Missions and Challenges |
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
- `system.mission_director` is not renamed. It can prioritize both Missions and Challenges. There is no second planner.
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

Allowed to remain, without renaming in this pass:

- `system.mission_director`
- “today’s mission” and older Mission references in existing code and copy
- `/api/saleslay/*` routes
- `dayforge_*` tables and files
- `BoreslayLanding.tsx` as a superseded public page
- historical comments
- real-business use of the words Laundry Farm / Laundry Butler

Stored kingdom-row ids are not semantic slugs and are not renamed here: `kingdom-1-colosseum` (stored title “The Colosseum”) and `kingdom-2-the-last-valet` (stored title “The Last Valet”). “The Colosseum” in that row is not `kingdom.brass_republic`. “The Last Valet” is not a second name for `kingdom.boreslay` and is not `level.colosseum`.

## 7. Forbidden ambiguities

Forbidden for new user-visible copy, new docs, and new modules:

- calling the product DayForge, Goldline, BORESLAY, or Laundry Butler
- calling Claire a companion
- calling Rook a DayForge field coach
- introducing Cash or Spark as the JOYSTICK protagonist
- using “campaign” for both a growth-library motion and a Kingdom story arc without the `growth_campaign` / `kingdom_binding` split
- using Mission for remote work, or Challenge for in-person field work
- renaming `system.mission_director`, or adding a second planner for Challenges
- treating a completed Mission or Challenge as a Boss defeat, a Level resolution, or Kingdom completion

No nomenclature lint was added. A gate that failed only new files would still need a large grandfather list (`client/src/archive/**`, `client/src/assets/boreslay-rally/**`, historical landings, `/api/saleslay/**`, `dayforge_*` implementation files). This section is the rule.
