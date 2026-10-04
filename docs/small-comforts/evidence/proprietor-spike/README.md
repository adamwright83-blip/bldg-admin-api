# Proprietor spike — evidence package

Spike under test: branch `feat/small-comforts-proprietor-spike` @ `8bec0a2` (pushed, not merged).
Status of this package: **IMPLEMENTED + headless-VERIFIED. Not CREATIVE-ACCEPTED. Not RELEASED.**

## How the captures were made
- Headless Chromium (Playwright) with software GL (SwiftShader). Frame rate is NOT representative; no performance claim is made.
- Driven through the normal player input path: pointer taps / touch taps on the canvas and the on-screen buttons. Test-only shortcuts: `?spike=1` (seeds the Conductor as a resident and exposes `window.__smallComforts`), `begin()/skipIntro()/openCase()` to get past the title/descent/latch.
- Desktop screenshots and the video were captured at `6024745`. `8bec0a2` differs from it only by a CSS media block for short landscape screens (`max-height:520px`), which does not apply at 900x560. Touch captures were taken at `8bec0a2`.
- Screenshot latency under software GL is several seconds, longer than a toast (1.6s min) or the reaction banner (7.2s). Where a text banner had already expired at capture time, `desktop/04` and `desktop/07` re-fire the same toast text right before the screenshot. The reaction narration banner is NOT shown in `desktop/11`; it appears in the real-time video only.

## What each capture proves
| Required item | File(s) |
|---|---|
| walking the shelf | desktop/02, 03, 04; landscape-touch/03, 03b; portrait-touch/03, 03b |
| carrying thimble / button overhead | desktop/06, 15 |
| pushing (rolling) the spool | desktop/13, landscape-touch/05, portrait-touch/05 |
| carry-one rejection | desktop/07 (log line: `REJECTION TOAST: Your hands are full...`) |
| put it down | desktop/08 (state after: `carrying:null, fixtures:[]`) |
| returning an object home | desktop/09 (hop over the lip), 10 (tinkering) |
| resident reacting | desktop/12, 14, 16; landscape-touch/06; portrait-touch/06 |
| sealed tin-can tease | desktop/04, landscape-touch/04, portrait-touch/04 |
| reload persistence | desktop/17, 18 + log `after reload (pre-start)` shows all 3 fixtures and `conductor: signals_trains` restored |

`desktop-playthrough-real-time-5min.mp4` is the whole desktop run recorded in real time (about 5 minutes only because software GL is slow).

## Re-run it yourself
```
git checkout feat/small-comforts-proprietor-spike
pnpm install --frozen-lockfile --ignore-scripts
mkdir .harness && cp tools/small-comforts-harness/{index.html,main.tsx,vite.config.ts} .harness/   # from the evidence branch
pnpm exec vite --config .harness/vite.config.ts
# open http://127.0.0.1:5199/?spike=1
```
Playwright driver: `tools/small-comforts-harness/evidence.mjs` (`MODE=desktop|landscape|portrait`, `QUICK=1` for the short touch pass).
The game is otherwise only mounted behind the admin gate in Lantern City; the harness mounts `SmallComforts` directly.
