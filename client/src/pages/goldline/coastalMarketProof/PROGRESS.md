# Coastal Market three.js proof: progress

Resume here if a session is cut off. Branch `claude/coastal-market-three-proof`, worktree
`~/Desktop/bldg-admin-api-coastal-proof`. Brief: the Phase 1 prompt +
`~/Desktop/coastal-proof-refs/COASTAL-PROOF-HANDOVER.md` (handover wins).

## Stage

**Phase 1 baseline complete**: route + camera, water + light, wind + boats + waterfall, six townspeople, synthesized audio, and dressed Trailblazer. Final emulation profiles and main-thread work metrics are recorded below. Draft PR is the immutable baseline for Phase 2; do not merge it.

## Measured

Every number is emulation, never a phone.

| When | What | Environment | Result |
| --- | --- | --- | --- |
| 2026-09-23 | Bundle budget | `pnpm build && pnpm goldline:bundle:budget` | GoldlineGameHome 71.3 KB gzip before and after; three.js only in `CoastalMarketProofPage-*.js` (191.9 KB gzip, proof-only). Negative control: importing three into GoldlineGameHome fails the gate. |
| 2026-09-23 | Autowalk, graybox | Playwright Chromium headless `--use-angle=metal` (Apple M1), 390x844 DPR 3 mobile+touch, CPU 1x, render DPR 1.6 | Full route 213.3 m walked end to end in 99.2 s at 2.1 m/s; fps median 60 (vsync), min 55; p95 frame 18.3 ms; 28-33 draws; ~84k tris. |
| 2026-09-23 | Autowalk, Stage 2 (textures, baked AO + sun shadow, water, sky) | same, **CPU throttle 4x** | Route 173.8 m in 83.8 s; fps median 60, min 31.5 (one sample); p95 worst 18.2 ms; <=32 draws; ~79k tris; planted-foot slip median 0.17 m/s at 2.1 m/s. |
| 2026-09-23 | Autowalk, Stages 3+4 (plants, 5 boats, waterfall, glows, 6 NPCs, dressed Trailblazer) | same, CPU throttle 4x | 81.5 s; fps median 60, min 54; p95 worst 18.1 ms; <=68 draws; <=217k tris. |
| 2026-09-24 | Final autowalk, phone profile | Playwright Chromium headless `--use-angle=metal` (Apple M1), 390x844 DPR 3 mobile+touch, **CPU throttle 6x** | Route 173.8 m completed in 81.5 s; fps median 60, min 59.8; app-frame CPU 5.66 ms mean / 10.2 ms worst p95; p95 frame interval worst 18.5 ms; <=69 draws; <=222k tris; no page errors. |
| 2026-09-24 | Final autowalk, phone profile | Same phone emulation, **CPU throttle 1x** | Route completed in 79.6 s; fps median 60, min 59; app-frame CPU 2.94 ms mean / 4.0 ms worst p95; p95 frame interval worst 17.9 ms; <=68 draws; <=222k tris; no page errors. |
| 2026-09-24 | Final autowalk, desktop profile | Playwright Chromium headless `--use-angle=metal` (Apple M1), 1280x800 DPR 1, **CPU throttle 1x** | Route completed in 79.6 s; fps median 60, min 59.9; app-frame CPU 2.94 ms mean / 4.0 ms worst p95; p95 frame interval worst 18.0 ms; <=69 draws; <=222k tris; no page errors. |

These are Mac-hosted Chromium emulation measurements, not measurements from a real phone.

## Published

- Stage 1 graybox artifact: https://claude.ai/artifact/79myfaLbhpA3jkJdgdNUdz (private). Artifacts do not serve
  `.glb`; `stageArtifact.mjs` wraps each GLB as base64 JSON. Not verified inside the claude.ai frame (the built-in
  browser is not signed in); the same bundle boots and walks under the local harness.

## Next

Phase 2 follows `docs/goldline/coastal-market/CODEX_HANDOFF.md` on branch
`claude/gallant-franklin-uoh3te`. Preserve this branch and its draft PR as the Phase 1 baseline.

## Phase 2: the Rook Hunt (2026-09-24)

