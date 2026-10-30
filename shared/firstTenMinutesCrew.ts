import type {
  CompanionId,
  FindingPayload,
  FindingView,
  PersonRef,
  RouteStop,
} from "./firstTenMinutesFindings";

/**
 * The crew gets acquainted (slice 3, Astra 1:00-2:30, in Adam's presentation): one scene, one reveal per companion,
 * each from the person's own things, each source on tap and correctable. The person's words open it (Sable). A
 * companion with nothing worthwhile to reveal waits, and says nothing.
 *
 * Every line here is authored. Slots are filled only from verified findings; a line whose fact is missing is not said.
 */

export const CREW_ORDER: readonly CompanionId[] = ["sable", "mara", "rook", "bront", "luma", "orren", "ilex"];

type Of<K extends FindingPayload["kind"]> = Extract<FindingPayload, { kind: K }>;

export type PlacePin = {
  findingId: string;
  name: string;
  lat: number;
  lng: number;
  /** who asked from there, and when, from the person's own mail */
  asked: { who: string; at: string } | null;
};

export type Reveal =
  | { companion: "sable"; kind: "rule" | "promise"; finding: FindingView; quote: string; to: string | null; at: string; days: number[] }
  | { companion: "mara"; kind: "places"; findings: FindingView[]; pins: PlacePin[]; unpinned: string[]; clustered: boolean; category: string | null }
  | { companion: "rook"; kind: "habit"; finding: FindingView; examples: string[] }
  | {
      companion: "bront";
      kind: "contrast";
      finding: FindingView;
      a: { line: string; quote: string; who: string | null };
      b: { line: string; quote: string; who: string | null };
    }
  | { companion: "luma"; kind: "image"; finding: FindingView; name: string | null; uses: number; inWhat: "proposals" | "emails" }
  | {
      companion: "orren";
      kind: "route";
      finding: FindingView;
      title: string;
      weekday: number;
      stops: RouteStop[];
      meets: { placeFindingId: string; placeName: string; along: "street" | "nearby" } | null;
    }
  | {
      companion: "ilex";
      kind: "opportunity";
      finding: FindingView;
      person: PersonRef;
      placeFindingId: string | null;
      placeName: string | null;
    };

const live = (finding: FindingView) => finding.status !== "dismissed" && finding.status !== "changed";
const isKind =
  <K extends FindingPayload["kind"]>(kind: K) =>
  (finding: FindingView): finding is FindingView & { payload: Of<K> } =>
    finding.payload.kind === kind;
const nameOf = (person: PersonRef | null) => person?.name ?? person?.address ?? null;

const DAY_WORDS: Array<[RegExp, number[]]> = [
  [/\bsundays?\b/i, [0]],
  [/\bmondays?\b/i, [1]],
  [/\btuesdays?\b/i, [2]],
  [/\bwednesdays?\b/i, [3]],
  [/\bthursdays?\b/i, [4]],
  [/\bfridays?\b/i, [5]],
  [/\bsaturdays?\b/i, [6]],
  [/\bweekends?\b/i, [0, 6]],
];

/** The days a rule is about, when it names any ("No more Sunday deliveries." is about Sunday). */
export function ruleDays(text: string): number[] {
  const days = new Set<number>();
  for (const [pattern, which] of DAY_WORDS) if (pattern.test(text)) which.forEach(day => days.add(day));
  return [...days].sort();
}

/**
 * Who has something to reveal now. Mara's pins, Orren's route and Ilex's opportunity are only final when the reading
 * is (coordinates and the opportunity come last), so until then they don't step in.
 */
