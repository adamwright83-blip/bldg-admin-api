# Brass button -> signal mirror: capture evidence

Code under test: `feat/small-comforts-proprietor-spike` @ cfb881b9e5b46bafcc45639533bda9d4161512ce

How this was captured (read before trusting it): a scripted Playwright "player" drives real mouse events
(tap object, tap the suitcase mouth, press-drag-release on the canvas) against the real game in headless
Chromium with software GL. The game clock is replaced by a fixed 1/12 s step advanced by hand, so slow
rendering never changes game time. Frames in the drag/aha segments are 1 game frame each; walking
segments are sampled every 6-24 game frames, so those parts of the clip look held. No human has played it.

- `mirror_proof_clip.mp4` - uncut, one run: shelf -> pick up button -> haul home -> player drags (miss, glance, too steep, glance) -> light lands -> proprietor wedges it -> installed -> Conductor reacts -> furnish. ~28 s of game time.
- `stills/` - labelled frames from that same run (`11_*` is after a hard reload).
- `timeline.json` - per-frame game state: stage, mirror outcome/tilt/x, and any toast/hint/story text visible.
- `after_reload.json` - episode state after reload (fixture + placement + routine, mirror rebuilt).
