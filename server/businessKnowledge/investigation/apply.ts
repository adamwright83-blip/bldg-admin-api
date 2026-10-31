import { createHash } from "node:crypto";
import type { EntityKind, RelationshipType, TimelineKind, TimelineSignal } from "../../../shared/businessKnowledge";
import { findVerbatim, sameAddress } from "../../firstTenMinutes/understanding/text";
import { assertClaim, entities, nameKey, recordEvidence, recordTimelineEvent, upsertEntity, type KnowledgeScope } from "../store";
import type { Interpretation } from "./interpretation";
import { dateIn, type Material, type MaterialBook } from "./material";

/**
 * The interpreter proposes; this decides what stands. A finding is kept only when the item it cites was actually
 * read in this run and the quote is that item's own words. Then:
 *  - dates come from the item (or a date written in the quote), never from the interpreter;
 *  - the signal comes from what the item is: the owner's own sent mail is the owner acting; a document's text is a
 *    mention at its modification time; a file's modification time is metadata, never activity; a future meeting is
 *    a plan, not something that happened;
 *  - no relationship says two business names are one company, and "brand of" stands only on an explicit trading
 *    name; anything else between two business names is "related operation".
 */

export type ApplyContext = { scope: KnowledgeScope; runId: string; book: MaterialBook; now: Date; operatorId: string; ownerEmail: string; ownerName: string | null };

export type Applied = {
  evidenceIds: string[];
  events: number;
  entityIds: Set<string>;
  people: Set<string>;
  /** the items accepted findings cited: which reads paid off */
  handles: Set<string>;
  rejected: Array<{ what: string; why: string }>;
};

const TRADING_NAME = /\b(trading as|trades as|doing business as|d\/b\/a|dba|a brand of|our brand|brand name of)\b/i;
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 10);

const providerOf = (item: Material) => item.provider;

export class EntityIndex {
  private readonly byKey = new Map<string, { id: string; kind: EntityKind; name: string }>();
  constructor(private readonly scope: KnowledgeScope) {}

  async load(): Promise<void> {
    for (const row of await entities(this.scope)) this.remember(row.id, row.kind, row.name, row.aliasesJson ?? [], row.email);
  }

  remember(id: string, kind: EntityKind, name: string, aliases: string[] = [], email: string | null = null) {
    for (const key of [nameKey(name), ...aliases.map(nameKey), ...(email ? [email.toLowerCase()] : [])]) if (key && !this.byKey.has(key)) this.byKey.set(key, { id, kind, name });
  }

  find(name: string): { id: string; kind: EntityKind; name: string } | null {
    const key = nameKey(name);
    if (this.byKey.has(key)) return this.byKey.get(key)!;
    // a person named by first name only, when exactly one known person has it
    const first = [...this.byKey.values()].filter((value, index, all) => all.findIndex(other => other.id === value.id) === index && value.kind === "person" && nameKey(value.name).split(" ")[0] === key);
    return first.length === 1 ? first[0] : null;
  }

  all() {
    return [...new Map([...this.byKey.values()].map(value => [value.id, value])).values()];
  }
}

