/**
 * Work the operator says they are doing goes on the Day Line, under the operator's own authority.
 *
 * 2026-10-23 morning call (conversation f7b1344f): "I have 3 pickups. 2 pickups due by 10AM, and then 1
 * pickup that I can pick up right at 10AM or at noon." The model captured both as commitments dated
 * today, then the replan turned them into a proposed week plan ("Follow up: Two pickups due by 10 AM")
 * behind "Want me to lock that in?". Adam's next words were "so that's 3 orders", not a yes, and the
 * pickups never reached the Day Line.
 *
 * An approval gate protects the operator from Claire rearranging the plan. It does not apply to the
 * operator's own statement of their own work: that is an operator instruction (`claire_turn`), the same
 * admission the Day Line UI uses. Each landed item is read back from the Day Line before it is spoken.
 */
import { createHash } from "node:crypto";
import { addDaysYmd } from "../../analytics/businessPeriods";
import { spokenDay } from "../briefing/briefingTiming";
import { acceptProposalWithReceipt, getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { operatorInstructionAdmission } from "../../planning/dayDirector/dayLineAdmission";
import type { DayDirectorProposal } from "../../../shared/dayDirector";
import type { DebriefDevelopment } from "./showrunnerDebrief";
import { dateFromOperatorWords } from "./showrunnerDebrief";

export type ReportedWorkDeps = {
  accept: typeof acceptProposalWithReceipt;
  readState: typeof getDayDirectorState;
};

export type LandedWork = { title: string; businessDate: string; verified: boolean };

const SELF = /^(?:the\s+)?(?:operator|me|myself|i|you|owner|self)$/i;

/** "Two pickups due by 10 AM" stays itself; "call" + who "Dana" becomes "Call Dana". Never "Follow up: …". */
export function reportedWorkTitle(d: Pick<DebriefDevelopment, "who" | "what" | "place">): string {
  const what = d.what.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "");
  const who = SELF.test(d.who.trim()) ? "" : d.who.trim();
  let title = what || who;
  if (who && what && !what.toLowerCase().includes(who.toLowerCase())) title = `${what} with ${who}`;
  if (d.place.trim() && !title.toLowerCase().includes(d.place.trim().toLowerCase())) title = `${title} at ${d.place.trim()}`;
  return (title.charAt(0).toUpperCase() + title.slice(1)).slice(0, 200);
}

/** A commitment the operator stated for a day Claire can put on the line (today through six days out). */
export function landableCommitments(developments: DebriefDevelopment[], businessDate: string) {
  const last = addDaysYmd(businessDate, 6);
  return developments
    .filter(d => d.kind === "commitment" && (d.what.trim() || d.who.trim()))
    .map(d => {
      const spoken = dateFromOperatorWords(d.operatorWords, businessDate);
      const date = spoken ?? (d.date && d.date >= businessDate && d.date <= last ? d.date : businessDate);
      return { development: d, title: reportedWorkTitle(d), businessDate: date };
    });
}

export async function landReportedCommitments(input: {
  developments: DebriefDevelopment[];
  tenantId: string;
  operatorUserId: string;
  dayDirectorActorId: string;
  dayDirectorActorIds?: string[];
  canonicalOperatorId?: string;
  businessDate: string;
  conversationKey: string;
  sourceEventId: string;
  deps?: Partial<ReportedWorkDeps>;
}): Promise<LandedWork[]> {
  const accept = input.deps?.accept ?? acceptProposalWithReceipt;
  const readState = input.deps?.readState ?? getDayDirectorState;
  const landed: LandedWork[] = [];
  for (const item of landableCommitments(input.developments, input.businessDate)) {
    // Same words on the same call land once, however many turns repeat them.
    const key = createHash("sha256")
      .update(JSON.stringify([input.conversationKey, item.title.toLowerCase(), item.businessDate]))
      .digest("hex")
      .slice(0, 32);
    const proposal: DayDirectorProposal = {
      promptKey: `claire_reported:${key}`,
      title: item.title,
      kind: "operations",
      quantity: null,
      sourceText: item.development.operatorWords.slice(0, 1000) || item.title,
      prerequisites: [],
      question: null,
      intelligence: "manual_fallback",
      detailState: item.development.who.trim() || item.development.place.trim() ? "COMPLETE" : "NEEDS_DETAILS",
      missingDetails: item.development.who.trim() || item.development.place.trim() ? [] : ["who and where"],
      detailNote: null,
      references: [],
      targetBusinessDate: item.businessDate,
    };
    try {
      const { stored } = await accept({
        tenantId: input.tenantId,
        actorId: input.dayDirectorActorId,
        actorIds: input.dayDirectorActorIds,
        businessDate: item.businessDate,
        proposal,
        admission: operatorInstructionAdmission({
          operatorUserId: input.operatorUserId,
          surface: "claire_turn",
          sourceRef: `showrunner:${input.conversationKey}:${input.sourceEventId}`,
        }),
      });
      // Read back before speaking: the item must be open on that day's line.
      const day = await readState({
        tenantId: input.tenantId,
        actorId: input.dayDirectorActorId,
        actorIds: input.dayDirectorActorIds,
        canonicalOperatorId: input.canonicalOperatorId,
        businessDate: item.businessDate,
      });
      const storedId = (stored as { id?: string } | null)?.id;
      const verified = (day.commitments ?? []).some(c => c.status === "open" && (c.id === storedId || c.title === item.title));
      landed.push({ title: item.title, businessDate: item.businessDate, verified });
    } catch (error) {
      console.warn("[Showrunner] reported commitment write failed", error instanceof Error ? error.message : error);
      landed.push({ title: item.title, businessDate: item.businessDate, verified: false });
    }
  }
  return landed;
}

/** "Added to today's Day Line: two pickups due by 10 AM, and one pickup at 10 AM or around noon." */
export function speakLandedWork(landed: LandedWork[], businessDate: string): string {
  if (!landed.length) return "";
  const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`);
  const lines: string[] = [];
  const byDay = new Map<string, string[]>();
  for (const l of landed.filter(l => l.verified)) byDay.set(l.businessDate, [...(byDay.get(l.businessDate) ?? []), lower(l.title)]);
  for (const [date, titles] of byDay) {
    const when = spokenDay(date, businessDate);
    const line = when === "today" || when === "tomorrow" ? `${when}'s Day Line` : `the Day Line for ${when}`;
    lines.push(`Added to ${line}: ${join(titles)}.`);
  }
  const failed = landed.filter(l => !l.verified).map(l => lower(l.title));
  if (failed.length) lines.push(`I couldn't confirm ${join(failed)} on the Day Line, so add ${failed.length === 1 ? "it" : "them"} in the app.`);
  return lines.join(" ");
}
