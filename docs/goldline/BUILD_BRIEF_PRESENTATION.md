# GOLDLINE BUILD BRIEF — PRESENTATION & ASSET PIPELINE (Slices A–D)

**Audience:** implementation agent (Claude Code or GPT/Astra).
**Status:** written 2026-09-11 against the code on `main`.
**Relationship to the product brief:** `BUILD_BRIEF_SLICES_1_5.md` covers the real
business loop (campaigns, kingdoms, companions, Mission Director). This brief covers
how Goldline *looks and feels*. The two are independent — this one is not blocked on
Kingdom 3, Companion 2, or the migrations.

## Why this brief exists

Goldline is currently not shareable. Adam cannot show it to anyone, which is a real
business constraint, not vanity. The diagnosed causes, in order of impact:

1. **Nothing animates.** Characters are static images. A static PNG reads as a mockup;
   an 8-frame idle reads as a game. This is the single largest perceived-quality gap and
   it is not caused by the rendering engine.
2. **There is no asset pipeline.** 558 images live under `client/public/assets/` across
   nine top-level directories with no manifest, no naming contract, and no size/pivot
   standard. Art arrives from ChatGPT, Meta, and Codex sessions in mismatched styles.
   On 2026-09-11 an hour was spent sourcing Opus LA tower art while
   `client/public/assets/admin/control-room/world/opus-la-north-tower-v1.png` sat
   untracked in the repo, already generated, unknown to everyone.
3. **Impacts are not expressed.** The chapter simulation already computes hitstop; the
   view barely shows it.

## Do NOT do these things

- **Do not migrate to Unity, Godot, or any new engine.** Goldline is React + Pixi inside
  the admin app and is welded to live tRPC data (Mission Director plans, campaign rows,
  Tower Wars ledger, real paid-order events). An engine change means re-plumbing every
  data connection or splitting the product in two, and it does not fix animation, asset
  consistency, or game feel — which are the actual problems.
- **Do not expand content.** No new rooms, enemies, kingdoms, or chapters. This brief
  improves what exists.
- **Do not rebuild existing systems.** Hitstop already exists (`freeze` in
  `client/src/game/chapters/firstChapter/model.ts`). Camera impulse already exists
  (`client/src/game/runtime/CameraController.ts`) and deliberately refuses repeating
  shake — respect that stance rather than overriding it.
- **Do not violate the visual reference guide** in `docs/GOLDLINE-TASKS.md`: Tomb Raider
  II, Twisted Metal 2, Metal Gear Solid, Super Mario 3D World. No medieval, castle,
  crown, gothic, or vampire imagery, including in UI chrome.
- **Do not change simulation logic to serve presentation.** The reducers in `model.ts`
  are the truth; the view reads them. If an animation needs a state that does not exist,
  raise it rather than inventing a field in the sim.

## Tooling note — Blender MCP

Blender MCP is being installed for this work. It is a local stdio server plus a Blender
addon, not a hosted connector. Use it for asset *production* — modeling, rigging, baking
sprite sheets, and exporting consistent frames at a fixed camera and light rig. Assets
carry no business truth, so the truth rules that govern campaigns do not apply to them;
the style contract in Slice A does.

If Blender MCP is unavailable when a slice runs, say so and produce the pipeline and code
anyway with placeholder frames — do not block, and do not silently hand-make assets in a
different style.

---

## SCOPE CONSTRAINT — the Blender pipeline

**This document constrains future Goldline work.** Added 2026-09-11 after the pipeline
was proven on blockout geometry and the boundary turned out to be unwritten.

The brief said "apply animation to the chapter, then the companion" and never scoped
which asset classes go through Blender. Unsaid, that reads as an invitation to
re-render 652 images in 3D. It is not.

**Blender renders are only for characters that animate and need many consistent frames
of the same subject.** The seven companions, Trailblazer, and later Bellwether and
Clockhead if needed. Roughly ten characters.

**Do not put any of these through Blender. They stay exactly as they are:**

- Canonical building art (OPUS LA, Century Park East). Approved, already has a working
  pivot and art-space contract in `buildingArt.ts`, and buildings do not animate.
- UI chrome: nameplate frames, weekly panels, HUD, icons, buttons.
- Chapter background and scenery atlases. Painted 2D, already integrated.
- Lantern, territory and world map art.
- All marketing and landing assets: `boreslay-*`, `dayforge-*`, `held-landing`,
  `level4`, `saleslay`.

Re-rendering any of that in 3D destroys approved work to gain nothing.

**This boundary is enforced as data, not memory.** Every group in
`client/src/game/assets/registry.ts` carries a `pipeline` field, and
`BLENDER_ELIGIBLE_GROUPS` lists the only groups allowed to claim `blender_rendered`.
`registry.test.ts` fails if anything else does, and fails specifically if approved
building art is routed through Blender.

### Style requirement, and it is a requirement

Character renders must be shaded to sit inside the existing painted 2D art: flat or
toon shading, matched palette, matched light direction. **Default PBR output is a
failure even when the geometry is correct.** Painted 2D backgrounds with 3D characters
on top is a proven combination, but only when the characters are shaded to match. Left
plasticky, the animals look pasted onto the world.

