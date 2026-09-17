# Claire PR1 — live (non-mocked) Anthropic exam attempt

**Status: BLOCKED, not run. No output below is fabricated.**

## What was attempted

A direct call to the real `@anthropic-ai/sdk` client was attempted from this
sandboxed environment, targeting `claude-sonnet-4-6` (the model Claire
generation currently resolves to per `server/_core/env.ts`'s
`DEFAULT_ANTHROPIC_MODEL`, confirmed against production via Railway MCP
`list-variables` — see the main handoff doc):

```js
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const r = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 50,
  messages: [{ role: "user", content: "Say OK" }],
});
```

## Result

```
FAILED 401 {"type":"error","error":{"type":"authentication_error","message":"API key is invalid."}}
```

## Why

`ANTHROPIC_API_KEY` is not set in this sandboxed environment's shell
(`env | grep -i anthropic` shows only `ANTHROPIC_BASE_URL`, which belongs to
the Claude Code harness itself, not a directly usable API key for arbitrary
SDK calls billed against the target Anthropic account). No Anthropic
credential usable for a real `messages.create` call against Claire's actual
production key (`ANTHROPIC_API_KEY` / `ANTHROPIC_API_KEY_GoldlineAdminProduction`,
both set in Railway production per `list-variables`, values redacted) is
available here.

## What this means for acceptance

This is a real, unresolved gap, not a skipped step. A live Anthropic exam —
invoking `answerClairePreDriveFollowUp` / `writeClairePreDriveBrief` with a
real API key, so actual model text can be read (not scripted) — still needs
to run in an environment that has one: Adam's own machine, a CI runner with
the real secret injected, or a deployed Railway instance with
`ANTHROPIC_API_KEY` present.

**Important**: even once that live text exam runs, it only proves the
*prompt* carries Claire's voice — it does not prove a real *phone call*
sounds like Claire, since that additionally depends on conversational
history/turn-taking, Twilio's `<Gather>`/`<Say>` pacing, and the actual TTS
voice rendering the text out loud. See "The phone call is the real
acceptance test, not the text exam" in
`docs/goldline/CLAIRE_INTELLIGENCE_PR1_HANDOFF.md` for the full breakdown
and exact steps to trigger a real end-to-end test call. Neither this file
nor a future live-text-exam file should be read as "Claire is verified to
sound like Claire on the phone" — that is a separate, not-yet-attempted
step.
