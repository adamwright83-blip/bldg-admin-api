# Cloudflare AI Gateway (optional, default off)

Production model traffic stays on the current provider until a separate approval. This document does not give that approval, and shipping this helper does not move any provider call.

The adapter lives in `server/claire/cloudflareAiGateway.ts`. It returns the base URL the caller already uses unless a server-side flag is exactly on and both ids are present. In that case only the Anthropic provider may use:

`https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic`

OpenAI, xAI speech, and any other provider keep their own URLs. `ANTHROPIC_BASE_URL` is not this switch. The Anthropic SDK applies that variable to every SDK client in the process.

## Spend limits are not a hard budget

Cloudflare AI Gateway spend limits are eventually consistent. The cost of the current request is recorded after the request completes, so a burst of concurrent calls can pass the configured limit before enforcement catches up. A gateway spend limit is not, by itself, a hard budget. Do not remove or replace the spend check that already runs before a model call.

## Logging, caching, and metadata

For this path the adapter turns request/response logging off and response caching off:

- `cf-aig-collect-log: false` — no log entry
- `cf-aig-collect-log-payload: false` — no request or response body
- `cf-aig-skip-cache: true` — no cached completion

Authenticated metadata may include an opaque tenant id and a correlation id taken from the authenticated server session. The tenant id is never read from a browser parameter, query string, or client-supplied flag. Customer names, phone numbers, and prompt bodies are rejected and are not written to metadata or logs.

## Three-step activation sheet

Do not perform these steps as part of this change.

1. **Create the gateway, still with no production traffic.** In Cloudflare, create an AI Gateway. Turn gateway logs off and leave response caching off. Record the account id and the gateway id. Do not enable Browser Run. Browser Run is not approved for Google Messages, and this slice does not add it. Do not move model calls onto Durable Objects or Workflows.

2. **Set server environment variables only.** These are process environment variables, never a browser parameter:
   - `CLOUDFLARE_AI_GATEWAY_ENABLED=true` (anything other than the exact string `true` stays off)
   - `CLOUDFLARE_AI_GATEWAY_ACCOUNT_ID`
   - `CLOUDFLARE_AI_GATEWAY_ID`
   If the flag is on and either id is missing or not a plain id, the helper keeps the current provider URL. Metadata, when a later approved caller supplies it, is limited to an opaque `tenant_id` and `correlation_id`.

3. **Separate approval before any provider traffic moves.** Production traffic stays on the current provider until that approval. Approval has to name the single base-URL seam being wrapped. This slice does not wrap one, because the seam is ambiguous:
   - `invokeLLM` and `invokeTextLLM` in `server/_core/llm.ts` each construct an Anthropic client with an API key and no base URL.
   - President web research constructs another Anthropic client.
   - President cycle posts to `https://api.anthropic.com/v1/messages`, and its OpenAI provider uses `https://api.openai.com/v1`.
   - Claire speech posts to `https://api.x.ai/v1/tts`.

   Setting the variables in the server environment, or setting `ANTHROPIC_BASE_URL`, is not that approval and does not retarget Claire through this helper. The helper is unused by production code until a reviewed change wires one seam and leaves every other provider on its current URL.

## Out of scope

This slice does not rewrite Claire, Daphne, sql.js, or MySQL. It does not change billing, onboarding, landing, migrations, schema, Lantern City, personal number, Day Line, or source coverage. It does not add Browser Run, Durable Objects, or Workflows.