This was already observed in practice. The first companion pass rendered as glossy
plastic blobs, which was diagnosed as a geometry problem when it was also a shading
problem. The toon shading pass is not yet built.

### Approval gate

**Do not render, re-render, replace or "upgrade" any existing approved asset without
asking first.** New character art is produced one character at a time, each with
explicit approval, never batch-generated.

---

## Slice A — Asset registry and style contract

**Problem:** nobody, human or agent, can answer "what art do we already have?"

Build a typed asset registry that is the single source of truth for every game-facing
image.

- A manifest module (suggested `client/src/game/assets/registry.ts`) mapping a stable
  asset id to its path, intended surface, pixel dimensions, pivot, and style tag.
- A written style contract: camera angle, light direction, palette anchors, background
  transparency, pivot convention (existing building art uses `center bottom` in an
  800×1200 art space — see `client/src/components/admin/control-room/buildingArt.ts`,
  which already solves this correctly for two buildings and is the model to generalize).
- An inventory pass over all 558 existing assets: which are live, which are orphaned,
  which are duplicates, which are retired. `buildingArt.ts` already has a
  `RETIRED_BUILDING_ART` list — extend that idea registry-wide.
- A test that fails when a game surface references an image not in the registry, and when
  a registry entry points at a missing file.

**Success condition:** an agent can list every asset, its purpose, and its status without
reading any component, and cannot silently add an unregistered one.

**Gate before producing new character assets:** Adam must decide whether companions render
as the eccentric animal sidekicks or stay as the named characters (Mara, Sable, Rook,
Bront, Ilex, Luma, Orren) already seeded in `server/companions/seedCompanions.ts`. Making
assets before that decision means remaking them. If undecided, do Slice A's registry and
inventory work and stop short of new character art.

---

## Slice B — Sprite animation system

**Problem:** nothing moves. This is the biggest visible win available.

- A reusable Pixi animation component: named states (`idle`, `move`, `act`, `hurt`),
  frame timing, looping vs one-shot, and clean interruption.
- Drive it from state the simulation **already exposes**. `model.ts` already tracks
  movement, attack, `hurt`, and `freeze` — the animator reads those. It must remain a
  pure view layer with no writes back into the reducer.
- Apply to the chapter first (`client/src/game/chapters/firstChapter/`, rendering lives in
  `ChapterScene.ts` / `presentation.ts`, not `FirstChapter.tsx`). Then the Driver
  companion, if the companion presentation decision has landed.
- Ship at least an idle and a movement cycle for the heroine before adding anything else.
  A character that breathes while standing still is worth more than four half-done states.
- Register every frame/sheet in the Slice A registry.

**Success condition:** the heroine animates through idle, movement, attack, and damage in
the live chapter, driven entirely by existing simulation state, with no reducer changes.

---

## Slice C — Game feel pass

**Problem:** impacts compute but do not read.

- **Express the hitstop that already exists.** `model.ts` sets `freeze=70` on a landed hit
  and `freeze=90` on damage taken. Make those frames visible — sprite hold, flash, or
  scale pop — rather than adding new timing.
- **Impact particles** on landed hits and weight/redirect collisions. Short-lived, pooled,
  no per-frame allocation.
- **Camera:** extend `CameraController.impulse()` rather than adding a shake system. Its
  doc comment explicitly rejects repeating shake; a directional kick on impact is in
  keeping, a rumble is not.
- **Easing** on UI transitions, room fades, and HUD state changes. No linear tweens.
- **Audio hooks** at the event boundary — one call site per meaningful event (hit, dodge,
  mechanism, unlock), even if some ship silent. Do not build an audio architecture; the
  creative direction bans a major audio system. Hooks only.
- Apply to the chapter, then Tower Wars, then Boreslay.

**Success condition:** a landed hit is unmistakable without reading any text, and no new
timing or simulation state was invented to achieve it.

---

## Slice D — Design consistency sweep

**Problem:** pages still wearing Boreslay/Dayforge-era styling inside a Goldline product.

- Inventory every route rendering pre-Goldline visual language.
- Bring them to current Goldline direction: typography, palette, button and card
  treatment, spacing.
- Prefer shared tokens/components over per-page CSS so the next sweep is unnecessary.
- Out of scope: anything the visual reference guide bans, and any redesign of Lantern
  City's scene rendering (that is live pixi surface work with its own risk profile).

**Success condition:** no route looks like it belongs to a different product.

---

## End of every slice

1. Update `docs/GOLDLINE-TASKS.md` — what changed, what it enables, what is unresolved.
2. Run `npx tsc --noEmit` and the relevant vitest suites; report real numbers.
3. **State verification honestly.** There is no database in the local build environment
   and the admin app sits behind a password gate, so DB-backed screens often cannot be
   exercised locally. Chapter and Boreslay work *can* be verified in a browser via the
   preview configs in `.claude/launch.json` — do that, and screenshot it. Never claim
   verification that did not happen; several bugs have reached production that way.
4. Commit and push to `main`.
5. If a prerequisite decision is unresolved (the companion presentation gate in Slice A),
   stop and name the exact decision needed rather than guessing.