export async function applyInterpretation(ctx: ApplyContext, interpretation: Interpretation, index: EntityIndex): Promise<Applied> {
  const applied: Applied = { evidenceIds: [], events: 0, entityIds: new Set(), people: new Set(), handles: new Set(), rejected: [] };
  const reject = (what: string, why: string) => applied.rejected.push({ what: what.slice(0, 80), why });

  const verified = (handle: string, quote: string): { item: Material; quote: string } | null => {
    const item = ctx.book.get(handle);
    if (!item) return null;
    const found = findVerbatim(item.text, quote);
    return found ? { item, quote: found } : null;
  };

  const evidence = async (item: Material, quote: string) => {
    const id = await recordEvidence(
      ctx.scope,
      ctx.runId,
      {
        provider: providerOf(item),
        sourceRef: item.ref,
        locator: `${item.locator}${item.locator ? "#" : ""}q:${hash(quote)}`,
        label: item.label,
        excerpt: quote,
        url: item.url,
        occurredAt: item.at ?? item.modifiedAt,
      },
      ctx.now
    );
    applied.evidenceIds.push(id);
    applied.handles.add(item.handle);
    return id;
  };

  /** When, and what kind of act, an item is: from the item, never from the interpreter. */
  const timing = (item: Material, quote: string): { at: Date; signal: TimelineSignal; precision: "day" | "range" } | null => {
    const written = dateIn(quote);
    switch (item.kind) {
      case "mail":
        return item.at ? { at: item.at, signal: item.ownerAuthored ? "owner_action" : "counterpart_action", precision: "day" } : null;
      case "event": {
        const past = (item.occurrences ?? []).filter(date => date <= ctx.now);
        if (!past.length) return item.at ? { at: item.at, signal: "mention", precision: "day" } : null;
        return { at: past.at(-1)!, signal: item.people.length ? "counterpart_action" : "owner_action", precision: past.length > 1 ? "range" : "day" };
      }
      case "sheet_rows": {
        if (written && written <= ctx.now) return { at: written, signal: "owner_action", precision: "day" };
        if (item.at) return { at: item.at, signal: "owner_action", precision: "day" };
        return item.modifiedAt ? { at: item.modifiedAt, signal: "metadata", precision: "day" } : null;
      }
      case "doc_passage":
        return item.modifiedAt ? { at: written && written <= ctx.now ? written : item.modifiedAt, signal: "mention", precision: "day" } : null;
      case "file":
        return item.modifiedAt ? { at: item.modifiedAt, signal: "metadata", precision: "day" } : null;
    }
  };

  // ---- entities
  for (const entity of interpretation.entities) {
    const found = verified(entity.handle, entity.quote);
    const named = found && (findVerbatim(found.item.text, entity.name) || (entity.kind === "project" && entity.name.endsWith("s") && findVerbatim(found.item.text, entity.name.slice(0, -1))));
    if (!found || !named) {
      reject(entity.name, "name not in the cited item");
      continue;
    }
    if (ctx.ownerName && nameKey(entity.name) === nameKey(ctx.ownerName)) continue;
    const existing = index.find(entity.name);
    const id = existing?.id ?? (await upsertEntity(ctx.scope, { kind: entity.kind, name: entity.name }));
    if (!existing) index.remember(id, entity.kind, entity.name);
    applied.entityIds.add(id);
    const at = timing(found.item, found.quote);
    if (at) {
      const evidenceId = await evidence(found.item, found.quote);
      await recordTimelineEvent(ctx.scope, ctx.runId, { entityId: id, kind: kindFor(found.item), signal: at.signal === "metadata" ? "metadata" : "mention", summary: `${entity.name} appears: ${found.item.label}`, occurredAt: at.at, precision: at.precision, evidenceId, basis: "direct" }, ctx.now);
      applied.events += 1;
    }
  }

  // ---- people
  for (const person of interpretation.people) {
    const found = verified(person.handle, person.quote);
    const email = person.email.trim().toLowerCase();
    const onItem = found && (findVerbatim(found.item.text, person.name) || (email && found.item.people.some(box => sameAddress(box.email, email))));
    if (!found || !onItem) {
      reject(person.name, "person not on the cited item");
      continue;
    }
    if (sameAddress(email, ctx.ownerEmail) || (ctx.ownerName && nameKey(person.name) === nameKey(ctx.ownerName))) continue;
    const realEmail = email && (found.item.people.some(box => sameAddress(box.email, email)) || ctx.book.all().some(item => item.people.some(box => sameAddress(box.email, email)))) ? email : null;
    const existing = index.find(realEmail ?? person.name) ?? index.find(person.name);
    const id = existing?.id ?? (await upsertEntity(ctx.scope, { kind: "person", name: person.name, email: realEmail }));
    if (!existing) index.remember(id, "person", person.name, [], realEmail);
    applied.people.add(id);
    if (person.role.trim() && findVerbatim(found.item.text, person.role.trim())) {
      const evidenceId = await evidence(found.item, found.quote);
      await assertClaim(ctx.scope, { subjectEntityId: id, predicate: "role", value: "role", detail: person.role.trim().slice(0, 120), basis: "observed", confidence: 75, rationale: `${found.item.label} says so.`, evidenceIds: [evidenceId], createdBy: "investigator" });
    }
  }

  // ---- events
  for (const event of interpretation.events) {
    const found = verified(event.handle, event.quote);
    const subject = index.find(event.entity);
    if (!found || !subject) {
      reject(event.entity, found ? "unknown entity" : "quote not in the cited item");
      continue;
    }
    // the entity must actually be on the item: named in it, or (for a person) one of its people
    const onItem = findVerbatim(found.item.text, subject.name) || (subject.kind === "person" && found.item.people.some(box => index.find(box.email)?.id === subject.id)) || findVerbatim(found.item.text, subject.name.split(" ")[0]);
    if (!onItem) {
      reject(event.entity, "entity not on the cited item");
      continue;
    }
    const at = timing(found.item, found.quote);
    if (!at) {
      reject(event.entity, "the item has no date");
      continue;
    }
    const related = event.with.trim() ? index.find(event.with) : null;
    const kind: TimelineKind = found.item.kind === "file" ? "document" : found.item.kind === "event" ? "meeting" : (event.kind as TimelineKind);
    // a sale or launch needs the owner's own words saying so; otherwise it is preparation
    const finalKind: TimelineKind = (kind === "sale" || kind === "launch") && !(found.item.ownerAuthored && found.item.kind === "mail") ? "launch_preparation" : kind;
    const evidenceId = await evidence(found.item, found.quote);
    await recordTimelineEvent(
      ctx.scope,
      ctx.runId,
      {
        entityId: subject.id,
        relatedEntityId: related && related.id !== subject.id ? related.id : null,
        kind: finalKind,
        signal: at.signal,
        summary: event.summary || found.item.label,
        occurredAt: at.at,
        precision: at.precision,
        evidenceId,
        basis: "direct",
      },
      ctx.now
    );
    applied.events += 1;
  }

  // ---- explicit statuses
  for (const status of interpretation.statuses) {
    const found = verified(status.handle, status.quote);
    const subject = index.find(status.entity);
    if (!found || !subject) {
      reject(status.entity, "status not verified");
      continue;
    }
    const at = found.item.at ?? found.item.modifiedAt ?? ctx.now;
    const evidenceId = await evidence(found.item, found.quote);
    await recordTimelineEvent(ctx.scope, ctx.runId, { entityId: subject.id, kind: "status_statement", signal: "mention", statedStatus: status.status, summary: found.quote, occurredAt: at, evidenceId, basis: "direct" }, ctx.now);
  }

  // ---- written relationships
  for (const relationship of interpretation.relationships) {
    const found = verified(relationship.handle, relationship.quote);
    const subject = index.find(relationship.subject);
    const object = index.find(relationship.object);
    if (!found || !subject || !object || subject.id === object.id) {
      reject(`${relationship.subject} ${relationship.type} ${relationship.object}`, "relationship not verified");
      continue;
    }
    if (!findVerbatim(found.item.text, subject.name.split(" ")[0]) || !findVerbatim(found.item.text, object.name.split(" ")[0])) {
      reject(`${relationship.subject} ${relationship.type} ${relationship.object}`, "both sides must be named in the item");
      continue;
    }
    const businesses = (kind: EntityKind) => kind === "company" || kind === "brand";
    let type = relationship.type as RelationshipType;
    if (type === "brand_of" && !TRADING_NAME.test(found.quote)) type = "related_operation";
    if (businesses(subject.kind) && businesses(object.kind) && !["brand_of", "related_operation", "separate_business"].includes(type)) type = "related_operation";
    const evidenceId = await evidence(found.item, found.quote);
    await assertClaim(ctx.scope, {
      subjectEntityId: subject.id,
      predicate: "relationship",
      objectEntityId: object.id,
      value: type,
      basis: type === "related_operation" ? "inferred" : "observed",
      confidence: type === "related_operation" ? 45 : 70,
      rationale: type === "related_operation" ? `Mentioned together: "${found.quote}". How they relate isn't established.` : `"${found.quote}" (${found.item.label})`,
      evidenceIds: [evidenceId],
      createdBy: "investigator",
    });
  }
  return applied;
}

function kindFor(item: Material): TimelineKind {
  switch (item.kind) {
    case "mail":
      return "correspondence";
    case "event":
      return "meeting";
    case "sheet_rows":
      return "spreadsheet";
    default:
      return "document";
  }
}
