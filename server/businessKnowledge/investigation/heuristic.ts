import { findVerbatim, sameAddress } from "../../firstTenMinutes/understanding/text";
import { EMPTY_INTERPRETATION, type InterpretInput, type Interpretation, type InvestigatorModel } from "./interpretation";
import type { Material } from "./material";

/**
 * The deterministic investigator: rules over the material, no model. It is the baseline every model is compared
 * against, the fallback when a model fails, and the interpreter in tests. It is deliberately conservative: it names
 * things only from signatures, file titles, recurring outgoing subjects and explicit statements, and it proposes no
 * relationship it can't quote.
 *
 * Nothing here knows any particular business, product or person.
 */

const GENERIC_TITLE_WORDS =
  /\b(roadmap|launch|tracker|pricing|prices|operations|manual|routes?|schedule|plan|planning|budget|notes|template|game|design|proposal|invoices?|customers|clients|deck|brief|strategy|playbook|handbook|for|buildings?|overview|tasks|sop|process|report|dashboard|website|draft|v\d+)\b/i;
const PRODUCT_CONTEXT = /\b(roadmap|beta|launch|prelaunch|pre-launch|app|platform|game|prototype|release|testers|mvp|level art|chapter)\b/i;
const BRAND_CONTEXT = /\b(is (?:our|the) [\w\s-]{0,40}service|service line|trading as|doing business as|d\/b\/a|dba)\b/i;
const COMMON = new Set(
  "The A An And Or But For To From With Your Our My Re Fwd Fw Hi Hello Thanks Thank Dear Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Status Columns Row Formulas Repeats With On Total Date Name Role Phone Task Owner Due Ops Call Big Sale Everything Customer Deals Team Building Manager Front Desk Residents Players Open Who Weekly Private Hello"
    .split(" ")
    .map(word => word.toLowerCase())
);
const ROLE_WORDS = "operations lead|ops lead|co-?founder|founder|partner|business partner|general manager|manager|driver|designer|bookkeeper|accountant|developer|engineer|assistant|coordinator|director|head of [a-z]+";
const ROLE_AFTER = new RegExp(`\\b(${ROLE_WORDS})\\s*:\\s*([A-Z][a-z'-]+(?:\\s[A-Z][a-z'-]+)?)`, "i");
const ROLE_BEFORE = new RegExp(`\\b([A-Z][a-z'-]+(?:\\s[A-Z][a-z'-]+)?),?\\s+(?:is\\s+)?(?:our|the|my)\\s+(${ROLE_WORDS})\\b`);
const STATUS_STATEMENT = /\bstatus\s*:\s*(prelaunch|pre-launch|beta|private beta|live|launched|closed|paused|on hold)\b/i;
const PART_OF = /\b([A-Z][\w-]*(?:\s[A-Z][\w-]*)?) is the (?:game|app|module|feature|component) (?:inside|for|in|of|within) ([A-Z][\w-]*(?:\s[A-Z][\w-]*)?)/;

