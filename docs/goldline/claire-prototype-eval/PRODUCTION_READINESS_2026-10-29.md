# Claire native-tool prototype: production-readiness assessment (2026-10-29)

Written after four sealed evaluations. The prototype lives in `server/claire/prototype/`, is not wired to the phone, and has not touched production Claire. Frozen at commit `779598a`.

## 1. What is demonstrated (VERIFIED, from the preserved reports in this folder)

- On 16 production-derived and authored scenarios, same grader: prototype 8/16 vs production Brain V2 0/16 (run 3 vs run 4). V2 reproduces the Oct 28 call's failure pattern on demand.
- Four independently authored sealed sets, each unseen by the author of the prototype until after its run: 8/16 → 5/10 → 6/10 → **9/10**. The last 60 sealed trials (runs 20 and 27): **zero** unintended moves/removals/completions of existing work, **zero** unauthorized additions, **zero** denials of a confirmed save; the last 30: **zero** duplicates created, **zero** false save claims, **zero** unanswered questions.
- Safety is enforced at the tool boundary, not only in the prompt: quoted authorization must be words the operator said; a bare yes binds to the offer's own sentence and only the work it named; changes to pre-call work require that item and that action in one clause of the operator's words; writes to other days that look like existing work are returned for resolution instead of duplicated; every write is read back from the table before it is reported.
- Conversation: dictated lists land in one batch with a read-back; musing is left alone; capabilities questions are answered, including when bundled with a goodbye; hold rules are honored and, since round 4, not announced.
- Cost on the test workspace: about $0.30–$0.75 per 5–10 turn call on Sonnet 5.5 (Claire's side), text only.

## 2. What is NOT demonstrated (UNKNOWN or INFERRED)

- **The phone.** Everything above is text. Speech recognition errors, barge-in, pauses, perceived latency, and how the operator talks when nobody wrote their lines are unmeasured. Text-turn latency is 2.5–4.7 s mean (max 8 s); on a call that sits under ASR and TTS, so 4–7 s between the operator stopping and Claire speaking is the expectation, with no filler today.
- **Real data.** The disposable database has a handful of rows per day and an empty ledger. Production has months of Day Line rows, real customers, standing instructions captured by the old pipeline, and the day-plan missions #764 writes. `find_day_line_item` has not been exercised against a busy line; the loose candidate match will return more.
- **Multi-call memory.** Standing instructions were seeded; the prototype has not been tested writing a rule on one call and honoring it on the next, nor against the review-window and encouragement rule kinds the production prompt renders.
- **Adam.** Every operator so far was a script or a simulated persona.
- **Known residual defects:** proper-name plurals in the authorization guard (run 27), occasional over-asking on separately stated obligations, duplicated sign-off wording, and the speech check costs one extra model round when it fires.
- **Not part of the prototype at all:** the showrunner's scheduled calls, Daphne preference ingestion, the work ledger, promises, the Colosseum/game layer, the resident-app tool contracts (untouched and unaffected).

## 3. Requirements before any operator hears the prototype on the phone

1. Zero unintended mutations and zero duplicates in the acceptance evaluation (met on the last two sealed sets; keep it as the gate for every later change).
2. A live-phone test on disposable data (section 4) with its transcripts and database graded like a sealed run.
3. A per-operator switch (Adam's operator id only), defaulting off, and an instant way back to V2.
4. Observability: every tool call, receipt and refusal logged under one marker (`[ClairePrototype]`) with conversation id, the way `[ClaireTranscript]` is logged today, so the next bad call is readable from Railway without guessing.
5. A spend cap on the key the prototype uses, separate from V2's.
6. The guard's plural fix and a regression test, since it is known.

Even with all six, the first real calls are the test, not the proof.

## 4. Proposed real-phone test (not started)

**Shape.** Wire the prototype as an alternative turn handler behind the existing Twilio relay path (`runRelayAuthoritativeTurn` already returns `{speak, endCall}`, which is the prototype's turn result), selected by `CLAIRE_PROTOTYPE_VOICE_OPERATOR_IDS` and only for a **test tenant** in production MySQL seeded with disposable rows (a tenant row, a membership, ten Day Line rows across the next week, two standing rules, an empty ledger). Adam calls the existing Claire number; the call is answered by the prototype against the test tenant. Production tenant data is never read or written.

**Calls.** Five scripted on paper for Adam to read in his own words, one each: a dictated week; a move with no day given followed by "put it back"; an ambiguous remark about an existing job plus an explicit completion; the empty-ledger question and a standing rule given mid-call; a capabilities question with a goodbye. Then three unscripted calls where Adam runs a made-up week however he likes, including interrupting her.

**Measured.** Per turn: ASR transcript vs what was said (word error, and whether the meaning survived), model latency, TTS start, perceived gap; whether barge-in cuts her off cleanly and what she does next; final database vs what Adam says he meant (graded with the existing grader by writing the scenario after the call); unintended mutations, duplicates, asks, unanswered questions; Adam's own rating of each call in one line.

**Pass line for continuing.** Zero unintended mutations and zero duplicates across the eight calls; Adam willing to use it for a week on the test tenant; a written list of what the phone broke that text did not.

**Effort.** One to two days: the relay seam, the tenant seed script, the log marker, the switch. Nothing in it changes production Claire's behavior for anyone not on the switch.

## 5. Recommendation

Continue with the native-tool architecture; stop the sealed-set loop here. The next evidence that matters is a live call. Do the six requirements, run the eight calls, and decide from those transcripts.
