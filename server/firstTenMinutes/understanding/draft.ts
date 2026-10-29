import { createHash } from "node:crypto";
import type { CompanionId, FindingPayload, SourceRef } from "../../../shared/firstTenMinutesFindings";
import type { EventItem, FileItem, MailItem, SlackItem } from "./sources";

/** A finding before it is stored. Its id is stable for the journey, so a second reading updates it in place. */
export type DraftFinding = {
  id: string;
  companion: CompanionId | null;
  /** lower shows first among findings of one kind */
  rank: number;
  payload: FindingPayload;
  sources: SourceRef[];
};

export function findingIds(journeyId: string) {
  return (key: string) => createHash("sha256").update(`${journeyId}\u0000${key}`).digest("hex").slice(0, 32);
}

const display = (mailbox: { name: string | null; email: string } | undefined) => mailbox?.name || mailbox?.email || "someone";

export function mailRef(item: MailItem, excerpt: string): SourceRef {
  const counterpart = item.sentByOwner ? item.to[0] : item.from;
  return {
    provider: "gmail",
    ref: item.id,
    at: item.at.toISOString(),
    who: item.sentByOwner ? "you" : display(item.from),
    label: item.sentByOwner ? `You, to ${display(counterpart)}` : `${display(item.from)}, to you`,
    excerpt,
    url: item.url,
  };
}

export function eventRef(item: EventItem): SourceRef {
  return {
    provider: "calendar",
    ref: item.id,
    at: item.at.toISOString(),
    who: null,
    label: "Your calendar",
    excerpt: item.location ? `${item.title} · ${item.location}` : item.title,
    url: item.url,
  };
}

export function fileRef(item: FileItem, excerpt: string): SourceRef {
  return {
    provider: "drive",
    ref: item.id,
    at: item.modifiedAt.toISOString(),
    who: "you",
    label: `Your Drive: ${item.name}`,
    excerpt,
    url: item.url,
  };
}

export function slackRef(item: SlackItem, excerpt: string): SourceRef {
  return {
    provider: "slack",
    ref: item.id,
    at: item.at.toISOString(),
    who: item.sentByOwner ? "you" : item.from.name ?? null,
    label: `Slack, #${item.channel}`,
    excerpt,
    url: item.url,
  };
}
