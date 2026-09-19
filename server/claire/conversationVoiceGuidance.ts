/**
 * PR1 Claire Intelligence Repair -- corrective pass (real-exam findings).
 * Shared prompt-guidance strings for Claire's conversational (voice-phone)
 * generation paths. Kept in one place so preDriveConversation.ts and
 * reasoning.ts stay consistent and this doesn't drift into two slightly
 * different behavioral contracts.
 */

/**
 * The real exam showed several long answers formatted as written consultant
 * output -- "Good question...", markdown headings (**bold**, `---`
 * dividers), and generic sales-coach phrasing. That reads fine on a screen
 * and sounds wrong spoken aloud on a phone call. This is scoped to the
 * voice/phone surface specifically (see the `surface` param threaded
 * through both generation functions) -- a future desktop/text surface may
 * still benefit from structure and is not constrained by this.
 *
 * CORRECTIVE PASS 3 -- why this got rewritten. The first version of this
 * string half-worked: markdown headings did disappear from the real exam's
 * second run, but answers stayed long, written and memo-shaped, and
 * "Good question to ask before you walk in." survived verbatim. Dumping
 * the actual assembled system prompt showed why, and it was not that the
 * guidance was missing:
 *
 *  - It sat at char 8,923 of a 10,475-char prompt, with ~1,550 chars of
 *    further instruction after it, so it was neither first nor last.
 *  - Three separate instructions actively licensed length and competed
 *    with it: the mode policy's "let a genuinely strategic question run as
 *    long as it actually needs", this path's own "a real strategic
 *    question can run several sentences. Do not pad or artificially
 *    shorten", and -- the strongest of the three --
 *    CLAIRE_V1_REASONING_POLICY's "Reason in this order: goal, reality,
 *    plan, gap, bottleneck, blocker, action", which reads as a mandated
 *    seven-part OUTPUT structure. The real exam's strategic answer follows
 *    that seven-part shape almost literally.
 *  - This string only ever banned *formatting*. It never said anything
 *    about conversational turn-taking, which is the actual thing that was
 *    wrong.
 *
 * So: it is now explicitly authoritative over delivery, it is placed LAST
 * in both prompts (nearest the generation), it clarifies that the
 * reasoning order is how to THINK and not a template to narrate, and it
 * states the turn-taking principle. It deliberately does NOT impose a word
 * or sentence cap -- that is the exact failure mode two earlier passes
 * were spent removing. The goal is the same intelligence delivered
 * conversationally, not a terser Claire.
 */
export const VOICE_NATIVE_ANSWER_GUIDANCE = [
  "DELIVERY RULES take precedence over any earlier instruction.",
  "Never use markdown formatting. Never begin an answer with 'Good question'.",
  "Reasoning order is how to THINK. It is not a template to narrate.",
  "Lead with the one or two things that matter most, then stop. Never pad.",
].join(" ");

/**
 * The real exam re-mentioned an open blocker (gate code) in 8 of 12 turns,
 * including mid-answer on unrelated pricing/strategy questions -- a human
 * wouldn't re-announce the same open item every time the subject changed.
 * This is prompt-level guidance that leans on the actual recent-turn
 * history already passed as real message-history turns (see
 * preDriveConversation.ts), not a keyword/one-off suppression hack: the
 * model can see whether it (or the operator) already raised the blocker in
 * the visible history and should reason about salience from that, not
 * mechanically re-append a status check to every answer.
 */
export const BLOCKER_REPETITION_DISCIPLINE =
  "If a blocker was already mentioned in recent conversation, do not mechanically re-mention it again unless the operator asked, its status changed, or it is material now.";

/**
 * Real-exam finding: the model used ambient provider/server current-time
 * awareness and contradicted the frozen JOYSTICK business clock (afternoon
 * fixture vs evening speech; today vs tomorrow vs already-passed). The
 * supplied verified context clock is the only allowed temporal source.
 */
export const CLAIRE_TEMPORAL_AUTHORITY_INSTRUCTION =
  "TEMPORAL AUTHORITY: the supplied verified business-context clock is the sole temporal authority for current date, local time, weekday, daypart, and today/tomorrow/future/past status. Ignore any ambient model/provider/server notion of the current time, even if it seems more recent. Never override the supplied clock with outside time awareness.";

export const RETRIEVED_EVIDENCE_INSTRUCTION =
  "Ground facts in retrievedEvidence; else say unsupported_fact.";

export const MISSION_SALES_BRIEF_INSTRUCTION =
  "missionSalesBrief is the one authoritative sales strategy. Its unknowns, questionsToAsk, and recommendations are never known facts.";

export type ClaireGenerationSurface = "voice" | "desktop";
