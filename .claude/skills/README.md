# Installed Blender / 3D skills

Vendored 2026-09-11 because Goldline's first scripted-companion pass failed, and
the failure was mis-diagnosed as "Blender cannot author character shapes". It was
the method: thirty stacked primitives per character.

All three sources are MIT or CC0. Each was read before installing, and the only
bundled executable code (`blender-hardsurface/reference/*.py`) was scanned: one
localhost socket, no filesystem writes, no exec, no external network.

| Skill(s) | Source | Why |
|---|---|---|
| `blender-hardsurface` | `achimala/TheLongSilence` | Loft-and-recess method. Opens by naming the exact failure: primitive assembly has a hard ceiling. Also the Blender 5.x API traps, which apply here since this machine runs 5.2.1. |
| `creature-artist`, `character-artist`, `sculpting`, `retopology`, `rigging`, `animation`, `stylized-style`, `hand-painted-style`, `lowpoly-style`, `lighting`, `materials`, `rendering`, `lookdev`, `geometry-nodes`, `procedural-modeling`, `camera-cinematography`, `export-pipeline`, `qa-review` | `arjun988/blender-skills` | The organic half that hard-surface does not cover. `creature-artist` gives the workflow Goldline needs: skeleton blockout, muscle masses, surface forms, retopology, rig. `hand-painted-style` matches the requirement that characters sit inside painted 2D. |
| `reference-to-3d`, `multiview-fit-loop`, `orthographic-registration` | `RobLe3/cc-blender-skill` | Verifying that generated geometry actually matches a reference, which is what image-to-3D output needs before it enters the pipeline. |

## Not installed, deliberately

`icesixgod/awesome-astra-blender-characters` is a serious skill with good honesty
norms, but it targets anime humanoid faces and hair. The brief bans anime, and
Goldline's cast is stylized animals. Its one strongly transferable idea is worth
stealing without installing it: **generate a nine-view reference set before
modelling** — eight horizontal views at 45 degree steps plus a top view — and
check them against each other before touching geometry.

## The measurement that settles the method argument

`sirrobzeroone/Animal_Models` (CC0) ships a Red Junglefowl with `.blend` source.
It is a bird, so it is directly comparable to Rook:

| | Junglefowl (competent) | Goldline Rook, first pass |
|---|---|---|
| Mesh objects | 1 | ~30 |
| Vertices | 767 | subdivided spheres, far more |
| Topology | 199 quads, 44 tris, 24 ngons | primitive shells, no shared topology |
| Rig | one armature with an action | none |

One continuous quad skin driven by an armature, against a pile of separate
subdivided primitives. That is the whole difference, and no amount of lighting,
camera work or toon shading closes it.


## Second round — Tomb Raider II direction (driver app)

Added 2026-09-11. The driver surface (`client/src/components/driver/`) is heavily
Tomb Raider II inspired, and TR2 plus Twisted Metal 2 are already in the visual
reference guide. That direction needs modular stone architecture, props, vehicles
and kit assembly, none of which the first round covered.

| Skill(s) | Source | Licence |
|---|---|---|
| `blender-director`, `blender-modeler`, `environment-artist`, `prop-artist`, `vehicle-artist`, `hard-surface`, `historical-worlds`, `set-dressing`, `scene-assembly`, `asset-optimization`, `uv-workflow`, `texture-workflow`, `lod-pipeline`, `collision-proxy` | `arjun988/blender-skills` | MIT |
| `blender-hard-surface-modeling` | `composio-community/opencode-skills` | MIT (stated in README, no LICENSE file) |
| `blender-3d-asset-generation` | `lovecatisgood-sudo/...-game-development-skills` | MIT |
| `gamefactory-qa-3d_object`, `gamefactory-qa-3d_scene` | `OpenDCAI/GameFactory-3A` | Apache 2.0 |

`environment-artist` and `historical-worlds` are the TR2 pair: modular ruin kits,
architecture, traps and rooms. `vehicle-artist` covers the driving side.
`collision-proxy` and `lod-pipeline` matter because TR2-style level geometry ships
as many modular pieces and the naive export is a draw-call disaster.

### Not installed, second round

- **`grapeot/gpt_3d_skill`** — no licence file of any kind, which means default
  all-rights-reserved regardless of it being public. Not vendored into a
  commercial product on that basis. Nothing stops you reading it.
- **`MuruCoder/TR123R-Blender-Addon`** — imports `.TRM` files from the Tomb
  Raider I-III Remastered releases. Worth being precise about why this one is
  different from the rest:

  Visual **style** is not copyrightable, which is why "Tomb Raider II inspired"
  is a legitimate art direction and why it sits in the reference guide. The
  **assets** are copyrighted by their rights holders. Importing shipped game
  geometry to study proportion and construction is a grey area; putting any of
  that geometry, or anything traced from it, into Goldline is infringement in a
  product you intend to show people and charge for.

  Goldline already has a safer equivalent for the thing this addon would be used
  for. The CC0 animal `.blend` files measured above answer "how is a real
  low-poly mesh built" without touching anyone's shipped game.

## Standing rule

Every skill here is method. None of them authorise producing art. Character
renders still go one at a time with explicit approval, per the scope constraint
in `docs/goldline/BUILD_BRIEF_PRESENTATION.md`.

## Licensing note

These repos are reference and method. Goldline's seven companions must be
original work in one coherent direction. CC0 permits shipping someone else's
mesh; the art direction does not. Use them to learn topology and rigging, not
as companion assets.
