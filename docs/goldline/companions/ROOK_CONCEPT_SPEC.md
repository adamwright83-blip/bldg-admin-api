# ROOK — visual canon

**Status:** canonical. The delivered concept art and the approved 3D model are the truth;
this page records them on main so the shipped character and the written canon live in one
place. First written 2026-09-11 on `goldline/rook-3d-asset-pipeline`; brought to main and
updated 2026-09-23.

**Scope:** visual form and movement only. Rook's name, personality, truth rule and the
protected may/may-not contract live in `docs/goldline/WORLD_BIBLE.md` §11–12,
`docs/goldline/REALITY_BRIDGE.md` §6 and `server/companions/seedCompanions.ts`, and are
unchanged here.

---

## Canonical Rook

A lanky explorer-messenger bird. Tall thin legs with big splayed feet, a long trailing
tail, a broad expressive mouth rather than a pointed beak, a camo bucket hat with a
wind-up key through the brim, pushed-up brass goggles, a green body with a red-and-white
spotted face and throat, and a working kit of stuffed satchels, ink pots, brushes and
rolled scroll tubes carried across the hips.

The earlier written description — tall, narrow, ink-black, long straight pointed beak —
is **scratched**. It described a duller animal. (`ROOK_PROMPT.txt` on the pipeline branch
still describes that black rook; it is not canon and was deliberately not brought to main.)

## How he moves (confirmed by Adam, 2026-09-23)

- **He walks upright, like a small person.** Heel-strike, passing, push-off; chest up, a
  little swagger; head carried level, not bobbing.
- **He is never characterized by generic bird movement.** No hopping, no pecking, no
  pigeon head-bob, and he does not fly.
- His wings work as his hands: a raised wing is "wait here", a wing held out is "there",
  a wing out with a sealed letter is a handoff.
- Where a state has no animation, that is an art dependency to report — never a hop, a
  mirrored copy or a transform trick standing in for it.

## Where he joins

The Colosseum's Rook-on-the-line sequence **reveals** Rook and points the player toward
the hunt. It does not grant durable companion ownership.

The existing Coastal Market hunt is the recruitment beat: the player catches Rook
stealing the dispatch satchel, and completion of that authored beat is the one
server-authoritative writer for `companion.rook`.

The Wayward is the first actual trip together after that ownership exists. CONTACT is
separate again: it is granted only after the authored Wayward inspector/parley gate is
server-recorded. None of these states may be recovered from a client cache.

## The approved model and what is built from it

- **Model:** TRELLIS.2 output, `rook.glb` (one fused mesh, ~259k vertices, no rig), kept
  with its source in the local asset archive
  (`goldline-local-archive/.../rook/3d-trellis-source/`). It is not regenerated or
  redesigned.
- **Import and texture:** `scripts/assets/blender/glb_to_frames.py` (−90° X fix, normals)
  and `project_concept.py` (the concept projected at the registered view, yaw 38 /
  elevation 14).
- **Reveal frames:** 24-frame idle through the shared rig (`rig.py`, azimuth 60) —
  `client/public/assets/goldline/companions/rook/rook-idle-*.png`, played by
  `CompanionUnlockReveal`.
- **Rig and overworld states:** `scripts/assets/blender/rook_rig.py` fits an armature to
  landmarks measured on the approved mesh (hips, chest, neck, head, jaw, legs, feet,
  three tail bones, wings, satchels) with procedural skin weights, and renders walk,
  idle, talk, confide, wait, letter, dangle, shrug, brace and point from four facings —
  `client/public/assets/goldline/companions/rook/overworld/`.

## Open

- **Palette, set-wide (Adam).** Rook was specified ink-black and brass inside a set of
  seven meant to look like one production. The delivered Rook is green and red. Whichever
  way it goes, it is a set-wide call: six other companions still follow the old palette.
- **Coloring is unfinished but accepted for now.** The concept projection paints the side
  the concept shows; his other side (and his back) fall back to the calmed body green.
  Staging favors his painted side when he talks.
