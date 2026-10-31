import { TRPCError } from "@trpc/server";
import type { DraftView } from "../../../shared/firstTenMinutesChapter";
import type { FindingView } from "../../../shared/firstTenMinutesFindings";
import {
  checkClaireAnswer,
  firstChapterEntry,
  firstChapterFacts,
  firstChapterQuestion,
  knownTimeZone,
  replyExcerpt,
  type AnswerProblem,
  type FirstChapterFacts,
  type FirstChapterView,
  type ReplyState,
} from "../../../shared/firstTenMinutesFirstChapter";
import { assertAiSpendAvailable, trackModelUsage } from "../../agents/costTracking";
import { ClaireToolTurnError, openClaireFirstChapterSession } from "../../claire/prototype/claireToolLoop";
import { latestOnSubject, verifyDraft } from "../activation/activation";
import { chapterView } from "../chapter/chapter";
import { journeyEvents, recordEvent } from "../events";
import { setJourneyStage, type JourneyRow } from "../store";
import { googleAccessFor } from "../understanding/deps";
import { gmailReader } from "../understanding/googleReaders";
import { understandingView } from "../understanding/view";

/**
 * "Your first chapter": a new entry on the person's portrait, from what actually happened, and Claire's answer to
 * "Where did we leave things with Elena?". The answer is composed from the records alone; whether the recipient has
 * written back is read from the person's own mail, and said only when it was read.
 */
export async function firstChapterView(journey: JourneyRow): Promise<FirstChapterView | null> {
  const chapter = await chapterView(journey);
  if (!chapter.opportunity || !chapter.draft) return null;
  const answered = [...(await journeyEvents(journey.id))].reverse().find(event => event.kind === "claire_answered");
  const said = (answered?.payloadJson as { answer?: unknown } | null)?.answer;
  return {
    entry: firstChapterEntry(chapter.opportunity, chapter.draft),
    question: firstChapterQuestion(chapter.opportunity),
    answer: answered && typeof said === "string" ? { text: said, at: answered.createdAt.toISOString() } : null,
  };
}

/**
 * Has the recipient written back about this message since it went? Read from the person's own mail: a reply on the
 * message's subject is a reply, and the newest is where things stand. Other mail from them since is neither a reply
 * nor proof there isn't one.
 */
async function replyState(journey: JourneyRow, draft: DraftView): Promise<ReplyState> {
  const since = draft.verifiedSentAt ?? draft.reportedSentAt ?? draft.handedOffAt;
  if (!since) return { kind: "unknown" };
  const access = await googleAccessFor(journey);
  if (!access) return { kind: "unknown" };
  try {
    const mail = await gmailReader(access).receivedFrom(draft.to.address, new Date(new Date(since).getTime() - 60_000));
    const reply = latestOnSubject(mail, draft.subject);
    if (reply) return { kind: "replied", at: reply.at.toISOString(), excerpt: replyExcerpt(reply.text) };
    return mail.length ? { kind: "unknown" } : { kind: "none" };
  } catch {
    return { kind: "unknown" };
  }
}

/** The person returns to their portrait: the journey is in its first chapter. */
export async function openFirstChapter(journey: JourneyRow): Promise<FirstChapterView | null> {
  const view = await firstChapterView(journey);
  if (!view) return null;
  if (journey.stage !== "first_chapter") {
    await setJourneyStage(journey.id, "first_chapter");
    await recordEvent(journey.id, "first_chapter_opened", {});
  }
  return view;
}

/** Look in the person's Sent folder for a message that has left the table but isn't known to have gone. */
async function lookInSent(journey: JourneyRow): Promise<boolean> {
  try {
    if (!(await googleAccessFor(journey))) return false;
    await verifyDraft(journey);
    return true;
  } catch {
    return false;
  }
}

/** "Ask again" reads the records afresh, but this is a page, not a chat: at most this many answers per journey. */
const MOST_ANSWERS = 12;

const cannotAnswer = () => new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Claire can't answer that properly right now." });

function named(findings: readonly FindingView[], kind: "business" | "owner"): string | null {
  const finding = findings.find(item => item.payload.kind === kind && item.status !== "dismissed" && item.status !== "changed");
  return finding && "name" in finding.payload ? (finding.payload as { name: string }).name : null;
}

