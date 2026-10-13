# Small Comforts (Lost Property) — Execution Prompt

Paste this whole prompt into a fresh Claude Code session in `adamwright83-blip/bldg-admin-api`.
**Reuse the same prompt for every session.** Each session picks up where the last one stopped.

---

## Your job

Build Small Comforts Chapters 1–3 as specified in `docs/hiddenGame/LOST_PROPERTY_SPEC.md` (spec v2),
through the five PRs in spec §10, until the game is playable from the start of Chapter 1 to the end of
Chapter 3.

You continue from PR to PR without asking. You stop only at the stop points below.

## Start of every session

1. `git fetch origin`. Check out the branch named in the latest handoff entry; if there is none, check out
   `claude/lost-property-pr1-unlock-gate`.
   - If that branch is not in the remote yet, the spec and handoff files below were committed only
     locally. Report it and stop.
2. Read, in order: `ARCHITECTURE.md`, `CLAUDE.md`, `docs/JOYSTICK_SYSTEM_MAP.md` (§3a especially),
   `docs/hiddenGame/LOST_PROPERTY_SPEC.md` (all of it), and `docs/hiddenGame/LOST_PROPERTY_HANDOFF.md`
   (all of it).
3. Inspect the code you are about to change before changing it. Start with
   `client/src/components/admin/control-room/SmallComforts/`.
4. Take the "Exact next step" from the last handoff entry, and work from there.

## The spec is locked

`LOST_PROPERTY_SPEC.md` is the only creative and product authority. Adam approved it.

- Build every beat, set piece, intended path, wrong answer, line, camera change and cliffhanger exactly
  as written. §8 lists every line the game may say or show; there are no others.
- **Do not:**
  - write new jokes or dialogue;
  - cut or merge wrong answers;
  - turn an interactive beat into a cutscene or a menu of choices;
  - reorder chapters;
  - show anything that hints at the twist;
  - use the v1 spec, ChatGPT summaries, or the older plate-pipeline Chapter 1 text as instructions.
- If something cannot be built as written, keep the requirement, build everything around it, and log the
  blocker with evidence. Never quietly substitute.
- **No fake mechanics.**
  - A Climb that only flips a state variable is not Climb.
  - A Carry that plays a cutscene is not Carry.
  - The haircut must cut what the player actually drove.
  - The pinball must be playable.
  - The rhythm must read real input timing.

## Architecture (spec §3)

- **One** three.js runtime, mounted from the existing Lantern City entry. It replaces the CSS plate
  viewer and draws plates and live 3D characters together.
- Reuse what works in `SmallComforts/game/*` and `logic/*`. Do not build a second engine.
- Puzzle and unlock logic stays deterministic and renderer-free, so tests can run it.
- **Missing art:** plates and felt-mouse models come from Adam (spec §9). While they're missing, use a
  greybox labelled "PLATE PENDING" and keep building. Never use generated concept art as a stand-in.
  Never call a greybox shot visually accepted.

## Hard boundaries

- The game never writes a business fact. No XP, streaks, scores, timers or fail states.
- **Never:**
  - invent completion or sale evidence;
  - `COALESCE` or default a tenant;
  - weaken a repository guard to make something pass.
- **Do not touch** Claire, Daphne, the Day Line visual design, or the resident-app integration
  (CLAUDE.md §1).
- **Unlock rules come from spec §2.** If the only "verified sale" signal you can find is weaker than a
  verified sale, stop and report it with file and line evidence.
- **Developer preview** (spec §2) is env-gated, writes nothing, and tests must prove no other user or
  tenant gets it.

## Each PR

1. Rebase on the latest `origin/main`.
2. Build the scope in spec §10, with the tests listed in spec §7 for that scope.
3. Run `pnpm test` (the relevant suites at minimum), `pnpm check`, `pnpm check:nomenclature` and
   `pnpm check:vertical-dependencies`.
   - Also run `check:tenant-ratchet` and `check:domain-boundaries` where git history allows.
   - If a failure was inherited from `main`, prove it (it fails on `main` too) and leave unrelated code
     alone.
4. **Captures:**
   - Capture from the running game in Chromium at 390×844, DPR 3.
   - Production is password-gated and has no local database, so you may add a dev-only harness route.
     It mounts Small Comforts with mocked eligibility, exists only when `import.meta.env.DEV`, and the
     build must prove it is absent from production.
   - Label every capture as a desktop browser emulating a phone. Never call it an iPhone.
5. Open the PR with: scope, test output, captures, and VERIFIED / INFERRED / UNKNOWN.
6. Merge rules:
   - **PR 1 contains a migration: never merge it.** Stop and ask Adam (stop point A).
   - **PR 2 onward:**
     - Merge only when PR 1 is in `main` and every check above is green.
     - If PR 1 is not merged yet, keep stacking branches (PR 2 based on PR 1's branch, and so on). Do not
       merge into `main` out of order.
     - Never merge failing code.
7. Append a handoff entry, then continue with the next PR.

## Stop points (the only reasons to stop)

**A. PR 1 approval.**
- PR 1 adds `hidden_game_chapter_unlocks` and any other table. Verify it against the real production
  migration path (`scripts/migrate.mjs`): it must be additive and idempotent.
- Report the backup and restore-drill status in `docs/JOYSTICK-SAAS-LAUNCH-OPS.md`.
- Then stop for Adam's merge approval.
- **While waiting, keep working.** Continue PR 2 onward on stacked branches, then return to the stop.

**B. Context.** If this session's context is getting long:
- finish the current unit cleanly (tests green, committed, pushed);
- write a full handoff entry;
- stop.

Adam starts the next session with this same prompt.

**C. External blocker.** Missing credentials, missing art that blocks every remaining unit, or a
production operation that can't be undone. Log it with evidence and stop.

## Deployment

Merging is not deploying.

After the final merge:
1. Confirm the deployed Railway and Vercel builds match the merged SHA.
2. Confirm the migration ran.
3. Confirm Lantern City loads and Small Comforts launches the three.js runtime.
4. Confirm the preview account sees Chapters 1–3 and a normal account follows §2.

**Never run a database operation by hand in production.**

**The physical iPhone check is Adam's.** Hand it to him as a three-line checklist.

## Every session ends with

A handoff entry, plus a reply to Adam containing:
- what is now playable;
- VERIFIED (commands and results);
- INFERRED;
- UNKNOWN;
- blockers;
- the exact next step.

**Do not describe anything as playable unless you played it.**
