# Small Comforts in the app

**The real game is not in this folder.** The canonical Small Comforts build, the three chapters
Adam approved, lives in [`preview/small-comforts/`](../../../../../../preview/small-comforts/README.md).
Read that README and [`STORY.md`](../../../../../../preview/small-comforts/STORY.md) (what happens in each chapter) before changing anything here.

What this folder is today:

- `SmallComforts.tsx` is the Hollywood island entry in Lantern City. Clicking the Tin Can House
  opens the real game full screen in a frame at `/small-comforts/`, which the server serves
  straight from `preview/small-comforts/` (`server/_core/smallComfortsStatic.ts`, with its own
  scoped CSP). Change the game there, never here.
- `game/` and `logic/` are an older 3D proprietor prototype from the Lost Property Hotel concept.
  Nothing in the app imports `game/`. Do not build on it, and do not use it as the chapters.
