import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { FindingPayload, FindingView } from "../../../shared/firstTenMinutesFindings";
import {
  DRAFT_APPROACHES,
  LETTER_STEPS,
  approachesFor,
  chapterKind,
  chapterTitle,
  composeDraft,
  composeEstimateDraft,
  traysProblem,
  type ChapterCard,
  type ChapterOpportunity,
  type ChapterView,
  type DraftApproach,
  type DraftView,
  type EstimateTrays,
  type LetterStep,
} from "../../../shared/firstTenMinutesChapter";
import { suggestionRules } from "../../../shared/firstTenMinutesCrew";
import { journeyEvents, recordEvent } from "../events";
import { firstTenDb, setJourneyStage, type JourneyRow } from "../store";
import { firstTenDrafts } from "../schema";
import { understandingView } from "../understanding/view";

/**
 * The first chapter of a journey: the opportunity the crew found (with the findings it rests on), how far the person
 * has played, and the real draft at the writing table. The draft is composed only from those findings; the person's
 * own edits are kept as theirs. Nothing here sends anything.
 */
type Of<K extends FindingPayload["kind"]> = FindingView & { payload: Extract<FindingPayload, { kind: K }> };
const live = (finding: FindingView | undefined) => Boolean(finding && finding.status !== "dismissed" && finding.status !== "changed");

function card(finding: FindingView, quote: string, at: string): ChapterCard {
  return { findingId: finding.id, quote, at, sources: finding.sources };
}

/** The strongest opportunity still standing, with the findings it rests on, or null. */
export function chapterOpportunity(findings: readonly FindingView[]): ChapterOpportunity | null {
  const byId = new Map(findings.map(finding => [finding.id, finding]));
  const opportunity = findings.find((finding): finding is Of<"opportunity"> => finding.payload.kind === "opportunity" && live(finding));
  if (!opportunity) return null;
  const linked = <K extends FindingPayload["kind"]>(id: string | null, kind: K) => {
    const finding = id ? byId.get(id) : undefined;
    return finding && live(finding) && finding.payload.kind === kind ? (finding as Of<K>) : null;
  };
  const request = linked(opportunity.payload.requestId, "request");
  if (!request) return null;
  const reply = linked(opportunity.payload.replyId, "reply");
  const service = linked(opportunity.payload.serviceId, "service");
  const route = linked(opportunity.payload.routeId, "route");
  const place = linked(opportunity.payload.placeId, "place");
  const estimate = linked(opportunity.payload.estimateId ?? null, "estimate");
  const scope = linked(opportunity.payload.scopeId ?? null, "scope");
  const person = request.payload.from;
  return {
    id: opportunity.id,
    type: opportunity.payload.type,
    person: { name: person.name, address: person.address },
    firstName: person.name?.trim().split(/\s+/)[0] || null,
    request: { ...card(request, request.payload.quote, request.payload.at), wants: request.payload.wants, subject: request.payload.subject },
    reply: reply ? { ...card(reply, reply.payload.quote, reply.payload.at), missing: reply.payload.missing } : null,
    service: service ? { ...card(service, service.payload.quote, service.payload.at), name: service.payload.name } : null,
    route: route
      ? {
          findingId: route.id,
          weekday: route.payload.weekday,
          title: route.payload.title,
          stops: route.payload.stops.map(stop => ({ label: stop.label, lat: stop.lat, lng: stop.lng })),
        }
      : null,
    place: place
      ? { findingId: place.id, name: place.payload.name, category: place.payload.category, lat: place.payload.lat, lng: place.payload.lng }
      : null,
    along: opportunity.payload.along,
    estimate: estimate
      ? {
          findingId: estimate.id,
          title: estimate.payload.title,
          client: estimate.payload.client,
          areas: estimate.payload.areas,
          at: estimate.payload.at,
          sources: estimate.sources,
        }
      : null,
    scope: scope ? { ...card(scope, scope.payload.quote, scope.payload.at), first: scope.payload.first, later: scope.payload.later } : null,
  };
}

/** The message at the table, composed for the chapter it belongs to. The estimate's needs the person's trays. */
function composeFor(opportunity: ChapterOpportunity, approach: DraftApproach, now: Date, trays: EstimateTrays | null): { subject: string; body: string } | null {
  if (approach === "focused" || approach === "question") return trays ? composeEstimateDraft(opportunity, approach, trays) : null;
  return composeDraft(opportunity, approach, now);
}

