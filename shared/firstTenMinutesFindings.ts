/**
 * What the crew finds while getting acquainted (docs/goldline/FIRST_TEN_MINUTES_BUILD.md, slice 2).
 *
 * Every finding carries its sources: where it came from, when, and the exact words. A quote is shown only if it
 * appears verbatim in the item it cites; dates come from the item itself, never from a model. A finding the person
 * corrects is kept with their correction and never shown as true again.
 */

export const COMPANIONS = ["mara", "sable", "rook", "bront", "luma", "orren", "ilex"] as const;
export type CompanionId = (typeof COMPANIONS)[number];

export type SourceProvider = "gmail" | "calendar" | "drive" | "slack";

export type SourceRef = {
  provider: SourceProvider;
  /** the provider's id for the item (message, event, file, Slack timestamp) */
  ref: string;
  /** ISO time of the item, as the provider recorded it */
  at: string;
  /** who is on the other side, by name when known ("you" for the person's own words) */
  who: string | null;
  /** short, plain label: "Email from Elena Ruiz", "Calendar", "Drive: Weekly service sheet" */
  label: string;
  /** the exact words, verbatim from the item */
  excerpt: string;
  /** where the person can open the item themselves, when the provider has a link */
  url: string | null;
};

export type PersonRef = { name: string | null; address: string };

export type FindingKind =
  | "business"
  | "owner"
  | "person"
  | "rule"
  | "promise"
  | "request"
  | "reply"
  | "service"
  | "place"
  | "habit"
  | "image"
  | "route"
  | "rhythm"
  | "contrast"
  | "opportunity";

export type OpportunityType = "became_possible" | "deserves_finishing" | "within_reach" | "unanswered";

export type RouteStop = { label: string; location: string; lat: number | null; lng: number | null };

export type FindingPayload =
  | { kind: "business"; name: string }
  /** the person's own name, as their sent mail is signed and sent */
  | { kind: "owner"; name: string }
  | { kind: "person"; person: PersonRef; sent: number; received: number; lastAt: string }
  /** something the person said about how their business works, in their own words */
  | { kind: "rule"; statement: string; quote: string; saidTo: PersonRef | null; at: string }
  | { kind: "promise"; statement: string; quote: string; madeTo: PersonRef | null; at: string }
  | { kind: "request"; from: PersonRef; quote: string; wants: string; recurring: boolean; at: string; subject: string | null }
  | { kind: "reply"; to: PersonRef; quote: string; requestId: string | null; declined: boolean; missing: string | null; at: string }
  | { kind: "service"; name: string; quote: string; at: string }
  | {
      kind: "place";
      name: string;
      /** one plain noun, "hotel" */
      category: string | null;
      address: string | null;
      neighborhood: string | null;
      lat: number | null;
      lng: number | null;
      /** the people who wrote about it, e.g. who asked from that hotel */
      people: PersonRef[];
    }
  /** a habit in the person's own sent mail, with real examples */
  | { kind: "habit"; habit: "ends_with_question"; examples: string[]; share: number; sampled: number }
  /**
   * An image the person keeps sending. `name` is a plain name from the file ("blue jug"), or null for a camera's
   * own file name; `inWhat` says what it kept coming back in.
   */
  | { kind: "image"; name: string | null; fileName: string; uses: number; mimeType: string | null; inWhat: "proposals" | "emails" }
  /** recurring calendar work on one weekday */
  | { kind: "route"; title: string; weekday: number; stops: RouteStop[]; occurrences: number; since: string }
  /** one kind of event that keeps landing on the same days of the week ("wedding", on Saturdays) */
  | { kind: "rhythm"; word: string; days: number[]; count: number; titles: string[] }
  /** two requests side by side that show what different people are buying */
  | { kind: "contrast"; aLine: string; bLine: string; aRequestId: string; bRequestId: string }
  | {
      kind: "opportunity";
      type: OpportunityType;
      person: PersonRef;
      requestId: string;
      replyId: string | null;
      serviceId: string | null;
      routeId: string | null;
      placeId: string | null;
      /** how the route meets the place: on the same street, or a stop within a few hundred metres */
      along: "street" | "nearby" | null;
      summary: string;
    };

export type FindingStatus = "proposed" | "confirmed" | "changed" | "dismissed";

export type FindingView = {
  id: string;
  companion: CompanionId | null;
  status: FindingStatus;
  payload: FindingPayload;
  sources: SourceRef[];
  /** the person's own correction, when they gave one */
  correction: string | null;
};

// ------------------------------------------------------------------ the crew's reading, as it happens

/** Each stage is real work, and its line is shown only while that work runs (Astra's copy, 0:30). */
export const UNDERSTANDING_STAGES = ["people", "conversations", "work"] as const;
export type UnderstandingStage = (typeof UNDERSTANDING_STAGES)[number];

export const UNDERSTANDING_COPY: Record<UnderstandingStage, string> = {
  people: "Meeting the people you write to.",
  conversations: "Following the conversations you keep coming back to.",
  work: "Finding the work already in motion.",
};

export type UnderstandingStatus = "idle" | "running" | "complete" | "failed";

export type UnderstandingView = {
  status: UnderstandingStatus;
  /** the stage running now; null when idle or finished */
  stage: UnderstandingStage | null;
  finished: UnderstandingStage[];
  /** what was actually read so far, for the person's own curiosity (never a fabricated percentage) */
  counts: { sent: number; received: number; events: number; files: number; slack: number };
  findings: FindingView[];
  /** plain words when some source could not be read, e.g. Drive wasn't granted */
  notes: string[];
};

/** The quiet names that appear on the crew's objects as reliable findings arrive (0:30). */
export function objectNames(findings: readonly FindingView[]): {
  map: string | null;
  folder: string | null;
  photograph: string | null;
  notebook: string | null;
} {
  const live = findings.filter(finding => finding.status !== "dismissed" && finding.status !== "changed");
  const first = <K extends FindingKind>(kind: K) =>
    live.find(finding => finding.payload.kind === kind)?.payload as Extract<FindingPayload, { kind: K }> | undefined;
  const business = first("business");
  const place = first("place");
  const service = first("service");
  const image = first("image");
  const person = first("person");
  return {
    map: business?.name ?? place?.name ?? null,
    folder: service?.name ?? null,
    photograph: image?.name ?? image?.fileName ?? null,
    notebook: person?.person.name ?? null,
  };
}
