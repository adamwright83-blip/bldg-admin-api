# WEEKLY MISSION READINESS
Version: 1.0  
Date: 2026-09-21  
Status: **LOCKED for V1 implementation**  
Chats are disposable. This file is the spec.

Labels: LOCKED | WORKING | OPEN  
Related: Day Director · Daily Command (#199) · Mission Director · Claire conversation state  
Not related: Narrator OS · Act I playable beats · Brain V3

---

## 0. Product sentence

**LOCKED:** Every Monday — or the first time that week the operator opens the app — Claire interviews them until she understands enough of the **remaining** week to assign one real mission to each remaining day and tell them exactly what has to be ready before each mission. They approve the week once. Goldline then turns each day into the adventure they actually play.

Failure mode this exists to kill: Monday afternoon, no week, therefore no idea what must be cleaned, printed, approved, loaded, or researched beforehand.

---

## 1. Precedence

**LOCKED:**

1. Fixed windows are weather.
2. The locked weekly primary owns discretionary time.
3. Readiness due today matters now.
4. Daily Command may override the primary only for a stated reason.
5. `WeeklyIntent` keeps the original agreement. Override does not rewrite history.
6. Mission Director plays **today**, never the draft.

```
WEEKLY INTENT     what we decided when we locked
DAILY COMMAND     what actually makes sense today
MISSION DIRECTOR  what today's real objective becomes as gameplay
```

---

## 2. Week status

**LOCKED:**

| Status | Meaning | Claire / UI |
|---|---|---|
| `UNPLANNED` | No `WeeklyIntent` for this `weekStart` | Surface **once**. Card + one line. No hourly nag. |
| `IN_PROGRESS` | Interview started, not locked | Resumable across calls. Mode gate on. |
| `LOCKED` | Operator approved | Leave it alone unless operator taps Adjust. |

Horizon is **remaining days**, not a pristine Mon–Fri. Monday 15:10 → Monday remnant (optional, thin) + Tue–Fri. Claire does not construct a fantasy Monday.

Adjust reopens the same week session against current reality + what already happened this week. Revisions stay draft until a new explicit lock.

---

## 3. Port (do not grow this)

**LOCKED:** Four operations. Not a department. Not a third brain.

```
loadWeeklyDossier()
loadWeeklySession()
advanceWeeklySession()
commitWeeklyPlan()
```

| Op | May write business truth? |
|---|---|
| dossier | No. Read-only. |
| session load | No. Working document only. |
| advance | No. Speech + draft act only. |
| commit | Yes, and only after explicit lock. Receipts required. |

V1 calls these live. Brain V2 observes. Later V2 may become the caller. No planner rewrite. No Brain V3. No second Weekly Planner.

---

## 4. Dossier

**LOCKED:** `loadWeeklyDossier()` is a pure read of known reality for remaining weekdays.

Includes, with provenance: existing Day Director commitments, pickups/dropoffs/jobs, fixed windows, external promises, open follow-ups, sales work, known prep, recurrence **rules**, campaign state, macro goal, unresolved growth work.

**LOCKED — landmine:** Must not project recurrence into future Day Director rows. Looking at Thursday must not create Thursday.

`fixedConstraints[]` on the later intent are **references / provenance snapshots**. Authoritative pickup/window stays where it already lives. Do not duplicate those rows as new work.

---

## 5. Session and counselor

**LOCKED:** Session keyed `weekly-planning : tenant : operator : week-start`. Independent of a single phone call. Reuse Claire conversation-state infrastructure. This is not business truth.

`advanceWeeklySession({ dossier, session, operatorUtterance })` returns exactly one of:

`ASK | PROPOSE | REVISE | AWAIT_CONFIRMATION | CANCEL`

plus speech and the current draft.

Interview law:

- Start from dossier facts. Do not ask the operator to restate known pickups.
- One high-value question at a time.
- Probe conflicts, capacity, dependencies, prep, external promises, avoided work, what actually advances the stated objective.
- Challenge unrealistic shape. Never diagnose.
- Never invent obligations, recurrence, deadlines, availability, appointments, customers, completed work, or target identities.
- After ~6–8 substantive questions, propose the best defensible remaining week and name leftover uncertainty — or ask one genuinely blocking question. Not Question 17.
- Informational gaps become operator readiness (“confirm Tuesday’s six buildings”), never generated buildings.

---

## 6. Draft shape

**LOCKED:** One primary per remaining weekday.

```
DAY
  primary          (proposed text or existing commitment id)
  fixedConstraints[]   (refs/snapshots from dossier)
  readinessRequirements[]   (0–4)
```

Cap 4 readiness items. Nine items is a todo dump.

---

## 7. Readiness

**LOCKED:**

```
MissionReadinessRequirement {
  text
  kind: physical | document | information | approval | location
  neededForDate
  completeByDate
  status: open | ready | blocked
}
```

No `other`. No further fields in V1.

`completeByDate = neededForDate − 1 business day` is a **planner default**, not an externally verified fact. Operator may override conversationally (“packets Tuesday morning is fine”). Claire must be able to learn that.

Readiness ≠ automatic Day Director work.

| Example | Home |
|---|---|
| Clean jacket | Intent checklist |
| Car has gas | Intent checklist |
| Print six packets Monday at the plant | May be Day Director work |
| JETRO Monday 14:00 | Day Director work (already or newly accepted) |

Daily Command **surfaces** items whose `completeByDate` is today. Promote to Day Director only when it is actual scheduled work.

Claire may ask whether packets exist. She may not invent addresses, decision-makers, or approvals to fill slots.

---

## 8. Mode gate

**LOCKED:** While status is `IN_PROGRESS` or `AWAIT_CONFIRMATION`:

- generic work capture OFF
- generic briefing commit OFF
- tomorrow-plan flow OFF
- random Day Line proposal OFF

“Jacket needs washing and six packets printed” during “what must be ready before Tuesday?” is draft readiness. It is not two commitments because another parser heard a verb.

“No, Tuesday won’t work. Thursday.” is `REVISE` of the draft, not a new Thursday row.

This is a router invariant, not a prompt suggestion.

---

## 9. Commit

**LOCKED:** Nothing durable until an explicit operator authorization (“Lock it.” / “That’s the week.” / equivalent).

`commitWeeklyPlan()` then:

1. Writes `WeeklyIntent` (`weekStart`, `operatorId`, `lockedAt`, `source = operator_confirmed_proposal`, per-day primary refs + readiness).
2. For each day: `designateDayDirectorPrimary` if the work already exists; otherwise accept new primary work through existing proposal/acceptance.
3. Does not copy `fixedConstraints` as new tasks.
4. Returns per-day mutation receipts. Claire speaks failures. She does not say the week is locked if Thursday failed.

---

## 10. WeeklyIntent

**LOCKED:** Thin durable object. Not a task database. Not the source of individual work.

Answers: “What did operator and Claire agree this week was supposed to be?”

UI brochure (later) reads intent. Daily Command reads today. If Thursday’s field run is displaced by a Wednesday-created time-critical promise, both facts remain. That is how the system can later notice “three of the last four Thursdays, field work lost to operations” without rewriting Monday.

---

## 11. #199 / Daily Command

**LOCKED — semantics:** Do not invent a second meaning of `primary` or `designatedBy`.

**LOCKED — schedule:** Feature is not hostage to the entire #199 draft.

Before implementation: if #199 can merge quickly, land it and build on it. If it drags, extract only:

- `command.role = primary`
- `designatedBy = operator_confirmed_proposal`
- a **safe read-only** future/week scan

Remainder of Daily Command (including consuming readiness as `tomorrow_prep`) follows separately. Do not call a reader that writes recurrence in order to build the dossier.

When Daily Command is live: preserve locked primary where possible; override only with a stated reason; Mission Director reads command output, not `WeeklyIntent`, not the draft.

---

## 12. V1 build list

**LOCKED — implement this, in this shape:**

1. `WEEK_STATUS` for current `weekStart`.
2. Remaining-day horizon.
3. `loadWeeklyDossier()` read-only.
4. Session keyed by tenant / operator / weekStart.
5. `advanceWeeklySession()` → ask/propose/revise/await/cancel + speech + draft. Zero business writes.
6. Interview law in §5.
7. One primary per remaining weekday.
8. Each day: primary + fixed constraint refs + ≤4 readiness with due-by.
9. Mode gate.
10. Explicit lock → `commitWeeklyPlan()` → intent + designate-or-create + receipts.
11. Daily Command, once safe: today’s primary + readiness due today; override-with-reason.
12. Mission Director plays today’s command.

---

## 13. Out of V1

**LOCKED — do not build:**

CBT · ADHD modules · marketplace · constraint solver · automatic full-week reschedule · multi-week · V2 `weekly_planning` task-set · elaborate contradiction engine · chapter-verb generator · fold-out brochure art · Narrator integration · readiness kinds beyond the five · `other`

Ugly five-day cards that show primary + fixed + readiness are enough UI for V1.

“Claire planned your week / Built from our Monday conversation” is a sentence, not a rendering project.

---

## 14. Claire register

**LOCKED:** Field intelligence. Not a weekly standup coach. Not a questionnaire.

Allowed: “You’ve given Wednesday three mains. Which one survives.”  
Allowed: “Monday’s mostly gone. We still don’t have Tuesday through Friday. Ten minutes.”  
Forbidden: diagnosis, mood-mirror, cheer, invented windows, invented customers, calling until they plan.

Same behavioral floor as claire-1.0.0.

---

## 15. Tests that must exist in the first PR

**LOCKED:**

- Active session + “Thursday, not Tuesday” → draft revise, no Day Line write.
- “Jacket and six packets” during readiness question → draft readiness, no generic commitments.
- “Looks good” / “Lock it” after a proposal → weekly confirm/commit path, not five independent briefing prompts.
- Dossier load for a future weekday creates zero new Day Director rows.
- Commit receipt failure on one day is spoken; other days not silently claimed locked.
- Brain V2 shadow (if present) produces no mutations and does not treat draft facts as business truth.
