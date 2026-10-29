import type { PersonRef, RouteStop } from "../../../shared/firstTenMinutesFindings";
import { type DraftFinding, eventRef, mailRef } from "./draft";
import type { EventItem, MailItem, Owner } from "./sources";
import { closingSentence, sameAddress } from "./text";

/**
 * Findings that need no model: counted, never interpreted. People the person writes to, a habit in their own sent
 * mail, an image they keep sending, and the work their calendar repeats on one weekday.
 */
type Ids = (key: string) => string;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The people the person writes to most, from their own sent mail. */
export function peopleFindings(sent: MailItem[], received: MailItem[], owner: Owner, ids: Ids): DraftFinding[] {
  const people = new Map<string, { person: PersonRef; sent: number; received: number; lastAt: Date; lastSent: MailItem }>();
  for (const item of sent) {
    if (item.automated) continue;
    for (const to of item.to) {
      if (sameAddress(to.email, owner.email)) continue;
      const key = to.email.toLowerCase();
      const entry = people.get(key) ?? { person: { name: to.name, address: key }, sent: 0, received: 0, lastAt: item.at, lastSent: item };
      entry.sent += 1;
      if (!entry.person.name && to.name) entry.person.name = to.name;
      if (item.at >= entry.lastAt) {
        entry.lastAt = item.at;
        entry.lastSent = item;
      }
      people.set(key, entry);
    }
  }
  for (const item of received) {
    const entry = people.get(item.from.email.toLowerCase());
    if (!entry || item.automated) continue;
    entry.received += 1;
    if (!entry.person.name && item.from.name) entry.person.name = item.from.name;
    if (item.at > entry.lastAt) entry.lastAt = item.at;
  }
  return [...people.values()]
    .sort((a, b) => b.sent + b.received - (a.sent + a.received) || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, 12)
    .map((entry, index) => ({
      id: ids(`person:${entry.person.address}`),
      companion: null,
      rank: index,
      payload: { kind: "person", person: entry.person, sent: entry.sent, received: entry.received, lastAt: entry.lastAt.toISOString() },
      sources: [mailRef(entry.lastSent, entry.lastSent.subject || entry.person.address)],
    }));
}

/**
 * Rook: how the person tends to finish. Counted over their own sent mail; shown only when it is most of their mail
 * and there are real examples to show, written to different people.
 */
export function habitFindings(sent: MailItem[], ids: Ids): DraftFinding[] {
  const endings = sent
    .filter(item => !item.automated)
    .map(item => ({ item, ending: closingSentence(item.text) }))
    .filter((entry): entry is { item: MailItem; ending: string } => Boolean(entry.ending) && entry.ending!.split(/\s+/).length >= 2);
  if (endings.length < 4) return [];
  const questions = endings.filter(entry => entry.ending.endsWith("?"));
  const share = questions.length / endings.length;
  if (share < 0.5 || questions.length < 3) return [];
  const examples: Array<{ item: MailItem; ending: string }> = [];
  for (const entry of [...questions].sort((a, b) => a.ending.length - b.ending.length)) {
    if (entry.ending.split(/\s+/).length > 9) continue;
    if (examples.some(example => example.ending === entry.ending || sameAddress(example.item.to[0]?.email, entry.item.to[0]?.email))) continue;
    examples.push(entry);
    if (examples.length === 2) break;
  }
  if (examples.length < 2) return [];
  return [
    {
      id: ids("habit:ends_with_question"),
      companion: "rook",
      rank: 0,
      payload: {
        kind: "habit",
        habit: "ends_with_question",
        examples: examples.map(example => example.ending),
        share: Math.round(share * 100) / 100,
        sampled: endings.length,
      },
      sources: examples.map(example => mailRef(example.item, example.ending)),
    },
  ];
}

const CAMERA_NAME = /^(img|dsc|dscn|pxl|photo|image|screenshot|whatsapp image|scan)[\s_-]?\d*/i;

export function plainImageName(fileName: string): string | null {
  const stem = fileName.replace(/\.[a-z0-9]{2,5}$/i, "");
  if (CAMERA_NAME.test(stem) || /^\d+$/.test(stem)) return null;
  const words = stem.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.length >= 3 && words.length <= 40 ? words.toLowerCase() : null;
}

