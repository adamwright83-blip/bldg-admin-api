# Signal mirror: cold-playtest candidate

Code: `feat/small-comforts-proprietor-spike` @ `64a9b7672e39e7bc3c283b3445825ef2fe2d7a02`
(gameplay head stays `cfb881b9e5b46bafcc45639533bda9d4161512ce`; the commits after it only add the test-only entry and recorder, plus two recorder fixes).

**This is a recorder and a test entry. It is not evidence that the mechanic is fun, repeatable, or worth building on.**

## What the director question is
Not "does the signal mirror work?" but: *what, if anything, is pleasurable enough here to deserve becoming part of Small Comforts' repeated game language?* Four hypotheses, held separately:

- **H1 AIMING** - the pleasure is physically angling a tiny object until the light lands.
- **H2 UNDERSTANDING** - the pleasure is realizing a discarded human object can be repurposed into architecture/function.
- **H3 MEANING** - the pleasure is that the improvised object lets the proprietor affect/connect with the railway world or another character.
- **H0 SET PIECE** - charming once, not something a player wants to do again.

Do not collapse these into "interactive crafting."

## Falsifier (do not soften)
If a cold player understands the interaction, successfully aligns the mirror, and nevertheless shows no curiosity about manipulating/reusing objects again, then "physical object manipulation is a repeatable core loop" remains unproven or is rejected. The mirror may still survive as a one-off authored story beat.

If the player cannot discover the interaction but enjoys it once minimally cued, that points toward a discoverability/UX problem rather than automatically killing the verb.

One session may kill a probe if the kill criterion clearly fires. One successful session does not authorize systematizing the mechanic; a repeated pattern across naive sessions is required.

## The two entries (test-only; normal game flow is unchanged)
| URL param | Behavior |
|---|---|
| `?playtest=mirror-cold` | Plays the normal intro/open-case flow by itself, then starts with the proprietor **on the shelf, hands free**. Conductor already lives in the case, window already cut. Brass button, spool and thimble are on the shelf like normal. The tester still has to notice, pick up, haul and use the button. No mirror instructions, no "drag" copy, no progress bar, no arrows. Never reads or writes the tester's own save. |
| `?playtest=mirror-hinted` | Identical, except: if the tester has not pressed on the button within **20 s** of the button being set down, the button **rocks gently in place once** (about 7 degrees, 1.6 s). It shows that the button moves; it does not show where to put it. Fires at most once. Logged as `hint_cue`. |
| `&observer=1` (observer only) | Shows **Export session** and **New session** buttons bottom-left. Shift+E also exports. The tester's link must not include it. |

Not changed in either mode: the base game's own walking hint and pickup/inspect toasts still appear (they are recorded as `text_shown` so you can see exactly what text the tester saw), and the 40 s soft-lock assist is still active (recorded as `assist_fired`).

**The hinted mode must not be used as evidence that the normal game succeeds.** Cold tests discoverability plus desire; hinted helps separate a UX failure from a core-verb failure.

## What is recorded
Local only. No analytics SDK, no network. Output is a JSON file (Export session) and a copy in the tester browser's localStorage (`sc.playtest.sessions`, last 12).

**`meta`**: mode, exact build SHA, session id, start time, viewport (w, h, dpr, portrait), user agent, touch-capable, pointer types actually seen, assist threshold (40 s), hint delay (20 s or null).

**`events` (the raw timeline, no interpretation)**, each with wall ms since session start `t` and game seconds `gt`:
`session_start`, `tap` (what was tapped), `walk_start`, `pickup`, `put_down`, `placing_start`, `press`, `release`, `outcome` (miss / glance / aligned, on change), `catch`, `installed`, `assist_fired`, `hint_cue`, `text_shown` (every toast/hint/story line with channel), `canvas_down` (phase + what was under it, including `installed_mirror`), `ui_click` (button id), `visibility`, `left`.

**`derived` (separate; computed from `events` by a pure function, never fed back)**: first intentional proprietor move; button pickup; button home; first press on the button; number of distinct drag attempts; miss/glance/aligned sequence with times; seconds in placement; installed or not; left before install; touches on the installed mirror afterward; other interactions after install; other objects picked up before the button; whether the 40 s assist fired; whether the hint cue was shown; all on-screen text shown during placement (empty = none) and before it.

## What was actually run
Scripted browser sessions (headless Chromium, software GL, game clock stepped by hand at 1/12 s) against the **built static preview**, one per input type, each exercising the full path: walk, pick up, haul, press-drag attempts (miss, glance, too steep, glance, aligned), install, touch the installed mirror, tap elsewhere, read the recorder.

| Run | Input | Viewport | Result |
|---|---|---|---|
| desktop / cold | mouse | 960x600 | 19/19 checks passed |
| desktop / hinted | mouse | 960x600 | 19/19 (cue fired once after 20 s idle; none before) |
| landscape / cold | touch (CDP touch events) | 844x390 | 19/19 |
| portrait / cold | touch (CDP touch events) | 390x844 | 19/19 |

Checks include: reaches placement by tapping only; no text appears by itself during placement; no cue before the delay; one cue after it in hinted mode and none in cold; assist not fired; pointer type recorded as touch/mouse correctly; build SHA in meta; every core event present; outcome sequence has miss, glance and aligned; drag attempts counted; installed-mirror touch and later interactions recorded; no page errors. Per-run `checks.json`, `session.json` and stills are in `checks/`.

**Read these numbers with care:** in these stepped runs the wall-clock times in `session.json` are meaningless (rendering is slow, the clock is faked). The game-clock `gt` field is the reliable one for them. They prove the recorder and entries work, not how a person behaves.

## Not tested
- Any human play. No cold tester has touched this.
- A real phone, real touch latency, real audio (sound is wired to unlock on first touch; nobody has heard it).
- The 40 s assist and the near-aligned magnet in a browser session.
- `localStorage` export on a real device; the Export button's file download on iOS Safari in particular.
- Real-time (unstepped) play of the whole path in the built preview.
- A hosted URL (below).

## Hosted preview
**Not produced.** Details:
- GitHub Pages cannot be enabled from this environment (the GitHub API path is blocked by the proxy, HTTP 403).
- An empty Vercel project named `small-comforts-playtest` was created in the personal Vercel scope; the step that would have published a build to it (pushing a deploy branch to the public repo and deploying) was blocked by the permission check as creating a public surface, and was not worked around. No deployment exists.
- Lowest-friction alternative: the build is a plain static folder (about 3 MB). `LAUNCH.txt` in this folder has the three-line launch (`python3 -m http.server`), the tester URLs for desktop and for a phone on the same wifi, and the observer URL. The zip was delivered to Adam directly.
- Known preview quirk: the build must be served from the site root (the 3D models load from `/assets/...`), so it cannot sit under a subpath.

## Known rough edges (not fixed, no new gameplay)
- Portrait: the "Lost Property Hotel" pill overlaps the "‹ Lantern City" button in the top bar (existing layout, visible in `checks/portrait_mirror-cold/01_placing_start.png`).
- In the standalone preview the "‹ Lantern City" button goes nowhere; a tester pressing it is recorded as `ui_click` but nothing happens.
