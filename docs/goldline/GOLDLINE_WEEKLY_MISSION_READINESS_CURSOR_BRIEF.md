> **LEGACY DAYFORGE COMPATIBILITY:** Retained historical literals in this file are compatibility/history only; they are not current architecture. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.

# WEEKLY MISSION READINESS V1 — CURSOR WORK ORDER
Target repo: `adamwright83-blip/bldg-admin-api`  
Pass: Slices A–E. Draft PR only. Do not merge.

## Authority

If this brief conflicts with a file, the file wins in this order:

1. `docs/goldline/GOLDLINE_WEEKLY_MISSION_READINESS.md` (product law — already locked)
2. This work order (implementation sequence, tests, branch, gates)
3. Existing production code / #199 as landed on the chosen base

Do **not** rewrite the spec from this prompt. The spec is already at:

`docs/goldline/GOLDLINE_WEEKLY_MISSION_READINESS.md`

Do not add roadmap. Do not touch Narrator OS, PR #202, or story canon.

---

## 0. FIRST ACTION — BASE BRANCH DECISION

Fetch current `main` and PR **#199** (Claire Daily Command / Monday Reconciliation).

Last reviewed:

- PR #199 draft, **not merged**
- head then: `5d4169568cbde78e85924471c4c39f18ea8b4a10`
- **already conflicts with newer main**

If #199 has moved, report the new head and use that.

**Do not modify PR #199 directly. Do not merge #199. Do not merge this work.**

Then choose **exactly one** base. Report the choice before writing feature code.

### Path STACK (preferred only if cheap)

If you can rebase or merge current `main` into #199’s branch **without inventing product decisions** and the conflict resolution is mechanical:

- Branch `cursor/weekly-mission-readiness-v1` from the reconciled #199 head.
- Open a **draft PR whose base is #199’s branch**, not `main`.
- Diff must be Weekly Mission Readiness, not all of #199.

### Path EXTRACT (required if #199 still fights main)

If rebase/merge of #199 onto current main is not mechanical:

- Branch `cursor/weekly-mission-readiness-v1` from current `main`.
- Extract onto this branch **only**:
  - `command.role = primary`
  - `designatedBy = operator_confirmed_proposal`
  - a **read-only** future/week scan that does not materialize recurrence
- Implement slices A, B, C, E against that.
- Slice D: hook Daily Command **if the types exist on this branch**; otherwise add the smallest adapter/interface Daily Command can consume later, plus tests that encode the override/readiness contract. Do not reimplement Daily Command.

Do not create a second meaning of `primary`.

Stop and report if neither path is safe. That is a genuine architectural halt.

---

## Product law (do not dilute)

Already locked in the spec. Rebuild against that file.

Sentence:

Every Monday — or the first time that week the operator opens the app — Claire interviews them until she understands enough of the remaining week to assign one real mission to each remaining day and tell them exactly what has to be ready before each mission. They approve the week once. Goldline then turns each day into the adventure they actually play.

“Remaining” is functional. Monday 15:10 is a remnant, not Launch.

Precedence:

1. Fixed external windows are weather.
2. Locked weekly primary owns discretionary time.
3. Readiness due today is first-class on the morning surface.
4. Daily Command may override the weekly primary only for a stated reason.
5. Override does not rewrite `WeeklyIntent`.
6. Mission Director plays today’s command. Never an unconfirmed draft.

This is OS cognition. Not Narrator OS. Not a second Claire brain. Not Brain V3. Not a V2 planner.

Reusable seam only:

```
loadWeeklyDossier(...)
loadWeeklySession(...)
advanceWeeklySession(...)
commitWeeklyPlan(...)
```

V1 calls them live. Brain V2 stays shadow (`productionAuthority: false`). No `weekly_planning` V2 task-set in this PR.

Intelligence → counselor. Authority → Day Director. Today → Daily Command. Playable → Mission Director.

---

## How to work

One stacked draft PR. Separate commit per slice A–E (plus one commit for the base-path decision / extracted primitives if Path EXTRACT).

Do not stop between slices unless:

