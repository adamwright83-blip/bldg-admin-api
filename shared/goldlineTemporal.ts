/**
 * What a field sentence says about time, and what kind of claim it is.
 *
 * Two questions live here, and they are deliberately separate:
 *
 *   WHEN   — "Wednesday", "tomorrow", "next week", "Friday afternoon"
 *   WHAT KIND — is this something the operator promised, something a third
 *              party reported, or something the operator was merely musing
 *              about?
 *
 * Conflating them is how a CRM turns a passing thought into a guilt-inducing
 * task, and how "the front desk thinks Sarah is back Wednesday" silently
 * becomes "3:00 PM Wednesday — meeting with Sarah". Goldline must never do
 * either, so both answers carry their own precision and their own uncertainty.
 *
 * This module is pure. It resolves against an anchor date the caller has
 * already expressed in the tenant's timezone, so there is no hidden clock and
 * no hidden locale.
 */

/** How exactly the source pinned the moment down. Never sharpened later. */
export type TemporalPrecision =
  | "none"
  | "window"
  | "day"
  | "daypart"
  /**
   * A specific clock time the source actually stated. Goldline only ever
   * reaches this from an explicit spoken time, never by inference.
   */
  | "time";

export type Daypart = "morning" | "afternoon" | "evening" | "night";

export type TemporalReference = {
  /** The words that produced this, kept verbatim for explanation. */
  sourceText: string;
  precision: TemporalPrecision;
  /** Inclusive local date the reference starts, YYYY-MM-DD, or null. */
  startDate: string | null;
  /** Inclusive local date it ends. Equal to startDate for a single day. */
  endDate: string | null;
  daypart: Daypart | null;
  /** The local date the phrase was anchored against. */
  anchorDate: string;
  /**
   * True when the source hedged — "might", "should", "probably", "maybe".
   * Hedged time never hardens into a commitment, no matter how it is used.
   */
  hedged: boolean;
  /** A claim about a repeating pattern ("he works Thursdays"), not one date. */
  recurring: boolean;
};

/**
 * The six kinds of temporal claim Goldline must tell apart.
 *
 * Only `operator_commitment` and `authoritative_commitment` may ever become an
 * obligation. Everything else is, at most, a reason to look somewhere.
 */
export type TemporalClaimKind =
  /** A third party reported when someone would be available. */
  | "reported_availability"
  /** The operator told another person they would do something. */
  | "operator_commitment"
  /** The operator stated their own plan, but promised no one. */
  | "operator_intent"
  /** The operator mused that something would be a good idea. */
  | "suggested_action"
  /** Something that may or may not be true, and is known to be uncertain. */
  | "uncertain_possibility"
  /** A scheduled pickup, delivery or accepted appointment. */
  | "authoritative_commitment";

export type TemporalClaim = {
  kind: TemporalClaimKind;
  /** The sentence this was read from, kept for "why is this here?". */
  sourceText: string;
  when: TemporalReference | null;
  /** Who the operator promised, when that is what happened. */
  promisedTo: string | null;
  /** What was actually promised or reported, in the source's own words. */
  subject: string;
};

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
] as const;

const DAYPARTS: Array<{ word: RegExp; part: Daypart }> = [
  { word: /\bmorning\b/i, part: "morning" },
  { word: /\bafternoon\b/i, part: "afternoon" },
  { word: /\bevening\b/i, part: "evening" },
  { word: /\btonight\b|\bnight\b/i, part: "night" },
];

/**
 * Words that mark the speaker as unsure. "Should be back Wednesday" is a
 * weaker claim than "is back Wednesday", and the difference has to survive
 * all the way to the world's atmosphere.
 */
const HEDGES =
  /\b(might|maybe|probably|possibly|should be|should|i think|thinks|likely|not sure|unsure|around|sometime|hopefully|guess)\b/i;

/** Date helpers on local YYYY-MM-DD, with no timezone of their own. */
function toParts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

