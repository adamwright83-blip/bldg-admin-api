import type { FindingView } from "../../../shared/firstTenMinutesFindings";
import { findingIds, type DraftFinding } from "../understanding/draft";
import { habitFindings, imageFindings, peopleFindings, routeFindings } from "../understanding/deterministic";
import { exampleGeocoder, exampleReaders } from "../understanding/exampleReaders";
import { exampleExtractor } from "../understanding/extractors";
import { CONVERSATIONS_SYSTEM, conversationCorpus, verifyConversations, verifyWork, workCorpus } from "../understanding/extract";
import { linkOpportunities } from "../understanding/opportunity";
import { placeFindings } from "../understanding/places";
import { mergeDrafts } from "../understanding/run";

/** Nina's example read end to end in memory, exactly as the runner reads it, for tests. */
export async function exampleReading(journeyId = "journey-under-test") {
  const ids = findingIds(journeyId);
  const readers = exampleReaders();
  const extractor = exampleExtractor();
  const owner = await readers.owner();
  const sent = (await readers.sentMail(160)).items;
  const received = (await readers.receivedMail(240)).items;
  const now = readers.now();
  const day = 24 * 60 * 60 * 1000;
  const events = (await readers.calendar({ from: new Date(now.getTime() - 90 * day), to: new Date(now.getTime() + 30 * day) })).items;
  const files = (await readers.drive(60)).items;
  const { corpus, items } = conversationCorpus(sent, received, owner);
  const conversations = verifyConversations(await extractor.conversations({ system: CONVERSATIONS_SYSTEM, corpus }), items, owner, ids);
  let all = mergeDrafts([
    ...peopleFindings(sent, received, owner, ids),
    ...habitFindings(sent, ids),
    ...imageFindings(sent, ids),
    ...routeFindings(events, ids),
    ...conversations,
  ]);
  const work = await extractor.work({ system: "", corpus: workCorpus({ files, slack: [], events, verified: all }) });
  all = mergeDrafts([...all, ...verifyWork(work, { files, slack: [] }, ids)]);
  await placeFindings(all, exampleGeocoder());
  const opportunities = linkOpportunities(all, [], ids);
  return { all, owner, sent, received, items, events, files, opportunities };
}

/** Drafts as the page sees them, every one proposed. */
export function asViews(drafts: DraftFinding[]): FindingView[] {
  return drafts.map(draft => ({ id: draft.id, companion: draft.companion, status: "proposed", payload: draft.payload, sources: draft.sources, correction: null }));
}
