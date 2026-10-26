# Small Comforts — the canonical build

**This folder is the real game.** Adam confirmed it on 2026-10-26 from the captures in
[`reference/`](reference/): Chapter One's "Lunch. Tomorrow." and the Chapter Three Heimlich
with the singing glass.

**What happens in each chapter, who the mice are, and the mistakes agents keep making: [STORY.md](STORY.md).** Read it before you describe or change anything.

If you are asked to work on Small Comforts, the three mice, the suitcase game, the cozy
true-crime mice game, or "Lost Property", start here. Improve these files. Do not rebuild the
game, and do not start from anything under [Not this](#not-this).

Source: the Claude artifact "Small Comforts", version `1791868620-6d07`, published 2026-10-13
(`https://claude.ai/artifact/TQfw4Qw7PZT61UUPV64Gae`). This folder started as a byte-identical
copy of that version. **From 2026-10-26 on, this folder is the source of truth.** Change it here
first, then republish the artifact from it. The artifact link needs Adam's claude.ai login. This
folder does not.

## Run it

```bash
python3 -m http.server 5301 --directory preview/small-comforts
```

Open <http://localhost:5301/>. Use a plain static server: Vite rewrites the three.js import map
and changes what loads. Sound on, landscape.

## What is in it

| File | What it is |
|---|---|
| `index.html` | Chapter menu. Progress is in `localStorage` keys `smallcomforts.*`. |
| `ch1.html` | **Chapter One — Breakfast in Bed.** His lunch is on top of the tin. Pip's bed is up on the shelf. Nobody can reach either. |
| `ch2.html` | **Chapter Two — This Is a Sign.** He's asleep, his beard is in the way, somebody has a trimmer. |
| `ch3.html` | **Chapter Three — Leftovers.** Inside: the mice feed him the week's scraps on the in-breath. The chicken goes down wrong, he backs through his own window and lands outside. Outside: the neighbour, one arm in a cast, does the Heimlich; the mice jump on her beat; a shard of his window beside each mouse sings that mouse's note. |
| `man.js` | The man's and the neighbour's faces: an SVG rig with named expression beats. |
| `plate.jpg`, `plate1.jpg` | The painted suitcase interior. |
| `out.jpg`, `down.jpg` | The painted yard under his window, side-on and looking down. |
| `body_*.png` | His cut-paper body for the yard. |
| `*.webp` | Props: egg, shoelace, whoopee cushion, cap. |

**There is no separate Chapter Four file.** The choking, the window, the one-armed Heimlich and
the singing glass are the second half of `ch3.html`. When Adam says "Chapter Four", he means
that sequence.

Each chapter is one self-contained page: a canvas painted plate, felt mice in three.js (loaded
from a CDN through the page's import map), and synthesized sound. In `ch3.html`,
`window.__dbg.outside()` jumps straight to the yard for captures and testing.

## Ideas ported from Antigravity (2026-10-26), on trial

Adam is playing these to decide what stays. The art is untouched: every gag uses the existing
props, mice and cutouts.

| Where | What | How to see it |
|---|---|---|
| `ch3.html`, outside | The window shards pop up and shout **"WE'RE FREE!"** while he chokes | Plays on its own when the yard scene opens |
| `ch3.html`, Heimlich | On every good jump, the shard with the microphone sings a line ("NO MORE PUTTY!", "GOODBYE, SILL!", "OUTTA THE FRAME!"…) | Hit a jump on its note |
| `ch3.html`, ending | The Conductor's glass sings back to Pip: **"HAL-LE-LU-GLASS!"** | Finish the chapter |
| `ch3.html`, sound | **Choir A/B.** `?choir=a` is the original: the glass sings only its cue note, plus a chord on her push. `?choir=b` adds a four-part "aah→EEE" chord on every jump. Remembered per device. | Open `ch3.html?choir=b`, or `?choir=a` to switch back |
| `ch3.html`, feeding | **Alternate miss.** The first out-breath miss with a scrap plays the original (hat on Pip, bonk off the cap, chicken leg to the face). The second miss with the *same* scrap bursts it on his lips, and the crumbs sit in his moustache. | Feed him on the out-breath, twice, with the same scrap |
| `ch2.html`, the rig | **New:** Biscuit grabs the shoelace instead of the trimmer. The lace yo-yos him up at the hook, and he drops onto his cushion. | Tap the hanging shoelace while the trimmer is glowing |
| `ch2.html`, haircut | **Alternate wrong move.** The first time you buzz while he stirs, you get the original swat and Tarzan swing. The second time, all three mice go limp like toys until he settles. | Keep buzzing after Pip's warning, twice |
| `ch1.html`, the shoelace step | **New:** Pip tries to lift the bottle cap. It flips onto his head like a helmet, and he staggers blind into the whoopee cushion. | Tap the bottle cap on the rug before the Conductor swings |

Each chapter's `window.__dbg` can trigger these directly (`wrongCap`, `wrongYoyo`, `playDead`,
`swat`, `outside`, `win`).

## Not this

Each of these has sent an agent the wrong way. Do not use them as the base, and never take
their art.

- **The app's `client/src/components/admin/control-room/SmallComforts/`.** It renders only the
  painted Tin Can House plate on Lantern City's Hollywood island. Its `game/` and `logic/`
  folders are an older 3D proprietor prototype that nothing imports. None of it is these chapters.
- **Older Claude artifacts.** "Small Comforts" of 2026-10-04 and 2026-10-11 (an earlier
  single-page build); the standalone "Breakfast in Bed" and "This Is a Sign" (2026-10-11) and
  "Leftovers" (2026-10-12, a Heimlich without the singing glass); "Small Comforts Chapter One"
  (2026-10-05); and the "Lost Property: …" look tests, cast and story bible (2026-10-04/05).
  This bundle supersedes all of them.
- **Branches** `feat/small-comforts-*`, `fix/small-comforts-*`, `small-comforts-in-lantern-city`,
  `evidence/small-comforts-proprietor-spike`, `art/small-comforts-blender-vs01` and
  `feat/home-truth-small-comforts*`: the 3D proprietor line and the plate entry.
- **Antigravity's `feat/small-comforts-chapters-1-4`** (closed PR #724). It was rebuilt from a
  written description with its own art. Its graphics are rejected. Its chapter logic and
  synthesized audio may still be mined for mechanics and jokes, ported into these files.
- **The early story bible's cast and chapter table** (a Baker and a Reader mouse, a "From the ceiling" chapter). Those predate the build. [STORY.md](STORY.md) is what was actually built.
- **`server/mitch/smallComfortsProduction.ts`** still describes the Lost Property Hotel
  proprietor proof, not these chapters.

## Not done yet

These chapters are not wired into the app. When that happens, this folder is the source, and
connecting it to the Hollywood Tin Can House entry is its own change. The unlock gate in PR #556
is separate business logic; check its chapter rules against these chapters before wiring.
