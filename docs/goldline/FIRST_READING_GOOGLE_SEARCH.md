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

## Baseline before public research (2026-11-01, owner's account, 3 runs each, Gemini 3.8 Flash, low thinking)

| variant | complete | both sources verified | cost / run | Overview findings recalled | status right |
|---|---|---|---|---|---|
| discover + combined | 3 / 3 | 30.0 s (26.5–45.9) | 3.5¢ | 42% (33–46%) | 71% (71–88%) |
| agent + separate | 3 / 3 | 24.6 s (23.6–28.2) | 3.3¢ | 54% (2 of 3 graded) | 83% (67–100%) |

**What it gets right.**
- The product being built is now stated in every run, as work in progress.
- Its Season 1 story is filed as fiction inside it.
- Separate businesses stay separate.
- The judge struck an opening sentence that tied a collaborator to the wrong business.

**What it misses.**
- The full understanding stays short: 8–16 claims when 30 are allowed. Undertakings found in discovery are dropped
  from it.
- One run filed the AI assistant purely as fiction, though the documents show it is also a product feature.
- The game's name and two of its characters were never retrieved. A named prospect was retrieved and never stated.

## Public research: what is accessible (checked 2026-11-01)

| source | permitted route | what it gives | limits |
|---|---|---|---|
| LinkedIn | none automated: `robots.txt` disallows all agents ("automated means … strictly prohibited"); Googlebot is barred from `/feed/update/` | — | Profiles are reachable only as Google snippets. Posts and reposts can't be reached at all. |
| LinkedIn data export (the member downloads it) | the member uploads the file | Shares (own posts and reposts, with their own comments), Instant Reposts (date and link only), Reactions, Comments (type, date and link), Positions, Profile | It takes the member minutes to 24 hours. Reposts carry no text: the topic is known only from the link. The programmatic portability API is EU/EEA/CH members only. |
| X | X API (pay per use: $0.005 per post read), or xAI's `x_search` tool restricted to the person's handle ($5 per 1,000 posts; `XAI_API_KEY` exists) | posts, reposts and replies, with dates | Needs the handle. Under X's developer policy, inferring sensitive characteristics needs legal review. |
| Web (sites, press, profiles Google indexes) | Claude web search tool ($10 per 1,000 searches) | pages, with citations | Anthropic: cite sources when showing outputs directly. When combining with your own material, "display citations as appropriate" per legal advice. |
| Web via Gemini grounding | **not usable here** | — | The terms require showing Google's Search Suggestions with grounded results, and forbid storing, analysing or "learning from" them. Maps grounding forbids modifying results. Both rule out hidden research held in Claire's memory. |
| Google Business Profile | Places API (`GOOGLE_PLACES_API_KEY` exists) | name, address, rating, review count, website, hours, a few reviews | Maps Platform rules on attribution and caching apply before anything is shown or kept. |
| Company websites | direct fetch, robots honoured (`research/enrichment.ts` already does title and description) | what the business says about itself | none beyond robots |
| Instagram / Facebook personal profiles | none for a personal account (business accounts only, via Meta's APIs) | — | A user-provided export is the only route. |

**Smallest addition.** A `public` research stream beside Gmail and Drive, started from identity anchors: the owner's
name and account email, their own sending domains, and the business names the inventory finds. It runs three calls at
once:
1. Claude web search, restricted to findings that match the anchors.
2. xAI `x_search`, limited to the handle web search finds, or found by user search.
3. Places look-ups for each business discovered.

Its findings join the evidence as their own source, with URLs. A reveal step then reconciles all three streams into
confirmed facts and inferences. An inference must rest on at least two independent signals. Claire's opening is
judged, and a line that reveals how something was found is struck.

## Three-stream reveal prototype (2026-11-01)

`scripts/first-read-reveal.sh` (`firstRead/publicResearch.ts`, `firstRead/reveal.ts`, synthetic owners in
`firstRead/personas.ts`).

- Public research starts when discovery names the owner's businesses, about 15 s in. On the first real run it started
  with only name, email and domain, and found no social account at all.
- X runs only with a handle the web stream confirmed. Without one, the first run spent 167 s and 337k tokens to find
  nothing.
- A Places listing counts only when its website is the owner's domain or its address is in their city. The first run
  accepted a same-named business 40 miles away.

**Owner's account, second run: what the public stream added.**
- X: posts about eight months building an unnamed AI project, posts about AI coding tools, reposts clustered on AI
  builder tooling, and a bio calling LeapN past.
- Web: a LinkedIn snippet, the business's contact page, and the public repo's pull requests.

Combined, the reveal inferred, strongly, that the unnamed project is the one in the owner's private files. That
connection exists only because the two streams met.

**Not reached.** LinkedIn reposts can't be read by any permitted route. No fundraising signal appeared in what X
returned, so no fundraising inference was made.

**Timing.** Public started at 14.6 s, web done at 51.6 s, X done at about 140 s, reveal done at 173 s. X is too slow
for the first minute.

## Significance before dialogue, and the fast path (2026-11-01)

**Why version C lost the discovery.** Traced through the saved intermediate artifacts:
- Ingestion was fine.
- Reconciliation kept "the unnamed build is JOYSTICK" (strong), now with more support.
- The spotlight was unchanged.
- The writer fused it with a new, weaker inference from the screenshots into one unhedged line, and the judge struck
  that line. Nothing re-checked that the spotlight survived, and no line was required to stand alone.

Fixes:
- one repair pass when the spotlight is struck;
- a `standsAlone` check;
- lines are judged on the items that hold up.

**Significance stage** (`firstRead/significance.ts`). Before Claire speaks it works out:
- objectives (ultimate and intermediate, stated or inferred);
- each activity's role: end in itself, income, proving ground, means, side interest, past, or unclear;
- relationships (verified, inferred, or none found);
- the key result and why it matters, with its value as a dated snapshot;
- what the evidence can't tell.

No hidden ambition is assumed; a business can be the whole point. It reads the source excerpts as well as the claims:
on the owner's account the claims had compressed "Claire, inside JOYSTICK, worked from Laundry Farm's numbers" into
"Laundry Farm has 21 customers", and the significance stage concluded no connection until it could see the excerpts.

**Reasoning tests** (`firstRead/scenarios.ts`, six fictional owners, graded before any dialogue against a reviewer's
key the model never sees):

| owner | type | objective | roles | key result | end in itself |
|---|---|---|---|---|---|
| HVAC + dispatch software | proving ground | right | right | partly | right |
| family bakery | the business is the end | right | right | right | right |
| landscaper + band | unrelated side interest | right | right | right | right |
| food truck → restaurant | means | right | right | right | wrong (debatable key) |
| rideshare/handyman → real estate | income during transition | right | right | right | right |
| cleaner, thin evidence | unknown | right | right | right | right |

**Owner's account, fast path** (`scripts/first-read-significance.sh --fast`, timed from a fresh token):

| stage | ends at |
|---|---|
| Gmail and Drive, at once (4 Sent searches, 20 files) | 2–3 s |
| reading (claims) | 14–20 s |
| claims judged | 20–27 s |
| significance (low thinking) | 32–41 s |
| first reveal (low thinking, judged) | 46.1, 47.2, 51.3, 46.4, 47.3 s (median 47 s) |
| web research (started when businesses were named, 14–20 s) | 50–58 s |
| second, deeper reveal with public findings | 74–85 s |

Every run found the same reading:
- JOYSTICK is the ultimate objective (stated).
- Laundry Farm is its proving ground (inferred; the data link is verified).
- The customer count toward 50 is the result that matters, for both.
- Fundraising stays an open question ("whether JOYSTICK has secured pre-seed/angel capital from the investor research
  pipeline"), not a claim.

**Fit with the approved sequence** (`JOURNEY_STAGES`):
- The fast path starts at the Google callback, beside the crew's reading.
- Its first reveal lands inside the `understanding` stage, before `crew`, Claire's questions and the `portrait`.
- The lines carry no speaker name; Claire is named only after.
- Nothing in the crew's reading, the crew's interruptions, the portrait or the chapter changes.

## Grounding against the source, and what the timing does not cover (2026-11-01, later)

**The unpaid-bills line, traced.** In the owner's file the line read "covers my payroll but not gas or processing".
The reading kept that. The significance step's caveat turned it into "leaving gas and processing costs unfunded". The
reveal said "fuel and processing remain unpaid". The checker passed it, because it compared the line with the
significance summary and never with the file.

**Fixes:**
- `groundSignificance` checks every objective, role, relationship, key result and thread against the excerpts it
  cites. It runs while the opening is written, so it costs no wall-clock time beyond its own ~7 s.
  - Anything unsupported is unsayable.
  - A "verified" relationship the text doesn't state outright becomes inferred.
  - Anything that escalates money, debt, legal, health or family matters is unsayable.
  - It fails closed.
- The line judge now reads the source text behind each line, not only the summaries. It has a new `escalates` check.
- A deterministic guard covers both the reasoning and the lines. It strikes money, debt, legal, health and family words
  ("unpaid", "owes", "losing money", "lawsuit", "diagnosed with" …) unless the source uses the same word.
- The significance model now produces a **thread** (`T`): what the day-to-day result would show, and to whom. An
  audience is named only if an item shows it matters. The reveal prefers it as the spotlight.
- New traps in the scenarios:
  - an owner's own note that truck profit "covers my own pay but not the commissary fee and propane … payment sent";
  - "near break-even until DispatchPilot has paying shops".

**Read cold (`readerTest.ts`).** These are model stand-ins, not the human test:
- a stranger reading only the kept lines says what the owner does, is after, and what the day-to-day shows;
- for fictional owners only, a model given the owner's whole situation reacts as them: wrong, generic, "that's my
  business", or "it sees why".

**Timing is the pipeline, not the experience.** The clock starts with a stored grant being refreshed. A real
callback (`oauthRoutes.ts`) also:
- verifies state;
- loads the journey;
- exchanges the code (~ the same as a refresh);
- reads the account;
- saves the connection;
- redirects 303 to `/joystick-start`. The browser then loads the page, starts or polls the understanding run, and
  renders.

None of that is measured. It can only be measured once the fast path runs behind the callback, for example in the
existing `preview` mode with a preview pass.

## Public research inside the first minute (2026-11-01, evening)

ChatGPT's code review was right. The fast path:
- called only `webResearch`;
- started it about 15 s in;
- discarded the handles it found;
- never ran X or Places.

It now uses `PublicResearchRun`:

| stream | starts | lands (owner's account, 3 runs) | what it gave |
|---|---|---|---|
| their own profiles (name, account email, sending domains) | at authorization | 10–25 s | nothing confirmable: a common name and a personal Gmail address are one anchor; every hit was a namesake and was rejected |
| Places, per business | when the reading names them | 13–17 s | Lugo's Lavanderia, every run, confirmed because its street address is in the owner's own mail (`inOwnText`) |
| one short web search per business (Sonnet 5.5, 3 searches each), all at once | when the reading names them | 25–36 s | lugoslavanderia.com, the public GitHub repo; often nothing |
| X, limited to the confirmed handle | when any search confirms one | never ran: no search confirmed a handle | — |

- **What the first reveal sees.** Whatever has landed by 20 s after authorization (`--public-wait`). Waiting until 30 s
  added nothing but ~10 s. The rest feeds the second reveal.
- **First reveals across the final runs:**
  - timing: 45.8, 49.2 and 52.8 s;
  - the Places listing reached the first reveal in each;
  - the investor line was carried in each, after two judge fixes: the closing line no longer counts as carrying the
    spotlight, and "from twenty-one to fifty" is a starting point, not a current figure.

**A profile found is not a profile read.**
- X is the only social account read directly (xAI, confirmed handle only).
- LinkedIn, Instagram and Facebook are known only from what search engines index, and are never opened.
- Their posts and reposts are never claimed unless the person hands them over.
- Over the day's runs the search turned up a Facebook page ID and laundry.farm, and never an X handle. An earlier run
  rejected "Adam Wright, founder and COO of LeapN, Los Angeles (LinkedIn)" as a different person. LeapN appears in the
  owner's own Drive but wasn't among the businesses passed as anchors.

## Identity: handles verified, past organizations as anchors (2026-11-01, night)

ChatGPT's review of 3445bcfe found two defects. Both are fixed.
- **Handles were taken on the model's word.** `PublicResearchRun.take()` stored any returned handle, and X could start
  on a namesake's. Now `verifyHandle` accepts a profile only if:
  - their own mail or files mention it; or
  - a result the search engine actually returned points at it, and that result's title or quoted text carries their
    full name plus a business, an organization, a sending domain or an already-verified profile. A business or
    organization name inside an X handle counts.

  A city never counts. A web finding whose link the engine never returned is dropped. Adversarial test: a namesake
  songwriter's handle is never researched.
- **Places matching was loose.** `inOwnText` accepted a city found anywhere, or a number and a street word from
  different places. Now `listingIsTheirs` needs one of: the listing's website is a sending domain or appears in their
  files; its whole phone number appears there; or its street line appears there, number then street. False-positive
  tests cover each.

**Past organizations.** The LeapN profile was rejected because LeapN was never an anchor: anchors came only from the
current businesses in the reading. Now `identityAnchors`:
- reads organizations, current or past, from titles, headers and the first lines, in about 3–5 s;
- keeps a name only if the item it cites contains it;
- feeds them to the identity search.

**When the identity search starts.** The earlier report said "at authorization", which was wrong: it started after
Gmail and Drive retrieval. Now it starts at 4.7–7.8 s, after retrieval and the organization read. Name and email alone
proved useless for a common name.

**On the owner's account:**
- With 4 searches, no profile was proposed.
- With 8 searches (about 45–50 s) it found and verified:
  - linkedin.com/in/adamwrightla ("Adam Wright - Founder, LeapN");
  - X @AdamLeapN, with Threads @adamleapn alongside;
  - laundry.farm.
- It rejected seven namesakes, and rejected laundrybutler.com, a same-named company.
- X then read @AdamLeapN (about 65 s; once it timed out at 90 s). It found:
  - "an unnamed, extremely complex project he has been vibe-coding for about 8 months";
  - reposts about AI agents and founder growth;
  - the LeapN builder history;
  - a post about new Speed Queens at "the sunset laundry".

So the deep identity search and X feed the second reveal (about 150–170 s). The first reveal stays at 45–48 s, with
Places.

**Also caught:** "processing costs remain an open balance", a rewording of "unpaid" that passed both judges. The
deterministic guard now covers it.

The "1030 claire rule" content has been removed from Drive, and the 50-customer goal is gone from every reveal. That
confirms the goal came from that document.

## In onboarding: the first read (PR #811, behind `JOYSTICK_FIRST_READ_REVEAL`, off)

**The flow.**
1. The Google OAuth callback saves the connection.
2. It claims one `first_ten_first_reads` row for the journey (awaited, so the next page finds it running), then runs
   `runFirstRead` in the background.
3. The client polls `firstTenMinutes.firstRead`. The crew waits for the lines, and only at the `understanding` stage:
   - until they arrive, for at most 75 s after consent;
   - then while they are being read: one line every 2.6 s, then "Go on", or 6 s.
4. Then everything continues as before: crew, portrait (Claire named), chapter, Lantern City, goal-setting.

**What a stranger gets.**
- Lines from their sent mail and their own documents only. Files others sent them are never read here.
- Places listings tied to them.
- An account with fewer than four items, fewer than two stated claims, or fewer than two lines that survive: nothing,
  never a thin remark.
- No line may disclose a third party's confidential matters.

**Kept for later, never forced into words.**
- `understanding_json`: claims, the grounded significance and the identity organizations.
- `public_json`: verified profiles, every candidate with its verdict, and findings with their sources.

**Enable for preview-pass browsers only.** Set `JOYSTICK_FIRST_READ_REVEAL=on` on `bldg-admin-api`. While
`JOYSTICK_FIRST_TEN_MINUTES=preview`, only browsers that opened `/joystick-start?crew=<JOYSTICK_FIRST_TEN_PREVIEW_CODE>`
reach the callback at all. Without the crew link, `/joystick-start` shows the customer-list signup, which has no
Google step.

**Measured on the production code path, against the owner's stored grant, with no DB writes**
(`scripts/first-read-onboarding.sh`):
- lines ready 46.2 s after consent;
- deeper research kept at 131 s, with LinkedIn and X verified.

The browser path (consent → callback → redirect → page → visible lines) still needs a real sign-in.
