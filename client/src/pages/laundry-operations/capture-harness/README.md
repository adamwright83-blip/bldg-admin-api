# Laundry operations scene: capture harness

Standalone three.js scene (Laundry Farm "Operations Command"). Not wired into the app: no route, no Lantern City link.

- Scene entry: `../hero.js` (rooms, machines, carts, workers, HUD, tuned GTAO, selective bloom, 20 s choreography as pure function of t).
- `../hud2.js` + `../style2.css`: inspector / metrics / lifecycle strip.
- `../props.js`, `../props2.js`, `../textures.js`, `../people.js`: geometry, materials, CC0 Quaternius workers (`../assets/*.glb`, meshopt).
- `../main.js`, `../city.js`, `../ui.js`, `../data.js`, `../style.css`: earlier WareTrack-style version + dusk Lantern City bridge (`legacy-v1.html`).
- Deps already in the repo: three 0.186.0, vite, @playwright/test.

Query switches on index.html: `?capture=1`, `t=<sec>`, `gtao=0`, `sbloom=0` (full-scene bloom), `aor/aos/aoe/aot/aon/aof` (GTAO tuning), `dpr`.

Run (from repo root):
    node client/src/pages/laundry-operations/capture-harness/shots.mjs <prefix> <t...>   # stills -> /tmp/laundry-shots
    SCALE=1.5 node client/src/pages/laundry-operations/capture-harness/record.mjs 20 30 /tmp/laundry-shots/clip.mp4

Scripts expect Chrome for Testing 1228 in the Playwright cache (see executablePath).
