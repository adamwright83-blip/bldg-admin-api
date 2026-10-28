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

## Home presentation metadata (cinematic home)

Keep location in the existing chapter `config` JSON. For the real Chapter 1, Claude should add
`"location": "century_park_east"` to that chapter's `config` in the private season file and reseed it.
The validated values currently correspond to existing landmark ids: `century_park_east` and `opus_la`.
No schema migration is needed. Season 0 includes both values for visual verification.

`system.story.tonight` projects only the reached chapter's validated location, so Home can frame it
before Play. It does not expose the rest of the game config. Existing seasons without a location
retain the broad city framing. `system.story.start` continues delivering game config through the
existing story client.

Optional authored closing content also lives in `config`:

```json
{
  "location": "century_park_east",
  "closing": {
    "responses": { "left": "Placeholder response to left.", "right": "Placeholder response to right." },
    "keepsake": { "title": "Placeholder keepsake", "text": "Placeholder keepsake description." },
    "tomorrow": "Placeholder invitation for tomorrow."
  }
}
```

Response keys must match the chapter's answer option keys. Author real text in the private season;
never copy it into components or public fixtures. Closing metadata is removed from `start` game
config. Only after a win and a saved answer (or a win for chapters without questions), `tonight`
returns the selected response, keepsake and teaser. Other responses stay server-side. Home can
revisit the current earned ending without starting a second game. This does not create business
progress or an inventory spanning earlier nights.

The story registry currently contains only `fixture.button`. Customer release still needs the
approved real game and authored presentation content; the new shell does not replace either.
