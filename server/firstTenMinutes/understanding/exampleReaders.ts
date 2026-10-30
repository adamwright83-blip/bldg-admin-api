import ninaCorpus from "../../../shared/firstTenMinutesExampleCorpus.json";
import devCorpus from "../../../shared/firstTenMinutesExampleDevCorpus.json";
import type { ExampleKey } from "../../../shared/firstTenMinutesExample";
import type { EventItem, FileItem, Geocoder, MailItem, SourceReaders } from "./sources";
import { looksAutomated, sameAddress, stripQuotedReply } from "./text";

/**
 * The examples, read exactly the way a real account is read: the same item shapes, the same deterministic findings,
 * the same verification of every quote. Only the source is invented (shared/firstTenMinutesExample*Corpus.json).
 */
type Mailbox = { name: string; email: string };
export type ExampleCorpus = {
  owner: Mailbox;
  now: string;
  messages: Array<{
    id: string;
    threadId: string;
    date: string;
    from: Mailbox;
    to: Mailbox[];
    subject: string;
    body: string;
    attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }>;
    bulk?: boolean;
  }>;
  events: Array<{ id: string; summary: string; start: string; end?: string | null; location?: string | null; recurringEventId?: string | null }>;
  files: Array<{ id: string; name: string; mimeType: string; modifiedTime: string; text?: string; md5Checksum?: string }>;
  geocodes: Record<string, { lat: number; lng: number; formatted: string }>;
};

const CORPORA: Record<ExampleKey, ExampleCorpus> = { nina: ninaCorpus, dev: devCorpus };

export function exampleCorpus(key: ExampleKey = "nina"): ExampleCorpus {
  return CORPORA[key];
}

type CorpusMessage = ExampleCorpus["messages"][number];

function mailItem(message: CorpusMessage, corpus: ExampleCorpus): MailItem {
  return {
    provider: "gmail",
    id: message.id,
    threadId: message.threadId,
    at: new Date(message.date),
    from: { name: message.from.name, email: message.from.email },
    to: message.to.map(to => ({ name: to.name, email: to.email })),
    subject: message.subject,
    text: stripQuotedReply(message.body),
    sentByOwner: sameAddress(message.from.email, corpus.owner.email),
    automated: Boolean(message.bulk) || looksAutomated({ from: message.from.email }),
    attachments: message.attachments.map(attachment => ({ ...attachment })),
    url: null,
  };
}

/** Nina and Dev both work in Los Angeles: Pacific time, daylight saving until November 1, 2026. */
function corpusOffsetMinutes(iso: string): number {
  return new Date(iso) < new Date("2026-11-01T09:00:00Z") ? -7 * 60 : -8 * 60;
}

export function localParts(iso: string, offsetMinutes: number): { localDate: string; localTime: string } {
  const shifted = new Date(new Date(iso).getTime() + offsetMinutes * 60_000).toISOString();
  return { localDate: shifted.slice(0, 10), localTime: shifted.slice(11, 16) };
}

export function exampleReaders(corpus: ExampleCorpus = exampleCorpus()): SourceReaders {
  const mail = corpus.messages.map(message => mailItem(message, corpus));
  return {
    async owner() {
      return { name: corpus.owner.name, email: corpus.owner.email };
    },
    async sentMail(limit) {
      return { items: mail.filter(item => item.sentByOwner).slice(-limit), unavailable: null };
    },
    async receivedMail(limit) {
      return { items: mail.filter(item => !item.sentByOwner).slice(-limit), unavailable: null };
    },
    async calendar(window) {
      const items: EventItem[] = corpus.events
        .map(event => ({
          provider: "calendar" as const,
          id: event.id,
          at: new Date(event.start),
          ...localParts(event.start, corpusOffsetMinutes(event.start)),
          end: event.end ? new Date(event.end) : null,
          title: event.summary,
          location: event.location ?? null,
          seriesId: event.recurringEventId ?? null,
          url: null,
        }))
        .filter(event => event.at >= window.from && event.at <= window.to);
      return { items, unavailable: null };
    },
    async drive(limit) {
      const items: FileItem[] = corpus.files.slice(0, limit).map(file => ({
        provider: "drive" as const,
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        modifiedAt: new Date(file.modifiedTime),
        text: typeof file.text === "string" ? file.text : null,
        md5: typeof file.md5Checksum === "string" ? file.md5Checksum : null,
        url: null,
      }));
      return { items, unavailable: null };
    },
    async slack() {
      return { items: [], unavailable: null };
    },
    now() {
      return new Date(corpus.now);
    },
  };
}

export function exampleGeocoder(corpus: ExampleCorpus = exampleCorpus()): Geocoder {
  const table = corpus.geocodes;
  return {
    async geocode(address) {
      return table[address.trim()] ?? null;
    },
  };
}
