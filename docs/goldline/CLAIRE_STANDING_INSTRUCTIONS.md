# Claire standing instructions and the promise ledger

Why this exists: the 2026-10-13 to 2026-10-20 production audit found Adam's rules and Claire's own promises
spoken, acknowledged ("Understood, I'll keep that in mind", "That's on me to fix", "I'll hold it until then")
and then lost. Nothing was written, so the next call began from nothing. Two rules follow.

1. The operator never re-reports a rule. A rule stated once is saved, read back, and handed to every later call.
2. A promise Claire speaks is either kept by the system or never spoken.

## What is stored

| Table | Written by | Read by |
|---|---|---|
| `claire_operator_instructions` | `server/agents/daphne/standingInstructions/capture.ts` (after a fresh read back) | showrunner briefing, the speaking organ, Claire Desk |
| `claire_prepared_items` | `server/claire/promiseReconciler.ts` when a spoken promise can be backed | morning/evening opening, Claire Desk |

Instructions are append-only and versioned per `subjectKey`. The newest active version of a subject is in force.
A revoking statement ("stop the encouragement") is a new version with status `revoked`. Daphne meta-preferences
(`daphne_meta_preferences`) stay for style knobs (shorter, more direct); they cannot hold free-form rules, which
is why this store sits beside them rather than inside them.

Kinds: `encouragement_every_call`, `review_window`, `role_feedback`, `call_rule`.

## The contract

- **Capture.** `detectStandingInstructions` is a narrow parser. It never infers a rule from behaviour, ignores
  quotes and hypotheticals, and refuses a rule whose subject it cannot resolve ("stuff like that" with nothing before it).
- **Readback.** Claire says a rule is saved only after the rows are read back from the store. A failed write or
  a read back that does not match says so plainly and promises nothing. The wording avoids a leading "Saved",
  which `assertionGuard.ts` reserves for receipt-backed renderers.
- **Prompt.** Every call receives `OPERATOR STANDING INSTRUCTIONS` built from active rows: the scheduled-call
  showrunner prompt, the composed speaking organ, and the deterministic opening.
- **Review windows.** A rule like "ask about overdue follow-ups Sunday 5 to 7 PM" is evaluated against the
  operator's local clock. Outside the window the opening drops matching Day Line items and the prompt says HOLD.
  The match is by item title or time label (`follow up`, `overdue`, `circle back`), because Day Line stops carry no category.
- **Role feedback.** "You're the chief of staff, tell me the missions" is stored with the quote. The obligation is
  that every call opens with the goal and the plan. It is shown on Claire Desk under HEARD.
- **Promises.** `promiseGuard.ts` finds sentences that commit to a later call. `promiseReconciler.ts` backs the
  property-visit case by preparing a `claire_prepared_items` row from the live campaign; anything else is removed
  before speech. The next call's opening reads the row, re-checks the campaign so a visit done since is not offered,
  and marks the row consumed once the call has been placed.

## Encouragement, in character

Defined with the rapport policy in `server/claire/progression/policy.ts` (`ENCOURAGEMENT_POLICY`). One grounded
sentence that ties the next move to the goal, from facts already true in the call, such as
"Fifty is attainable if you count buildings." It earns no rapport, is not currency, and never reuses the authored
decline or closer lines. Rapport band changes warmth of phrasing only.

## Operations

- Kill switch: `CLAIRE_STANDING_INSTRUCTIONS=0` disables capture and loading. Default is on.
- The tables are created by `scripts/migrate.mjs` on boot (`drizzle/0146_claire_standing_instructions.sql`).
- The three rules Adam already gave are restored once, through the same capture path, with
  `scripts/claire-standing-instructions-seed.ts` (dry run by default, `--apply` to write, idempotent).

## Not done

- Pre-drive calls on the legacy (non V2) Twilio path do not capture instructions; V2 primary does.
- The held-topic filter on the opening is title based. Briefing JSON given to the scheduled-call model still lists
  every stop (truth is not hidden from it); it is told to HOLD.
- Model-extracted instructions from Daphne conversation ingestion (`instruction` items) are not imported yet.
