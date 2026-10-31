import { randomUUID } from "node:crypto";
import type { UnderstandingStage, UnderstandingView } from "../../../shared/firstTenMinutesFindings";
import type { FindingOrigin } from "../schema";
import { type DraftFinding, findingIds } from "./draft";
import { habitFindings, imageFindings, imageOrigin, ownerFindings, peopleFindings, rhythmFindings, routeFindings } from "./deterministic";
import {
  CONVERSATIONS_SYSTEM,
  WORK_SYSTEM,
  conversationCorpus,
  verifyConversations,
  verifyWork,
  workCorpus,
  type Extractor,
  type WorkExtraction,
} from "./extract";
import { linkOpportunities } from "./opportunity";
import { placeFindings } from "./places";
import { READ_LIMITS, type Geocoder, type ReadResult, type SourceReaders } from "./sources";
import { claimReading, finishReading, saveFindings, updateReading } from "./store";

/**
 * The crew's reading of one journey, in three stages, each the real work its line names:
 *   people         "Meeting the people you write to."                      sent mail, the person's name, people,
 *                                                                           habits, images
 *   conversations  "Following the conversations you keep coming back to."  the email reading (one model call)
 *   work           "Finding the work already in motion."                   calendar, Drive, Slack, routes, rhythms,
 *                                                                           places, opportunities (one model call)
 * Findings are stored as soon as they are verified, so names reach the screen while the reading goes on.
 * A source that can't be read becomes a plain note; the reading carries on without it.
 */
export type ReadingDeps = {
  readers: SourceReaders;
  extractor: Extractor;
  geocoder: Geocoder;
  /**
   * The business investigation (server/businessKnowledge), when JOYSTICK_ONBOARDING_INTELLIGENCE is on for this
   * person's own journey: it reconstructs the dated picture before anything is concluded, and says what has gone
   * quiet, so the chapter never leads to work the person no longer does. `heartbeat` keeps the reading's lease.
   */
  investigate?: (heartbeat: () => Promise<void>) => Promise<{ quietTerms: string[]; notes: string[] }>;
};

export const READING_NOTES = {
  conversations: "Some of your conversations couldn't be read closely just now. What's here came from the rest.",
  work: "Your documents and calendar couldn't be read closely just now. What's here came from the rest.",
  failed: "Your crew couldn't finish reading. Nothing was changed anywhere; you can try again.",
  investigation: "Your crew couldn't look into everything just now. What's here came from the rest.",
} as const;

/** An opportunity built on a request about work that has gone quiet or is past isn't offered: it would lead to work
 * the person may no longer do. Matched on the request's own words. */
export function aboutQuietWork(opportunity: DraftFinding, findings: readonly DraftFinding[], quietTerms: readonly string[]): boolean {
  if (opportunity.payload.kind !== "opportunity" || !quietTerms.length) return false;
  const request = findings.find(finding => finding.id === (opportunity.payload as { requestId: string }).requestId);
  const text = JSON.stringify([request?.payload ?? null, opportunity.payload]).toLowerCase();
  return quietTerms.some(term => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(text));
}

/** Same id twice (a service found in an email and in a document): one finding, both sources. */
export function mergeDrafts(drafts: DraftFinding[]): DraftFinding[] {
  const merged = new Map<string, DraftFinding>();
  for (const draft of drafts) {
    const existing = merged.get(draft.id);
    if (!existing) {
      merged.set(draft.id, { ...draft, sources: [...draft.sources] });
      continue;
    }
    for (const source of draft.sources) {
      if (!existing.sources.some(known => known.provider === source.provider && known.ref === source.ref)) existing.sources.push(source);
    }
  }
  return [...merged.values()];
}

async function attempt<T>(read: () => Promise<ReadResult<T>>, notes: string[]): Promise<T[]> {
  try {
    const result = await read();
    if (result.unavailable) notes.push(result.unavailable);
    return result.items;
  } catch (error) {
    console.warn("[FirstTen] a source couldn't be read:", error instanceof Error ? error.name : "unknown");
    return [];
  }
}

