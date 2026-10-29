# Claire: native-tool prototype vs production Brain V2, same 16 scenarios, 3 trials each

Date: 2026-10-29. Both runs on commit `744655e`, real models (Claude Sonnet 5.5 for Claire, Sonnet 5.5 as the simulated operator, Haiku 5.5 inside V2's perception), disposable MySQL, graded by the SAME grader and scenario files (the run-3 versions, i.e. BEFORE the grading corrections in commit `9d43310`). Nothing in production was changed.

- Prototype: [run 40823949938](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/40823949938), report preserved as `2026-10-29-run3-prototype-REPORT.md`.
- Brain V2: [run 40826577413](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/40826577413), report preserved as `2026-10-29-run4-v2-REPORT.md`.

## Headline

| | prototype | Brain V2 (production) |
|---|---|---|
| scenarios passing all 3 trials | **8 / 16** | **0 / 16** |
| trials passing | 30 / 48 | 1 / 48 |
| harness errors | 0 | 0 |
| trials in which anything was written to the Day Line | 41 / 48 | 16 / 48 |
| rows added over the run | 76 | 13 |
| unauthorized additions | 0 | 0 |
| seeded rows mutated against the scenario | 1 (bakery trial 1, see below) | 0 |
| "saved" claims without a receipt (run-3 detector) | 5, all false positives on inspection | 52, mostly real |
| denials of a confirmed save | 0 | 8 |
| authorization asks | 48 | 7 (V2 rarely asks; it mostly explains why it cannot write) |
| questions answered with only a sign-off | 1 found by hand (not graded in run 3) | several ("All right.", "No. What else?", "That's not something I get into.") |
| mean Claire turn latency | 2.5–4.2 s per scenario, max 11 s | 2.1–6.1 s per scenario, max 10.9 s |
| tokens / est. cost | 2.0M in / 40k out, ≈ $6.65 at $3/$15 per M (simulator not counted) | not captured by the runner |

The one V2 pass (`food_truck_empty_ledger_numbers` trial 1) is a scenario where the correct behavior is to write nothing and quote no figures.

## Per-scenario, with the cause classified

Categories: **H** = harness/scenario defect (grading wrong, system behavior right); **S** = simulated-operator contradiction (the persona disputed its own seeded record or its own dates); **T** = task failure (the work did not land, landed wrong, or was wrongly mutated); **C** = conversational failure (question unanswered, repetition, wrong register) with the work otherwise right.

| scenario | prototype | V2 | prototype cause | V2 cause |
|---|---|---|---|---|
| louise_hold_inbound | 3/3 | 0/3 | — | T: "I can't write to the Day Line from this call"; Rise Koreatown never added. Rule honored (never raised the Louise). |
| oct27_overwhelmed_defer | 0/3 | 0/3 | H: expected the Louise row on today/tomorrow though seeded 81 days back; Claire moved both open items to tomorrow and read them back correctly | T: nothing moved; "Nothing is saved on the Day Line for tomorrow." |
| oct28_three_items_scripted | 0/3 | 0/3 | H (trials 2–3: towel run split into two rows, regex counted both) + C (trial 1: 4 permission asks). All three items landed on tomorrow in every trial; capabilities answered correctly | T + C: reproduces the production call. "Saved" for the challenge (the one row that landed), "Already set" twice for items never written, then "I have to walk back what I said… Nothing was saved, including the marketing challenge" (denying the one real save), then "That's not something I get into." to the capabilities question |
| oct28_three_items_simulated | 3/3 | 0/3 | passed, but trial 1 answered "what can you actually do for me?" with "Goodnight, Adam." (C, missed by run-3 grading; now a failing check) | T + C: only the landing page landed; "Saved" then "that wasn't backed by anything"; "No. What else?" to a real question |
| relative_dates_and_ambiguity | 2/3 | 0/3 | T (trial 1): asked to confirm "next Thursday" instead of writing it | T: wrote "Pay the water bill sometime next week" on TODAY (vague date guessed), did not move Century Park East, dryer call never landed, then denied its own earlier "done" |
| yes_binds_to_offer | 1/3 | 0/3 | C: outcome right in all 3; failed on ask count (a clarifying "I'm not sure what the yes is answering") and, in trial 2, the server's bare-yes rule cost a turn | T: nothing written; advised sending the email instead |
| bakery_three_days_one_breath | 1/3 | 0/3 | S (trial 1): simulator insisted a seeded standing order was never given; Claire removed it (the one seeded-row mutation of the run; a better assistant pushes back). S (trial 3): simulator contradicted itself on "next Friday"; Claire followed its final word | T: none of the three written |
| cleaning_company_bare_yes | 3/3 | 0/3 | — | T: oven job never written; "Yes" treated as answering nothing |
| contractor_done_and_take_off | 2/3 | 0/3 | C: outcome right; one sensible follow-up question against a 0-ask threshold | T: "There's no Alvarado disposal on the Day Line" (it was seeded); nothing completed or removed |
| food_truck_empty_ledger_numbers | 3/3 | 1/3 | — | C: two trials flagged for stating plan items as if committed |
| groomer_remembers_whole_call | 3/3 | 0/3 | — | T: "I can't put those on tomorrow from this call" |
| groomer_wants_a_text_sent | 3/3 | 0/3 | — | T: the allowed Day Line note never written; "I don't have write access to the Day Line in this turn" |
| landscaper_correction_mid_list | 0/3 | 0/3 | **T (judgment)**: held all items, corrected, dropped Rosewood, asked "want me to put them on?" four times, never wrote | T: wrote one of two items as a "challenge" on an unrelated turn, then denied it ("My last reply was wrong") |
| mechanic_no_duplicates_done_and_money | 3/3 | 0/3 | — | T: nothing written or completed |
| pool_service_new_rule_and_old_rule | 3/3 | 0/3 | — | T: chlorine run never written; "I can't claim it's on the Day Line until the server confirms the add" |
| window_washer_weekday_juggling | 0/3 | 0/3 | H: sealed expectations used the pre-change `next_<weekday>` rule (off by a week); Claire's dates were the natural ones. 4 flagged "claims" were detector false positives | T: nothing written at all across three trials, 60–80 s per trial |

Counting only causes attributable to the system (T and C, excluding H and S): the prototype has genuine failures in 4 scenarios (landscaper 3/3, relative_dates 1/3, yes_binds asks 2/3, oct28 scripted asks 1/3, plus the one unanswered question in a passing trial); V2 has genuine failures in 15 of 16.

## What V2's failures look like, in its own words

The same sentences that appeared on the Oct 28 production call appear here, unprompted, across unrelated businesses: "Nothing's written yet", "I can't write to the Day Line from this call", "I don't have write access to the Day Line in this turn", "Saved. Tomorrow's challenge: …" followed by "My last reply was wrong", and "That's not something I get into" to a capabilities question. V2's speaking model is instructed that it may not initiate writes; it says so, truthfully, and then the deterministic layer in front of it rarely decides to write. When it does write (the day-plan "challenge" lane) the model still cannot see the receipt, so it denies the save a turn later.

## Caveats, stated plainly

1. Same grader, same defects: both systems were graded by the run-3 grader, so the three harness defects (Louise expectation, towel regex, weekday drift) apply equally. Correcting them would raise the prototype to roughly 11/16 and leave V2 at 0/16; those are estimates from reading the traces, not re-graded results.
2. Clock: the scenario `localTime` is applied to the prototype only; V2 reads the real clock and saw "11 PM" during the run. It affected V2's tone ("the field day is over") and some of its advice, not its ability to write.
3. The first sealed set is now spent (I read it to classify failures). A fresh sealed set, written by a separate agent against the corrected grader, is committed unread at `evals/scenarios/sealed/`.
4. The authorization check in the prototype verifies that the quoted words were spoken on the call; it does not verify that those words authorized the specific operation. The judgment of what was authorized is the model's, and it is what the next round must improve (see `REMEDY_over_confirmation.md`).
5. Latency is comparable between the two; neither has been measured behind speech-to-text and text-to-speech.

## What this does and does not show

It shows that, on 16 conversations the prototype's author mostly did not write, one model with five tools did the operator's work correctly far more often than the production pipeline, with zero unauthorized additions and zero denials of its own saves, and that production Brain V2 reproduces the Oct 28 failure pattern on demand.

It does not show the prototype is ready for the phone. Its remaining defect is judgment about when it already has permission, and it has one unanswered-question lapse. Next: apply the proposed remedy, rerun dev + the fresh sealed set with the corrected grader at pass^3, and only then discuss the phone path.
