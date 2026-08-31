/**
 * PSYCHOLOGICAL WORLD SIGNALS
 *
 * Six manifestations of UNCERTAINTY around a situation. They are not people, and
 * they never replace one.
 *
 * WHERE THEY COME FROM
 *
 * `shared/impactSignal.ts` describes what DID happen, as a funnel:
 *
 *     observation -> field_activity -> response -> opportunity ->
 *     customer_outcome -> economic_outcome
 *
 * These signals describe what is NOT known. So they live in the GAPS between rungs,
 * which means every trigger is derived from authoritative business state plus
 * elapsed business time — never hand-authored, never ambient, and unit-testable:
 *
 *     field_activity with no response      -> Ghost      (silence)
 *     ...and past this account's own window-> Goblins    (the story about silence)
 *     response recorded, meaning unclear   -> Fog        (ambiguity)
 *     opportunity, no activity, overdue    -> Vines      (avoidance)
 *     a real dated commitment              -> Clock      (real timing pressure)
 *     a mission actively executing         -> Ruinbound  (execution friction)
 *
 * WHAT THEY DO NOT CLAIM
 *
 * A creature represents the Trailblazer's POSSIBLE internal friction around a
 * condition. It does not assert a psychiatric or emotional fact about Adam, and it
 * does not assert a motive about the other person. "STALLER pressure has manifested
 * around this account" is fair. "Jane Smith is The Staller" is not, and no code path
 * here can produce it: a signal is attached to a situation id, never to a person.
 *
 * NO INVENTED DEADLINES. If an account has no observed reply cadence, goblins simply
 * cannot spawn. We do not manufacture an expectation so that a creature has
 * something to be anxious about.
 *
 * NOT GAMEABLE. Every input below is authoritative evidence or elapsed business
 * time. There is deliberately no view count, session count, open count or refetch
 * count in the input type, so opening the same thread fifty times cannot clear a
 * ghost. Only new evidence, a legitimate action, or genuine passage of time can.
 */

export const PSYCH_SIGNALS = [
  "ghost",
  "goblins",
  "fog",
  "vines",
  "clock",
  "ruinbound",
] as const;
export type PsychSignalKind = (typeof PSYCH_SIGNALS)[number];

/** Louder is only ever earned by more evidence or more elapsed time. */
export type SignalIntensity = "faint" | "present" | "insistent";

export type PsychSignal = {
  kind: PsychSignalKind;
  intensity: SignalIntensity;
  /** What real condition produced this. Shown to the operator, never invented. */
  because: string;
  /** How it clears. Never "check it again". */
  clearedBy: string;
};

/**
 * Authoritative inputs only.
 *
 * Note what is absent: anything about how often the operator looked. That absence is
 * the anti-rumination guarantee, enforced by the type rather than by discipline.
 */
export type SignalContext = {
  /** Real outreach that happened, ISO date. */
  lastFieldActivityAt: string | null;
  /** A real reply / reaction from the other side, ISO date. */
  lastResponseAt: string | null;
  /** True once someone has classified what that response actually meant. */
  responseMeaningClassified: boolean;
  /** A concrete next step exists (impact class `opportunity` or stronger). */
  hasOpportunity: boolean;
  /** When the operator's own next legitimate action is due, if a real one exists. */
  nextActionDueAt: string | null;
  /** A real dated commitment: promised callback, scheduled visit, cadence date. */
  commitmentDueAt: string | null;
  /** A mission is in an actively-executing state right now. */
  missionExecuting: boolean;
  /**
   * This account's OWN observed reply window, in days. Null when unknown — and when
   * it is null, goblins cannot spawn. We never invent an expectation.
   */
  expectedReplyDays: number | null;
  /** Does the outcome here actually matter? Silence about nothing is not a ghost. */
  stakesAreReal: boolean;
  /** Business date, ISO. Elapsed time is measured against this, not wall clock. */
  today: string;
};

const DAY = 86_400_000;

function daysBetween(fromIso: string | null, toIso: string): number | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.floor((to - from) / DAY);
}

function scale(days: number, present: number, insistent: number): SignalIntensity {
  if (days >= insistent) return "insistent";
  if (days >= present) return "present";
  return "faint";
}

/**
 * Derive the signals a situation legitimately carries right now.
 *
 * Returns them in a stable order so the world does not reshuffle between renders.
 */
