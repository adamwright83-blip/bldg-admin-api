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

## Decision (2026-10-31)

Workspace MCP is deprioritised: no new OAuth client, no Cloud Console changes. The benchmark proves the REST path:
JOYSTICK's own Gmail and Drive readers plus Gemini.

## The benchmark

```bash
scripts/first-read-bench.sh --journey <own journey id> --i-have-authorization --paths rest --strategies fast,agent,survey --expect <file>
```

**Three REST strategies, run one after another so their timings don't share quota:**

| strategy | what it reads | role |
|---|---|---|
| `fast` | Four Sent searches at once: the last 90 days (25), plus 6–12, 12–24 and 24–48 months ago (6 each, for contrast). Then whole messages. One Drive search over 18 months, and the text of up to 10 Docs and Slides. | the first-minute candidate |
| `agent` | The same four Sent searches and a Drive file list, headers and titles only. Gemini (no thinking) then picks up to 6 Gmail and 4 Drive searches. They run at once, and the answer reads what they found. | Gemini as the searcher, not just the summariser |
| `survey` | The investigation's 24 monthly Sent windows, plus 24 months of Drive. | comparison only: what the fast strategies miss; never a prerequisite for a first result |

**What runs at once.**
- Gmail and Drive retrieval run concurrently.
- Each source's reading starts as soon as its own evidence is in.
- The report counts every Google request by kind: searches, header reads, message reads, Drive searches, exports.
- `firstRead.test.ts` pins the counts against a fake Google: fast makes 4 Gmail searches, agent 4 plus its own,
  survey 25.

**How claims are checked.** Every claim must cite an evidence id together with a quote copied from that item.
Each claim then gets one verdict:

| verdict | meaning | shown as |
|---|---|---|
| `established_current` | The quotes really are in the cited items. At least one is the owner's own act (mail they sent, a file they last changed) in the last 120 days. The judge agrees it supports the claim and shows present activity. | a current fact |
| `supported_past` | Supported, but the latest support is old. Whatever the model called it, it is past, with the date. | past |
| `supported` | A person or relationship the quotes support. | a person |
| `uncertain` | Undated support (every MCP result), support that isn't the owner's own act, partial support, or the judge unsure about present activity. | not shown as fact |
| `contradicted` | The judge found the evidence says otherwise. | struck |
| `unsupported` | No real id, no quote actually in the cited item, or the judge says the quotes don't show it. | struck |

- The judge is a second Gemini call per source. It sees only each claim and its quoted evidence.
- It can lower a verdict, never raise one.
- The report times the draft (checked by quote and date) and the verified reading (judged) separately.

**Against the owner's own results.** `--expect` takes the Gmail and Drive AI Overviews, written as names, in a file
kept outside the repo:
- `current`: must come out established-current.
- `past`: must never come out current.
- `people` and `mention`: must be found.

The report lists what was found, what was missed and what was wrongly called current. It also lists every
established-current claim the file doesn't name, to read by hand for inventions.

**Recorded per strategy.**
- Time from connect, auth included:
  - Gmail and Drive retrieval;
  - each Gemini call;
  - the first draft;
  - each verified reading;
  - all done.
- Google requests.
- Tokens and cost, from the token counts Gemini reports, priced at Gemini 2.5 Flash's list price unless set.

**Safety.**
- Read-only: REST goes through the cold-test harness's `readOnlyFetch`.
- Nothing is written to the database, and nothing goes to analytics.
- The refreshed token stays in memory.
- The report (`tmp/first-read-bench/`, mode 600) holds the readings, which are the owner's own data, so it stays on the
  machine that ran it.

## What decides the next step

- **Integrate into Claire's existing first ten minutes** if a strategy reproduces most of the Overviews' specific
  recognition, with a first draft inside 60 s and nothing wrongly called current.
- **Over 90 s, or too much missed:** fix the measured bottleneck in retrieval before touching presentation.
