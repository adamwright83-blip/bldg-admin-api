import corpus from "../../../shared/firstTenMinutesExampleCorpus.json";
import type { EventItem, FileItem, Geocoder, MailItem, SourceReaders } from "./sources";
import { looksAutomated, sameAddress, stripQuotedReply } from "./text";

/**
 * Nina's example, read exactly the way a real account is read: the same item shapes, the same deterministic
 * findings, the same verification of every quote. Only the source is invented (shared/firstTenMinutesExampleCorpus.json).
 */
type CorpusMessage = (typeof corpus.messages)[number];

function mailItem(message: CorpusMessage): MailItem {
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

/** Nina works in Los Angeles: Pacific time, daylight saving until November 1, 2026. */
function corpusOffsetMinutes(iso: string): number {
  return new Date(iso) < new Date("2026-11-01T09:00:00Z") ? -7 * 60 : -8 * 60;
}

export function localParts(iso: string, offsetMinutes: number): { localDate: string; localTime: string } {
  const shifted = new Date(new Date(iso).getTime() + offsetMinutes * 60_000).toISOString();
  return { localDate: shifted.slice(0, 10), localTime: shifted.slice(11, 16) };
}

export function exampleReaders(): SourceReaders {
  const mail = corpus.messages.map(mailItem);
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
        text: "text" in file && typeof file.text === "string" ? file.text : null,
        md5: "md5Checksum" in file && typeof file.md5Checksum === "string" ? file.md5Checksum : null,
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

export function exampleGeocoder(): Geocoder {
  const table = corpus.geocodes as Record<string, { lat: number; lng: number; formatted: string }>;
  return {
    async geocode(address) {
      return table[address.trim()] ?? null;
    },
  };
}
