/**
 * What the crew reads, in one shape whatever the provider. Readers fetch; nothing here decides what anything means.
 * Raw items live only in memory for the length of a run: findings keep short quotes, never the items themselves.
 */
export type Mailbox = { name: string | null; email: string };

export type MailItem = {
  provider: "gmail";
  id: string;
  threadId: string;
  at: Date;
  from: Mailbox;
  to: Mailbox[];
  subject: string;
  /** the person's own words in the message, quoted history removed */
  text: string;
  sentByOwner: boolean;
  /** a newsletter, notification or receipt: never read for findings */
  automated: boolean;
  attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }>;
  url: string | null;
};

export type EventItem = {
  provider: "calendar";
  id: string;
  at: Date;
  /** the event's own calendar day and time (YYYY-MM-DD, HH:MM), as the calendar shows it to the person */
  localDate: string;
  localTime: string;
  end: Date | null;
  title: string;
  location: string | null;
  /** the series an instance belongs to, when it repeats */
  seriesId: string | null;
  url: string | null;
};

export type FileItem = {
  provider: "drive";
  id: string;
  name: string;
  mimeType: string;
  modifiedAt: Date;
  /** a document's text (first part only), when it is a document */
  text: string | null;
  md5: string | null;
  url: string | null;
};

export type SlackItem = {
  provider: "slack";
  id: string;
  at: Date;
  channel: string;
  from: Mailbox;
  text: string;
  sentByOwner: boolean;
  url: string | null;
};

export type Owner = { name: string | null; email: string };

/** Each reader returns what it could read; a source the person didn't grant answers `unavailable`. */
export type ReadResult<T> = { items: T[]; unavailable: string | null };

export interface SourceReaders {
  owner(): Promise<Owner>;
  sentMail(limit: number): Promise<ReadResult<MailItem>>;
  receivedMail(limit: number): Promise<ReadResult<MailItem>>;
  calendar(window: { from: Date; to: Date }): Promise<ReadResult<EventItem>>;
  drive(limit: number): Promise<ReadResult<FileItem>>;
  slack(limit: number): Promise<ReadResult<SlackItem>>;
  /** "now" for this reading: the real clock, or the example's own day */
  now(): Date;
}

export type Geocoded = { lat: number; lng: number; formatted: string };
export interface Geocoder {
  geocode(address: string): Promise<Geocoded | null>;
}

/** How much is read, at most. Enough to know a small business; bounded so a reading stays under two minutes. */
export const READ_LIMITS = {
  sent: 160,
  received: 240,
  driveFiles: 60,
  driveDocs: 12,
  slack: 200,
  calendarPastDays: 90,
  calendarFutureDays: 30,
} as const;