const READ_FIRST = "[page check: this note is from the page, not from the person] Call read_first_chapter, then answer from what it shows alone.";

/** What didn't hold, for Claire to write the answer again from what she read. */
function restatement(problems: readonly AnswerProblem[]): string {
  return `[page check: this note is from the page, not from the person] Some of what you wrote isn't what read_first_chapter shows: ${problems
    .map(problem => `“${problem.text}”`)
    .join("; ")}. Write the answer again from it alone: quote exactly, and say only what it shows.`;
}

/**
 * Claire answers on the person's page, through her engine (server/claire/prototype): she reads the first chapter as it
 * stands now (looking in the Sent folder again when the message has left the table) and writes the answer. What she
 * writes is checked against what she read: she may write it once more, and an answer that still doesn't hold is not
 * shown. The answer is kept with what it rests on, so she remembers what she said.
 */
export async function askClaire(
  journey: JourneyRow,
  timeZone: string | null,
  deps: { open: typeof openClaireFirstChapterSession } = { open: openClaireFirstChapterSession }
): Promise<FirstChapterView | null> {
  const before = await chapterView(journey);
  if (!before.opportunity || !before.draft) return null;
  const asked = (await journeyEvents(journey.id)).filter(event => event.kind === "claire_answered" || event.kind === "claire_unanswered").length;
  if (asked >= MOST_ANSWERS) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Claire has answered this. Tomorrow, we'll pick up from here." });
  const attribution = `first_ten:${journey.id}`;
  await assertAiSpendAvailable(attribution).catch(() => {
    throw cannotAnswer();
  });

  const zone = knownTimeZone(timeZone);
  const question = firstChapterQuestion(before.opportunity);
  let facts: FirstChapterFacts | null = null;
  let reading: Promise<FirstChapterFacts> | null = null;
  const readFirstChapter = () =>
    (reading ??= (async () => {
      const pending = before.draft!.status === "sending" || before.draft!.status === "handed_off" || before.draft!.status === "reported_sent";
      const lookedInSent = pending ? await lookInSent(journey) : false;
      const chapter = pending ? await chapterView(journey) : before;
      const draft = chapter.draft ?? before.draft!;
      const out = draft.status === "reported_sent" || draft.status === "verified_sent";
      const reply = out ? await replyState(journey, draft) : ({ kind: "unknown" } as const);
      facts = firstChapterFacts(chapter.opportunity ?? before.opportunity!, draft, reply, { timeZone: zone, lookedInSent });
      return facts;
    })());

  const findings = (await understandingView(journey.id)).findings;
  const usage = { input: 0, output: 0, model: null as string | null };
  let answer = "";
  let problems: AnswerProblem[] = [];
  try {
    const session = await deps.open({ personName: named(findings, "owner"), businessName: named(findings, "business"), question, timeZone: zone, readFirstChapter });
    usage.model = session.model;
    const turn = async (utterance: string) => {
      const result = await session.turn(utterance);
      usage.input += result.inputTokens;
      usage.output += result.outputTokens;
      answer = result.speak.trim();
      problems = facts ? checkClaireAnswer(answer, facts) : [];
    };
    await turn(question);
    // once more, if she answered without reading or wrote what the records don't hold
    if (!facts || problems.length) await turn(facts ? restatement(problems) : READ_FIRST);
  } catch (error) {
    if (error instanceof ClaireToolTurnError) {
      usage.input += error.inputTokens;
      usage.output += error.outputTokens;
    }
    await recordEvent(journey.id, "claire_unanswered", { question, reason: "Claire's engine failed" });
    throw cannotAnswer();
  } finally {
    if (usage.input || usage.output) {
      await trackModelUsage({ tenantId: attribution, modelUsed: usage.model, inputTokens: usage.input, outputTokens: usage.output, feature: "first_ten_claire" }).catch(() => undefined);
    }
  }
  // an answer that didn't read the records, or still says what they don't, is not shown
  if (!facts || !answer || problems.length) {
    await recordEvent(journey.id, "claire_unanswered", { question, reason: !facts ? "she didn't read the first chapter" : "the answer didn't hold", problems });
    throw cannotAnswer();
  }
  await recordEvent(journey.id, "claire_answered", { question, answer, facts, model: usage.model });
  return firstChapterView(journey);
}