Branch `codex/coastal-market-phase2` (draft PR #247, stacked on the Phase 1 branch). Codex built the
first candidate; Claude took it over and finished the visual/character pass without restarting. The
runtime plays the Phase 1 geography reversed (pier -> terrace, "chase metres").

### The corridor, in order

1. **Waterfront.** The pier, the quay apron, stalls and townsfolk. Rook's brass cage sits at the harbour
   ropeway station; when the chase starts the camera looks past her at it pulling away up the cable.
   The harbour bell rings (the shutdown) and the portcullis at the stair foot drops.
2. **Mantle** a toppled cargo stack across the pier (6.8 m).
3. **RIDE.** Hook the quay crane's line: its counterweight drops, and she is hoisted and slewed up the cliff
   onto the stair landing (20.5 -> 43.8 m).
4. **Jump** the boardwalk gap (58.6-60.9 m); the bridge leaves rise ahead.
5. **RELEASE.** Hook the gorge boom's line: the tie-back lets go, and the boom swings her out over the
   gorge, past the raised leaves, to the far bridge (69 -> 79.4 m).
6. **Mantle** an overturned cart in the arch passage (108.5 m) and a stall barricade in the market lane (127 m).
7. The market gate drops at the lane's end. **TRANSFER:** catch a passing ropeway carrier at the parapet
   and ride the span up to the terrace (140.8 -> 167.4 m).
8. **The cage and the workshop.** The cage docks at the terrace and its door opens: a bench, shelves of jars,
   pigeonholes of letters, charts, and a lamp. Rook takes the sealed dispatch satchel off the station hook
   in front of her. "That's not yours." / "It isn't theirs either." / "Leave it." / "I am leaving with it."

All three uses are one rule: a line under load becomes her lift. The rig moves a hook along its own
mechanism. She hangs from it on a simulated pendulum, and on release she flies on the rig's velocity
onto real floor. Nothing teleports. The shutdown gates are route blockers, and the gaps are real holes
in the walk collider.

### What changed in this pass

- **Environment.** Codex's per-route box kit, which hovered over the sea, is gone. The level builder
  now authors every facade:
  - stone plinths and quoins, arched doors with voussoirs, open shops with lit interiors;
  - framed windows with sills, lintels and painted shutters, flower boxes;
  - balconies on corbels, deep eaves with rafter tails and barrel-tile edges, chimneys;
  - drainpipes, hanging trade signs, striped awnings, damp and grime gradients.

  Around them: market stalls with produce, pottery and baskets, laundry lines, and the chase set's
  towers and cables. Everything is re-baked, with a third lightmap atlas for the facades.
- **Lighting and rendering.**
  - An HDR post stack: MSAA scene target, a dual-filter bloom, tone mapping, then a display-space
    grade (split tone, S-curve, vignette, grain). The reveal adds letterbox bars.
  - A soft contact shadow under her that fades with height.
  - `?fx=0` renders without the post stack.
  - Fixed a negative first-frame delta that could freeze time-based systems.
- **Trailblazer.** Same cut and the same coverage; the geometry is untouched. Surface ids now ride in
  the garment vertex colour. A bind-space garment shader draws:
  - on the top: the v2 sheet's olive side panels, the leather-bound V with brass eyelets, the leather
    shoulder straps, and a stitched hem;
  - on the shorts: olive denim twill with seams, fly and pocket stitching;
  - elsewhere: leather grain, boot creases, knit ribbing, brass;
  - per surface: roughness and metalness.

  The sand linen is warmed so it no longer reads white. She also gets:
  - a sky rim and a sun rim, and warm skin fill;
  - gaits that blend by speed, played at each clip's measured ground speed;
  - a climb that raises her root through the clip instead of snapping;
  - falls off ledges, with a respawn after a fall into the gorge;
  - hands that reach the actual hook when she hangs.
- **Rook.**
  - The approved mesh, decimated to a 42k-tri LOD, with the concept projection as vertex colour. The
    old export carried TRELLIS's own texture, which is why he read as a camouflage blob.
  - His own rig, evaluated to morph targets (look, reach, lift, hold, lean, talk, breath).
  - Staged at canon size, 0.62 × her height, as main's Wayward uses. Codex had him taller than her.
- **Cameras.**
  - The opening sighting of the cage.
  - Fixed crane shots from out over the water for each rig.
  - The reveal: over her left shoulder into the cage, and a three-quarter close-up on her lines.
  - Cinematic cameras collide unless their placement is clear by construction.
- **Controller constants kept:** jog 5.3, sprint 8.25, gravity 22, jump 8.2, mantle 1.15.

### Polish round (after review)

- **Hands on the line.** Every hook carries a turned toggle on a rope loop. While she hangs:
  - she faces square to the toggle;
  - both arms reach it, her fingers close around it, and her body is placed so the toggle sits
    exactly between her knuckles;
  - the swing tilts her whole body about her grip, as a hanging body swings, rather than sliding
    her under the hook.
- **Rook's colour.**
  - It is no longer per-vertex concept samples, which speckled like camouflage on the generated shell.
  - Each vertex is named by the concept's hue within what its body region can be: head (beak, lips,
    hat, goggles), bib, body (feathers, strap), hip bags, legs (leg, claw).
  - A neighbourhood vote removes the speckle, and unseen vertices take the nearest seen paint.
  - It is painted in the concept's palette with its smoothed tone.
  - Runtime welds the shell and smooths its normals.