/** Luma: an image the person keeps attaching to what they send. */
export function imageFindings(sent: MailItem[], ids: Ids): DraftFinding[] {
  const groups = new Map<string, { fileName: string; mimeType: string; items: MailItem[] }>();
  for (const item of sent) {
    for (const attachment of item.attachments) {
      if (!attachment.mimeType.startsWith("image/")) continue;
      const key = `${attachment.filename.toLowerCase()}:${attachment.size}`;
      const group = groups.get(key) ?? { fileName: attachment.filename, mimeType: attachment.mimeType, items: [] };
      if (!group.items.some(existing => existing.id === item.id)) group.items.push(item);
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .filter(([, group]) => group.items.length >= 2)
    .sort((a, b) => b[1].items.length - a[1].items.length)
    .slice(0, 3)
    .map(([key, group], index) => {
      const proposals = group.items.filter(item => /proposal|quote|estimate/i.test(item.subject)).length;
      return {
        id: ids(`image:${key}`),
        companion: "luma" as const,
        rank: index,
        payload: {
          kind: "image" as const,
          name: plainImageName(group.fileName),
          fileName: group.fileName,
          uses: group.items.length,
          mimeType: group.mimeType,
          inWhat: proposals >= 2 ? ("proposals" as const) : ("emails" as const),
        },
        sources: group.items.map(item => mailRef(item, group.fileName)),
      };
    });
}

/** Where an image finding's picture is, for the server to show it to the person who owns it. */
export function imageOrigin(sent: MailItem[], fileName: string): { messageId: string; attachmentId: string } | null {
  for (const item of [...sent].reverse()) {
    const attachment = item.attachments.find(candidate => candidate.filename === fileName);
    if (attachment) return { messageId: item.id, attachmentId: attachment.attachmentId };
  }
  return null;
}

function weekdayOf(localDate: string): number {
  return new Date(`${localDate}T12:00:00Z`).getUTCDay();
}

/** "Friday delivery" from "Friday delivery · Café Lumen" and "Friday delivery · Mercer". */
function sharedTitle(titles: string[]): string | null {
  const heads = titles.map(title => title.split(/\s+[·•|:-]\s+/)[0].trim());
  return heads.every(head => head === heads[0]) && heads[0].length >= 3 ? heads[0] : null;
}

/**
 * Orren: work the calendar repeats on one weekday, with the places it goes. Only series that repeated at least three
 * times count, and a route needs somewhere to go.
 */
export function routeFindings(events: EventItem[], ids: Ids): DraftFinding[] {
  const series = new Map<string, EventItem[]>();
  for (const event of events) {
    if (!event.seriesId) continue;
    series.set(event.seriesId, [...(series.get(event.seriesId) ?? []), event]);
  }
  const byWeekday = new Map<number, Array<{ seriesId: string; events: EventItem[] }>>();
  for (const [seriesId, instances] of series) {
    if (instances.length < 3 || !instances.some(instance => instance.location)) continue;
    const counts = new Map<number, number>();
    for (const instance of instances) counts.set(weekdayOf(instance.localDate), (counts.get(weekdayOf(instance.localDate)) ?? 0) + 1);
    const [weekday] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    byWeekday.set(weekday, [...(byWeekday.get(weekday) ?? []), { seriesId, events: instances }]);
  }
  return [...byWeekday.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)
    .map(([weekday, group], index) => {
      const ordered = [...group].sort((a, b) => a.events[0].localTime.localeCompare(b.events[0].localTime));
      const stops: RouteStop[] = ordered.map(entry => {
        const sample = entry.events.find(instance => instance.location) ?? entry.events[0];
        const parts = sample.title.split(/\s+[·•|:-]\s+/);
        return { label: (parts[1] ?? parts[0]).trim(), location: sample.location ?? "", lat: null, lng: null };
      });
      const all = ordered.flatMap(entry => entry.events).sort((a, b) => a.at.getTime() - b.at.getTime());
      const title = sharedTitle(ordered.map(entry => entry.events[0].title)) ?? `${WEEKDAYS[weekday]} rounds`;
      return {
        id: ids(`route:${weekday}`),
        companion: "orren" as const,
        rank: index,
        payload: {
          kind: "route" as const,
          title,
          weekday,
          stops,
          occurrences: Math.max(...ordered.map(entry => entry.events.length)),
          since: all[0].at.toISOString(),
        },
        sources: ordered.map(entry => eventRef(entry.events[entry.events.length - 1])),
      };
    });
}

export { WEEKDAYS };
