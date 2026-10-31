import type { ActivityStatus, AssertionBasis, EntityKind, EvidenceProvider, TimelineKind, TimelineSignal } from "../../shared/businessKnowledge";
import type { ResearchSource } from "../firstTenMinutes/research/coverage";

/**
 * Chronology before conclusions. Given everything dated about one business, brand, product or project, decide
 * whether it is current, in preparation, dormant, past, abandoned, unknown or in conflict, and say why. Pure and
 * deterministic: the same timeline and coverage always give the same answer.
 *
 * The rules this file exists to keep:
 *  - A file's modification time is never proof of activity (signal "metadata" never counts).
 *  - A lack of email is never proof that something ended. Quiet after the last activity reads as "dormant" (may have
 *    stopped) only when the quiet period was actually searched successfully; otherwise "unknown".
 *  - "Abandoned" and "historical" need someone to have said so: the person, or a source stating it explicitly.
 *  - A product or project with recent development but no verified launch or sale is "prelaunch", never "active
 *    business", and no launch date, revenue or customer is implied.
 *  - The person's own answer is the status. Later owner activity that contradicts it is reported as a conflict, kept
 *    beside it, and never replaces it.
 */

export const CHRONOLOGY = {
  /** activity this recent makes something current */
  activeDays: 90,
  /** quiet this long, searched, makes something possibly dormant */
  dormantDays: 120,
  /** an explicit status statement this recent is taken as current */
  statementDays: 150,
} as const;

const DAY = 86_400_000;

export type ChronologyEvent = {
  id: string;
  kind: TimelineKind;
  signal: TimelineSignal;
  occurredAt: Date;
  evidenceId: string;
  provider: EvidenceProvider;
  summary: string;
};

/** A status a source states explicitly ("Status: prelaunch", "we closed the shop in May"), with its evidence. */
export type ObservedStatus = { status: ActivityStatus; at: Date; evidenceIds: string[]; summary: string };

export type UserStatus = { status: ActivityStatus; at: Date; detail: string | null; basis: AssertionBasis };

export interface CoverageView {
  covered(source: ResearchSource, from: Date, to: Date): boolean;
}

export type StatusDecision = {
  status: ActivityStatus;
  basis: AssertionBasis;
  confidence: number;
  rationale: string;
  lastActivityAt: Date | null;
  evidenceIds: string[];
  /** the person's answer stands, but newer evidence disagrees: what the evidence alone would say */
  conflict: { status: ActivityStatus; rationale: string; evidenceIds: string[] } | null;
};

const counts = (event: ChronologyEvent) => event.signal === "owner_action" || event.signal === "counterpart_action";
const isProductLike = (kind: EntityKind) => kind === "product" || kind === "project";
const day = (date: Date) => date.toISOString().slice(0, 10);
const newest = (events: readonly ChronologyEvent[], n = 4) => [...events].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, n);

function researchSourceOf(provider: EvidenceProvider): ResearchSource | null {
  return provider === "user" ? null : provider;
}