- **Trailblazer.**
  - Her boots are now built as boots: a lofted shaft, a toe box, a sole and heel, strap bands with
    brass buckles. The old ones were the foot's own surface pushed out, which kept its toes.
  - The leg inside them is not drawn.
  - Every cut garment piece is trimmed per pixel to the exact line it was cut on, so the stair-stepped
    edges are gone.
  - Skin under a garment's outline takes that garment's colour, so a gap reads as cloth.
  - Skin is rougher, with a mottled tone, warm joints, pores, and light scattered through at the
    terminator.
  - Leather and linen reflect less of the grey sky.
- **Camera.**
  - Rig shots cut in and out rather than dragging the lens through scenery.
  - Nothing within 0.35 m of the lens is drawn.
  - A dock post that blocked the reveal is gone.

### Trailblazer rebuilt on a MakeHuman body (after review)

Adam's review said the mannequin-faced Trailblazer "looks like shit", and he approved rebuilding her
on MakeHuman (MPFB2, CC0 assets). She keeps her skeleton, so every clip, the controller, the grips and
the runtime bindings are unchanged. Her approved garment cut and coverage are the same bind-space
lines as before, re-cut on the new body, and a side-by-side against the previous build showed no
added skin.

- **Face.** A photographic CC0 skin, real eyes with irises, and brows and lashes.
  - The eyes' clear cornea shells drew as blank discs over the irises, so they are dropped.
  - The brows and lashes were hidden: glTF marks their materials as blended, so they arrived with
    depth writes off. They are cut-out cards that now write depth.
- **Head.** Fitting MakeHuman's rig to the mannequin's short head and neck bones had squashed her
  head to half height. The head and neck now keep their own lengths, and the neck ends on the
  mannequin's head joint.
- **Hair.** The bun, tie and strands were placed on the mannequin's bigger head. They are now mapped
  onto hers from one head's bounds to the other's and kept 4 mm off the scalp.
- **Garments.**
  - The pieces are cut from a once-subdivided copy of the body, and the top, strap and shorts
    overshoot their outline so the per-pixel trim draws the exact line.
  - The shorts' frayed hem is now a per-pixel fringe; before, it was whole faces that read as blocks.
- **Boots.** The shaft rings are smoothed along the leg and smooth-shaded, where they used to be a
  lumpy cast of the calf. The legs inside the boots are deleted, because they still cast shadows
  through the leather.
- About 48k triangles for her (was about 39k).

### Trailblazer as a VRoid character (2026-09-25, Adam's direction)

