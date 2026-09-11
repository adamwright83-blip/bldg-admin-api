# ROOK — concept image spec

**Status:** input spec for the image-to-3D pipeline. Written 2026-09-11.
**Scope:** presentation only. Rook's name, personality and the protected may/may-not
contract in `docs/goldline/REALITY_BRIDGE.md` and `server/companions/seedCompanions.ts`
are unchanged by this document. Only visual form is decided here.

Rook is the proving case for the whole companion pipeline because Rook is Kingdom 2's
unlock and the only companion with an engine already behind it (`draftCustomerMessageTool`).

---

## STATUS: superseded by delivered concept art

Adam produced the canonical Rook. The written description that used to live in
this document — tall, narrow, ink-black, long straight pointed beak — is
**scratched**. It described a duller animal. The delivered design is the truth.

**Canonical Rook:** a lanky explorer-messenger bird. Tall thin legs with big
splayed feet, a long trailing tail, a broad expressive mouth rather than a
pointed beak, a camo bucket hat with a wind-up key through the brim, pushed-up
brass goggles, a green body with a red-and-white spotted face and throat, and a
working kit of stuffed satchels, ink pots, brushes and rolled scroll tubes
carried across the hips.

**Set implication, for Adam to rule on.** Rook was specified ink-black and brass
inside a set of seven meant to look like one production. The delivered Rook is
green and red. Whichever way it goes, it is a set-wide call: six other
companions currently follow the old palette.

## Pipeline intake

The delivered art is a 1:1 plate with a soft background gradient and a cast
shadow. Both bake into geometry during reconstruction, so they are stripped
first:

```
python3 scripts/assets/blender/prep_concept.py <image> --out-dir artifacts/rook --id rook
```

That writes a cutout, a flat plate for image-to-3D, a 48px silhouette, and a
JSON report. The report counts opaque islands: **one island means every limb
touches the body**, which is what fuses during reconstruction. It is measured
rather than guessed, and it is reported rather than silently worked around.

## Acceptance check before it goes into the pipeline

1. Does the whole body fit with margin on all four sides?
2. Is the background genuinely flat, with no gradient or vignette?
3. Do the wings and arms read as separate from the torso?
4. Is the beak clearly projecting, not merged into the head?
5. Reduce it to 48px and squint. Is it obviously a tall narrow bird, and obviously not
   the owl, the eagle or the raccoon?

Check five is the one that has already failed twice in scripted geometry. It is worth
doing on the concept image before spending generation time on it.
