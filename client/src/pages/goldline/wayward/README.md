# The Wayward — the first Road Encounter

Trailblazer's first journey with Rook after the Colosseum. Fiction only.

## The voyage

1. **The deck.** They come aboard the tethered ship. Mooring City looms ahead; the Tether
   Guardian sleeps at the head of the deck; a hair-thin Gold Line seam runs up the planks.
   Optional: the hull cache (Tether Memory — the Linehook shows where the ring is going).
2. **Hold the Line** (`holdTheLine.ts`, `spanScene.ts`). The broken span, side-on. The
   ship's end rolls (heavy rolls warn first), the tether ring sways, a crate on a boom sweeps
   the edge and dips through the cast line, loose rigging drifts through it, and the edge
   crumbles under anyone who waits on it. The gold thread shows her line: clean, fouled or
   out of reach. A clean cast bites and she swings across — Rook hanging on — while the planks
   she stood on fall away. A foul yanks her; a fall is RECOIL (WORLD_BIBLE §26): colour
   drains, the Cut lights, the filament hauls her back to the anchor. Rook catches her once.
3. **The parley.** Mooring City's rope inspectors, Pell and Dunmore. Rook: "Wait here." He
   talks them down, seen not heard — one laughs, one rages, a sealed letter changes hands,
   "This makes us square." "What did you tell them?" "Nothing untrue."
4. **Cast off.** She opens the outer tether. The ship pulls away, the mooring stage comes
   apart, "Plan?" "Yes." "Good." "Go away from it quickly." — she casts back to the departing
   ship, or the Line recoils her aboard.
5. **Under sail** (`sailScene.ts`). The deck she walked in on wakes around her: the seam
   races for the bow, masts rise, canvas fills, the horn, Mooring City falls away, and the
   Gold Line runs ahead toward the next island.

## Rules this module keeps

- **Rook aboard fails closed** (`waywardParty.ts`): the server progression read
  (`companionRookOwned` earned and true — production passes the overworld gate's
  identity-guarded read) or the explicit preview/test seam. Never the same-device party
  cache, the Colosseum flag, `capability.rook.contact` or real visits. Without him the
  span is still crossable and the outer tether stays sealed. His presence is fixed when a
  run starts; a background refetch never adds or removes him mid-voyage.
- **Rook cannot speak a direct lie**: every Rook line in `waywardLines.ts` carries the
  reason it is true, and a test keeps that note mandatory.
- Nothing here reads or writes business state, storage or the network; no cue is a
  `victory` cue (`waywardTruth.test.ts`).
- Rook and the inspectors are rendered from 3D through the shared rig
  (`scripts/assets/blender/rook_rig.py`, `inspectors.py`); the span parts are cut from the
  approved painting (`scripts/assets/wayward/prep_span.py`). See
  `docs/goldline/companions/ROOK_CONCEPT_SPEC.md` for Rook's visual canon.

## Preview

```bash
npx vite --config vite.wayward-preview.config.ts
```

`?start=deck|span|sail`, `&rook=0` (a player without Rook), `&cache=1`. In dev and in the test
harness, `window.__wayward` exposes `state()`, `skipTo(beat)`, `setTimeScale`, `teleport`,
`act` and `forceFall` for bots.
