# Claire PR1 — REAL (non-mocked) Anthropic exam

**Status: BLOCKED. No exam was run. Nothing below is fabricated model output.**

This file is intentionally kept separate from `after-pr1-transcript.md` (the
earlier, clearly-labeled *mocked* harness output) and from
`after-pr1-live-transcript.md` (the first blocked attempt, made from inside
the sandboxed coding environment). This file documents a second, more
thorough investigation into whether a real Anthropic exam through the
actual PR #161 code path was achievable, per Adam's explicit "live
acceptance only, do not improvise" instruction.

## What was investigated

1. **PR-preview / branch-deploy pattern in this repo or Railway project.**
   Checked for `railway.json` / `railway.toml` (none exist), any `package.json`
   script or `.github/workflows/*.yml` step that deploys a non-`main` branch
   or spins up an ephemeral preview environment (none found — the
   `DAYFORGE_PUBLIC_PREVIEW_*` variables are an unrelated in-app Dayforge
   feature-preview mechanism, not a Railway branch/PR deploy). Confirmed via
   Railway MCP `describe-service` that the `bldg-admin-api` production
   service's `source.branch` is hardcoded to `main`, and via `list-services`
   (done in the earlier PR1 pass) that this Railway project has exactly
   **one environment: `production`**. There is no preview-environment or
   branch-deploy pattern to reuse.
2. **Pulling a real `ANTHROPIC_API_KEY` value via Railway MCP tools, to run
   the actual generation functions in-process without deploying anything.**
   `mcp__Railway__list-variables` was called against the `bldg-admin-api`
   service. Its own tool description states plainly: *"Connected OAuth apps
   receive variable names only."* This Railway MCP connection is exactly
   that — an OAuth-connected app, not a Railway API token/session — and
   every call in this and the prior PR1 pass returned `"valuesRedacted":
   true"` with names only, never values. **There is no way, through this
   tool, for this session to read the actual value of `ANTHROPIC_API_KEY`
   or any other secret on the `bldg-admin-api` service.** This is a
   structural limitation of the connection type, not something a different
   parameter or retry would change.
3. **A directly-usable Anthropic key already present in this sandboxed
   environment.** Re-confirmed from the prior pass: `env | grep -i
   anthropic` shows only `ANTHROPIC_BASE_URL` (belonging to the Claude Code
   harness itself); no `ANTHROPIC_API_KEY` is set. A direct
   `@anthropic-ai/sdk` call in the prior pass returned `HTTP 401
   authentication_error`.

## Conclusion

**Both of the two technical paths offered are structurally blocked in this
environment — not by choice, and not something retrying or improvising
around would fix:**

- No PR-preview/branch-deploy pattern exists for this Railway project to
  stand up a temporary deployment of this branch.
- The Railway MCP connection available to this session is OAuth-scoped and
  cannot return actual secret values (by the tool's own stated behavior),
  so a real key cannot be pulled to run the generation functions in-process
  either.
- No usable Anthropic key exists directly in this sandboxed environment.

Per the explicit instruction not to improvise or fabricate a workaround,
**this task stops here rather than inventing a third path.**

## Exact shortest manual procedure for Adam (or anyone with real credentials)

A ready-to-run harness already exists on this branch:
`docs/goldline/claire-intelligence/run-real-exam.ts`. It calls the real,
unmodified PR #161 production code path (`answerClairePreDriveFollowUp` /
`writeClairePreDriveBrief` → the real `invokeTextLLM` → a real Anthropic
API call using `ENV.anthropicModelClaire || ENV.anthropicModel`, i.e.
whatever production already uses — no model override), with
`recordGeneration` explicitly no-op'd so it cannot write to any database,
and it never touches Twilio. It writes RAW model output (no rewriting/
curation) to `after-pr1-REAL-transcript.md` and `after-pr1-REAL-metrics.json`,
overwriting only those two files.

**Shortest procedure, from a machine that has a real Anthropic API key for
this account:**

```
git fetch origin
git checkout codex/claire-intelligence-pr1-conversation
npm install --legacy-peer-deps   # or pnpm install, matching this repo's lockfile
ANTHROPIC_API_KEY=<your real key> npx tsx docs/goldline/claire-intelligence/run-real-exam.ts
```

That's it — no deployment, no Railway CLI required, no Twilio call, no
database required (see the script's own header comment for the one caveat:
if a real `DATABASE_URL` is also exported, cost-tracking will write one
small AI-usage increment per turn under a synthetic tenant id; omit
`DATABASE_URL` or use a throwaway one for a fully DB-write-free run — either
way, nothing customer-facing or order-related is touched).

**Alternative, if Adam has Railway CLI access to this project** (pulls the
real key via a Railway variable reference instead of pasting it manually,
never printing the value):

```
railway login
railway link   # select the bldg-admin-api service / production environment
git checkout codex/claire-intelligence-pr1-conversation
npm install --legacy-peer-deps
railway run --service bldg-admin-api -- npx tsx docs/goldline/claire-intelligence/run-real-exam.ts
```

`railway run` injects the service's real environment variables
(`ANTHROPIC_API_KEY` included) into the process without ever printing them,
runs the command, and exits — it does not deploy or modify the service.

Once one of the above has actually been run, the resulting
`after-pr1-REAL-transcript.md` (raw, unedited) is the first genuine
non-mocked text exam for this PR, and is a separate, prior step to the
real phone call described in `CLAIRE_INTELLIGENCE_PR1_HANDOFF.md`.
