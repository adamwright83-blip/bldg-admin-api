import {
  claireAnswer,
  firstChapterEntry,
  firstChapterQuestion,
  replyExcerpt,
  type FirstChapterView,
  type ReplyState,
} from "../../../shared/firstTenMinutesFirstChapter";
import { verifyDraft } from "../activation/activation";
import { chapterView } from "../chapter/chapter";
import { journeyEvents, recordEvent } from "../events";
import { setJourneyStage, type JourneyRow } from "../store";
import { googleAccessFor } from "../understanding/deps";
import { gmailReader } from "../understanding/googleReaders";

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

/** Has the recipient written since the message went? Read from the person's own mail, when it can be. */
async function replyState(journey: JourneyRow, address: string, since: string | null): Promise<ReplyState> {
  if (!since) return { kind: "unknown" };
  const access = await googleAccessFor(journey);
  if (!access) return { kind: "unknown" };
  try {
    const [first] = await gmailReader(access).receivedFrom(address, new Date(new Date(since).getTime() - 60_000));
    if (!first) return { kind: "none" };
    return { kind: "replied", at: first.at.toISOString(), excerpt: replyExcerpt(first.text) };
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

/** Claire answers, from the records as they are now. The answer is kept, so she remembers what she said. */
export async function askClaire(journey: JourneyRow, timeZone: string | null): Promise<FirstChapterView | null> {
  const before = await chapterView(journey);
  if (!before.opportunity || !before.draft) return null;
  const pending = before.draft.status === "handed_off" || before.draft.status === "reported_sent";
  const lookedInSent = pending ? await lookInSent(journey) : false;
  const chapter = pending ? await chapterView(journey) : before;
  const draft = chapter.draft!;
  const sent = draft.status === "reported_sent" || draft.status === "verified_sent";
  const reply = sent ? await replyState(journey, draft.to.address, draft.verifiedSentAt ?? draft.reportedSentAt ?? draft.handedOffAt) : ({ kind: "unknown" } as const);
  const answer = claireAnswer(chapter.opportunity!, draft, reply, { timeZone, lookedInSent });
  await recordEvent(journey.id, "claire_answered", {
    question: firstChapterQuestion(chapter.opportunity!),
    answer,
    draftStatus: draft.status,
    reply: reply.kind,
  });
  return firstChapterView(journey);
}