export function deriveSignals(ctx: SignalContext): PsychSignal[] {
  const out: PsychSignal[] = [];

  const sinceActivity = daysBetween(ctx.lastFieldActivityAt, ctx.today);
  const sinceResponse = daysBetween(ctx.lastResponseAt, ctx.today);
  const awaitingReply =
    ctx.lastFieldActivityAt !== null &&
    ctx.stakesAreReal &&
    (ctx.lastResponseAt === null ||
      (sinceResponse !== null &&
        sinceActivity !== null &&
        sinceResponse > sinceActivity));

  // GHOST — real outreach exists, the outcome matters, and no answer has come.
  if (awaitingReply && sinceActivity !== null) {
    out.push({
      kind: "ghost",
      intensity: scale(sinceActivity, 3, 10),
      because: `Reached out ${sinceActivity} day${
        sinceActivity === 1 ? "" : "s"
      } ago and nothing has come back yet.`,
      clearedBy: "A reply, a resolution, or closing the thread.",
    });

    // GOBLINS — only once the silence has outlasted THIS account's own observed
    // window. With no known window there is no expectation to have exceeded, so no
    // goblins. We do not invent a deadline to justify anxiety.
    if (
      ctx.expectedReplyDays !== null &&
      sinceActivity > ctx.expectedReplyDays
    ) {
      const over = sinceActivity - ctx.expectedReplyDays;
      out.push({
        kind: "goblins",
        intensity: scale(over, 2, 7),
        because: `This one usually answers within ${ctx.expectedReplyDays} day${
          ctx.expectedReplyDays === 1 ? "" : "s"
        }. It has been ${sinceActivity}.`,
        clearedBy: "Evidence. Nothing here is a finding yet.",
      });
    }
  }

  // FOG — something came back, but nobody has said what it meant.
  if (ctx.lastResponseAt !== null && !ctx.responseMeaningClassified) {
    out.push({
      kind: "fog",
      intensity: sinceResponse !== null ? scale(sinceResponse, 2, 6) : "faint",
      because: "There was a reply, but what it meant has not been recorded.",
      clearedBy: "Classifying what the response actually was.",
    });
  }

  // VINES — a real next step exists and is overdue. Never when correctly waiting.
  const overdueBy = daysBetween(ctx.nextActionDueAt, ctx.today);
  if (ctx.hasOpportunity && overdueBy !== null && overdueBy > 0) {
    out.push({
      kind: "vines",
      intensity: scale(overdueBy, 2, 7),
      because: `A next step here came due ${overdueBy} day${
        overdueBy === 1 ? "" : "s"
      } ago.`,
      clearedBy: "Doing it — or the path being invalidated.",
    });
  }

  // CLOCK — a real dated commitment, still ahead. Not vague urgency.
  const untilCommitment = ctx.commitmentDueAt === null
    ? null
    : daysBetween(ctx.today, ctx.commitmentDueAt);
  if (untilCommitment !== null && untilCommitment >= 0) {
    out.push({
      kind: "clock",
      intensity: untilCommitment <= 0 ? "insistent" : untilCommitment <= 2 ? "present" : "faint",
      because: `A dated commitment falls in ${untilCommitment} day${
        untilCommitment === 1 ? "" : "s"
      }.`,
      clearedBy: "Doing it, or the window closing.",
    });
  }

  // RUINBOUND — friction of execution, only while actually executing.
  if (ctx.missionExecuting) {
    out.push({
      kind: "ruinbound",
      intensity: "present",
      because: "A mission is being executed right now.",
      clearedBy: "The mission resolving.",
    });
  }

  return out;
}

/** Assets. Real people are never rendered as any of these. */
export const SIGNAL_ART: Record<PsychSignalKind, string> = {
  ghost: "/assets/admin/control-room/signals/ghost.png",
  goblins: "/assets/admin/control-room/signals/goblins.png",
  fog: "/assets/admin/control-room/signals/fog.png",
  vines: "/assets/admin/control-room/signals/vines.png",
  clock: "/assets/admin/control-room/signals/clock-creature.png",
  ruinbound: "/assets/admin/control-room/signals/ruinbound.png",
};

export const SIGNAL_LABEL: Record<PsychSignalKind, string> = {
  ghost: "Unanswered",
  goblins: "A story about the silence",
  fog: "Unclear",
  vines: "Overgrown",
  clock: "Dated commitment",
  ruinbound: "In execution",
};
