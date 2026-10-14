/**
 * Daphne mission-presentation adjustments.
 *
 * An overdue, still-open Day Line item is evidence of unresolved work, not
 * proof of an intentional skip. The operator's own explanation is the only
 * input that can produce an adjustment, and adjustments change presentation
 * only: title, objective, business date, destination and navigation stay as
 * recorded. Nothing here raises immersion; the only style change is "plain".
 */

export type DaphneMissionAdjustment =
  | { kind: "timing"; window: "morning" | "afternoon" | "evening" }
  | { kind: "task_size"; firstStepOnly: true }
  | { kind: "reveal_timing"; reveal: "evening_before" }
  | { kind: "delivery_channel"; channel: "text" | "call" }
  | { kind: "presentation_style"; style: "plain" };

export type DaphneExplanationReason =
  | DaphneMissionAdjustment["kind"]
  | "blocked"
  | "unclassified";

export type DaphneExplanationClassification = {
  reason: DaphneExplanationReason;
  /** "explicit": the operator said it. "hypothesis": inferred, never applied. */
  epistemic: "explicit" | "hypothesis";
  adjustment: DaphneMissionAdjustment | null;
};

export type DaphneMissionPresentation = {
  adjustment: DaphneMissionAdjustment;
  note: string;
  sourceObservationId: string;
  missionType: string;
};

export type DaphneMissionFollowUp = {
  commitmentId: string;
  businessDate: string;
  title: string;
  missionType: string;
  question: string;
};

const MISSION_TYPE_LABELS: Record<string, string> = {
  retention: "customer recovery mission",
  account_acquisition: "new-account mission",
  continue_existing: "growth mission",
  territory_expansion: "territory mission",
  relationship_capital: "relationship mission",
  reputation: "reputation mission",
  digital_presence: "online presence mission",
  alliance: "partnership mission",
  investigation: "investigation",
  customer_recovery: "customer recovery mission",
  commercial_follow_up: "follow-up mission",
  unfinished_growth_work: "growth mission",
  proactive_obligation: "promised follow-through",
  campaign_library: "campaign mission",
  strategy_diagnosis: "strategy mission",
  growth: "growth mission",
  prep: "prep task",
  operations: "operations task",
};

export function missionTypeLabel(missionType: string): string {
  return MISSION_TYPE_LABELS[missionType] ?? "mission";
}

export function missionFollowUpQuestion(missionType: string): string {
  return `What happened with that ${missionTypeLabel(missionType)}?`;
}

const has = (text: string, re: RegExp) => re.test(text);

/** Classifies only what the operator explicitly said. Unknown stays unknown. */
export function classifyMissionExplanation(
  answer: string
): DaphneExplanationClassification {
  const t = answer.toLowerCase();
  const explicit = (
    reason: DaphneExplanationReason,
    adjustment: DaphneMissionAdjustment | null
  ): DaphneExplanationClassification => ({ reason, epistemic: "explicit", adjustment });
  if (has(t, /\b(rain|sick|ill|car|truck|flat tire|closed|emergency|no one (was )?(home|there)|locked out|weather)\b/))
    return explicit("blocked", null);
  if (has(t, /\b(too much (story|game|fantasy)|just tell me|plain|skip the (story|game)|less (story|game))\b/))
    return explicit("presentation_style", { kind: "presentation_style", style: "plain" });
  if (has(t, /\b(too (much|big|long)|overwhelm|huge|too many|didn'?t know where to start)\b/))
    return explicit("task_size", { kind: "task_size", firstStepOnly: true });
  if (has(t, /\b(text me|by text|sms|send (me )?a text)\b/))
    return explicit("delivery_channel", { kind: "delivery_channel", channel: "text" });
  if (has(t, /\b(call me|phone me|give me a call)\b/))
    return explicit("delivery_channel", { kind: "delivery_channel", channel: "call" });
  if (has(t, /\b(didn'?t see it|saw it too late|night before|evening before|didn'?t know (about it|it was))\b/))
    return explicit("reveal_timing", { kind: "reveal_timing", reveal: "evening_before" });
  if (has(t, /\b(too early|mornings? (are|is) (bad|rough|busy))\b/))
    return explicit("timing", { kind: "timing", window: "afternoon" });
  if (has(t, /\b(too late|ran out of (time|day)|end of (the )?day|afternoons? (are|is) (bad|busy)|by the afternoon)\b/))
    return explicit("timing", { kind: "timing", window: "morning" });
  if (has(t, /\b(evenings? (work|are) better|after work|at night)\b/))
    return explicit("timing", { kind: "timing", window: "evening" });
  return { reason: "unclassified", epistemic: "hypothesis", adjustment: null };
}

export function describeMissionAdjustment(a: DaphneMissionAdjustment): string {
  switch (a.kind) {
    case "timing":
      return `Suggested for the ${a.window}: that's when you said this kind of work fits.`;
    case "task_size":
      return "Start with the first step only; the full objective is unchanged.";
    case "reveal_timing":
      return "Previewed the evening before so it isn't a surprise.";
    case "delivery_channel":
      return `Reminder by ${a.channel === "text" ? "text" : "phone call"}.`;
    case "presentation_style":
      return "Shown plainly, without story framing.";
  }
}

export function parseMissionAdjustment(value: unknown): DaphneMissionAdjustment | null {
  const v = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!v) return null;
  if (v.kind === "timing" && ["morning", "afternoon", "evening"].includes(v.window as string))
    return { kind: "timing", window: v.window as "morning" | "afternoon" | "evening" };
  if (v.kind === "task_size" && v.firstStepOnly === true) return { kind: "task_size", firstStepOnly: true };
  if (v.kind === "reveal_timing" && v.reveal === "evening_before")
    return { kind: "reveal_timing", reveal: "evening_before" };
  if (v.kind === "delivery_channel" && (v.channel === "text" || v.channel === "call"))
    return { kind: "delivery_channel", channel: v.channel };
  if (v.kind === "presentation_style" && v.style === "plain")
    return { kind: "presentation_style", style: "plain" };
  return null;
}
