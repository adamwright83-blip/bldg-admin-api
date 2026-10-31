import type { EvidenceProvider } from "../../../shared/businessKnowledge";
import type { CalendarEntry, DocumentRead, DriveEntry, MailHeader, MailMessage, SpreadsheetRead } from "../../firstTenMinutes/research/googleResearch";
import { columnLetters } from "../../firstTenMinutes/research/googleResearch";
import type { Mailbox } from "../../firstTenMinutes/understanding/sources";
import { clip, sameAddress } from "../../firstTenMinutes/understanding/text";

/**
 * Material: what the investigator has read, one item per message, passage, spreadsheet tab, calendar series or
 * file, each with a short handle ("S12") the interpreter must cite. The text is already redacted by the research
 * layer. Items live only in memory for one run; what is kept is evidence (a short excerpt and a locator).
 */
export type MaterialKind = "mail" | "doc_passage" | "sheet_rows" | "event" | "file";

export type Material = {
  handle: string;
  kind: MaterialKind;
  provider: EvidenceProvider;
  /** the provider's id for the item: message, file or event */
  ref: string;
  /** where inside it: a thread, a passage and offset, a cell range, a calendar series */
  locator: string;
  /** when the item happened (sent, met, the latest dated row); null when it has no time of its own */
  at: Date | null;
  label: string;
  text: string;
  url: string | null;
  /** the owner wrote, sent or organised it */
  ownerAuthored: boolean;
  /** the other people on it: recipients, sender, attendees, co-editors */
  people: Mailbox[];
  /** a file's modification time: kept apart, since it is never proof of activity */
  modifiedAt: Date | null;
  /** for a calendar series: how many occurrences were read */
  occurrences?: Date[];
  /** for a mail item: the thread, so a follow-up can read the whole conversation */
  threadId?: string;
  /** for a file item: its type, so a follow-up can read it properly */
  mimeType?: string;
};

const DATE_PATTERNS: Array<[RegExp, (m: RegExpMatchArray) => Date]> = [
  [/\b(20\d{2})-(\d{2})-(\d{2})\b/, m => new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))],
  [/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/, m => new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 12))],
];

