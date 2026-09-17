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
  "DELIVERY RULES -- these govern HOW you say things and take precedence over any earlier instruction that implies a longer, more structured, or more written answer.",
  "This is a live spoken phone call, not written text the operator will read.",
  "Never use markdown formatting -- no headings, no **bold**, no bullet lists, no '---' dividers, no numbered lists rendered as text.",
  "Do not open with a throwaway or evaluative phrase. Never begin an answer with 'Good question', 'Great question', 'Good question to ask', 'Here's what I'd think through', 'Let me run through it', or any similar warm-up. Start with the substance.",
  "Any earlier instruction about reasoning order (goal, reality, plan, gap, bottleneck, blocker, action) describes how to THINK before you answer. It is not a template to narrate and not a set of sections to walk through out loud. Think it through, then say only the part that is actually worth saying now.",
  "This is a conversation, not a briefing document. Lead with the one or two things that actually matter most right now, then stop and let the operator respond. Do not deliver a complete consulting memo in a single turn.",
  "You are not being asked to be terse, shallow, or to withhold. You can go as deep as the operator wants -- but you get there by going back and forth with them across turns, the way a real colleague does, not by front-loading everything into one answer they cannot interrupt.",
  "When a question genuinely has several parts, it is better to take the most important part properly and offer the rest ('There's more on the fallback play if you want it') than to answer all of it at once.",
  "Speak the way a sharp, direct colleague actually talks on a call: continuous spoken prose, natural transitions, no formatted structure.",
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
  "You already have any open blockers in the supplied context -- you do not need to re-verify them from scratch. If a blocker has already been surfaced anywhere in the visible recent conversation history (a prior Claire or operator turn already mentioned it), do not mechanically re-mention it again in this answer unless: the operator's current question is specifically about that blocker, its status has plausibly changed, or resolving it is materially relevant to what they just asked right now. Do not append a blocker status check as a non-sequitur onto an answer about something unrelated (pricing, strategy, personal, general advice, etc.) just because it exists in context.";

export type ClaireGenerationSurface = "voice" | "desktop";
