# Independent AI review of PR #575

Reviewed head: `548895defb691de5949123ac882abd63ff5cd653`; base: `b2a8bc9adcf71183989343b4b8dfc06f543b2af3`. Checkout HEAD matched and `git status --short` was empty at entry. This is an independent AI source review, not an independent human review. No source changes, deployment, migration, outbound call, or external message was performed.

I read ARCHITECTURE.md and CLAUDE.md; no applicable AGENTS.md was found in the checkout or searched parent directories. I inspected the 82-file changed manifest, the production changes and relevant surrounding authority paths, migrations, client controls, evaluation/test changes and report/evidence claims. The committed artifacts are historical claims; I did not treat them as newly observed runtime acceptance.

## Supported findings

### 1. P1 — A refreshed proposal does not supersede the old proposal at approval admission

**VERIFIED source:** `server/strategy/strategicApproval.ts:46-50`; `server/strategy/strategicStore.ts:94-107,175-213`; `server/claire/weeklyMission/weeklyMissionRouter.ts:183-200` (refresh mutation).

Failure sequence: browser A retains proposal P1; evidence or ranking changes and browser B/worker prepares P2 for the same operator/week; P1 remains within its 24-hour expiry. A submits its original ID/revision. Admission loads P1 and checks that its own revision matches and has not expired. Response storage locks only P1 and checks responses only for P1. Preparation simply appends P2 without closing P1. Consequently A can commit superseded P1 items after P2 exists, potentially choosing stale dates/tasks and creating a separate commitment from a later P2 approval. Exact identity equality with a historical row is insufficient to prove current proposal authority.

Minimal repair: serialize proposal publication and response admission per operator/week; persist an authoritative current/superseded relation or equivalent lifecycle marker, and reject old unaccepted revisions within that same transaction. Preserve idempotent retries for already accepted receipts. Test independent refresh/approve workers and a stale browser.

### 2. P1 — Queued calls can present deferred or subsequently closed proposals

**VERIFIED source:** `server/agents/persistentOperator/strategicCallAuthorization.ts:172-183` checks decisions when enqueueing; `server/agents/persistentOperator/operatorAppointmentExecution.ts:208-228` rechecks only proposal availability/expiry before calling; `server/claire/weeklyMission/driver.ts:203-211,224-231` bypasses decisions when resuming an existing session and omits deferral/full acceptance in the new-session filter; `server/agents/persistentOperator/operatorAppointmentStore.ts:355-369` fences consent and dispatch without checking proposal decisions.

Failure sequence A: schedule a pending proposal, defer it through the app before the appointment runs, then dispatch with still-valid call consent. The new-session filter allows the deferred proposal and the call uses its pending opening. Failure sequence B: start a weekly session, schedule a call for its proposal, then reject/revise/fully approve through the app. The existing-session branch resumes the old opening without inspecting those decisions, so the queued call still offers closed work. New-session reject/revise is indirectly blocked; this finding deliberately does not claim otherwise.

Minimal repair: verify proposal lifecycle/current revision and remaining unapproved items at the final dispatch admission, coordinated with response locking; also validate on weekly session resume. Cancel/skip queued appointments after defer/terminal decisions. Test decisions taken after enqueue and immediately before dispatch.

### 3. P1 — Prepared proposal item references can bypass strategic approval via the ordinary mission route

**VERIFIED source and executable parser smoke:** `server/claire/claireTwilio.ts:792-802,843-851` runs the ordinary mission classifier/executor before strategic session handling without consulting `strategicProposalId`. `server/claire/operatorMissionCommand.ts` includes the frame `make (.+?) a mission` and writes through ordinary Day Director acceptance/designation.

At the reviewed revision, a read-only `node --import tsx` parser smoke returned:

- `make item 2 a mission` → `kind: execute`, title `Item 2`.
- `make the second item a mission` → `kind: execute`, title `The second item`.

Failure sequence: Claire presents a multi-item prepared proposal; operator uses either ordinary item-selection phrase. The pre-Brain route treats the referential words as literal work, creates/designates today's primary, and never binds the stored strategic proposal/item/revision/response. It loses both the referent and intended proposal date and can displace an existing primary. The parser behavior was executed; the DB mutation consequence follows the directly inspected call graph and still needs the parent’s controlled full-voice proof.

Minimal repair: prepared-proposal item/reference controls must be resolved by the stored proposal lifecycle before generic mission grammar. Preserve ordinary explicit new mission commands that do not refer to the held proposal. Add full voice tests with two proposed items and an existing protected primary.

### 4. P2 — Ordinary deferral is recorded as terminal rejection

**VERIFIED source and executable fallback smoke:** `server/claire/weeklyMission/strategicProposalTurn.ts:118-131` maps `weekly_cancel` to reject unless raw text starts with `defer`. The production deterministic Brain fallback returned `target: weekly_planning`, `weeklyDisposition: cancel` for `Not now. We will discuss it tomorrow.` with a prepared weekly session.

Failure sequence: without the optional Brain model (the committed MySQL journey disables provider keys), operator makes the requested ordinary deferral. The router records reject, clears the session, and renders “The recommendation is rejected.” Rejection is terminal in response admission, so a temporary postponement cannot be resumed as intended. A live model producing cancel has the same downstream defect.

Minimal repair: carry reject and defer as distinct typed control results, or conservatively resolve postponement at the prepared-proposal boundary before terminal rejection. Test the exact requested phrase and contractions through authoritative voice routing.

### 5. P2 — The requested proactive-role correction is not captured durably

