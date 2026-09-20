/**
 * Executive business judgment.
 *
 * A judgment is not a fact and not an action. It is a recommendation bounded by the
 * evidence that was actually retrieved:
 *
 *   current authoritative state  (Business Memory)
 * + what happened before         (Episodic Memory, labelled historical)
 * + scoped priorities            (Goals, advisory)
 * → recommended next move, and why
 *
 * Model-assisted reasoning is allowed INSIDE deterministic governance. A recommender
 * may be injected to phrase or reason; `assertJudgmentGrounded` then rejects any
 * recommendation that introduced a number or a proper name the evidence did not carry.
 * The model may reason over evidence. It may not manufacture it.
 *
 * Nothing here creates work, mutates, or grants authority.
 */

import type { EvidenceItem } from "../contracts/evidence";

export type JudgmentSubject = {
  mention: string;
  contactName: string | null;
  accountId: number | null;
  accountName: string | null;
  /** True when rows could not settle who this is; the judgment must then say so. */
  ambiguous: boolean;
};

export type JudgmentBrief = {
  subject: JudgmentSubject | null;
  temporal: string[];
  /** Authoritative current business truth. */
  current: EvidenceItem[];
  /** Historical observations. Never current truth. */
  history: EvidenceItem[];
  /** Advisory only. */
  goals: EvidenceItem[];
};

export type JudgmentRecommender = (brief: JudgmentBrief) => string | null;

function payloadOf<T>(item: EvidenceItem): T {
  return (item.payload ?? {}) as T;
}

/** The resolution the executive scoped this judgment to, if rows settled one. */
export function subjectFromEvidence(evidence: readonly EvidenceItem[]): JudgmentSubject | null {
  const resolutions = evidence.filter(item => item.id.startsWith("contact_account_resolution:"));
  if (!resolutions.length) return null;
  const settled = resolutions.find(item => {
    const kind = payloadOf<{ resolutionKind?: string }>(item).resolutionKind;
    return kind === "contact" || kind === "account";
  });
  const chosen = settled ?? resolutions[0];
  const payload = payloadOf<{
    mention?: string;
    resolutionKind?: string;
    accountId?: number | null;
    accountName?: string | null;
    contactName?: string | null;
  }>(chosen);
  return {
    mention: payload.mention ?? "",
    contactName: payload.contactName ?? null,
    accountId: payload.accountId ?? null,
    accountName: payload.accountName ?? null,
    ambiguous: payload.resolutionKind !== "contact" && payload.resolutionKind !== "account",
  };
}

export function buildJudgmentBrief(input: {
  evidence: readonly EvidenceItem[];
  temporal: string[];
}): JudgmentBrief {
  const current = input.evidence.filter(item => item.authoritativeFor.includes("current_business_truth"));
  const history = input.evidence.filter(item => item.authoritativeFor.includes("historical_observation"));
  const goals = input.evidence.filter(item => item.authoritativeFor.includes("goal_recommendation"));
  return {
    subject: subjectFromEvidence(input.evidence),
    temporal: input.temporal,
    current,
    history,
    goals,
  };
}

function subjectLabel(subject: JudgmentSubject | null): string {
  if (!subject) return "that";
  if (subject.contactName && subject.accountName) return `${subject.contactName} at ${subject.accountName}`;
  return subject.contactName ?? subject.accountName ?? subject.mention;
}

function historyLine(brief: JudgmentBrief): string | null {
  const latest = [...brief.history].sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
  if (!latest) return null;
  const payload = payloadOf<{ speaker?: string; text?: string; at?: string }>(latest);
  if (!payload.text) return null;
  const day = (payload.at ?? latest.asOf).slice(0, 10);
  const who = payload.speaker === "CLAIRE" ? "I said" : "you said";
  // Explicitly dated and attributed: this is what was SAID then, not what is true now.
  return `On ${day} ${who}: "${payload.text.trim()}"`;
}

function openOrdersLine(brief: JudgmentBrief): string | null {
  const item = brief.current.find(entry => entry.type === "open_orders");
  if (!item) return null;
  const payload = payloadOf<{ openTotal?: number; awaitingPayment?: number }>(item);
  if (typeof payload.openTotal !== "number") return null;
  return `${payload.openTotal} open on the account`;
}

function goalLine(brief: JudgmentBrief): string | null {
  const item = brief.goals[0];
  if (!item) return null;
  const payload = payloadOf<{ title?: string }>(item);
  return payload.title ? `it lines up with ${payload.title}` : null;
}

/**
 * A rules-based recommendation over retrieved evidence.
 *
 * Deliberately conservative: it recommends a next move and states what the move rests
 * on. Where the evidence does not support a move, it says the evidence is thin rather
 * than inventing a confident one.
 */
