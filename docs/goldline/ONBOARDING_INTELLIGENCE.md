# Onboarding intelligence: business timeline, investigation and Claire's knowledge

Status: built in four PRs (A #802 sources, B #803 timeline/entities, C #804 investigation/questions, D integration).
Live only when `JOYSTICK_ONBOARDING_INTELLIGENCE=on`. Off by default; with it off, onboarding behaves exactly as before.

## Why

Adam's real onboarding portrait described old freelance web work as current. It missed an important collaborator
and misread how his business names relate. The reading sampled mail and documents and went straight to a
portrait. It never reconstructed what happened when.

## What owns what

| Concern | Owner | Not |
|---|---|---|
| What a source said | `business_knowledge_evidence`: a short, redacted excerpt plus a locator | never a whole document |
| What happened, when | `business_knowledge_timeline`: event time ≠ discovery time; owner act / counterpart act / mention / metadata | a file's modification time is never activity |
| What JOYSTICK concludes, or the person said | `business_knowledge_assertions`: status / relationship / role, versioned and superseded, never overwritten | an inference never replaces the person's answer (it is kept beside it as `conflict`) |
| What was asked | `business_knowledge_questions`: each topic once; reopened only on changed conflicting evidence | not an interrogation: three at most during onboarding |
| How each investigation went | `business_knowledge_runs`: budget, searches, coverage, research questions, watermark | |
| How to work with the person | Daphne V2 (unchanged) | Daphne holds no business facts. A test keeps the two modules from importing each other. |
| Money, orders, customers | the existing domains (unchanged) | `authorizes_financial_merge` is always 0; `same_legal_entity` comes only from the person |

Every row carries `journey_id` and, once the workspace exists, `tenant_id`. Tenant reads require both.

## Flow

1. **Reading** (`server/firstTenMinutes/understanding/run.ts`). The existing crew reading runs as before. After its
   work stage, `investigate` (`server/businessKnowledge/investigation/loop.ts`) runs under the reading's lease:
   - **Survey, Sent first:** 24 months of the owner's own mail, a few messages per month; their own messages in full (signatures);
     recent Docs, Sheets and Slides; and a year of calendar.
   - **Interpret** (`apply.ts` verifies everything). A finding stands only on a quote from an item actually read.
   - **Research its own questions** for every name found:
     - When was it last active?
     - Has it gone quiet? (It searches the whole quiet period.)
     - Who is this person?
     - How do these names relate?
   - **Reconcile** (`chronology.ts`) into a status: active / prelaunch / dormant / historical / abandoned / unknown /
     conflicting. Then infer collaborators across *kinds* of source, and propose questions (`clarify.ts`).
   - Opportunities built on requests about quiet work are not offered to the chapter.
2. **Claire's questions** (`ClaireQuestion.tsx`, `knowledgeQuestion` / `answerKnowledgeQuestion`). She asks one at a time
   before the page. An unclear answer gets one follow-up. The person's words are stored verbatim.
3. **Portrait** (`portrait/write.ts`). It writes from the reconciled understanding (citeable `k:` facts). A line resting
   only on paused or past work must be in the past tense, or it is struck.
4. **Workspace.** Provisioning stamps the knowledge with the tenant (`activation.ts` → `bindKnowledgeTenant`).
5. **Claire** (`contextAssembler.ts` → `businessKnowledge`, `BUSINESS_KNOWLEDGE_RULE`, inventory `business-*`). This
   covers phone, text and Brain V2. The operator's answers are verified; JOYSTICK's readings are pending.
6. **Keeping current** (`incremental.ts`). A cheap watermark check; a small investigation only when there is new sent mail or
   changed files; at most every 12 hours; started in the background, never awaited by a conversation.

## Sources and their limits

- **Gmail:** read-only through the existing grant. It uses targeted searches, month windows, threads and counts. A count never
  "covers" a window; only complete reads do.
- **Docs:** Drive export of the full text (≤250k chars), with passages and offsets.
- **Sheets:** the Sheets API under the already-granted `drive.readonly` scope.
  - The **Google Sheets API must be enabled** in the OAuth client's Cloud project. Until it is, only the first tab is read (Drive CSV export), and coverage says so.
  - Reads are bounded to 8 tabs and 20 columns: the opening rows, the latest populated rows, and formulas.
- **Calendar:** attendees and series.
- **Public websites:** off unless `JOYSTICK_PUBLIC_ENRICHMENT=on`. It reads title and description only, honours robots.txt,
  and allows only public addresses, checked on every redirect hop.
- **LinkedIn / Instagram:** not read. There is no official third-party API.

## Models

`JOYSTICK_INVESTIGATOR_MODEL` = `claude` (default) | `gemini` (needs `GEMINI_API_KEY`) | `heuristic`. The deterministic
interpreter always runs beside a model and is the fallback. Compare models with
`scripts/onboarding-intelligence-eval.ts` against a local database.

## Cold tests against a real account

`pnpm intel:cold` (`scripts/onboarding-intelligence-real-account.ts`, on `server/businessKnowledge/coldTest.ts`) tests
the intelligence against a connected Google account. CI never runs it, and every run needs the account owner's
authorization (`--i-have-authorization`).

What every run guarantees:

- **It starts from nothing.** It runs on a throwaway test journey whose id is `coldtest-` and 27 hex characters. A real
  journey id is a UUID and can't take that form. Before anything runs, every table it writes is shown to hold no row
  for that id.
- **Of the person's own journey, only its Google (and Slack) connection is used.** Its knowledge, findings, answers,
  portrait, draft and workspace are never read or written. A token refreshed during the run stays in memory, so the
  connection row isn't written either.
- **Google is only read.** Every request goes through `readOnlyFetch`. Reads and token refreshes pass. Anything else
  (send, change, delete, revoke) is refused before it leaves the process. Nothing beyond the granted scopes is requested.
- **It is private.** No prompt or reply goes to analytics. Model spend is booked to `first_ten:coldtest-…`, never to
  the person's journey. Those spend rows stay, so JOYSTICK's cost ledger keeps matching the provider's bill.
- **It deletes exactly what it wrote**, by exact id, and proves nothing is left. Deletion refuses any id that isn't a
  cold-test id, and any id a journey, a connection or a workspace has carried.

Two kinds of test:

- `--mode intelligence` (the default) runs the investigation alone. You get its conclusions, Claire's questions,
  coverage, tokens and cost.
- `--mode journey` runs the whole first ten minutes:
  - the crew's reading, with the investigation;
  - Claire's questions, which you answer in the terminal (or pass `--answers skip`);
  - the portrait;
  - the chapter, played as far as the writing table. A draft is prepared there; nothing is sent or activated.

Run it from a checkout that `railway link` has linked to the production project. The wrapper,
`scripts/onboarding-cold-test.sh`, runs it with production's settings. It reaches the database at the MySQL service's
public address, because production's own `DATABASE_URL` is private to Railway.

```bash
pnpm intel:cold --list
pnpm intel:cold --journey <journey id> --i-have-authorization
pnpm intel:cold --journey <journey id> --i-have-authorization --mode journey
pnpm intel:cold --journey <journey id> --i-have-authorization --investigator gemini --model gemini-2.5-flash --runs 2
pnpm intel:cold --sweep
```

- `--list` shows the own journeys with Google connected: id, account, stage, and whether it has a workspace.
- `--investigator claude|gemini|heuristic` and `--model <id>` choose the investigator; the default is the server's
  setting. The reading and the portrait always use the server's Claude model.
- `--expect <file>`: your expectations (below).
- `--runs <n>`: n tests in a row, each from nothing.
- `--out-dir <dir>`: where reports go; the default is `tmp/onboarding-intelligence/runs`.
- `--input-cents-per-million` and `--output-cents-per-million` price a model JOYSTICK's price table doesn't know, such
  as Gemini.
- `--keep` keeps a run's rows so you can inspect them. Then `--sweep --yes` deletes them. Plain `--sweep` only lists
  what a killed or kept run left.

**The report** is a `.md` file with a `.json` twin, readable only by you (mode 600), under the git-ignored `tmp/`. It
lists what JOYSTICK concluded (current, being prepared, paused, past, unknown, people, how names relate), Claire's
questions, the rule checks, source coverage and what couldn't be read completely. It also gives the model, tokens,
time and estimated cost, and what changed since the previous run of the same kind for the same journey.
With `--expect` it also lists discoveries, omissions, incorrect conclusions, and names your expectations don't mention.
It never holds message bodies, document text or quotes, email addresses or phone numbers.

**Expectations** are a JSON file you keep outside the repo:

```json
{
  "current": ["Acme Cleaning", "Acme Building Services|ABS"],
  "prelaunch": ["New App"],
  "paused": [],
  "past": ["Website proposals"],
  "people": ["Jordan Lee|Jordan"],
  "notCurrent": ["Website proposals"],
  "absent": [],
  "relationships": [{ "subject": "Acme Building Services", "type": "related_operation", "object": "Acme Cleaning" }]
}
```

- Names match whatever their case, punctuation or company suffix.
- `|` separates aliases.
- Relationship types are those in `shared/businessKnowledge.ts`.

`server/businessKnowledge/coldTest.mysql.integration.test.ts` proves the isolation. It runs two consecutive cold tests
of each kind against a controlled Google, for a person who already has an answer, a kept portrait and a draft. Neither
run sees that history or the other run. Both clean up to zero rows, and the person's rows, connection included, are
unchanged byte for byte.

## Retention and deletion

- Evidence keeps ≤300-character redacted excerpts. Personal-finance and personal-record documents and bank-detail columns
  are never read into it.
- `forgetKnowledge(scope)` deletes every business-knowledge row for a scope and nothing else.
- Wiring it to account deletion, and to the expiry of unprovisioned signup drafts, is not done yet. See the final report.
