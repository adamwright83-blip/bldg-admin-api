# Monitor desk (`cpe.monitor-desk`)

A story game: one night shift at Century Park East's camera wall, played from the desk. About five minutes on a first
play; a retry on the same page starts half a minute before the window.

- **The shift.** Six cameras: one on the main monitor, all six as live thumbnails. Motion alerts teach the wall:
  pull the flashing feed (tap it, or 1–6), follow the subject (drag, or ← →), zoom (+ −, or ↑ ↓) and take a still
  (STILL, or Space). A still counts only if the subject is whole in the frame and close enough. The shift's stills
  are logged and change nothing else.
- **The window.** At the configured time the indicator over the lobby lift lights at the configured floor for
  `windowSeconds`. Somewhere in it the doors open and a figure steps out, looks across the lobby and goes back in. The
  lobby feed drops its signal for a moment every few seconds, and other cameras raise decoy alerts.
- **Win:** one still from the lobby camera holding the whole figure, close enough, with the lit indicator in the
  same frame. **Lose:** the doors shut without one. Retries are unlimited.

The host gives the game its chapter `config` and an `onFinish` callback, nothing else. Every story word is the host's
(from the server); the labels here are the desk's own. Settings: `server/story/README.md`, "Games".

| File | Role |
| --- | --- |
| `monitorDeskModule.tsx` | the registry entry; lazy-loads the game so three.js never reaches the home's chunks |
| `MonitorDeskGame.tsx` | layout, controls, HUD, the loop, win and lose; test hook `window.__storyMonitorDesk` in dev and visual-test builds |
| `deskMachine.ts` | the rules, pure and tested: the clock, alerts, the window, who is where, what makes a still |
| `deskScene.ts` | the picture: the CPE set (`cpeSet.ts`, with the lobby opened onto the lift), six pan/zoom cameras, the wall through the CPE tube (`cpeCctv.ts`) |
| `deskSounds.ts` | a blip, the shutter, a refusal and the hum, synthesised |

It reuses only the pure parts of the building (layout, set, textures, the tube); `chapterHost.isolation.test.ts`
walks those imports to prove nothing business-wired (`CenturyParkEast3D.tsx`, the shotgun, `cpeRuntime.ts`) comes
along. The cast is the Beverly Hills cast (`/assets/goldline/beverly-hills-3d/cast/`).

Reduced motion: no tube roll, tearing, cut glitch, flash or eased camera moves; the people still walk.

Captures (mocked, Season 0): `node scripts/story/capture-story-home.mjs` against the `goldline-verify-visual` server.