export function buildReveals(
  findings: readonly FindingView[],
  options: { final: boolean; includeCorrected?: boolean } = { final: true }
): Reveal[] {
  // What the crew may reveal is only what still stands. What is already on the desk stays there when corrected,
  // greyed, so the person sees their correction took (includeCorrected).
  const usable = options.includeCorrected ? [...findings] : findings.filter(live);
  const reveals: Reveal[] = [];
  const byId = new Map(findings.map(finding => [finding.id, finding]));

  // Sable: the person's own rule, else their own promise.
  const rule = usable.filter(isKind("rule")).sort((a, b) => Number(Boolean(b.payload.saidTo)) - Number(Boolean(a.payload.saidTo)))[0];
  const promise = usable.filter(isKind("promise"))[0];
  if (rule) {
    reveals.push({
      companion: "sable",
      kind: "rule",
      finding: rule,
      quote: rule.payload.quote,
      to: nameOf(rule.payload.saidTo),
      at: rule.payload.at,
      days: ruleDays(`${rule.payload.quote} ${rule.payload.statement}`),
    });
  } else if (promise) {
    reveals.push({ companion: "sable", kind: "promise", finding: promise, quote: promise.payload.quote, to: nameOf(promise.payload.madeTo), at: promise.payload.at, days: [] });
  }

  // Mara: the places that wrote, on a map when they have coordinates.
  const requests = usable.filter(isKind("request"));
  const places = usable.filter(isKind("place"));
  if (places.length >= 2) {
    const askedFrom = (place: FindingView & { payload: Of<"place"> }) => {
      const request = requests
        .filter(candidate => place.payload.people.some(person => person.address === candidate.payload.from.address))
        .sort((a, b) => a.payload.at.localeCompare(b.payload.at))[0];
      return request ? { who: nameOf(request.payload.from) ?? "someone", at: request.payload.at } : null;
    };
    const pins: PlacePin[] = places
      .filter(place => place.payload.lat !== null && place.payload.lng !== null)
      .map(place => ({ findingId: place.id, name: place.payload.name, lat: place.payload.lat!, lng: place.payload.lng!, asked: askedFrom(place) }));
    const categories = new Set(places.map(place => place.payload.category).filter(Boolean));
    reveals.push({
      companion: "mara",
      kind: "places",
      findings: places,
      pins,
      unpinned: places.filter(place => place.payload.lat === null).map(place => place.payload.name),
      clustered: pins.length >= 2 && pins.length === places.length && clustered(pins),
      category: categories.size === 1 ? [...categories][0]! : null,
    });
  }

  const habit = usable.filter(isKind("habit"))[0];
  if (habit) reveals.push({ companion: "rook", kind: "habit", finding: habit, examples: habit.payload.examples.slice(0, 2) });

  const contrast = usable.filter(isKind("contrast"))[0];
  if (contrast) {
    const side = (id: string, line: string) => {
      const request = byId.get(id);
      const payload = request?.payload.kind === "request" ? request.payload : null;
      return { line, quote: payload?.quote ?? "", who: payload ? nameOf(payload.from) : null };
    };
    const a = side(contrast.payload.aRequestId, contrast.payload.aLine);
    const b = side(contrast.payload.bRequestId, contrast.payload.bLine);
    if (a.quote && b.quote) reveals.push({ companion: "bront", kind: "contrast", finding: contrast, a, b });
  }

  const image = usable.filter(isKind("image"))[0];
  if (image) reveals.push({ companion: "luma", kind: "image", finding: image, name: image.payload.name, uses: image.payload.uses, inWhat: image.payload.inWhat });

  const route = usable.filter(isKind("route"))[0];
  const opportunity = usable.filter(isKind("opportunity"))[0];
  if (route) {
    const place = opportunity?.payload.routeId === route.id && opportunity.payload.placeId ? byId.get(opportunity.payload.placeId) : undefined;
    reveals.push({
      companion: "orren",
      kind: "route",
      finding: route,
      title: route.payload.title,
      weekday: route.payload.weekday,
      stops: route.payload.stops,
      meets:
        place && place.payload.kind === "place" && opportunity?.payload.along
          ? { placeFindingId: place.id, placeName: place.payload.name, along: opportunity.payload.along }
          : null,
    });
  }

  if (opportunity) {
    const place = opportunity.payload.placeId ? byId.get(opportunity.payload.placeId) : undefined;
    reveals.push({
      companion: "ilex",
      kind: "opportunity",
      finding: opportunity,
      person: opportunity.payload.person,
      placeFindingId: place?.id ?? null,
      placeName: place?.payload.kind === "place" ? place.payload.name : null,
    });
  }
  const lateCompanions = new Set<CompanionId>(["mara", "orren", "ilex"]);
  return reveals
    .filter(reveal => options.final || !lateCompanions.has(reveal.companion))
    .sort((a, b) => CREW_ORDER.indexOf(a.companion) - CREW_ORDER.indexOf(b.companion));
}

/** Companions who have nothing to reveal yet. While the reading runs they may still; once it's done, they wait. */
export function waitingCompanions(reveals: readonly Reveal[]): CompanionId[] {
  const present = new Set(reveals.map(reveal => reveal.companion));
  return CREW_ORDER.filter(companion => !present.has(companion));
}

/**
 * Whose turn it is: the first companion, in order, with something to reveal who hasn't had their turn. A turn under
 * way is kept to its end, with its finding as it stands now: Sable's answer can cross out the very words she pointed
 * at, and she still says her line about them before anyone else steps in.
 */
