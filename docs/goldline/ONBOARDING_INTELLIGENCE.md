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

## Retention and deletion

- Evidence keeps ≤300-character redacted excerpts. Personal-finance and personal-record documents and bank-detail columns
  are never read into it.
- `forgetKnowledge(scope)` deletes every business-knowledge row for a scope and nothing else.
- Wiring it to account deletion, and to the expiry of unprovisioned signup drafts, is not done yet. See the final report.