export async function runReading(journeyId: string, runId: string, deps: ReadingDeps): Promise<"complete" | "failed"> {
  const ids = findingIds(journeyId);
  const counts: UnderstandingView["counts"] = { sent: 0, received: 0, events: 0, files: 0, slack: 0 };
  const notes: string[] = [];
  const finished: UnderstandingStage[] = [];
  const origins = new Map<string, FindingOrigin>();
  let all: DraftFinding[] = [];
  // Store what was just found, merged with anything found earlier under the same id (a rule in an email and again in
  // a document keeps both sources).
  const keep = async (drafts: DraftFinding[]) => {
    all = mergeDrafts([...all, ...drafts]);
    const touched = new Set(drafts.map(draft => draft.id));
    await saveFindings(journeyId, runId, all.filter(draft => touched.has(draft.id)), origins);
  };

  try {
    const owner = await deps.readers.owner();

    // ---------------------------------------------------------------- people
    await updateReading(journeyId, runId, { stage: "people" });
    const sent = await attempt(() => deps.readers.sentMail(READ_LIMITS.sent), notes);
    counts.sent = sent.length;
    await updateReading(journeyId, runId, { counts });
    const received = await attempt(() => deps.readers.receivedMail(READ_LIMITS.received), notes);
    counts.received = received.length;
    const images = imageFindings(sent, ids);
    for (const image of images) {
      if (image.payload.kind !== "image") continue;
      const origin = imageOrigin(sent, image.payload.fileName);
      if (origin) origins.set(image.id, { provider: "gmail", ...origin });
    }
    await keep([...ownerFindings(sent, owner, ids), ...peopleFindings(sent, received, owner, ids), ...habitFindings(sent, ids), ...images]);
    finished.push("people");

    // ---------------------------------------------------------------- conversations
    await updateReading(journeyId, runId, { stage: "conversations", finished, counts });
    const { corpus, items } = conversationCorpus(sent, received, owner);
    if (items.length) {
      try {
        const extraction = await deps.extractor.conversations({ system: CONVERSATIONS_SYSTEM, corpus });
        await keep(verifyConversations(extraction, items, owner, ids));
      } catch (error) {
        console.warn("[FirstTen] the email reading failed:", error instanceof Error ? error.message.slice(0, 120) : "unknown");
        notes.push(READING_NOTES.conversations);
      }
    }
    finished.push("conversations");

    // ---------------------------------------------------------------- work in motion
    await updateReading(journeyId, runId, { stage: "work", finished, counts, notes });
    const now = deps.readers.now();
    const day = 24 * 60 * 60 * 1000;
    const events = await attempt(
      () => deps.readers.calendar({ from: new Date(now.getTime() - READ_LIMITS.calendarPastDays * day), to: new Date(now.getTime() + READ_LIMITS.calendarFutureDays * day) }),
      notes
    );
    const files = await attempt(() => deps.readers.drive(READ_LIMITS.driveFiles), notes);
    const slack = await attempt(() => deps.readers.slack(READ_LIMITS.slack), notes);
    counts.events = events.length;
    counts.files = files.length;
    counts.slack = slack.length;
    await updateReading(journeyId, runId, { counts });
    await keep([...routeFindings(events, ids), ...rhythmFindings(events, ids)]);

    let proposals: WorkExtraction["opportunities"] = [];
    const hasWork = files.some(file => file.text) || slack.length > 0 || events.length > 0;
    if (hasWork || all.length) {
      try {
        const extraction = await deps.extractor.work({ system: WORK_SYSTEM, corpus: workCorpus({ files, slack, events, verified: all }) });
        await keep(verifyWork(extraction, { files, slack }, ids));
        proposals = extraction.opportunities;
      } catch (error) {
        console.warn("[FirstTen] the work reading failed:", error instanceof Error ? error.message.slice(0, 120) : "unknown");
        notes.push(READING_NOTES.work);
      }
    }
    let quiet: string[] = [];
    if (deps.investigate) {
      try {
        quiet = (await deps.investigate(() => updateReading(journeyId, runId, {}))).quietTerms;
      } catch (error) {
        console.warn("[FirstTen] the investigation failed:", error instanceof Error ? error.name : "unknown");
        notes.push(READING_NOTES.investigation);
      }
    }
    await placeFindings(all, deps.geocoder);
    await keep(linkOpportunities(all, proposals, ids).filter(opportunity => !aboutQuietWork(opportunity, all, quiet)));
    // places and routes gained coordinates: store them again in place
    await saveFindings(journeyId, runId, all.filter(draft => draft.payload.kind === "place" || draft.payload.kind === "route"), origins);
    finished.push("work");
    await updateReading(journeyId, runId, { finished, counts });
    await finishReading(journeyId, runId, "complete", notes);
    return "complete";
  } catch (error) {
    console.warn("[FirstTen] the reading failed:", error instanceof Error ? error.name : "unknown");
    await finishReading(journeyId, runId, "failed", [...notes, READING_NOTES.failed]).catch(() => undefined);
    return "failed";
  }
}

/**
 * Begin (or rejoin) the reading for a journey. Returns at once; the reading runs in this server process and writes
 * its progress as it goes. A reading whose server went away is taken over after its lease lapses.
 */
export async function beginReading(
  journeyId: string,
  deps: () => Promise<ReadingDeps>,
  options: { again?: boolean } = {}
): Promise<{ started: boolean }> {
  const runId = randomUUID();
  if (!(await claimReading(journeyId, runId, { again: Boolean(options.again) }))) return { started: false };
  void (async () => {
    try {
      await runReading(journeyId, runId, await deps());
    } catch {
      await finishReading(journeyId, runId, "failed", [READING_NOTES.failed]).catch(() => undefined);
    }
  })();
  return { started: true };
}