Adam rejected the MakeHuman Trailblazer and chose VRoid Studio and an anime look. He picked the
sample (pixiv's AvatarSample_X) and her outfit while it was built: a black tank top, olive short
shorts, a belt with pouches and a thigh holster, no socks, brown lace-up boots, and a high ponytail.
**This outfit replaces the v2 sheet's outfit at his direction.** The v2 cut and coverage rule applied
to the previous builds; this outfit is his own choice.

- **How she moves.** The game still animates the Quaternius rig exactly as before: locomotion, mantle,
  the hang, the arm IK, the grips. That rig is now invisible. `runtime/vrmHero.ts` copies its pose onto
  the VRM's humanoid every frame. Both rigs are bound in a T-pose facing +Z, so each bone's rotation
  away from bind carries over directly.
- **What the VRM adds.** Its own MToon toon shading, its spring bones (the ponytail swings) and a blink.
- **Grips.** Her arms are shorter than the rig's, so while she hangs she is lifted until her own
  knuckles close on the toggle.
- **Cost.** VRoid exports 16 skinned meshes, each with its own 107-bone skeleton, so
  `VRMUtils.combineSkeletons` gives them one shared skeleton; that halved her frame cost.
- **Comparing.** `?hero=legacy` still shows the previous Trailblazer.
- **Measured.** Same session, 4× throttle, full autowalk. **This is emulation, not a phone.**
  - VRoid hero: 16.0 ms mean CPU, 57–59 fps median, 218 draws.
  - Legacy hero: 8.4 ms mean CPU, 60 fps, 193 draws.
  - Merging her 16 materials at VRoid export would win more back.
- **Now out of style.** Rook and the environment are still the previous realistic style.

### Two fixes from Adam's play of the artifact (2026-09-25)

- **The white "ghost" Trailblazer, and every texture packed inside a model file, in the artifact.**
  - The cause: three.js decodes textures embedded in a GLB by fetching their `blob:` URLs. The artifact
    page's Content-Security-Policy (`connect-src`) blocks that fetch, so every embedded texture failed
    silently there. Trailblazer came out white and bloomed in the sun.
  - It had been happening all along: Rook's concept paint, the townsfolk and the earlier Trailblazer
    builds were hit the same way.
  - Reproduced locally by serving the staged artifact under a similar policy: the old build logs 127
    blocked fetches and a white Trailblazer. The fix is to decode embedded images through an `<img>`
    (`TextureLoader`), which that policy allows for `blob:`. With it, no fetch is blocked and she is
    fully textured.
- **The ropeway transfer could not be caught by a player.**
  - The carriers pass over the parapet, not over the path. The hint ("HOLD LINE AS A CARRIER PASSES")
    appears at the closed gate, where the handle passes 2–2.5 m from her reach (the grab accepted 1.9).
  - Only the autopilot, which walks to one exact spot under the rope, ever caught one.
  - The reach is now 3.3 m, from the grab point up to the gate. By keyboard, standing against the
    portcullis on the far side: the old code never caught in 15 s, the fixed code catches within 1.5 s.

### Final measurement

Mac-hosted Playwright Chromium headless `--use-angle=metal` (Apple M1), 390x844 DPR 3 mobile+touch,
**CPU throttle 4x**, autowalk from the pier to the cage door:

- 39.7 s to the door;
- fps median 60, minimum 59.6;
- app-frame CPU 5.96 ms mean, 9.7 ms worst rolling p95;
- 193 draws or fewer (including 9 post passes; each ropeway carrier's hook, toggle and rope are
  separate draws), about 488k triangles or fewer (up from 442k: the MakeHuman Trailblazer has about 9k more triangles, and she is drawn in the shadow passes as well as the main one);
- zero page errors.

Re-measured after the MakeHuman rebuild. The continuous film, with the reveal, runs 57.4 s. **This is emulation, not a real phone.**

### Known limitations

- **Pacing.** The autowalk plays a fast line: it sprints the straights and never misses a hook. It
  reaches the door in about 40 s and ends at about 53 s once the reveal has played. A first-time
  player will be slower, but nobody has measured that.
- **Rook's LOD.** It is the decimated generated shell. Close up, its fine surface still shows the
  generation's noise, and his far side is the concept's feather green, as in the approved turntable.
  His deformation is his rig's, blended linearly between key poses.
- **Trailblazer's hair** is still the Quaternius low-poly hair pack, fitted to her head. It reads
  as chunky cards up close, and her face is MakeHuman's default young face with no expression
  work: it does not blink or emote.
- **Performance** was measured only in Mac Chromium emulation. No real-phone pass was performed.
- **Continuity** is deliberately untouched. Main shows Rook joining right after the Colosseum, while
  this proof introduces him at the Coastal Market. No production progression, CONTACT authority or
  Wayward path changes.
- This is an isolated proof: it reads only its own static assets and writes nothing. Do not merge or
  deploy it as production progression.

## How to run

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_level.py -- --bake   # ~1.5-3.5 min
python3 scripts/assets/coastal-proof/prep_textures.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_characters.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_trailblazer.py
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/assets/coastal-proof/build_rook_runtime.py -- [--preview tmp/rook/p]
npx vite build --config vite.coastal-proof-preview.config.ts
node scripts/coastal-proof/proofHarness.mjs shots          # tmp/coastal-proof-captures/*.png
node scripts/coastal-proof/proofHarness.mjs autowalk --verbose --throttle 4
node scripts/coastal-proof/proofHarness.mjs film           # the continuous run, with the reveal
```