async function draftRow(journeyId: string) {
  const db = await firstTenDb();
  const [row] = await db.select().from(firstTenDrafts).where(eq(firstTenDrafts.journeyId, journeyId)).limit(1);
  return row ?? null;
}

function draftView(
  row: NonNullable<Awaited<ReturnType<typeof draftRow>>>,
  opportunity: ChapterOpportunity | null,
  now: Date,
  trays: EstimateTrays | null
): DraftView {
  return {
    approach: row.approach,
    to: { name: row.recipientName, address: row.recipientAddress },
    subject: row.subject,
    body: row.body,
    edited: row.edited,
    status: row.status,
    handedOffAt: row.handedOffAt?.toISOString() ?? null,
    reportedSentAt: row.reportedSentAt?.toISOString() ?? null,
    verifiedSentAt: row.verifiedSentAt?.toISOString() ?? null,
    approaches: opportunity
      ? approachesFor(opportunity).flatMap(approach => {
          const composed = composeFor(opportunity, approach, now, trays);
          return composed ? [{ approach, body: composed.body }] : [];
        })
      : [],
  };
}

export async function chapterView(journey: JourneyRow, now = new Date()): Promise<ChapterView> {
  const reading = await understandingView(journey.id);
  const opportunity = chapterOpportunity(reading.findings);
  const events = await journeyEvents(journey.id);
  const steps = new Set<LetterStep>();
  let revealed = false;
  let letterWritten = false;
  let trays: EstimateTrays | null = null;
  for (const event of events) {
    if (event.kind === "chapter_revealed") revealed = true;
    if (event.kind === "letter_written") letterWritten = true;
    const step = (event.payloadJson as { step?: string } | null)?.step;
    if (event.kind === "letter_step" && LETTER_STEPS.includes(step as LetterStep)) steps.add(step as LetterStep);
    if (event.kind === "estimate_arranged") {
      const arranged = event.payloadJson as Partial<EstimateTrays> | null;
      if (Array.isArray(arranged?.thisJob) && Array.isArray(arranged?.later)) trays = { thisJob: arranged.thisJob, later: arranged.later };
    }
  }
  const row = await draftRow(journey.id);
  return {
    opportunity,
    kind: chapterKind(opportunity),
    title: chapterTitle(opportunity),
    closedDays: suggestionRules(reading.findings).closedDays,
    progress: { revealed, steps: LETTER_STEPS.filter(step => steps.has(step)), letterWritten, trays },
    draft: row ? draftView(row, opportunity, now, trays) : null,
  };
}

/** How far the person has played: each beat is recorded once, in the order played. */
export async function recordChapterStep(journey: JourneyRow, step: "revealed" | LetterStep | "letter_written"): Promise<ChapterView> {
  const view = await chapterView(journey);
  if (!view.opportunity) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There's no conversation to pick up yet." });
  if (step === "revealed") {
    if (!view.progress.revealed) await recordEvent(journey.id, "chapter_revealed", { opportunityId: view.opportunity.id });
  } else if (step === "letter_written") {
    if (view.progress.steps.length !== LETTER_STEPS.length) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Hazel requires a proper response. In ink. With a quill." });
    }
    if (!view.progress.letterWritten) await recordEvent(journey.id, "letter_written", {});
  } else {
    // a step counts only in its turn, as in the courtyard (reunionQuests.applyStepItem)
    const expected = LETTER_STEPS[view.progress.steps.length];
    if (!view.progress.steps.includes(step)) {
      if (step !== expected) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Not yet." });
      await recordEvent(journey.id, "letter_step", { step });
    }
  }
  if (journey.stage === "portrait") await setJourneyStage(journey.id, "chapter");
  return chapterView(journey);
}

/**
 * The estimate on the cart: every room on one of the two trays, something on each. The arrangement is the person's
 * and is kept; the cart fits through the arch only once the scope is separated, and nothing is taken out.
 */