function addDays(date: string, days: number): string {
  const [y, m, d] = toParts(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

function weekdayIndex(date: string): number {
  const [y, m, d] = toParts(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The next occurrence strictly after the anchor, so "Wednesday" never means today. */
function nextWeekday(anchor: string, target: number): string {
  const current = weekdayIndex(anchor);
  const delta = (target - current + 7) % 7;
  return addDays(anchor, delta === 0 ? 7 : delta);
}

function detectDaypart(text: string): Daypart | null {
  for (const entry of DAYPARTS) if (entry.word.test(text)) return entry.part;
  return null;
}

/**
 * Reads the time expression out of a sentence.
 *
 * Everything it cannot read with confidence comes back as `precision: "none"`
 * rather than as a guess. A missing answer is recoverable; an invented
 * Wednesday 3 PM is not.
 */
export function resolveTemporalReference(
  text: string,
  anchorDate: string
): TemporalReference | null {
  const source = text.trim();
  if (!source) return null;

  const base = {
    sourceText: source,
    anchorDate,
    daypart: detectDaypart(source),
    hedged: HEDGES.test(source),
    recurring: false,
  };

  // An explicitly spoken clock time is the only route to "time" precision.
  const clock = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(source);

  // "he works Thursdays", "every Tuesday" — a pattern, not an appointment.
  const recurring = /\b(every|each)\s+(\w+)|(\w+day)s\b/i.exec(source);
  if (recurring && /\b(every|each)\b|\w+days\b/i.test(source)) {
    const dayWord = WEEKDAYS.find(day => new RegExp(`\\b${day}s?\\b`, "i").test(source));
    if (dayWord) {
      return {
        ...base,
        precision: "day",
        recurring: true,
        // A recurring claim resolves to its next instance for relevance, but
        // stays flagged so nothing treats it as a one-off promise.
        startDate: nextWeekday(anchorDate, WEEKDAYS.indexOf(dayWord)),
        endDate: nextWeekday(anchorDate, WEEKDAYS.indexOf(dayWord)),
      };
    }
  }

  if (/\btoday\b|\bthis morning\b|\bthis afternoon\b|\bthis evening\b|\btonight\b/i.test(source)) {
    return { ...base, precision: base.daypart ? "daypart" : "day", startDate: anchorDate, endDate: anchorDate };
  }
  if (/\bday after tomorrow\b/i.test(source)) {
    const day = addDays(anchorDate, 2);
    return { ...base, precision: "day", startDate: day, endDate: day };
  }
  if (/\btomorrow\b/i.test(source)) {
    const day = addDays(anchorDate, 1);
    return { ...base, precision: base.daypart ? "daypart" : "day", startDate: day, endDate: day };
  }
  if (/\bnext week\b/i.test(source)) {
    // A week is a window. Pretending it is a day would be inventing precision.
    return { ...base, precision: "window", startDate: addDays(anchorDate, 7), endDate: addDays(anchorDate, 13) };
  }
  if (/\bthis week\b/i.test(source)) {
    return { ...base, precision: "window", startDate: anchorDate, endDate: addDays(anchorDate, 6) };
  }
  if (/\bnext month\b/i.test(source)) {
    return { ...base, precision: "window", startDate: addDays(anchorDate, 30), endDate: addDays(anchorDate, 60) };
  }

  // An explicit calendar date.
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(source);
  if (iso) {
    const day = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return {
      ...base,
      precision: clock ? "time" : base.daypart ? "daypart" : "day",
      startDate: day,
      endDate: day,
    };
  }

  const dayWord = WEEKDAYS.find(day => new RegExp(`\\b${day}\\b`, "i").test(source));
  if (dayWord) {
    const day = nextWeekday(anchorDate, WEEKDAYS.indexOf(dayWord));
    return {
      ...base,
      precision: clock ? "time" : base.daypart ? "daypart" : "day",
      startDate: day,
      endDate: day,
    };
  }

  // Named future markers Goldline cannot resolve to a date on its own.
  if (/\bafter\s+(labor day|the holiday|the weekend|thanksgiving|christmas|new year)/i.test(source)) {
    return { ...base, precision: "none", startDate: null, endDate: null };
  }

  return null;
}

/**
 * A promise is made to someone. "I told them I'd email Sarah Wednesday" is an
 * obligation; "I should email Sarah Wednesday" is a thought about one.
 */
const COMMITMENT_TO_OTHER =
  /\b(i|we)\s+(told|promised|committed|assured|said to|let)\b|\bi said i(?:'| wou)?l?d\b|\bi'?ll\b(?=[^.]*\b(send|email|call|bring|come|drop|deliver|get)\b)/i;

const INTENT = /\b(i'?m|we'?re|i am|we are)\s+(going|coming|heading|planning|driving)\b|\bi\s+will\s+be\b/i;

const SUGGESTION =
  /\b(i\s+should|we\s+should|should\s+probably|maybe\s+i|i\s+could|worth|it\s+would\s+be\s+good|i\s+need\s+to\s+probably)\b/i;

const REPORTED =
  /\b(they|she|he|front\s?desk|reception|the\s+desk|staff|receptionist|manager|someone)\s+(said|told|mentioned|reported|says|thinks|confirmed)\b|\bwas told\b|\baccording to\b/i;

const UNCERTAIN = /\b(might|may|maybe|possibly|not sure|unsure|could be|perhaps)\b/i;

/** Who the promise was made to, when the sentence names them. */
function extractPromisee(text: string): string | null {
  const match =
    /\bi\s+told\s+(?:the\s+)?([A-Za-z][\w' ]{1,40}?)\s+(?:i|that|we)\b/i.exec(text) ??
    /\b(?:promised|assured)\s+(?:the\s+)?([A-Za-z][\w' ]{1,40}?)\s+(?:i|that|we)\b/i.exec(text);
  return match?.[1]?.trim() ?? null;
}

/**
 * Classifies one sentence.
 *
 * Order matters: a sentence can contain both a report and a promise ("they
 * said she's back Wednesday, I told them I'd email her"), and the operator's
 * own promise is the part that creates an obligation, so it is tested first.
 */
export function classifyTemporalClaim(
  sentence: string,
  anchorDate: string
): TemporalClaim | null {
  const text = sentence.trim();
  if (!text) return null;
  const when = resolveTemporalReference(text, anchorDate);

  const build = (kind: TemporalClaimKind): TemporalClaim => ({
    kind,
    sourceText: text,
    when,
    promisedTo: kind === "operator_commitment" ? extractPromisee(text) : null,
    subject: text,
  });

  if (COMMITMENT_TO_OTHER.test(text)) return build("operator_commitment");
  // A hedge downgrades a plan to a musing even when it is phrased as intent.
  if (SUGGESTION.test(text)) return build("suggested_action");
  if (REPORTED.test(text))
    return build(UNCERTAIN.test(text) ? "reported_availability" : "reported_availability");
  if (INTENT.test(text)) return build("operator_intent");
  if (UNCERTAIN.test(text) && when) return build("uncertain_possibility");
  return when ? build("reported_availability") : null;
}

/** Sentence split that keeps abbreviations and times intact well enough. */
export function splitSentences(transcript: string): string[] {
  return transcript
    .split(/(?<=[.!?])\s+(?=[A-Z])|\n+/)
    .map(part => part.trim())
    .filter(part => part.length > 0);
}

/**
 * Reads a whole transcript into its temporal claims.
 *
 * One sentence may carry a report and a promise at once, so a sentence that
 * contains both is split on the operator's own clause before classification —
 * otherwise the promise would mask the report, and Wednesday would lose the
 * reason the operator is going back at all.
 */
export function classifyTranscriptClaims(
  transcript: string,
  anchorDate: string
): TemporalClaim[] {
  const claims: TemporalClaim[] = [];
  for (const sentence of splitSentences(transcript)) {
    const clauses = sentence.split(/\s*(?:,|;|\band\b)\s*(?=i\s+(?:told|promised|said|assured))/i);
    for (const clause of clauses.length > 1 ? clauses : [sentence]) {
      const claim = classifyTemporalClaim(clause, anchorDate);
      if (claim) claims.push(claim);
    }
  }
  return claims;
}

/** Only these two kinds may ever restrain a building with a tether. */
export function claimCreatesObligation(claim: TemporalClaim): boolean {
  return (
    claim.kind === "operator_commitment" ||
    claim.kind === "authoritative_commitment"
  );
}

/**
 * Whether a claim is worth surfacing on a given local date.
 *
 * Obligations remain relevant from the day they are due onward — an unmet
 * promise does not stop mattering because its date passed. Everything else is
 * relevant only inside the window the source actually described.
 */
export function claimIsRelevantOn(claim: TemporalClaim, date: string): boolean {
  const when = claim.when;
  if (!when?.startDate) return false;
  if (claimCreatesObligation(claim)) return date >= when.startDate;
  const end = when.endDate ?? when.startDate;
  return date >= when.startDate && date <= end;
}

/**
 * Plain-language reason a place surfaced today, for "why is this here?".
 * Deliberately free of internal vocabulary — the player reads this, not a log.
 */
export function describeTemporalClaim(claim: TemporalClaim): string {
  const when = claim.when;
  const timing = !when?.startDate
    ? "at no stated time"
    : when.precision === "window"
      ? `between ${when.startDate} and ${when.endDate}`
      : when.daypart
        ? `${when.startDate} ${when.daypart}`
        : when.startDate;

  switch (claim.kind) {
    case "operator_commitment":
      return `You said you would ${claim.subject.replace(/^.*?\b(i|we)\s+(told|promised|said)[^,]*,?\s*/i, "")} — ${timing}.`;
    case "authoritative_commitment":
      return `A committed appointment on ${timing}.`;
    case "reported_availability":
      return `Reported on site: ${claim.sourceText} (${timing}).`;
    case "operator_intent":
      return `You planned to return ${timing}.`;
    case "suggested_action":
      return `You thought this might be worth doing ${timing}.`;
    case "uncertain_possibility":
      return `Possible, not confirmed: ${claim.sourceText} (${timing}).`;
  }
}

/* ── Validating what the intelligence provider proposes ────────────────────
 *
 * The provider does the language understanding: it reads the messy sentence,
 * the pronouns, the asides, the things no regex will ever handle. This module
 * does not compete with it. It is the gate the provider's answers pass
 * through, and it only ever makes a claim weaker, never stronger.
 *
 * Three things are checked, because these are the three ways a confident
 * model quietly manufactures obligations:
 *
 *   1. A promise must actually read like one in the operator's own words.
 *   2. Precision must be earned by the source, not asserted by the model.
 *   3. A resolved date must agree with the anchor it claims to come from.
 *
 * Anything that fails is downgraded and kept, never dropped — the raw evidence
 * still stands, and uncertainty is preserved rather than resolved by guessing.
 */

/** A claim as the provider proposed it, before validation. */
export type ProposedTemporalClaim = {
  kind: Exclude<TemporalClaimKind, "authoritative_commitment">;
  sourceText: string;
  subject: string;
  promisedTo: string | null;
  when: {
    text: string;
    startDate: string | null;
    endDate: string | null;
    daypart: Daypart | null;
    precision: TemporalPrecision;
    hedged: boolean;
    recurring: boolean;
  } | null;
};

export type ValidatedTemporalClaim = TemporalClaim & {
  /** Every way the proposal was weakened, for audit and explanation. */
  adjustments: string[];
};

/** First-person commitment language. Without it, nothing is a promise. */
const FIRST_PERSON_COMMITMENT =
  /\b(i|we)\s+(told|promised|committed|assured|said)\b|\bi\s+said\s+i(?:'| wou)?l?d\b|\bi'?ll\b|\bi\s+will\b|\bi'?d\b/i;

/**
 * Checks one provider proposal against the contract.
 *
 * Returns a claim that is always safe to project: same words, possibly a
 * weaker kind and possibly a blunter time, never a sharper one.
 */
export function validateProposedClaim(
  proposal: ProposedTemporalClaim,
  anchorDate: string
): ValidatedTemporalClaim {
  const adjustments: string[] = [];
  let kind: TemporalClaimKind = proposal.kind;

  /*
    A model that has decided the operator made a promise must be able to point
    at the operator saying so. Third-party reporting language in the same
    sentence is not enough — that is exactly the confusion this guards.
  */
  if (kind === "operator_commitment" && !FIRST_PERSON_COMMITMENT.test(proposal.sourceText)) {
    kind = REPORTED.test(proposal.sourceText) ? "reported_availability" : "suggested_action";
    adjustments.push(
      "Downgraded from a promise: the operator's own words do not commit to anything."
    );
  }

  let when: TemporalReference | null = null;
  if (proposal.when) {
    // Re-read the time from the operator's words. This is the authority on
    // precision; the provider's own resolution is only a suggestion.
    const derived = resolveTemporalReference(
      proposal.when.text || proposal.sourceText,
      anchorDate
    );

    let precision = proposal.when.precision;
    // Clock precision has to be spoken. A model may not promote a daypart.
    if (precision === "time" && !/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(proposal.sourceText)) {
      precision = derived?.precision ?? "day";
      adjustments.push("No clock time was spoken, so this stays a day, not an appointment.");
    }
    // A hedge in the source outranks a model that decided to be confident.
    const hedged = proposal.when.hedged || HEDGES.test(proposal.sourceText);
    if (hedged && !proposal.when.hedged) {
      adjustments.push("Kept as uncertain: the operator hedged.");
    }

    let startDate = proposal.when.startDate;
    let endDate = proposal.when.endDate ?? proposal.when.startDate;
    if (derived?.startDate && startDate && derived.startDate !== startDate) {
      // The anchor is not negotiable. If the model's date disagrees with what
      // the words resolve to against capture time, the words win.
      startDate = derived.startDate;
      endDate = derived.endDate ?? derived.startDate;
      adjustments.push(
        `Re-anchored to ${derived.startDate} from the words spoken and the capture date.`
      );
    }
    if (!startDate && derived?.startDate) {
      startDate = derived.startDate;
      endDate = derived.endDate;
    }

    when = {
      sourceText: proposal.when.text || proposal.sourceText,
      precision: startDate ? precision : "none",
      startDate,
      endDate: endDate ?? startDate,
      daypart: proposal.when.daypart ?? derived?.daypart ?? null,
      anchorDate,
      hedged,
      recurring: proposal.when.recurring || Boolean(derived?.recurring),
    };
  }

  /*
    A promise with no time is still a promise, but a hedged one is not. "I
    might email her Wednesday" is a thought, however the model labelled it.
  */
  if (kind === "operator_commitment" && when?.hedged && UNCERTAIN.test(proposal.sourceText)) {
    kind = "operator_intent";
    adjustments.push("Downgraded from a promise: the operator hedged the commitment itself.");
  }

  return {
    kind,
    sourceText: proposal.sourceText,
    subject: proposal.subject,
    promisedTo: kind === "operator_commitment" ? proposal.promisedTo : null,
    when,
    adjustments,
  };
}

/**
 * The claims for a transcript, preferring the provider and falling back to
 * deterministic reading only where the provider gave nothing.
 *
 * The fallback exists so a proof run or a provider outage still produces
 * something truthful for plainly-worded sentences. It is not expected to
 * understand arbitrary speech, and it never runs when the provider answered.
 */
export function resolveTranscriptClaims(input: {
  transcript: string;
  anchorDate: string;
  proposed: ProposedTemporalClaim[];
}): ValidatedTemporalClaim[] {
  if (input.proposed.length)
    return input.proposed.map(claim => validateProposedClaim(claim, input.anchorDate));
  return classifyTranscriptClaims(input.transcript, input.anchorDate).map(claim => ({
    ...claim,
    adjustments: ["Read deterministically; no intelligence provider answered."],
  }));
}