**VERIFIED source and executable parser smoke:** `shared/claireRoleFeedback.ts:4-8`; `server/agents/daphne/explicitPreferenceCorrection.ts:55`. The exact requested phrase `You should be preparing these decisions for me.` produced `isClaireRoleFeedback=false` and no explicit Daphne corrections. Its Brain fallback also had `identityTopic=none`.

Failure sequence: operator gives that explicit correction; the new role-correction path fails to create `proactive_initiative=high`, so the promised next-interaction preference guidance cannot be supported by that durable receipt. The existing integration fixture uses “supposed to” and therefore does not test this phrase. General conversation ingestion is durable observation, but is not proof that this explicit preference was admitted and read back.

Minimal repair: extend the narrow, non-authorizing role-feedback grammar to ordinary should/need phrasing while keeping hypotheticals, quotations and actual task commands out. Test explicit correction admission/readback and next interaction with the exact phrase.

### 6. P2 — Saved call consent cannot be inspected accurately after reload

**VERIFIED source:** `client/src/pages/goldline/ClaireStrategicCallConsent.tsx:10-12,23-36`. The server returns the authorization bounds, but the UI renders only active/inactive and business timezone; checkboxes always initialize empty and inputs initialize 09:00–17:00. It never renders the persisted weekdays/window/limit.

Failure sequence: operator grants Tuesday 10:00–11:00 and reloads. UI shows active permission alongside an empty weekday selection and 09:00–17:00 draft, with no way to inspect the actual permission. This fails the requested inspect-and-revoke consent acceptance and can mislead an operator about when calls are permitted.

Minimal repair: explicitly display current persisted bounds separately from the editing draft, or initialize the draft from the saved authorization with a clear save control. Verify reload and revoke in authenticated browser acceptance.

## Sound boundaries observed

- Proposal/diagnosis/response reads are tenant and canonical-operator scoped. App mutations resolve authenticated operator identity; approval also verifies both source/canonical operator membership. I found no concrete cross-tenant disclosure in the newly changed ports inspected.
- Sunday and weekday actions are distinct. Weekday consent validates weekdays 1–5, timezone, time window, bounded limit and revocation; scheduling/dispatch check exact action.
- Dispatch fences a durable lease and marker before provider invocation. Recovery avoids redial after uncertain dispatch. This is a conservative at-most-once attempt, which can miss a call after a crash; it is not exactly-once provider completion.
- Approval rejects mismatched revision/item scope and expired rows, writes an immutable response, and independently reads Day Director identity/content/approval lineage before claiming a save. Existing approval/revision/rejection responses are serialized by proposal row locking.
- Mission Director remains the ranking authority. Pending objectives project blocked; strategy path selection no longer directly commits missions. Accepted strategic work uses supporting designation rather than replacing primary work through that port.
- Estimated/partial/stale/unsupported bottleneck metrics are withheld; software lacks invented canonical readers; current market readers check same-tenant territories, fresh sourced observations, coordinates and radius. Existing unaccepted contaminated template plays are retired without rewriting approved history.
- Optional quality judgment failure/unavailability is not recorded as an acceptable pass. Candidate admission currently permits unreviewed/unavailable diagnoses with low-confidence hypothesis labeling and bounded audit actions. I did not find a concrete new spend/contact grant from unavailable review.
- Daphne role preference changes are style preferences and do not grant execution, manufacture financial truth or edit business ledgers.
- Numbered and boot migrations both provision the new tables/columns/appointment enum. These source changes are additive; fresh/existing/idempotent MySQL execution remains the parent’s acceptance gate.

## Uncertain concerns and verification limits

- Selected-item voice approval relies on a narrow raw regex. If Brain interprets a scoped paraphrase as `weekly_lock`, the downstream route approves all items; its typed intent carries no selected IDs. The exact live model classification is unverified. The parent should test “Only add the second one” with at least two items and reject any scope widening.
- Natural day moves do not have a prepared proposal date mutation port: revision currently changes title/objective only. The parent should run “Actually, move that mission to Thursday” and verify it neither creates generic work nor falsely acknowledges a date change.
- “Why” speech emits supporting evidence IDs rather than metric values; ordinary “What numbers…” may route away from the prepared proposal. The parent should verify evidence-grounded voice answers and original-plan recall.
- `quality.reasons` is not included in proposal uncertainty/opening or the client evidence details. Default reviewer unavailability is accurately stored but is not explicitly disclosed on the inspected app/voice surface. This is a report-claim discrepancy, not evidence that the UI claims professional validation.
- Dispatch's authorization-row lock makes admission serialize against revoke, but the provider runs after that transaction commits. A revoke after dispatch admission cannot recall an in-flight provider attempt. No live concurrency/provider experiment was performed in this review.
- I did not run MySQL migrations/workers, browser authentication, live models, provider transport or production configuration. Historical artifacts and green CI are not substituted for those results. The ordinary mission parser and fallback/role-parser smokes above were executed without a DB or provider.

## Independent acceptance position

**BLOCKED at the reviewed baseline head** by the supported current-revision and conversational/dispatch authority defects above, pending repair and connected regression proof. Source review alone cannot establish merge or controlled rollout readiness. The parent’s MySQL, controlled authoritative voice, authenticated browser and production read-only gates remain required.

Strategic certification explicitly remains incomplete: no independent human strategic-quality certification, proven financial impact, full production-baseline superiority, or real-world adaptive-learning effectiveness is established by this review. No deeper intelligence implementation is proposed.
