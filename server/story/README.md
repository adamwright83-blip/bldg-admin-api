# Story seasons (server)

One authored chapter per night on the main account page. This folder holds the machinery only. No season's words live
in this repository except the placeholder Season 0 in `fixtures/season-0.json`.

## Rules the server enforces

- **Story never reaches the business.** Story gameplay sends `x-joystick-story` on every request. The Express gate in
  `storyIsolation.ts` refuses that request anywhere but `system.story.*` before any route, REST endpoint or webhook
  runs, and the tRPC base procedure refuses it in every other procedure. The files here may import only what
  `storyIsolation.test.ts` allows, and the store touches only the six `story_*` tables.
- **One chapter per business-local night.** Chapter n+1 opens on the first local date after chapter n was won.
  Losing changes nothing; retry is unlimited. A retried win returns the same ending and records nothing new.
- **Nothing unearned leaves the server.** `system.story.tonight` resolves variants against the operator's own answers
  and nights away, and returns only the chapter they have reached. Endings and questions appear only after a win.
- **Answers are final.** The same answer again is accepted (a retry); a different one is refused.
- **Off by default.** `JOYSTICK_STORY_TENANTS` (comma-separated tenant ids, no wildcard) and `JOYSTICK_STORY_SEASON`
  (season slug) must both be set. Otherwise `tonight` answers `{ enabled: false }` and every write is refused.

## Files

| File | Role |
| --- | --- |
| `storyEngine.ts` | pure rules: dates, unlocks, outcomes, variant resolution, answer finality |
| `storyService.ts` | orchestration with an injected store and clock |
| `storyStore.ts` | the only database access; also `seedStorySeason` |
| `storyRouter.ts` | `system.story.tonight / start / finish / answer`, operator login, canonical operator id |
| `storyIsolation.ts` | the Express gate and the tRPC guard |
| `storyFlag.ts` | the two environment variables |

Tables: `drizzle/0150_story_tables.sql` (additive, applied by `scripts/migrate.mjs`).
Rollback: `drizzle/0150_story_tables.rollback.sql` drops exactly those six tables, by hand.

## Loading a season

```bash
pnpm exec tsx scripts/story/seed-season.ts server/story/fixtures/season-0.json
```

Real seasons are kept outside the repository and passed by path. The script validates the file, writes nothing if it
is invalid, and prints counts only.

## Spoiler guard

`node scripts/story/spoiler-guard.mjs [build-dir]` fails if a tracked file (or a build output) contains a word that
belongs only to an unreleased season. It holds salted hashes, not words. CI runs it on every pull request.

## Tests

```bash
pnpm exec vitest run server/story shared/story.test.ts
DATABASE_URL=mysql://root:root@127.0.0.1:3407/story_test pnpm exec vitest run --config vitest.integration.config.ts server/story
```
