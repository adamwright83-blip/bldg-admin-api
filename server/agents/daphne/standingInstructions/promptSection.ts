import { formatInTimeZone } from "date-fns-tz";
import { encouragementGuidance } from "../../../claire/progression/policy";
import { describeReviewWindow, topicLabel } from "./detect";
import type { ReviewWindowPayload, StandingInstructionRecord } from "./types";

export function evaluateReviewWindow(payload: ReviewWindowPayload, now: Date, timeZone: string): "inside" | "outside" {
  const isoDay = Number(formatInTimeZone(now, timeZone, "i")); // 1 = Monday … 7 = Sunday
  if (isoDay % 7 !== payload.weekday) return "outside";
  if (payload.startMinutes == null || payload.endMinutes == null) return "inside";
  const [hour, minute] = formatInTimeZone(now, timeZone, "HH:mm").split(":").map(Number);
  const minutes = hour! * 60 + minute!;
  return minutes >= payload.startMinutes && minutes < payload.endMinutes ? "inside" : "outside";
}

export type StandingInstructionsView = {
  /** Null when no instruction is active. */
  section: string | null;
  /** Topics the operator asked Claire to hold for a later window; not inside it right now. */
  heldTopics: string[];
  /** Topics whose window is open now: Claire raises them on this call. */
  askNowTopics: string[];
  encouragement: boolean;
  roleObligation: boolean;
  records: StandingInstructionRecord[];
};

const asWindow = (record: StandingInstructionRecord) => record.payload as ReviewWindowPayload | null;

export function buildStandingInstructionsView(
  records: readonly StandingInstructionRecord[],
  context: { now: Date; timeZone: string; rapportBand?: 0 | 1 | 2 | 3 }
): StandingInstructionsView {
  const heldTopics = new Set<string>();
  const askNowTopics = new Set<string>();
  const lines: string[] = [];
  let encouragement = false;
  let roleObligation = false;
  for (const record of records) {
    if (record.status !== "active") continue;
    if (record.kind === "encouragement_every_call") {
      encouragement = true;
      lines.push(encouragementGuidance(context.rapportBand ?? 0));
    } else if (record.kind === "review_window") {
      const window = asWindow(record);
      if (!window) continue;
      const state = evaluateReviewWindow(window, context.now, context.timeZone);
      const topics = window.topics.map(topicLabel).join(" and ");
      if (state === "inside") {
        window.topics.forEach(topic => askNowTopics.add(topic));
        lines.push(`REVIEW WINDOW OPEN NOW (${describeReviewWindow(window)}): the operator asked you to raise ${topics} in this window. Raise them on this call.`);
      } else {
        window.topics.forEach(topic => heldTopics.add(topic));
        lines.push(
          `HOLD: the operator asked that ${topics} be raised only on ${describeReviewWindow(window)}. This call is outside that window: do not raise ${topics}, do not list them, and do not say you are holding them. If the operator raises them first, answer.`
        );
      }
    } else if (record.kind === "role_feedback") {
      roleObligation = true;
      lines.push(
        `OBLIGATION (the operator told you on ${record.createdAt.slice(0, 10)} that you are not doing your job, and you accepted it): open this call with the goal and the plan for the day, then ask only for what is missing. Do not wait to be asked what the missions are.`
      );
    } else if (record.kind === "call_rule") {
      lines.push(`RULE: ${record.text}`);
    }
  }
  if (!lines.length) {
    return { section: null, heldTopics: [], askNowTopics: [], encouragement, roleObligation, records: [] };
  }
  const section = [
    "OPERATOR STANDING INSTRUCTIONS. The operator gave these rules in earlier calls; they are saved, read back, and bind every call until revoked. They govern how you behave and what you raise. They are not business facts and never license a claim about what has been sent, scheduled or saved.",
    ...lines,
    "PROMISES: do not promise anything for a later call, such as having something ready or keeping something in front of the operator, unless the server has prepared it and it is listed in this prompt. Do not say you will keep something in mind.",
  ].join(" ");
  return {
    section,
    heldTopics: [...heldTopics],
    askNowTopics: [...askNowTopics],
    encouragement,
    roleObligation,
    records: records.filter(record => record.status === "active"),
  };
}