const lower = (text: string) => text.toLowerCase();
const isProper = (phrase: string) => phrase.split(/\s+/).every(word => /^[A-Z][\w&'-]*$/.test(word) || /^[A-Z0-9]{2,}$/.test(word) || word === "&");

/** The proper-name phrase a file title begins with: "Rinse Farm operations manual" → "Rinse Farm". */
export function titleName(title: string): string | null {
  const cut = title.split(GENERIC_TITLE_WORDS)[0]?.trim().replace(/[-–:,]+$/, "").trim() ?? "";
  if (!cut || cut.length < 3 || cut.length > 60) return null;
  if (!isProper(cut)) return null;
  if (COMMON.has(lower(cut))) return null;
  return cut;
}

/** The line after the owner's own name in a signature: their business, or what they call their work. */
export function signatureNames(text: string, ownerName: string | null): string[] {
  if (!ownerName) return [];
  const lines = text.split(/\n/).map(line => line.trim()).filter(Boolean);
  const out: string[] = [];
  for (let i = Math.max(0, lines.length - 6); i < lines.length - 1; i += 1) {
    if (lower(lines[i]) === lower(ownerName)) {
      // "Wildroot Flowers · Silver Lake": the business is what comes before the separator
      const next = lines[i + 1]?.split(/\s+[·•|–—-]\s+|,\s+/)[0]?.trim();
      if (next && next.length <= 60 && !/[@:/]|\d{3}/.test(next)) out.push(next);
    }
  }
  return out;
}

const subjectKey = (subject: string) =>
  subject
    .replace(/^(re|fwd?|fw)\s*:\s*/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .join(" ")
    .toLowerCase();

const quoteOf = (item: Material, phrase: string): string | null => findVerbatim(item.text, phrase);

function eventKind(text: string, productLike: boolean): Interpretation["events"][number]["kind"] {
  if (/\b(proposal|quote|estimate)\b/i.test(text)) return "proposal";
  if (/\binvoice/i.test(text)) return "invoice";
  if (/\b(sold|order confirmed|payment received|first customer)\b/i.test(text)) return "sale";
  if (productLike && /\b(launch|beta|release|testers)\b/i.test(text)) return "launch_preparation";
  if (productLike && /\b(roadmap|design|screens|level|art|review|chapter)\b/i.test(text)) return "planning";
  if (/\b(pickup|delivery|deliver|route|scheduled|staffing|shift|vans?)\b/i.test(text)) return "operations";
  return "correspondence";
}

export function heuristicInterpret(input: InterpretInput): Interpretation {
  const out: Interpretation = { ...EMPTY_INTERPRETATION, entities: [], people: [], events: [], statuses: [], relationships: [], questions: [], toolCalls: [], done: false };
  const items = input.material;
  const owner = input.ownerName;
  const knownNames = new Map(input.known.entities.map(entity => [lower(entity.name), entity]));
  const named = new Map<string, Interpretation["entities"][number]>();
  const nameEntity = (name: string, kind: Interpretation["entities"][number]["kind"], item: Material, quote: string) => {
    const key = lower(name);
    if (owner && key === lower(owner)) return;
    // the first, strongest source of a name decides its kind: a signature before a file title
    if (named.has(key)) return;
    named.set(key, { name, kind, handle: item.handle, quote });
  };

  // ---- names from signatures (the owner's own business, or what they call their work)
  for (const item of items.filter(item => item.kind === "mail" && item.ownerAuthored)) {
    for (const name of signatureNames(item.text, owner)) {
      const quote = quoteOf(item, name);
      if (!quote) continue;
      nameEntity(name, isProper(name) ? "company" : "project", item, quote);
    }
  }

  // ---- names from file titles, typed by the context they appear in
  const corpus = items.map(item => item.text).join("\n");
  for (const item of items.filter(item => item.kind === "file" || item.kind === "doc_passage" || item.kind === "sheet_rows")) {
    const title = item.text.split("\n")[0].split(" › ")[0];
    const name = titleName(title);
    if (!name) continue;
    const quote = quoteOf(item, name);
    if (!quote) continue;
    // a single ordinary word ("Salon") is a name only when it stands on its own elsewhere too, or is written in capitals
    if (!name.includes(" ") && !/^[A-Z0-9]{3,}$/.test(name) && standalone(name, items.filter(other => other !== item)) < 1) continue;
    const kind = new RegExp(`${escape(name)} is (?:our|the|a) [\\w\\s-]{0,40}service`).test(corpus) || new RegExp(`${escape(name)}[^.\\n]{0,40}${BRAND_CONTEXT.source}`, "i").test(corpus)
      ? "brand"
      : PRODUCT_CONTEXT.test(title) || new RegExp(`${escape(name)}\\W{1,3}(?:\\w+\\W+){0,2}?(roadmap|beta|launch tracker|game|app|platform|level art|chapter|screens)\\b`, "i").test(corpus)
        ? "product"
        : "company";
    nameEntity(name, kind, item, quote);
  }

  // ---- recurring outgoing work: the same kind of message to different people ("Website proposal for …")
  const patterns = new Map<string, Material[]>();
  for (const item of items.filter(item => item.kind === "mail" && item.ownerAuthored)) {
    const subject = item.text.split("\n")[0];
    const key = subjectKey(subject);
    if (key.split(" ").length < 2 || [...named.keys()].some(name => key.includes(name) || name.includes(key))) continue;
    patterns.set(key, [...(patterns.get(key) ?? []), item]);
  }
  for (const [key, list] of patterns) {
    const recipients = new Set(list.flatMap(item => item.people.map(person => person.email)));
    if (list.length < 2 || recipients.size < 2 || !/\b(proposal|quote|estimate|pitch|offer)\b/i.test(key)) continue;
    const first = list[0];
    const phrase = first.text.split("\n")[0].replace(/^(re|fwd?|fw)\s*:\s*/i, "").split(/\s+/).slice(0, 2).join(" ");
    const quote = quoteOf(first, phrase);
    if (!quote) continue;
    const name = `${phrase}s`;
    named.set(lower(name), { name, kind: "project", handle: first.handle, quote });
    for (const item of list) {
      const q = quoteOf(item, phrase);
      if (q) out.events.push({ entity: name, with: "", kind: "proposal", summary: item.text.split("\n")[0].slice(0, 120), handle: item.handle, quote: q });
    }
    // what the owner calls this work in the signature of the same messages is the same work, not another business
    for (const signature of list.flatMap(item => signatureNames(item.text, owner))) {
      const entry = named.get(lower(signature));
      if (entry && entry.kind === "project" && !items.some(item => item.text.includes(signature) && !list.includes(item))) named.delete(lower(signature));
    }
  }

  out.entities = [...named.values()];
  const all = [...out.entities.map(entity => ({ name: entity.name, kind: entity.kind })), ...input.known.entities.filter(entity => !named.has(lower(entity.name))).map(entity => ({ name: entity.name, kind: entity.kind }))];

  // ---- dated events for every named thing, from every item that names it
  for (const item of items) {
    for (const entity of all) {
      if (entity.kind === "project" && /s$/.test(entity.name) && out.events.some(event => event.entity === entity.name && event.handle === item.handle)) continue;
      // "Website proposals" is named in a message as "Website proposal"
      const quote = quoteOf(item, entity.name) ?? (entity.kind === "project" && entity.name.endsWith("s") ? quoteOf(item, entity.name.slice(0, -1)) : null);
      if (!quote) continue;
      const productLike = entity.kind === "product" || entity.kind === "project";
      const other = all.find(candidate => candidate.name !== entity.name && item.text.includes(candidate.name));
      const kind =
        item.kind === "event"
          ? "meeting"
          : item.kind === "sheet_rows"
            ? "spreadsheet"
            : item.kind === "doc_passage" || item.kind === "file"
              ? productLike && PRODUCT_CONTEXT.test(item.text)
                ? "planning"
                : "document"
              : eventKind(item.text, productLike);
      out.events.push({ entity: entity.name, with: other?.name ?? "", kind, summary: item.text.split("\n")[0].slice(0, 120), handle: item.handle, quote });
    }
  }

  // ---- explicit statuses
  for (const item of items) {
    const match = item.text.match(STATUS_STATEMENT);
    if (!match) continue;
    const entity = all.find(candidate => item.text.includes(candidate.name));
    if (!entity) continue;
    const word = match[1].toLowerCase();
    const status = /pre-?launch|beta/.test(word) ? "prelaunch" : /live|launched/.test(word) ? "active" : /closed/.test(word) ? "historical" : "dormant";
    out.statuses.push({ entity: entity.name, status, handle: item.handle, quote: match[0] });
  }

  // ---- people: who appears across kinds of source, and the roles items state
  const people = new Map<string, Interpretation["people"][number]>();
  const addPerson = (name: string, email: string, role: string, item: Material, quote: string) => {
    if (owner && lower(name) === lower(owner)) return;
    if (sameAddress(email, input.ownerEmail)) return;
    const key = email || lower(name);
    const existing = people.get(key) ?? [...people.values()].find(person => lower(person.name) === lower(name) || (email && person.email === email) || (person.name && lower(name).startsWith(`${lower(person.name.split(" ")[0])} `)));
    if (existing) {
      if (!existing.role && role) Object.assign(existing, { role, handle: item.handle, quote });
      if (!existing.email && email) existing.email = email;
      if (existing.name.split(" ").length < name.split(" ").length) existing.name = name;
      return;
    }
    people.set(key, { name, email, role, handle: item.handle, quote });
  };
  for (const item of items) {
    const after = item.text.match(ROLE_AFTER);
    if (after) addPerson(after[2], emailFor(after[2], items), capitalise(after[1]), item, after[0]);
    const before = item.text.match(ROLE_BEFORE);
    if (before && !COMMON.has(lower(before[1].split(" ")[0]))) addPerson(before[1], emailFor(before[1], items), capitalise(before[2]), item, before[0]);
    if (item.kind === "sheet_rows" && /Columns:.*\bRole\b/i.test(item.text)) {
      for (const line of item.text.split("\n").filter(line => line.startsWith("Row "))) {
        const cells = line.replace(/^Row \d+:\s*/, "").split(" | ");
        if (cells.length >= 2 && /^[A-Z][a-z'-]+\s[A-Z][a-z'-]+$/.test(cells[0]) && cells[1]) {
          const quote = findVerbatim(item.text, `${cells[0]} | ${cells[1]}`);
          if (quote) addPerson(cells[0], emailFor(cells[0], items), cells[1], item, quote);
        }
      }
    }
    // a recurring meeting's attendees and a shared file's co-editors work with the owner
    if ((item.kind === "event" && (item.occurrences?.length ?? 0) >= 3) || ((item.kind === "file" || item.kind === "doc_passage" || item.kind === "sheet_rows") && item.people.length)) {
      for (const person of item.people) {
        const name = person.name ?? person.email;
        const quote = quoteOf(item, person.email) ?? (person.name ? quoteOf(item, person.name) : null) ?? quoteOf(item, item.text.split("\n")[0].slice(0, 60));
        if (quote) addPerson(name, person.email, "", item, quote);
      }
    }
  }
  out.people = [...people.values()];

  // ---- people's dated events: mail to and from them, meetings, shared files, mentions
  for (const person of out.people) {
    const first = person.name.split(" ")[0];
    for (const item of items) {
      const onItem = item.people.some(box => box.email && person.email && sameAddress(box.email, person.email));
      const mentioned = person.name.includes(" ") ? item.text.includes(person.name) : false;
      const firstMention = first.length >= 3 && new RegExp(`\\b${escape(first)}\\b`).test(item.text) && item.ownerAuthored && item.kind === "mail";
      if (!onItem && !mentioned && !firstMention) continue;
      const quote = (person.email && quoteOf(item, person.email)) || (mentioned && quoteOf(item, person.name)) || (firstMention && quoteOf(item, first)) || quoteOf(item, item.text.split("\n")[0].slice(0, 60));
      if (!quote) continue;
      const business = all.find(entity => entity.kind !== "project" && item.text.includes(entity.name));
      out.events.push({
        entity: person.name,
        with: business?.name ?? "",
        kind: item.kind === "event" ? "meeting" : item.kind === "sheet_rows" ? "spreadsheet" : item.kind === "mail" ? "correspondence" : "document",
        summary: item.text.split("\n")[0].slice(0, 120),
        handle: item.handle,
        quote,
      });
    }
  }

  // ---- relationships that are written down
  for (const item of items) {
    const part = item.text.match(PART_OF);
    if (part && all.some(entity => entity.name === part[1]) && all.some(entity => entity.name === part[2])) {
      out.relationships.push({ subject: part[1], type: "part_of", object: part[2], handle: item.handle, quote: part[0] });
    }
    // two business names in one owner-written passage: related somehow, never "the same company"
    const businesses = all.filter(entity => (entity.kind === "company" || entity.kind === "brand") && item.text.includes(entity.name));
    if (businesses.length >= 2 && (item.ownerAuthored || item.kind === "doc_passage")) {
      const [a, b] = businesses;
      const sentence = item.text.split(/(?<=[.!?])\s+/).find(line => line.includes(a.name) && line.includes(b.name));
      const quote = sentence ? findVerbatim(item.text, sentence.trim().slice(0, 200)) : null;
      if (quote && !out.relationships.some(rel => rel.type === "related_operation" && [rel.subject, rel.object].sort().join() === [a.name, b.name].sort().join())) {
        out.relationships.push({ subject: b.name, type: "related_operation", object: a.name, handle: item.handle, quote });
      }
    }
    for (const person of out.people) {
      const runs = new RegExp(`\\b${escape(person.name.split(" ")[0])}\\b[^.\\n]{0,40}\\b(runs|leads|manages|handles)\\b[^.\\n]{0,60}`).exec(item.text);
      const business = runs && all.find(entity => entity.kind !== "project" && entity.kind !== "product" && item.text.includes(entity.name));
      if (runs && business) {
        const quote = findVerbatim(item.text, runs[0].trim().slice(0, 200));
        if (quote) out.relationships.push({ subject: person.name, type: "works_at", object: business.name, handle: item.handle, quote });
      }
    }
  }
  return out;
}

/** How many items use `word` as a name on its own: capitalised, not part of a longer capitalised phrase. */
function standalone(word: string, items: Material[]): number {
  const pattern = new RegExp(`(^|[^A-Za-z])(\\S+\\s)?${escape(word)}(?![A-Za-z])(\\s\\S+)?`, "g");
  let count = 0;
  for (const item of items) {
    for (const match of item.text.matchAll(pattern)) {
      const before = (match[2] ?? "").trim();
      const after = (match[3] ?? "").trim();
      const capital = (token: string) => /^[A-Z]/.test(token) && !COMMON.has(lower(token.replace(/[^A-Za-z]/g, "")));
      if (!capital(before) && !capital(after)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function emailFor(name: string, items: Material[]): string {
  for (const item of items) {
    const match = item.people.find(box => box.name && (box.name === name || box.name.split(" ")[0] === name.split(" ")[0]));
    if (match) return match.email;
  }
  return "";
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function heuristicInvestigator(): InvestigatorModel {
  return {
    name: "heuristic",
    async interpret(input) {
      return heuristicInterpret(input);
    },
  };
}