/** The first plain date written in a text, if any. */
export function dateIn(text: string): Date | null {
  for (const [pattern, make] of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const date = make(match);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return null;
}

export class MaterialBook {
  private readonly items = new Map<string, Material>();
  private readonly byKey = new Map<string, string>();
  /** handles added or expanded (a snippet replaced by a fuller read) since the interpreter last took them */
  private readonly changed = new Set<string>();
  private next = 1;

  constructor(private readonly ownerEmail: string) {}

  private add(item: Omit<Material, "handle">): Material {
    const key = `${item.provider}\u0000${item.ref}\u0000${item.locator}`;
    const known = this.byKey.get(key);
    if (known) {
      const existing = this.items.get(known)!;
      // a fuller read of the same item replaces a snippet
      if (item.text.length > existing.text.length) {
        this.items.set(known, { ...existing, ...item, handle: known });
        this.changed.add(known);
      }
      return this.items.get(known)!;
    }
    const handle = `S${this.next++}`;
    const material = { ...item, handle };
    this.items.set(handle, material);
    this.byKey.set(key, handle);
    this.changed.add(handle);
    return material;
  }

  /** Everything new or expanded since the last call: what the interpreter hasn't read yet in its current form. */
  takeChanged(): Material[] {
    const out = [...this.changed].map(handle => this.items.get(handle)!).filter(Boolean);
    this.changed.clear();
    return out.sort((a, b) => Number(a.handle.slice(1)) - Number(b.handle.slice(1)));
  }

  get(handle: string): Material | undefined {
    return this.items.get(handle);
  }

  all(): Material[] {
    return [...this.items.values()];
  }

  since(handleNumber: number): Material[] {
    return this.all().filter(item => Number(item.handle.slice(1)) > handleNumber);
  }

  get size(): number {
    return this.next - 1;
  }

  private counterpartLabel(item: { sentByOwner: boolean; from: Mailbox; to: Mailbox[] }) {
    const display = (box?: Mailbox) => box?.name || box?.email || "someone";
    return item.sentByOwner ? `You, to ${display(item.to[0])}` : `${display(item.from)}, to you`;
  }

  mail(item: MailHeader | MailMessage): Material {
    const full = "text" in item;
    const people = (item.sentByOwner ? item.to : [item.from, ...item.to]).filter(box => !sameAddress(box.email, this.ownerEmail));
    return this.add({
      kind: "mail",
      provider: "gmail",
      ref: item.id,
      locator: "",
      at: item.at,
      label: this.counterpartLabel(item),
      text: clip(`${item.subject}\n${full ? (item as MailMessage).text : item.snippet}`, full ? 3000 : 400),
      url: item.url,
      ownerAuthored: item.sentByOwner,
      people,
      modifiedAt: null,
      threadId: item.threadId,
    });
  }

  file(entry: DriveEntry): Material {
    const people = [...entry.owners, ...(entry.lastModifiedBy ? [entry.lastModifiedBy] : [])].filter(box => !sameAddress(box.email, this.ownerEmail));
    return this.add({
      kind: "file",
      provider: "drive",
      ref: entry.id,
      locator: "",
      at: null,
      label: `Your Drive: ${entry.name}`,
      text: entry.name,
      url: entry.url,
      ownerAuthored: entry.owners.some(owner => sameAddress(owner.email, this.ownerEmail)),
      people: dedupe(people),
      modifiedAt: entry.modifiedAt,
      mimeType: entry.mimeType,
    });
  }

  passages(read: DocumentRead): Material[] {
    const people = [...read.file.owners, ...(read.file.lastModifiedBy ? [read.file.lastModifiedBy] : [])].filter(box => !sameAddress(box.email, this.ownerEmail));
    return read.passages.map(passage =>
      this.add({
        kind: "doc_passage",
        provider: "docs",
        ref: read.file.id,
        locator: `passage:${passage.index}@${passage.offset}`,
        at: null,
        label: `Your document "${read.file.name}"`,
        text: `${read.file.name}\n${passage.text}`,
        url: read.file.url,
        ownerAuthored: read.file.owners.some(owner => sameAddress(owner.email, this.ownerEmail)),
        people: dedupe(people),
        modifiedAt: read.file.modifiedAt,
      })
    );
  }

  sheet(read: SpreadsheetRead, now: Date): Material[] {
    return read.tabs.map(tab => {
      const rows = tab.rows.slice(0, 45);
      const first = rows[0]?.row ?? 1;
      const last = rows.at(-1)?.row ?? first;
      const width = Math.max(tab.headers.length, ...rows.map(row => row.cells.length), 1);
      const dates = rows
        .flatMap(row => row.cells.slice(0, 3).map(dateIn))
        .filter((date): date is Date => Boolean(date) && date!.getTime() <= now.getTime());
      const latest = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : null;
      const text = [
        `${read.title} › ${tab.title}`,
        `Columns: ${tab.headers.join(" | ")}`,
        ...rows.map(row => `Row ${row.row}: ${row.cells.join(" | ")}`),
        ...(tab.formulas.length ? [`Formulas: ${tab.formulas.map(formula => `${formula.cell} ${formula.formula}`).join("; ")}`] : []),
      ].join("\n");
      return this.add({
        kind: "sheet_rows",
        provider: "sheets",
        ref: read.file.id,
        locator: `${tab.title}!A${first}:${columnLetters(width)}${last}`,
        at: latest,
        label: `Your spreadsheet "${read.title}", ${tab.title}`,
        text: clip(text, 3500),
        url: read.file.url,
        ownerAuthored: read.file.owners.some(owner => sameAddress(owner.email, this.ownerEmail)),
        people: dedupe([...read.file.owners, ...(read.file.lastModifiedBy ? [read.file.lastModifiedBy] : [])].filter(box => !sameAddress(box.email, this.ownerEmail))),
        modifiedAt: read.file.modifiedAt,
      });
    });
  }

  /** One item per calendar series (or single event), with its occurrences, so a weekly meeting is one fact. */
  events(entries: CalendarEntry[], now: Date): Material[] {
    const series = new Map<string, CalendarEntry[]>();
    for (const entry of entries) {
      const key = entry.seriesId ?? entry.id;
      series.set(key, [...(series.get(key) ?? []), entry]);
    }
    return [...series.entries()].map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.at.getTime() - b.at.getTime());
      const past = sorted.filter(entry => entry.at <= now);
      const latest = past.at(-1) ?? null;
      const head = sorted[0];
      const attendees = dedupe(sorted.flatMap(entry => [...entry.attendees, ...(entry.organizer ? [entry.organizer] : [])]));
      const text = [
        head.title,
        sorted.length > 1 ? `Repeats: ${sorted.length} times, ${sorted[0].at.toISOString().slice(0, 10)} to ${sorted.at(-1)!.at.toISOString().slice(0, 10)}` : `On ${head.at.toISOString().slice(0, 10)}`,
        attendees.length ? `With: ${attendees.map(box => (box.name ? `${box.name} <${box.email}>` : box.email)).join(", ")}` : "",
        head.description ?? "",
      ]
        .filter(Boolean)
        .join("\n");
      return this.add({
        kind: "event",
        provider: "calendar",
        ref: key,
        locator: list.length > 1 ? `series:${key}` : "",
        at: latest?.at ?? head.at,
        label: "Your calendar",
        text: clip(text, 800),
        url: head.url,
        ownerAuthored: !list.some(entry => entry.organizer),
        people: attendees,
        modifiedAt: null,
        occurrences: sorted.map(entry => entry.at),
      });
    });
  }
}

function dedupe(boxes: Mailbox[]): Mailbox[] {
  const seen = new Map<string, Mailbox>();
  for (const box of boxes) {
    const key = box.email.toLowerCase();
    const known = seen.get(key);
    if (!known || (!known.name && box.name)) seen.set(key, box);
  }
  return [...seen.values()];
}

/** How the interpreter sees an item. */
export function materialLine(item: Material, ownerEmail: string): string {
  const date = item.at ? item.at.toISOString().slice(0, 10) : "";
  const modified = item.modifiedAt ? ` modified="${item.modifiedAt.toISOString().slice(0, 10)}"` : "";
  const people = item.people.length ? ` people="${item.people.slice(0, 6).map(box => (box.name ? `${box.name} <${box.email}>` : box.email)).join(", ").replace(/"/g, "'")}"` : "";
  const by = item.ownerAuthored ? "the owner" : "someone else";
  void ownerEmail;
  const id = item.threadId ? ` thread="${item.threadId}"` : item.kind === "file" || item.kind === "doc_passage" || item.kind === "sheet_rows" ? ` file="${item.ref}"${item.mimeType ? ` type="${item.mimeType.split(".").pop()}"` : ""}` : "";
  return `<item handle="${item.handle}" kind="${item.kind}" date="${date}"${modified} by="${by}"${people}${id} label="${item.label.replace(/"/g, "'")}">\n${item.text}\n</item>`;
}