- the base-path decision is EXTRACT and Slice D cannot hook without reinventing Daily Command (implement the adapter + tests, then continue E), or
- you hit a genuine architectural conflict the spec does not resolve.

Do not invent gate scripts. Run what exists. Name anything missing.

---

## SLICE A — contracts, read-only dossier, session

`WeekStatus` is **derived**, no status table:

- locked `WeeklyIntent` for this business-local `weekStart` → `LOCKED`
- else active weekly planning session → `IN_PROGRESS`
- else → `UNPLANNED`

Remaining-week horizon: business-local date, weekday, local time, remaining weekdays through Friday, whether today is a remnant. **No hardcoded “15:00 kills Monday.”** Pass actual local time. Counselor may stand the remnant down.

Remnant only:

```
disposition: "primary" | "stand_down"
```

`loadWeeklyDossier(...)` is strictly read-only. Provenance on every fact. Recurrence may appear as **rules**. Must not materialize future Day Director rows. Must not call a #199 reader that projects recurrence into writes.

Regression: dossier load → zero inserts, zero updates, zero Day Director projection, zero recurrence projection.

Fixed constraints are refs/snapshots, not copied work:

```
WeeklyFixedConstraint { sourceRef, title, businessDate, scheduleLabel }
```

Readiness V1 only:

```
MissionReadinessRequirement {
  text
  kind: physical | document | information | approval | location
  neededForDate
  completeByDate
  status: open | ready | blocked
}
```

Max 4 per day. Default `completeByDate = previous business day` is a **planner default**, not verified truth. Operator or authoritative reality may override.

Claire may recommend prep. She may not invent buildings, names, approvals, or windows.

Session: existing Claire conversation-state store. Key:

```
weekly-planning:{tenant}:{operator}:{weekStart}
```

Survives webhook, process, call, deploy. Not business truth.

---

## SLICE B — interview + mode gate

`advanceWeeklySession(...)` uses the existing Claire model/personality/compiler stack. No new LLM client.

Investigator, not questionnaire. Known facts first. One question. Challenge capacity/conflicts/prep/undated work. No diagnosis. No coaching clichés. After a reasonable bound, propose and name uncertainty or ask one blocking question. Not Question 17.

Validated structured act only:

`ASK | PROPOSE | REVISE | AWAIT_CONFIRMATION | CANCEL`

Fail closed on malformed model output. Model output never writes business truth.

Each future weekday: `businessDate`, one `primary`, `fixedConstraints`, `readinessRequirements`.

Primary must mark source: existing work | operator-stated | Claire-recommended. Recommendations are not facts.

A `weekly_planning` **character mode** on the existing Claire character definition is allowed. That is not a V2 task-set.

Speech about dossier facts must go through existing claim/G4 discipline. Do not disable factual lint. Extend a verified-fact inventory from the dossier if needed.

**Mode gate — router invariant**, not a prompt:

While session is `interview | proposal | awaiting_confirmation`:

generic work capture, briefing commit, tomorrow-plan, single-item commitment proposal, random Day Line capture = **OFF**.

Thin `runClaireTurn` hook only: if active weekly session → route completed thought to planner → return planner result. Do not sprinkle weekly conditionals through every V1 route.

V2: no mutations, no authority flip, no V1 session mutation, no second planner. Small regressions only.

Voice: one question per turn. Do not read the full week after every answer. When enough: “I have enough. Here’s the week I’d run.” Then a concise proposal.

---

## SLICE C — lock, WeeklyIntent, Day Director primary

A/B write nothing durable as business truth.

`WeeklyIntent` is thin: tenant, operator, weekStart, revision, `source = operator_confirmed_proposal`, lockedAt, days (primary ref/details, constraint snapshots, readiness). Not a task database.

Lock only from `AWAIT_CONFIRMATION` plus a genuine bind (“Lock it.” / “That’s the week.” / unambiguous yes to “Want me to lock this?”). Revision, “no”, or a new topic must not lock.

`commitWeeklyPlan()` orchestrates Day Director. Existing item → `designateDayDirectorPrimary(...)` in the Day Director domain (`command.role = primary`, `designatedBy = operator_confirmed_proposal`, timestamp; demote any other primary that date). New work → existing proposal/acceptance. Deterministic idempotency. One primary per date.

