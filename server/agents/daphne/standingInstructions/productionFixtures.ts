/**
 * Real operator statements from the production audit of calls since 2026-10-13 (read-only).
 * Used as test fixtures: each was spoken, acknowledged by Claire, and then lost.
 */
export const FIXTURE_ENCOURAGEMENT = {
  /** 2026-10-19 evening debrief, session e6c19580. */
  session: "e6c19580",
  priorClaireTurn: "Fifty is attainable if you count buildings.",
  utterance: "I want that on every call.",
  /** The form the audit quoted, naming the thing directly. */
  utteranceNamed: "I want encouragement on every call.",
  claireReplied: "Understood, I'll keep that in mind.",
} as const;

export const FIXTURE_SUNDAY_REVIEW = {
  /** 2026-10-18 pre_drive, session 28e7ee9b. */
  session: "28e7ee9b",
  priorClaireTurn: "The Louise follow-up is overdue. Do you want to deal with it now?",
  utterance:
    "when we do our week call on Sunday from 5 to 7 PM, that's a good time for you to ask me about stuff like that.",
  claireReplied: "Got it. Sunday 5–7 PM for that kind of review. I'll hold it until then.",
} as const;

export const FIXTURE_TOMORROW_VISITS = {
  /** 2026-10-19 evening debrief; the 10-20 morning call (session 80d6bcbb) never carried it. */
  eveningSession: "e6c19580",
  morningSession: "80d6bcbb",
  claireSaid: "Tomorrow morning I'll have the open property visits ready so you can choose one.",
} as const;

export const FIXTURE_CHIEF_OF_STAFF = {
  /** 2026-10-13, session 28727517. Recurred on 2026-10-20. */
  session: "28727517",
  utterance:
    "You're the one who's supposed to be calling me as a chief of staff… telling me what the missions are gonna be each day.",
  claireReplied: "That's on me to fix.",
} as const;