export function deterministicRecommendation(brief: JudgmentBrief): string {
  const who = subjectLabel(brief.subject);
  const when = brief.temporal[0] ?? null;
  const parts: string[] = [];

  if (brief.subject?.ambiguous) {
    return `I can't pin down which ${brief.subject.mention} you mean from what's on record, so I'd confirm that before doing anything else.`;
  }

  const history = historyLine(brief);
  const open = openOrdersLine(brief);
  const goal = goalLine(brief);

  // What we actually know.
  const known: string[] = [];
  if (open) known.push(open);
  if (history) known.push(history);
  if (known.length) parts.push(`On ${who}: ${known.join(". ")}.`);

  // The recommended move, and what it rests on.
  const timing = when ? ` ${when}` : "";
  if (history && !open) {
    parts.push(`I'd pick that back up${timing} and get it confirmed, since nothing since then shows it landed.`);
  } else if (open) {
    parts.push(`I'd deal with what's open${timing} before starting anything new there.`);
  } else if (brief.current.length) {
    parts.push(`I'd make contact${timing} — the account is on record but there's nothing recent to go on.`);
  } else {
    parts.push(`There's nothing on record for ${who} to base a move on. I'd find that out first.`);
  }
  if (goal) parts.push(`Worth doing because ${goal}.`);

  return parts.join(" ");
}

/** Numbers and capitalised names the evidence actually carried. */
function groundedTokens(brief: JudgmentBrief): { digits: Set<string>; names: Set<string> } {
  const digits = new Set<string>();
  const names = new Set<string>();
  const absorb = (value: unknown): void => {
    if (typeof value === "number") digits.add(String(value));
    else if (typeof value === "string") {
      for (const digit of value.match(/\d[\d,.]*/g) ?? []) digits.add(digit.replace(/[.,]$/, ""));
      for (const name of value.match(/\b[A-Z][a-z]{2,}\b/g) ?? []) names.add(name);
    } else if (Array.isArray(value)) value.forEach(absorb);
    else if (value && typeof value === "object") Object.values(value).forEach(absorb);
  };
  for (const item of [...brief.current, ...brief.history, ...brief.goals]) absorb(item.payload);
  if (brief.subject) {
    for (const value of [brief.subject.mention, brief.subject.contactName, brief.subject.accountName]) {
      for (const name of (value ?? "").match(/\b[A-Z][a-z]{2,}\b/g) ?? []) names.add(name);
    }
  }
  return { digits, names };
}

/** Words a recommendation may use that are not claims about the business. */
const RECOMMENDATION_VOCABULARY = new Set([
  "On", "There", "Worth", "That", "This", "The", "They", "You", "Your", "It", "Its",
  "And", "But", "Since", "Because", "Before", "After", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday", "Sunday", "Today", "Tomorrow", "Yesterday",
  "Nothing", "Something", "Anything",
]);

/**
 * Deterministic governance over model-assisted reasoning.
 *
 * Rejects a recommendation that introduced a number or a proper name the evidence did
 * not contain. Reasoning over evidence is allowed; manufacturing it is not.
 */
export function assertJudgmentGrounded(brief: JudgmentBrief, recommendation: string): void {
  const grounded = groundedTokens(brief);
  for (const digit of recommendation.match(/\d[\d,.]*/g) ?? []) {
    const token = digit.replace(/[.,]$/, "");
    if (!grounded.digits.has(token)) {
      throw new Error(`judgment introduced a number no evidence supports: ${token}`);
    }
  }
  for (const name of recommendation.match(/\b[A-Z][a-z]{2,}\b/g) ?? []) {
    if (RECOMMENDATION_VOCABULARY.has(name)) continue;
    if (!grounded.names.has(name)) {
      throw new Error(`judgment introduced a name no evidence supports: ${name}`);
    }
  }
}

/**
 * Produce a governed recommendation. An injected recommender may reason or phrase;
 * if it fabricates, we fall back to the deterministic one rather than speaking it.
 */
export function recommendOverEvidence(
  brief: JudgmentBrief,
  recommend?: JudgmentRecommender
): { text: string; source: "model" | "deterministic" } {
  if (recommend) {
    try {
      const candidate = recommend(brief);
      if (candidate && candidate.trim()) {
        assertJudgmentGrounded(brief, candidate);
        return { text: candidate.trim(), source: "model" };
      }
    } catch {
      // Fail closed to the grounded recommendation. A fabricating model is not spoken.
    }
  }
  return { text: deterministicRecommendation(brief), source: "deterministic" };
}
