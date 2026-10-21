/**
 * Conversational acts that the surface of a sentence settles on its own.
 *
 * Three production calls (2026-10-18 → 2026-10-20) were misread because these acts
 * had no name in perception:
 *
 *   - "What did you say?" / "You have to repeat yourself." is a REPEAT REQUEST. It is
 *     not a challenge to the correctness of what was said, and it must never reach the
 *     prior-claim adjudicator ("I didn't have enough to state that as fact").
 *   - "I love you, Claire." is a ROMANTIC ADVANCE. It is not a biography probe: Claire
 *     deflects it with the band's authored decline plus an authored pivot, and the
 *     advance is remembered. "I want your encouragement." is a WORK request and must
 *     never reach the decline registry.
 *   - "Do you remember what my goal is?" is a BUSINESS question about the operator's
 *     macro goal, even though it is phrased at Claire. The goal is in the briefing.
 *
 * Perception only DESCRIBES these. Executive Function decides what to do about them.
 */

/** "What did you say", "say that again", "repeat that", "I didn't catch that", "come again". */
const REPEAT_REQUEST =
  /(?:^|\b)(?:what(?:'s| is| was| did)\s+(?:that|you\s+(?:just\s+)?(?:say|said))\b|what\s+did\s+you\s+(?:just\s+)?say\b|say\s+(?:that|it|this)\s+(?:again|once\s+more|one\s+more\s+time)\b|say\s+again\b|repeat\s+(?:that|it|this|yourself|what\s+you\s+(?:just\s+)?said|the\s+last\s+(?:part|bit|thing))\b|(?:you\s+(?:have|need|'ll\s+have|will\s+have|are\s+going)\s+to|please)\s+repeat\b|(?:i\s+)?(?:didn'?t|did\s+not|couldn'?t|could\s+not|don'?t)\s+(?:quite\s+)?(?:catch|hear|get|follow|understand)\s+(?:that|it|you|what\s+you\s+said)\b|(?:i\s+)?(?:don'?t|do\s+not)\s+know\s+what\s+you\s+said\b|(?:i'?m\s+)?asking\s+(?:you\s+)?what\s+you\s+said\b|come\s+again\b|one\s+more\s+time\b|run\s+that\s+by\s+me\s+again\b|(?:say|tell\s+me)\s+(?:that\s+)?(?:last\s+(?:part|bit|thing))\s+again\b)/i;

/**
 * A romantic or personal advance aimed at Claire ("I love you, Claire", "I miss you",
 * "you're gorgeous", "be my girlfriend"). Claire DEFLECTS these, always: the answer is
 * an authored decline for the operator's rapport band plus an authored pivot back to
 * the work, and the advance is remembered as durable game state. It is distinct from a
 * biography probe ("where did you grow up") and from a work request.
 */
const ROMANTIC_ADVANCE =
  /\b(?:i|we)\s+(?:really\s+|do\s+|just\s+|truly\s+|honestly\s+|kind\s+of\s+|sort\s+of\s+)?(?:love|adore|miss|fancy|like)\s+(?:you|ya)\b(?!\s+(?:guys|all|two|both|folks)\b)|\blove\s+(?:you|ya)\b(?!\s+(?:guys|all|two|both|folks)\b)|\b(?:i(?:'ve|\s+have)?\s+(?:got\s+)?(?:a\s+)?crush\s+on\s+you|i(?:'m|\s+am)\s+(?:in\s+love|falling\s+for)\s+(?:with\s+)?you)\b|\b(?:you(?:'re|\s+are)\s+(?:so\s+|really\s+|very\s+)?(?:beautiful|gorgeous|sexy|hot|pretty|cute|stunning|attractive))\b|\b(?:be\s+my\s+(?:girlfriend|wife|valentine|date)|marry\s+me|kiss\s+me|date\s+me|go\s+(?:out\s+)?on\s+a\s+date\s+with\s+me)\b|\b(?:do|would|could|can)\s+you\s+(?:ever\s+)?(?:love|like|fancy|date|kiss|marry)\s+me\b|\b(?:i\s+)?(?:want|wanna|would\s+like|'d\s+like)\s+(?:to\s+)?(?:kiss|date|marry|hold|cuddle)\s+you\b/i;

/**
 * A request for encouragement or support about the work ("I want your encouragement",
 * "give me a pep talk", "cheer me on"). This is a WORK request. It is routed to the
 * composed organ, grounded in the day's record, and never reaches the decline registry.
 */
const ENCOURAGEMENT_REQUEST =
  /\b(?:i|we)\s+(?:want|need|could\s+use|would\s+like|'d\s+like|'d\s+love|'d\s+appreciate)\s+(?:some\s+|a\s+(?:little|bit\s+of)\s+|your\s+)?(?:encouragement|support|a\s+pep\s+talk|reassurance|motivation)\b|\b(?:encourage|motivate|support)\s+me\b|\bcheer\s+me\s+(?:up|on)\b|\bgive\s+me\s+(?:some\s+|a\s+)?(?:encouragement|pep\s+talk|motivation|a\s+boost)\b|\bpep\s+talk\b/i;

/**
 * The operator's macro goal, asked at Claire. "Remember my goal", "what is my goal",
 * "what am I working toward". Business memory, not Claire's biography.
 */
const MACRO_GOAL_QUESTION =
  /\b(?:do\s+you\s+)?(?:remember|recall|know|still\s+know)\b[^?.!]{0,40}\b(?:my|our|the)\s+(?:big\s+|main\s+|macro\s+|weekly\s+|overall\s+)?(?:goal|objective|target|mission)\b|\bwhat(?:'s| is| was)\s+(?:my|our|the)\s+(?:big\s+|main\s+|macro\s+|weekly\s+|overall\s+)?(?:goal|objective|target)\b|\bwhat\s+(?:goal|objective|target)\s+(?:am\s+i|are\s+we)\b|\bwhat\s+(?:am\s+i|are\s+we)\s+(?:working|aiming|going|driving|pushing)\s+(?:toward|towards|for|at)\b|\b(?:remind|tell)\s+me\s+(?:what\s+)?(?:my|our|the)\s+(?:goal|objective|target)\b/i;

export function isRepeatRequest(text: string): boolean {
  return REPEAT_REQUEST.test(text);
}

export function isRomanticAdvance(text: string): boolean {
  return ROMANTIC_ADVANCE.test(text);
}

export function isEncouragementRequest(text: string): boolean {
  return ENCOURAGEMENT_REQUEST.test(text);
}

export function isMacroGoalQuestion(text: string): boolean {
  return MACRO_GOAL_QUESTION.test(text);
}

/** Whether the words even point at Claire. A personal probe that does not is a misread. */
export function addressesClaire(text: string): boolean {
  return /\b(?:you|your|yours|yourself|you'?re|you'?ve|claire)\b/i.test(text);
}
