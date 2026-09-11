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

## Licensing note

These repos are reference and method. Goldline's seven companions must be
original work in one coherent direction. CC0 permits shipping someone else's
mesh; the art direction does not. Use them to learn topology and rigging, not
as companion assets.
