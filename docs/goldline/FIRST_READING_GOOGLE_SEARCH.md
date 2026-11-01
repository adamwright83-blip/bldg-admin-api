# The first reading: Google's search MCP vs JOYSTICK's own readers

Status: investigation, 2026-10-31. Nothing here is wired into onboarding. The benchmark is
`scripts/first-read-bench.sh` (`server/businessKnowledge/firstRead/`). It has not yet been run against a real account.

## The question

The owner asked Gmail's and Drive's AI Overviews two questions (the exact text is `FIRST_READ_PROMPTS` in
`server/businessKnowledge/firstRead/synthesis.ts`). They got specific, sourced readings of their working life. Can
JOYSTICK get the same thing about 60 seconds after a stranger connects Google? And can it call Google's own
intelligence to do it?

## Findings

### VERIFIED (read in Google's docs, or seen from the endpoint, 2026-10-31)

- **No API exposes Gmail's or Drive's AI Overview.** The Universal Search MCP server has one tool, `search_corpus`.
  Its `tools/list` output schema (fetched from `https://workspacemcp.googleapis.com/mcp/v1` with no credentials) is
  ranked `items`, each one result from one source:
  - Gmail: the thread's messages with subject, snippet, sender, recipients, link.
  - Drive: title, snippet, MIME type, link.
  - Calendar and Chat results.
  - It has no answer, summary or citation field.
- **`search_corpus` returns no dates** for Gmail messages or Drive files. Calendar events and Chat messages have
  times. Telling "current" from "old ambition" needs dates, so its results would need follow-up reads.
- **It is Developer Preview only.** The guide and its parent page both require membership of the Google Workspace
  Developer Preview Program. Applying asks for "your Google Workspace account" and a Cloud project number.
  - Program term (iv): you may not give end users outside your domain or company access to apps built on pre-GA
    APIs.
  - So it can't serve JOYSTICK customers until Google announces GA.
- **The OAuth client needs a new setting.** Requests are rejected unless the client has "Use this client for an
  AI-powered agent" ticked. Google's advice: if a client serves both agent and non-agent features, create a separate
  agent client.
- **The scopes are the same as ours.** `search_corpus` honours `gmail.readonly`, `drive.readonly`,
  `calendar.readonly` and `chat.messages.readonly`. It searches only the products granted.
  - JOYSTICK already asks for the first three (`shared/firstTenMinutes.ts` `GOOGLE_SCOPES`).
  - The server's protected-resource metadata lists those scopes and their broader variants. Its authorization
    server is `accounts.google.com`.
- **The endpoint is reachable.** `initialize` and `tools/list` answer without credentials in about 150–250 ms.
  `tools/call` answers 403 with no identity and 401 with a bad token.
- **Google's per-product Gmail and Drive MCP servers add no natural-language retrieval.**
  - Gmail's `search_threads` takes the Gmail query language.
  - Drive's `search_files` takes Drive's structured query (`title contains …`, `fullText contains …`).
  - Both are what `googleResearch.ts` already sends through REST.
  - Gmail's MCP server also exposes write tools (labels, trash, spam, drafts).
- **JOYSTICK already has the fast path's pieces.**
  - `googleResearch` (PR #802) reads Sent mail by month, whole messages, Doc and Slides text, and Sheets, all under
    the existing grant.
  - The Gemini call pattern exists (`investigation/models.ts`), and production has `GEMINI_API_KEY`.
  - What is slow is the full investigation: `FULL_BUDGET` gives it up to 150 s, and it runs before the portrait.

### INFERRED

- Gmail's AI Overview is Gemini retrieval plus synthesis over the mailbox. Reproducing it means retrieval (a sample of
  Sent mail and recent Docs) plus one model call per question.
  - That is what `runFirstReadBench`'s `rest` path does, with Gmail and Drive retrieved concurrently.
  - Each answer starts as soon as its own evidence is in.
- Rough cost: about 20k input tokens and 4–8k output tokens over two Gemini 2.5 Flash calls, a few cents per new
  customer. The benchmark measures the real figure.
- `search_corpus` is semantic search across products. That may be good at finding relevant threads for a vague
  question. Without dates, and without our citation check, it isn't enough for a first reading on its own.

### UNKNOWN (the benchmark, or Google, has to answer these)

- Whether `search_corpus` works for a consumer `@gmail.com` account. The docs speak only of Workspace accounts, and
  the preview program registers a Workspace account.
- Its relevance and latency on a real mailbox.
- Whether tokens from JOYSTICK's existing client are accepted. The client has no agent setting, so Google's docs
  suggest not.
- Real latency of the `rest` path: Gmail retrieval, Drive retrieval and Gemini, end to end.
- How accurate the current-versus-past calls are against the owner's own expectations.

## The benchmark

```bash
scripts/first-read-bench.sh --journey <own journey id> --i-have-authorization [--paths rest,mcp] [--expect file]
scripts/first-read-bench.sh --consent --i-have-authorization --paths mcp      # separate "AI agent" probe client
```

- **Read-only.**
  - REST goes through the cold-test harness's `readOnlyFetch`.
  - MCP goes through `workspaceSearchFetch`, which refuses anything but the handshake, `tools/list` and
    `search_corpus`.
  - Nothing is written to the database. Tokens stay in memory, and a `--consent` grant is revoked at the end.
- **Isolated.** It uses only a journey's Google connection, or its own sign-in, never another person's.
- **Private.** No analytics. The report (`tmp/first-read-bench/`, mode 600) holds the readings, which are the owner's
  own data, so it stays on the machine that ran it.
- **What it reports.**
  - Time, per path and per source: auth (a token refresh), retrieval, model, when each answer is ready, and when both
    are.
  - Evidence counts by source, and tokens and cost.
  - Each reading after verification:
    - claims citing no real evidence are struck;
    - a "current" claim resting only on old evidence is flagged;
    - a "current" claim resting only on undated evidence (every MCP result) is flagged.
  - With `--expect`, the names the owner expected that were found or missed, and anything wrongly called current.

## Recommendation (pending the benchmark)

1. **Build on the `rest` path, not MCP.**
   - It runs on scopes customers already grant, for every account type, with dates, today. MCP can't legally serve
     customers before GA.
   - It would be a first-reading stage that runs right after connect, beside the existing reading and before the
     investigation.
   - It is shown as Claire's early, provisional read. The investigation then corrects and extends it, and the portrait
     still comes from the reconciled understanding.
2. **Keep MCP as a probe.** Re-test it when Google announces GA. If it proves better at finding relevant threads, it
   could feed ids to the REST readers, which fetch the dated, whole messages.
3. **Prove the result is personal before wiring anything.** Run the benchmark on the owner's account (with his
   go-ahead) and on one or two pilot owners'. For each: total time to the first reading, the share of claims with real
   citations, the owner's found/missed list, and zero "current" claims resting on stale evidence.