export function turnNow(
  reveals: readonly Reveal[],
  seen: readonly CompanionId[],
  findings: readonly FindingView[],
  underWay: Reveal | null = null
): Reveal | null {
  if (underWay && !seen.includes(underWay.companion)) {
    if (underWay.companion === "mara") return underWay;
    const finding = findings.find(candidate => candidate.id === underWay.finding.id) ?? underWay.finding;
    return { ...underWay, finding };
  }
  const next = CREW_ORDER.find(who => !seen.includes(who) && reveals.some(reveal => reveal.companion === who));
  return reveals.find(reveal => reveal.companion === next) ?? null;
}

function clustered(pins: PlacePin[], radiusMetres = 2_500): boolean {
  const centre = { lat: pins.reduce((sum, pin) => sum + pin.lat, 0) / pins.length, lng: pins.reduce((sum, pin) => sum + pin.lng, 0) / pins.length };
  const rad = (value: number) => (value * Math.PI) / 180;
  return pins.every(pin => {
    const dLat = rad(pin.lat - centre.lat);
    const dLng = rad(pin.lng - centre.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(centre.lat)) * Math.cos(rad(pin.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h)) <= radiusMetres;
  });
}

// ------------------------------------------------------------------ what they say

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function numberWord(value: number): string {
  return NUMBER_WORDS[value] ?? String(value);
}

/** "Friday deliveries" from "Friday delivery". */
export function pluralTitle(title: string): string {
  const trimmed = title.trim();
  if (/s$/i.test(trimmed)) return trimmed;
  if (/[^aeiou]y$/i.test(trimmed)) return `${trimmed.slice(0, -1)}ies`;
  return `${trimmed}s`;
}

/**
 * What each companion says, in order: the first line when they step in, an optional second after a beat. Astra's
 * words wherever she wrote them; Adam's "Still true?" for Sable. One short line, mostly.
 */
export function crewLines(reveal: Reveal): string[] {
  switch (reveal.companion) {
    case "sable":
      return [reveal.kind === "rule" ? "Still true?" : "Still on?"];
    case "mara":
      if (!reveal.pins.length) return ["Not on the map yet."];
      return [reveal.clustered ? "That's a small map with quite a lot happening on it." : "That's a big map with quite a lot happening on it."];
    case "rook":
      return ["You tend to finish with a real question.", "I can work with that."];
    case "bront":
      return [reveal.a.line, reveal.b.line];
    case "luma": {
      const what = reveal.inWhat === "proposals" ? "proposals" : "emails";
      return [`This one keeps coming back. ${numberWord(reveal.uses)} ${what}.${reveal.name ? ` Same ${reveal.name}.` : ""}`, "I've kept the original."];
    }
    case "orren": {
      const routes = pluralTitle(reveal.title);
      if (reveal.meets?.along === "street") return [`Your ${routes} already pass this street.`];
      if (reveal.meets?.along === "nearby") return [`Your ${routes} already stop nearby.`];
      return [`Every ${WEEKDAY_NAMES[reveal.weekday]}, the same way round.`];
    }
    case "ilex":
      return ["There's an older conversation we should put beside this."];
  }
}

/** Sable, after the person answers. */
export const SABLE_AFTER = {
  confirmed: "Then we'll work around it.",
  changed: "Then I'll cross it out.",
} as const;

/** What each says when the person corrects them. Short, and never arguing. */
export const CORRECTED_LINES: Record<CompanionId, string> = {
  sable: "Crossed out.",
  mara: "Off the map, then.",
  rook: "Struck.",
  bront: "Off the menu.",
  luma: "Back in the drawer.",
  orren: "Rerouted.",
  ilex: "Unthreaded.",
};

/**
 * What the person's confirmed rules mean for later suggestions: the days nothing may be proposed on, and the rules in
 * their own words. Read by the draft and the chapter (later slices) and by Claire.
 */
export function suggestionRules(findings: readonly FindingView[]): { closedDays: number[]; rules: string[] } {
  const confirmed = findings.filter(finding => finding.payload.kind === "rule" && finding.status === "confirmed");
  const closed = new Set<number>();
  const rules: string[] = [];
  for (const finding of confirmed) {
    if (finding.payload.kind !== "rule") continue;
    rules.push(finding.payload.quote);
    if (/\b(no|never|not|stop|without)\b/i.test(finding.payload.quote) || /\b(no|never|not|stop)\b/i.test(finding.payload.statement)) {
      ruleDays(`${finding.payload.quote} ${finding.payload.statement}`).forEach(day => closed.add(day));
    }
  }
  return { closedDays: [...closed].sort(), rules };
}
