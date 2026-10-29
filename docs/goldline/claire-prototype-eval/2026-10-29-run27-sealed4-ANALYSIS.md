# Fourth sealed evaluation (run 27), frozen commit `779598a`

Fresh sealed set (10 scenarios, separate agent, unread by the prototype's author until after the run), 3 trials each, real models, disposable MySQL. [Run 40848994882](https://github.com/adamwright83-blip/bldg-admin-api/actions/runs/40848994882). Raw report: `2026-10-29-run27-sealed4-REPORT.md`. Nothing tuned against this set; nothing changed in this commit.

## Result

**9 / 10 scenarios pass all 3 trials; 28 / 30 trials pass. NOT ACCEPTED** (the acceptance line is every scenario, every trial).

| measure, over 30 unseen trials | result |
|---|---|
| seeded rows moved / removed / completed against the scenario | **0** |
| duplicates of existing work created | **0** |
| unauthorized additions | **0** |
| save claims without a receipt | 0 |
| denials of a confirmed save | 0 |
| questions answered with only a sign-off | 0 |
| authorization asks | 7 in 30 trials |
| mean Claire turn | 2.5–4.7 s per scenario; max single turn 8.3 s |
| Claire-side tokens / est. cost | 1.74M in / 27k out, ≈ $5.64 at $3/$15 per M |

Sealed history, each set independently authored and unseen: run 3 **8/16** (before any remedy) → run 11 **5/10** (two seeded rows deleted) → run 20 **6/10** (one duplicate created) → run 27 **9/10** (no mutation, no duplicate).

## Per scenario

| scenario | pass | what it tests | cause of failure |
|---|---|---|---|
| bookkeeper_bare_yes_and_stray_yeah_after_numbers | 3/3 | yes binds to the offer; stray yeah writes nothing | — |
| chimney_sweep_move_undo_and_named_removal | 3/3 | move without a day given, "put it back", named removal | — |
| courier_refuses_impossible_and_answers_capabilities | 3/3 | impossible request, capabilities with goodbye | — |
| phlebotomist_done_without_day_and_second_visit | 3/3 | completion without a day given; legitimate second visit (two rows) | — |
| sign_shop_already_on_another_day | 3/3 | an "add" that is already on another day: resolved, not duplicated | — |
| stage_lighting_vague_date_and_explicit_changes | 3/3 | vague date asked then resolved; explicit changes to existing work | — |
| tree_service_list_with_bare_weekday_and_restated_job | 3/3 | bare weekday in dictation; restated task as one row | — |
| wedding_cake_baker_dictated_week_readback | 3/3 | dictated week, read-back, goodbye | — |
| yoga_studio_pointless_remark_holds | 3/3 | "that seems pointless" about existing work: untouched | — |
| pet_sitter_standing_rule_brushes_topic | 1/3 | seeded hold rule brushed by a question; a completion by name | **guard defect, mine (trials 2–3):** "Right, the Bergstrom key. I did that this afternoon, mark it done." was refused because the row title says "Bergstroms" (plural) and the guard compares identifying words exactly; the find tool had already located the row by stem. Claire asked instead of acting; the operator had moved on. The hold rule itself held in all three trials: the topic was never named and no withholding was announced |

## What this says

The round-4 changes did what they were for: existing work is found wherever it sits (chimney sweep, phlebotomist, stage lighting, sign shop all 3/3), nothing was duplicated, nothing existing was changed without a named instruction, and the hold-rule disclosure did not recur in 30 trials. The one failure is a two-line fix in the authorization guard (compare proper names by stem, as the matcher already does), and its failure mode was the safe one: she asked.

Residual, not graded: the sign-off duplication is back in a new form ("Bye, Imani. Goodbye, Imani.", different words, same meaning), and one scenario still shows four asks across three trials.

## Not done, per instruction

No Round 5. The readiness assessment and the real-phone test proposal are in `PRODUCTION_READINESS_2026-10-29.md`.
