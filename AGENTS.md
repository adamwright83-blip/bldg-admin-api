# For coding agents (Codex, Gemini, Antigravity, Cursor, Copilot, anyone)

Claude Code loads `CLAUDE.md` automatically. You probably don't, so read these yourself before you
change anything:

1. [README.md](README.md): what this repo is, how to run it, how it deploys.
2. [CLAUDE.md](CLAUDE.md): despite the name, its rules apply to every agent. Section 1 is a separate
   production app (the resident app) that breaks silently if you rename or reshape its agent tools.
3. [ARCHITECTURE.md](ARCHITECTURE.md): who owns which business fact, and the only legal write paths.

## Games

Each game has exactly one canonical build. Older branches, artifacts and prototypes of the same game
exist, and they are wrong.

- **Small Comforts** (three mice in a lost suitcase): [`preview/small-comforts/`](preview/small-comforts/README.md).
  Read [`STORY.md`](preview/small-comforts/STORY.md) for what happens in every chapter (checked
  against the code), and the README for how to run it and what not to use. Do not rebuild it, and do
  not draw new art for it.

## Before you say something exists

Check it on `origin/main`, not in a worktree, an old branch or your memory of an earlier chat. If it
isn't there, say so and stop. Don't recreate it.