Readiness stays on intent. Checklist ≠ task. Only explicitly scheduled work (JETRO window, print run as a dated stop, call Russell at 11) may be Day Director.

Partial failure: keep successful refs on the session, do not duplicate on retry, status stays `IN_PROGRESS`, speak the failed day, receipts required. Never claim locked if lock did not complete.

Adjust: reopen same week. Confirmed revision → new intent revision. No constraint solver.

---

## SLICE D — Daily Command consumes intent

Do not rewrite Daily Command. Do not build a second today-planner.

Locked today’s primary is the intended primary unless a higher-priority real condition overrides. Override needs a machine-readable + speakable reason. Do not mutate `WeeklyIntent`.

Surface intent readiness with `completeByDate === today` as first-class prep. Reuse `tomorrowPrep` if it fits without lying; else smallest read-model field. Provenance `weekly_intent_readiness` (or equivalent): due today, needed-for date/mission, open/ready/blocked.

Mission Director reads **today’s Daily Command only**. Respect protected discretionary time via existing #199 mechanism when present.

If Path EXTRACT left Daily Command off-branch: adapter + contract tests here, no fake Daily Command.

---

## SLICE E — smallest driver UI

No brochure. No chapter verbs. No fiction. No dark mode. No new call transport. No new mission engine.

Find the real driver/mobile Claire entry and mission-start navigation.

`UNPLANNED`: one card, one CTA “Plan the week with Claire.” Surface once. Decline → stay `UNPLANNED`, no hourly repitch.

`IN_PROGRESS`: resume, do not restart.

`LOCKED`: plain cards — weekday, real primary, concise fixed constraints, ≤4 readiness, status.

Today may emphasize existing Daily Command / Start Mission CTA.

`Adjust with Claire` reopens this week’s session.

Proactive V1: if `UNPLANNED`, one Claire line appropriate to remnant vs morning. No autonomous repeated outbound calls.

---

## Non-goals

CBT, ADHD, UA, marketplace, Brain V3, V2 planner, V2 cutover, Narrator, canon, IGNITE/SIGNAL/CLAIM, brochure art, image gen, multi-week, team planning, constraint solver, auto-ripple, diagnosis, inferred recurrence from history, second task DB, second Mission Director, auto-promoting readiness to tasks.

---

## Tests (minimum)

Dossier read-only. Remaining-week remnant math. Known Tuesday window is in the dossier. Mode gate on jacket / “move Tuesday to Thursday.” Zero writes on ASK/PROPOSE/REVISE/AWAIT. Fixed constraints not duplicated. Readiness cap + five kinds + default due date + no auto task. Confirmation bind rules. Idempotent designate + partial retry. Intent X survives Daily Command Y. Mission Director ignores draft. V2 shadow unchanged. Speech: dossier facts allowed; model recommendation ≠ fact; commit speech receipt-backed.

Do not weaken existing tests.

---

## Gates

After each slice: focused tests for that slice.

At the end, run **what exists**: Weekly Mission Readiness, Claire V1, Brain V2, Day Director, Daily Command, Mission Director, full suite, `pnpm check`, production build, Fast Goldline, DayForge. Report missing names. Do not invent them.

---

## Final report (do not merge)

1. PR URL  
2. head SHA  
3. base path (STACK or EXTRACT) + exact #199 head and/or main SHA  
4. commit SHA per slice  
5. files changed by slice  
6. how `WEEK_STATUS` is derived  
7. where the dossier gets each class of truth  
8. proof dossier writes nothing  
9. session key + persistence  
10. `advanceWeeklySession` contract  
11. exact `runClaireTurn` mode-gate seam  
12. `WeeklyIntent` schema  
13. Day Director primary designation path  
14. readiness persistence / why not tasks  
15. Daily Command override contract (or adapter)  
16. Mission Director integration  
17. driver UI location  
18. Brain V2 result  
19. gate results  
20. collisions / assumptions  

Keep draft. Stop for exact-head review.
