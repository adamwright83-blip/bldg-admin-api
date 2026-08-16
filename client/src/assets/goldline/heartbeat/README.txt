Goldline Heartbeat Asset Pack — Corrected Transparency

All PNGs in this pack were post-processed and alpha-verified.

Important:
- Broad generated vignette / ambient glow backgrounds were removed.
- Corner alpha is 0 for every asset.
- Assets were composited against a bright Mediterranean test background and visually checked.
- These are prototype production/reference assets, not complete animation sheets.

Files:
trailblazer_idle_front.png
ruinbound_hunter.png
ruinbound_slinger.png
ruinbound_shieldbearer.png
linehook_grapple_ring.png
suspended_cargo_hazard.png
pickup_cache_objective.png
ui_act_linehook.png
ui_move_joystick.png

Integration guidance:
- Ruinbound PNGs can replace current procedural enemy body silhouettes for the heartbeat prototype.
- Keep runtime telegraphs, recoil, hit flash, depth scaling, shadows, and death effects in code.
- Trailblazer image is a visual reference unless it can be integrated without regressing directional animation.
- Keep MOVE/ACT touch hitboxes larger than the rendered art.
