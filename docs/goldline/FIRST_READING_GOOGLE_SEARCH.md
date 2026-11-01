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

## Decisions and corrections (2026-10-31 / 11-01)

- **Workspace MCP is deprioritised.** No new OAuth client and no Cloud Console changes. The benchmark proves the REST
  path: JOYSTICK's own Gmail and Drive readers, plus Gemini.
- **Gemini 2.5 Flash is not retired. Corrected.** Google's deprecations page says the 2.5 models "are not deprecated".
  Google limits them to projects that used them before. Production's `bldg` project hadn't, so `gemini-2.5-flash`
  answered 404. The benchmark uses `gemini-3.8-flash`, which Google recommends for new projects.
  - The investigator's own Gemini option (`JOYSTICK_INVESTIGATOR_GEMINI_MODEL`) also defaults to `gemini-2.5-flash`.
  - Production runs Claude by default, so nothing live breaks.
- **Billing was confirmed directly** (AI Studio → API keys, 2026-11-01):
  - Production's `GEMINI_API_KEY` (ending `…eL7A`, named GOLDLINE) belongs to project `bldg`
    (`gen-lang-client-0159109182`).
  - That project is linked to an active billing account and is on **Tier 1 (paid)**.
  - Paid-tier prompts are not used to improve Google's products.
  - Gemini 3.8 Flash costs $0.75 per million input tokens and $3.75 per million output tokens, thinking included.
    Those prices hold through 2026-12-31, then double.

## The benchmark (v3)

```bash
scripts/first-read-bench.sh --journey <own journey id> --i-have-authorization --runs 3 --thinking low --expect <file>
```

**Variants: retrieval strategy × way of answering.** Repeated runs are interleaved.

| retrieval | what it reads |
|---|---|
| `fast` | Four Sent searches at once: the last 90 days (25), plus 6–12, 12–24 and 24–48 months ago (6 each). Then whole messages. One Drive search over 18 months, and the text of up to 10 Docs and Slides. |
| `agent` | The same four Sent searches and a Drive file list, headers and titles only. Gemini (low thinking) picks up to 6 Gmail and 4 Drive searches, which run at once. |

| answering | |
|---|---|
| `separate` | The owner's two questions, Gmail's and Drive's. Each starts as soon as its own evidence is in. |
| `combined` | One question over mail and files together, which can connect what the mail shows the owner doing with what the files show them building. |

**Claims are single and typed.** Each claim is one fact of one kind: business, project, event, problem or
relationship. Each quotes 1–3 cited items. The outcomes:

| outcome | when | shown as |
|---|---|---|
| `active` | The owner's own dated act (mail they sent) in the last 120 days shows it, and the judge agrees. A Drive project counts only when the claim also cites that mail (cross-source). | active now |
| `open_problem` | In the owner's recent mail, and the judge sees no sign it was resolved. | an open problem |
| `happened` | A dated event the evidence shows took place. Its present status isn't claimed. | a dated event |
| `ended` | The evidence itself says it ended, and the judge agrees. | ended |
| `relationship` | The person's role, shown by the messages they're on. The judge sees the real From/To headers. | a relationship |
| `status_unknown` | Real, but the latest evidence is old, or is only a document edit. | "last seen <date>", never ended or active |
| `uncertain` | Partly supported, or the judge failed, skipped the claim or was off. | not stated |
| `contradicted`, `unsupported` | The evidence says otherwise, or nothing real supports it. | struck |

**Grading by meaning.** A high-thinking grader runs after the clock stops. It compares the stated claims with the
owner's AI Overview findings, written as statements in a private file outside the repo. For each finding it gives
found or not, and whether the status is right. Stated claims that no Overview covers are listed for hand-checking.
Unconfirmed findings aren't scored.

**Recorded.** Per run, from connect:
- retrieval;
- the first draft;
- the first verified answer;
- both sources verified;
- each reading and judge call.

Also Google requests by kind, and model cost. The report gives medians and ranges over the runs.

**Safety.** Read-only through `readOnlyFetch`. Nothing is written to the database or sent to analytics. Reports stay
local, under `tmp/first-read-bench/`, mode 600.