export async function arrangeEstimate(journey: JourneyRow, trays: EstimateTrays): Promise<ChapterView> {
  const view = await chapterView(journey);
  if (!view.opportunity || view.kind !== "scope") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There's no estimate on the cart." });
  const problem = traysProblem(view.opportunity, trays);
  if (problem) throw new TRPCError({ code: "BAD_REQUEST", message: problem });
  if (view.draft) throw new TRPCError({ code: "CONFLICT", message: "The estimate has already gone through the arch." });
  await recordEvent(journey.id, "estimate_arranged", { thisJob: trays.thisJob, later: trays.later });
  return chapterView(journey);
}

/**
 * "Now. Yours." The draft at the writing table, composed from the findings: Rook's message once the old request is on
 * today's route, Hazel's once the letter is written, or the estimate once it fits through the arch.
 */
export async function prepareDraft(journey: JourneyRow, now = new Date(), approach?: DraftApproach): Promise<ChapterView> {
  const view = await chapterView(journey, now);
  if (!view.opportunity) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "There's no conversation to pick up yet." });
  if (!view.draft) {
    const first: DraftApproach = view.kind === "scope" ? "focused" : "still_wanted";
    const chosen = approach && approachesFor(view.opportunity).includes(approach) ? approach : first;
    const composed = composeFor(view.opportunity, chosen, now, view.progress.trays);
    if (!composed) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "It still won't fit through the arch." });
    const db = await firstTenDb();
    await db
      .insert(firstTenDrafts)
      .values({
        journeyId: journey.id,
        opportunityId: view.opportunity.id,
        recipientName: view.opportunity.person.name,
        recipientAddress: view.opportunity.person.address,
        subject: composed.subject,
        body: composed.body,
        approach: chosen,
        edited: false,
        status: "prepared",
      })
      .onDuplicateKeyUpdate({ set: { journeyId: journey.id } });
    await recordEvent(journey.id, "draft_prepared", { opportunityId: view.opportunity.id, approach: chosen, to: view.opportunity.person.address });
  }
  if (journey.stage === "chapter" || journey.stage === "portrait") await setJourneyStage(journey.id, "table");
  return chapterView(journey, now);
}

/**
 * "Try another way" (a different approach, composed afresh) or the person's own words. A declined draft is prepared
 * again by any change. Only a draft still at the table can change: one handed off is out of JOYSTICK's hands.
 */
export async function changeDraft(
  journey: JourneyRow,
  change: { approach?: DraftApproach; body?: string },
  now = new Date()
): Promise<ChapterView> {
  const view = await chapterView(journey, now);
  if (!view.opportunity || !view.draft) throw new TRPCError({ code: "NOT_FOUND", message: "There's no draft at the table." });
  if (view.draft.status !== "prepared" && view.draft.status !== "declined") {
    throw new TRPCError({ code: "CONFLICT", message: "This message has already left the table." });
  }
  const approach = change.approach ?? view.draft.approach;
  if (!approachesFor(view.opportunity).includes(approach)) throw new TRPCError({ code: "BAD_REQUEST", message: "That's not a way this message can go." });
  const composed = composeFor(view.opportunity, approach, now, view.progress.trays)?.body ?? view.draft.body;
  // the person's words when they gave them; a new approach composed afresh; otherwise the message as it stands
  const body = change.body?.trim() ? change.body.trim() : change.approach ? composed : view.draft.body;
  const db = await firstTenDb();
  await db
    .update(firstTenDrafts)
    .set({ approach, body, edited: body !== composed, status: "prepared" })
    .where(eq(firstTenDrafts.journeyId, journey.id));
  await recordEvent(journey.id, "draft_changed", { approach, edited: body !== composed });
  return chapterView(journey, now);
}

/** "Not now": the person decided against it. Kept as their decision; nothing is sent. */
export async function declineDraft(journey: JourneyRow, now = new Date()): Promise<ChapterView> {
  const view = await chapterView(journey, now);
  if (!view.draft) throw new TRPCError({ code: "NOT_FOUND", message: "There's no draft at the table." });
  if (view.draft.status === "prepared") {
    const db = await firstTenDb();
    await db.update(firstTenDrafts).set({ status: "declined" }).where(eq(firstTenDrafts.journeyId, journey.id));
    await recordEvent(journey.id, "draft_declined", { approach: view.draft.approach });
  }
  return chapterView(journey, now);
}
