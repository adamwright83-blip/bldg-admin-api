# Rook chase hero sequence (Blender)

An 18.5 s, 9:16 set piece: Trailblazer chasing Rook through the Coastal Market harbour to the moored
ship, the first time they meet. Everything is built from scripts in this folder, on the game's own
level geometry, characters and animation library.

```
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/assets/coastal-proof/hero_chase/hero_chase.py -- \
    --res 1080x1920 --samples 32 --out tmp/hero/final --blend tmp/hero/rook_chase_hero.blend
# fast animatic: --preview --res 270x480 --samples 6 --step 3 [--no-sim]
```

Not `--factory-startup`: Trailblazer is imported with the VRM add-on installed in the user's Blender.
Sources live in `~/Desktop/lantern-city-commercial-game/coastal-proof-sources` (override with
`COASTAL_SOURCES`); Rook's approved TRELLIS mesh in the local archive (see `rook_rig.py`).

## Beats

| t (s) | What happens | What reacts |
|---|---|---|
| 0.0 | Rook drops onto the laundry line; the sheets glow against the sun | line dips and rings; sheets ride it |
| 1.1 | He springs over the lens as she bursts through the sheets | cloth sheet is flung by her body |
| 1.7 | Awning, lantern rope, awning, the sign bracket | canvas dents and snaps back; rope dips; lanterns swing |
| 4.0 | He waits on the sign, amused; kicks off it to the roofs | the board swings down across the street; she slides under it |
| 5.3 | He runs the eaves above her; she clips a fruit crate | fruit spills (rigid bodies); gulls burst off the roofs |
| 9.1 | He surfs a lantern rope down across the street over her; she swipes and misses | rope bends under him; a lantern takes her hand |
| 10.0 | Off the pole, onto the ship, up the shrouds to the fighting top | ship rides the swell |
| 13.1 | At the top he touches his hat brim and laughs; she has skidded to the quay edge below | gulls go up off the yards; lens racks from him to her |

## Files

- `common.py`: the shore road as an arclength curve (copied from `build_level.py`'s spine), helpers.
- `env.py`: level import with 2k Poly Haven PBR on every surface (tinted by the level's own palettes),
  sunset HDRI turned so its sun sits on the game's sun, a sun lamp, a height-falling haze volume, an
  ocean-modifier sea with foam, EEVEE settings, and a bloom and vignette compositor.
- `set_dressing.py`: promenade and kerb, bollards, awnings, hanging signs, lantern ropes, laundry,
  fruit stall, barrels and crates, facade greenery, the moored ship with translucent sails.
- `characters.py`: Rook (approved mesh and projection, his procedural rig, new pose vocabulary) and
  Trailblazer (VRM, restyled for real light, Quaternius clips retargeted, VRM spring bones baked).
- `fx.py`: rope dip and ring, pendulums, directed awning canvas, gull flock, rigid fruit, wind.
- `choreo.py`: Trailblazer's speed-profiled path and clip schedule; Rook's segment track.
- `hero_chase.py`: the director; builds, bakes every frame, cameras, renders.

## Techniques worth reusing elsewhere

1. **Retarget by bind-pose delta** (`characters.Retarget`). For each bone, take its armature-space
   rotation away from rest on the source rig and apply it to the matching bone on the target. The
   math is closed form: `q_local = rest⁻¹ · Δparent⁻¹ · Δ · rest`, with no depsgraph round trips.
   It is the same idea as the runtime's `vrmHero.ts`, so what you see here is what the game can do.
2. **Feet planted by construction.** The run clip's time advances with distance travelled divided by
   the clip's measured ground speed (`ClipLibrary.ground_speed`), so speed changes never slide feet.
3. **VRM spring bones stepped by hand and baked.** The add-on's own VRMC_springBone-1.0 solver,
   called after each body frame, gives the ponytail and holster straps the model's colliders and the
   same physics three-vrm runs.
4. **Directed "cloth" with shape keys** (`fx.awning_motion`). A dent key under a landing, with a
   damped rebound when the weight leaves, plus a gusty belly key. It is fully art-directable, and it
   is cheap enough to ship on a phone as a vertex animation.
5. **Rope dip and ring** (`fx.RopeFx`). A V-shaped load under whoever stands on a rope, then a damped
   mode when they leave. Anything hung on the rope follows it and is swung by its acceleration.
6. **Pendulums driven by kicks, wind and support acceleration** (`fx.Pendulum`). This covers signs,
   lanterns and anything that dangles.
7. **Segment-track choreography for a small nimble character.** Hops are parabolas with a chosen apex,
   runs are polylines, with anticipation, landing absorb and look-at-pursuer blended per frame. His
   personality lives in the timing: he waits, looks back, laughs, and leaves at the last moment.
8. **Rigs blended into a oner.** Each shot is a function of the characters' positions. A schedule
   blends between them and a critically damped follow smooths every switch, so re-timing the action
   re-frames the camera automatically.
9. **Backlit canvas cheat.** Translucency plus a small warm emission from the cloth's own colour,
   which is what sells sails and awnings against a low sun.
10. **Probing the set for contact points.** Roof edges, the fighting-top platform and the ship's rail
    are found by ray casts, so the action stays glued to whatever geometry is actually there.

## Keeping this quality in the phone runtime (three.js)

What carries over nearly free:
- **The whole choreography layer.** Rook's segment track, the rope, pendulum and awning reactions and
  the camera rigs are plain math. They port to TypeScript as-is: Phase 2 already has pendulums, ropes
  and cinematic directives.
- **Retargeting and VRM spring bones.** Already in the runtime (`vrmHero.ts`, three-vrm).
- **Awning dents and belly.** Two morph targets per awning, driven by the same functions.
- **Gulls.** An instanced mesh with a two-morph flap, about 20 of them.

What must change to keep the look:
- **Lighting.** EEVEE's ray-traced GI, soft sun shadows and volumetric haze are the biggest single
  difference. On the phone:
  - bake them into lightmaps (the level already bakes AO and sun visibility), but re-bake with the new
    warm, low sun;
  - use one cascaded shadow map, tight on the characters;
  - fake the haze with the existing height fog, plus a screen-space sun glow.
- **Materials.** The 2k PBR sets become 1k albedo and normal, as already done, with roughness packed.
  The palettes stay as vertex colours. The facade greenery becomes instanced cards.
- **Motion blur and depth of field.** Budget-dependent. A cheap velocity-buffer blur on camera moves,
  and depth of field only in the two cinematic beats (the whip and the reveal).
- **Bloom and grade.** Already in `postfx.ts`; match its threshold to this sequence's grade.
- **The laundry.** It is real cloth here. On the phone, bake it to a vertex animation (it only
  matters in one beat), or use the rope-plus-pendulum shape-key trick.
- **The ship.** 170k tris in total. It needs a decimated LOD for the runtime, as `props.glb` does
  today, plus a hero LOD with the rigging as alpha cards for the climb.
- **Rook up close.** The runtime uses a 42k-tri decimation of his mesh. The climb and top shots need
  the higher LOD (or a normal map baked from the full mesh) for his silhouette to hold at this size.