/** What the evidence alone says. */
export function inferStatus(input: {
  kind: EntityKind;
  events: readonly ChronologyEvent[];
  observed: readonly ObservedStatus[];
  coverage: CoverageView;
  now: Date;
}): Omit<StatusDecision, "conflict"> {
  const { now } = input;
  const activity = input.events.filter(counts);
  const metadataOnly = input.events.filter(event => event.signal === "metadata");
  const last = newest(activity, 1)[0] ?? null;
  const lastAt = last?.occurredAt ?? null;
  const recentStatement = [...input.observed].sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
  const statementFresh = recentStatement && now.getTime() - recentStatement.at.getTime() <= CHRONOLOGY.statementDays * DAY;
  const sold = activity.some(event => (event.kind === "sale" || event.kind === "launch") && event.signal === "owner_action");
  const later = (date: Date) => activity.filter(event => event.occurredAt > date);

  // an explicit statement of an ending wins over silence, but not over activity after it
  if (recentStatement && (recentStatement.status === "historical" || recentStatement.status === "abandoned")) {
    const after = later(recentStatement.at);
    if (after.length) {
      return {
        status: "conflicting",
        basis: "inferred",
        confidence: 50,
        rationale: `A source said this ended (${recentStatement.summary}, ${day(recentStatement.at)}), but there is activity after that, most recently on ${day(newest(after, 1)[0].occurredAt)}.`,
        lastActivityAt: lastAt,
        evidenceIds: [...recentStatement.evidenceIds, ...newest(after, 2).map(event => event.evidenceId)],
      };
    }
    return {
      status: recentStatement.status,
      basis: "observed",
      confidence: 75,
      rationale: `A source says so: ${recentStatement.summary} (${day(recentStatement.at)}).`,
      lastActivityAt: lastAt,
      evidenceIds: recentStatement.evidenceIds,
    };
  }

  if (!last) {
    if (statementFresh && recentStatement) {
      return { status: recentStatement.status, basis: "observed", confidence: 60, rationale: `A source says: ${recentStatement.summary} (${day(recentStatement.at)}).`, lastActivityAt: null, evidenceIds: recentStatement.evidenceIds };
    }
    return {
      status: "unknown",
      basis: "inferred",
      confidence: 20,
      rationale: metadataOnly.length
        ? "Only file activity was found (a file changed), which on its own isn't evidence that this work is happening."
        : "It is mentioned, but no dated activity was found.",
      lastActivityAt: null,
      evidenceIds: newest(input.events, 2).map(event => event.evidenceId),
    };
  }

  const age = now.getTime() - last.occurredAt.getTime();
  const recent = activity.filter(event => now.getTime() - event.occurredAt.getTime() <= CHRONOLOGY.activeDays * DAY);

  if (age <= CHRONOLOGY.activeDays * DAY) {
    const ids = newest(recent).map(event => event.evidenceId);
    if (isProductLike(input.kind) && !sold) {
      const preparing = recent.filter(event => event.kind === "planning" || event.kind === "launch_preparation" || event.kind === "document" || event.kind === "spreadsheet" || event.kind === "meeting");
      return {
        status: "prelaunch",
        basis: statementFresh && recentStatement?.status === "prelaunch" ? "observed" : "inferred",
        confidence: preparing.length >= 2 ? 80 : 60,
        rationale: `Recent development and planning (most recently ${day(last.occurredAt)}), and no verified launch or sale.`,
        lastActivityAt: last.occurredAt,
        evidenceIds: ids,
      };
    }
    if (statementFresh && recentStatement?.status === "prelaunch" && !sold) {
      return { status: "prelaunch", basis: "observed", confidence: 70, rationale: `Recent activity, and a source says it hasn't launched: ${recentStatement.summary}.`, lastActivityAt: last.occurredAt, evidenceIds: [...recentStatement.evidenceIds, ...ids].slice(0, 6) };
    }
    const owner = recent.filter(event => event.signal === "owner_action");
    return {
      status: "active",
      basis: "inferred",
      confidence: owner.length >= 3 ? 85 : owner.length ? 70 : 55,
      rationale: `The owner's own recent activity: ${owner.length || recent.length} dated item${(owner.length || recent.length) === 1 ? "" : "s"} in the last ${CHRONOLOGY.activeDays} days, most recently on ${day(last.occurredAt)}.`,
      lastActivityAt: last.occurredAt,
      evidenceIds: ids,
    };
  }

  // quiet since the last activity: was the quiet searched?
  const from = new Date(last.occurredAt.getTime() + DAY);
  const sources = [...new Set(activity.map(event => researchSourceOf(event.provider)).filter((source): source is ResearchSource => Boolean(source)))];
  const searched = sources.filter(source => input.coverage.covered(source, from, now));
  const unsearched = sources.filter(source => !searched.includes(source));
  const evidenceIds = newest(activity, 3).map(event => event.evidenceId);
  if (searched.length && !unsearched.length && age >= CHRONOLOGY.dormantDays * DAY) {
    const docsChecked = input.coverage.covered("drive", from, now);
    return {
      status: "dormant",
      basis: "inferred",
      confidence: docsChecked ? 65 : 50,
      rationale: `The last ${last.kind === "proposal" ? "proposal" : "activity"} was on ${day(last.occurredAt)}; ${searched.join(" and ")} from then until now ${searched.length === 1 ? "was" : "were"} searched and nothing comparable came up. That suggests it may be paused, not that it ended.${docsChecked ? "" : " Recent documents weren't checked for it."}`,
      lastActivityAt: last.occurredAt,
      evidenceIds,
    };
  }
  if (unsearched.length) {
    return {
      status: "unknown",
      basis: "inferred",
      confidence: 25,
      rationale: `The last activity was on ${day(last.occurredAt)}, and ${unsearched.join(" and ")} after that couldn't be searched completely, so its silence says nothing.`,
      lastActivityAt: last.occurredAt,
      evidenceIds,
    };
  }
  return {
    status: "unknown",
    basis: "inferred",
    confidence: 35,
    rationale: `The last activity was on ${day(last.occurredAt)}; it has been quiet since, but not long enough to call it paused.`,
    lastActivityAt: last.occurredAt,
    evidenceIds,
  };
}

/** The status to hold: the person's answer when there is one (with any newer disagreement), otherwise the evidence. */
export function decideStatus(input: {
  kind: EntityKind;
  events: readonly ChronologyEvent[];
  observed: readonly ObservedStatus[];
  user: UserStatus | null;
  coverage: CoverageView;
  now: Date;
}): StatusDecision {
  const inferred = inferStatus(input);
  if (!input.user) return { ...inferred, conflict: null };
  const user = input.user;
  // only evidence newer than the answer can disagree with it; activity contradicts "it ended", silence contradicts
  // nothing
  const newer = input.events.filter(event => counts(event) && event.signal === "owner_action" && event.occurredAt > user.at);
  const ended = user.status === "historical" || user.status === "abandoned" || user.status === "dormant";
  const conflict =
    ended && newer.length
      ? {
          status: "active" as const,
          rationale: `You said this was ${user.status === "dormant" ? "paused" : "over"}, but there is newer activity: most recently on ${day(newest(newer, 1)[0].occurredAt)}.`,
          evidenceIds: newest(newer, 3).map(event => event.evidenceId),
        }
      : null;
  return {
    status: user.status,
    basis: user.basis,
    confidence: 100,
    rationale: user.detail ? `You said so: "${user.detail}"` : "You said so.",
    lastActivityAt: inferred.lastActivityAt,
    evidenceIds: inferred.evidenceIds,
    conflict,
  };
}
