import { normalizePropertyTower } from "@shared/propertyTowers";
import { pickupSyncLabel } from "@shared/cleancloudPickup";
import type { DayPlanStop } from "../goldlineDayPlanModel";

/**
 * Presentation ONLY. All real completion authority stays in the original
 * onResolveStop service. No scene or animation ever writes order status.
 */
export type DriverSceneId =
  | "silver-lake" | "beverly-hills" | "century-park-east"
  | "opus" | "koreatown" | "hollywood" | "plain";

export type RouteVisit = {
  id: string;
  location: string;
  address: string | null;
  timeLabel: string;
  /** Minutes after midnight of the first job, when the source gives a real time. */
  minutes: number | null;
  scene: DriverSceneId;
  jobs: DayPlanStop[];
};

const squash = (v: string | null | undefined) =>
  (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Scene choice reads only place evidence: the building the stop is already
 * linked to, then the canonical tower registry, then the locality written in
 * the address. Customer names never choose a world.
 */
export function chooseDriverScene(stop: Pick<DayPlanStop, "address" | "physicalEntityId">): DriverSceneId {
  const entity = (stop.physicalEntityId ?? "").toLowerCase();
  if (entity.includes("century_park_east") || entity.includes("century-park-east")) return "century-park-east";
  if (entity.includes("opus")) return "opus";
  const tower = normalizePropertyTower(stop.address);
  if (tower.propertyGroup === "century_park_east") return "century-park-east";
  if (tower.propertyGroup === "opus_la") return "opus";
  const place = (stop.address ?? "").toLowerCase();
  if (/\bcentury park e(ast)?\b/.test(place)) return "century-park-east";
  if (/\bsilver ?lake\b/.test(place)) return "silver-lake";
  if (/\bbeverly hills\b/.test(place)) return "beverly-hills";
  if (/\bkoreatown\b|\bk-town\b/.test(place)) return "koreatown";
  if (/\bhollywood\b/.test(place) && !/\b(east|west|north) hollywood\b/.test(place)) return "hollywood";
  return "plain";
}

export type SceneArt = {
  label: string;
  /** Headline for the visit; null keeps the stop's own title. */
  title: string | null;
  image: string | null;
  /** Intrinsic pixel size of `image`, so effects can be anchored to the art itself. */
  size: readonly [number, number];
  /** Which part of the art stays in frame when the screen crops it (CSS object-position). */
  focus: string;
  effect: string;
  /** Concept art is never presented as shipped gameplay. */
  concept?: boolean;
  /** Lantern City's painting of the neighbourhood, used where no game exists. */
  territory?: boolean;
  /** Obvious stand-in art to be replaced. */
  placeholder?: boolean;
};

/** Only existing, checked-in game imagery. No generated facsimiles of shipped games. */
export const SCENES: Record<DriverSceneId, SceneArt> = {
  "silver-lake": {
    label: "Silver Lake courtyard",
    title: "Silver Lake",
    image: "/joystick/gameplay/silver-lake.jpg",
    size: [1280, 880],
    focus: "42% 50%",
    effect: "Fennel and Bella wave from the courtyard",
  },
  "beverly-hills": {
    label: "The Other Rodeo",
    title: "Beverly Hills",
    image: "/assets/goldline/beverly-hills-2d/01-look.png",
    size: [1536, 1024],
    focus: "55% 60%",
    effect: "The herd stirs",
  },
  "century-park-east": {
    label: "Century Park East · building cutaway",
    title: "Century Park East",
    image: "/joystick/gameplay/century-park-east.jpg",
    size: [960, 660],
    focus: "50% 62%",
    effect: "The floors light up",
  },
  opus: {
    label: "OPUS LA clubhouse · concept art",
    title: "OPUS LA",
    image: "/goldline/opus-clubhouse/room.webp",
    size: [1672, 526],
    focus: "28% 50%",
    effect: "The tower model fills with light",
    concept: true,
  },
  koreatown: {
    label: "Koreatown boba shop",
    title: "Koreatown",
    image: "/joystick/driver-studio/koreatown-boba.svg",
    size: [1000, 590],
    focus: "50% 55%",
    effect: "Fresh boba on the counter",
  },
  hollywood: {
    label: "Hollywood",
    title: "Hollywood",
    image: null,
    size: [1, 1],
    focus: "center",
    effect: "Job recorded",
  },
  plain: { label: "Business stop", title: null, image: null, size: [1, 1], focus: "center", effect: "Job recorded" },
};

/** Neighbourhoods with a committed Lantern City painting (v6 territories, healthy state). */
const LANTERN_TERRITORIES: Array<[slug: string, name: string]> = [
  ["arts-district", "Arts District"], ["beverly-hills", "Beverly Hills"], ["century-city", "Century City"],
  ["downtown", "Downtown"], ["east-hollywood", "East Hollywood"], ["echo-park", "Echo Park"],
  ["hollywood-hills-west", "Hollywood Hills West"], ["hollywood", "Hollywood"], ["koreatown", "Koreatown"],
  ["los-feliz", "Los Feliz"], ["mid-city", "Mid-City"], ["silver-lake", "Silver Lake"],
  ["west-hollywood", "West Hollywood"], ["westlake", "Westlake"],
];

/** The Lantern City territory named in the stop's address, longest name first. */
export function territoryOf(address: string | null | undefined): { slug: string; name: string } | null {
  const place = (address ?? "").toLowerCase().replace(/[-\s]+/g, " ");
  const hit = [...LANTERN_TERRITORIES]
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, name]) => new RegExp(`\\b${name.toLowerCase().replace(/-/g, " ")}\\b`).test(place));
  return hit ? { slug: hit[0], name: hit[1] } : null;
}

export const PLACEHOLDER_ART: SceneArt = {
  label: "Placeholder art · replace",
  title: null,
  image: "/joystick/driver-studio/placeholder-stop.svg",
  size: [1000, 590],
  focus: "50% 50%",
  effect: "Job recorded",
  placeholder: true,
};

/**
 * Every visit gets a picture: its game's art, else Lantern City's painting of
 * the neighbourhood, else an obvious placeholder.
 */
export function artFor(visit: Pick<RouteVisit, "scene" | "address">): SceneArt {
  const game = SCENES[visit.scene];
  if (game.image) return game;
  const territory = territoryOf(visit.address);
  if (territory) {
    return {
      label: `Lantern City · ${territory.name}`,
      title: game.title,
      image: `/assets/goldline/lantern-city/v6/territories/${territory.slug}/healthy.png`,
      size: [1536, 994],
      focus: "50% 45%",
      effect: "Lantern City brightens",
      territory: true,
    };
  }
  return { ...PLACEHOLDER_ART, title: game.title };
}

export function visitTitle(visit: Pick<RouteVisit, "scene" | "location">) {
  return SCENES[visit.scene].title ?? visit.location;
}

/** Parse time labels conservatively. Returns null when a schedule cannot be read. */
export function timeOfStop(label: string): number | null {
  const match = label.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return null;
  const h = Number(match[1]);
  if (h < 1 || h > 12) return null;
  return (h % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match[2] ?? "0");
}

/**
 * A stop's scheduled minute of day. The projection already normalizes every
 * source window into a 24h `HH:MM` sortKey (CleanCloud sends "07:00", operations
 * write "1:30–2:30"); sentinel keys (60:00 and up) and ISO deadlines mean no
 * fixed time, which stays unknown rather than guessed.
 */
export function minutesOfStop(stop: Pick<DayPlanStop, "sortKey" | "timeLabel">): number | null {
  const key = stop.sortKey.match(/^(\d{2}):(\d{2})(?!\d)/);
  if (key) {
    const h = Number(key[1]);
    const m = Number(key[2]);
    if (h < 24 && m < 60) return h * 60 + m;
    return null;
  }
  return timeOfStop(stop.timeLabel);
}

export const EVENING_FROM_MINUTES = 17 * 60;

export function visitPeriod(visit: Pick<RouteVisit, "minutes">): "day" | "evening" {
  return visit.minutes !== null && visit.minutes >= EVENING_FROM_MINUTES ? "evening" : "day";
}

/** Supplier runs (JETRO restocks, Lugo's processing hand-offs) the operator excluded from the driver route. */
export function isExcludedSupplierLogistics(job: Pick<DayPlanStop, "source" | "title">) {
  return job.source === "derived_operation" && /\b(jetro|lugos|lugo.s lavanderia)\b/i.test(job.title);
}

/**
 * One visit per building per time slot: jobs at the same address scheduled
 * within 30 minutes of each other share a card, each keeping its own id. A
 * later revisit to the same building is a separate visit.
 *
 * The projection re-ranks a stop once it is completed (finished work drops
 * out of the adventure order), so nothing here depends on adjacency: jobs
 * inside a visit are ordered by time then id, and visits by scheduled time,
 * keeping the list and the open card stable while the driver saves jobs.
 * Untimed work keeps its place after the timed visit it followed.
 */
export function groupRouteVisits(stops: DayPlanStop[]): RouteVisit[] {
  const groups: Array<{ key: string; order: number; jobs: DayPlanStop[] }> = [];
  stops.forEach((job, index) => {
    // Processing and intake movements are not customer visit cards.
    if (job.kind === "processing" || job.status === "cancelled" || isExcludedSupplierLogistics(job)) return;
    const key = squash(job.address);
    const t = minutesOfStop(job);
    const match = key && t !== null
      ? groups.find(g => g.key === key && g.jobs.some(j => {
          const other = minutesOfStop(j);
          return other !== null && Math.abs(other - t) <= 30;
        }))
      : undefined;
    if (match) {
      match.jobs.push(job);
      match.order = Math.min(match.order, index);
    } else {
      groups.push({ key, order: index, jobs: [job] });
    }
  });
  const visits = groups
    .sort((a, b) => a.order - b.order)
    .map(group => {
      const jobs = [...group.jobs].sort((a, b) =>
        (minutesOfStop(a) ?? Number.MAX_SAFE_INTEGER) - (minutesOfStop(b) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
      );
      const first = jobs[0];
      return {
        visit: {
          id: first.id,
          location: first.title,
          address: first.address,
          timeLabel: first.timeLabel,
          minutes: minutesOfStop(first),
          scene: chooseDriverScene(first),
          jobs,
        } satisfies RouteVisit,
        order: group.order,
      };
    });
  let lastTimed = -1;
  const anchored = visits.map(entry => {
    if (entry.visit.minutes !== null) lastTimed = entry.visit.minutes;
    return { ...entry, anchor: entry.visit.minutes ?? lastTimed };
  });
  return anchored
    .sort((a, b) => a.anchor - b.anchor || a.order - b.order)
    .map(entry => entry.visit);
}

/** Finds the selected visit again after a data refresh, even if its first job moved. */
export function findVisit(visits: RouteVisit[], visitId: string | null, jobIds: readonly string[] = []) {
  if (!visitId) return undefined;
  return visits.find(v => v.id === visitId) ?? visits.find(v => v.jobs.some(j => jobIds.includes(j.id)));
}

export function hasSavedJob(stop: DayPlanStop, savedIds: ReadonlySet<string>) {
  return stop.status === "completed" || savedIds.has(stop.id);
}

export function isVisitDone(visit: RouteVisit, savedIds: ReadonlySet<string>) {
  return visit.jobs.every(s => hasSavedJob(s, savedIds));
}

export function formatJobKind(kind: DayPlanStop["kind"]) {
  return kind === "pickup" ? "PICK UP" : kind === "dropoff" ? "DROP OFF" : kind.toUpperCase();
}

export function canHoldToComplete(stop: DayPlanStop): boolean {
  return Boolean((stop.kind === "pickup" || stop.kind === "dropoff") && stop.action && stop.status !== "blocked" && stop.status !== "cancelled" && stop.status !== "completed" &&
    (stop.action.type !== "order" || stop.action.eligible) &&
    (!stop.pickupBridge || stop.pickupBridge.state === "ready"));
}

export type JobTruth = {
  /** Short chip text. */
  label: string;
  tone: "ready" | "saved" | "pending" | "attention" | "synced" | "blocked";
  /** Full sentence for screen readers and the job card. */
  detail: string | null;
  canRetrySync: boolean;
};

/**
 * What a job's state honestly means. A local save is not an upstream
 * CleanCloud sync, and neither is ever a payment.
 */
export function jobTruth(stop: DayPlanStop, savedLocally: boolean): JobTruth {
  const bridge = stop.pickupBridge;
  const saved = savedLocally || stop.status === "completed";
  if (bridge && bridge.state !== "ready") {
    const detail = pickupSyncLabel(bridge);
    if (bridge.state === "synced") return { label: "CLEANCLOUD SYNCED", tone: "synced", detail, canRetrySync: false };
    if (bridge.state === "attention") return { label: "SYNC NEEDS ATTENTION", tone: "attention", detail: bridge.error ? `${detail}: ${bridge.error}` : detail, canRetrySync: true };
    if (bridge.state === "held") return { label: "ON HOLD", tone: "blocked", detail, canRetrySync: false };
    return { label: "SYNC PENDING", tone: "pending", detail, canRetrySync: false };
  }
  if (saved && bridge) {
    // Saved here, but the refreshed bridge state has not arrived yet.
    return { label: "SYNC PENDING", tone: "pending", detail: "Pickup saved · CleanCloud sync pending", canRetrySync: false };
  }
  if (saved) return { label: "SAVED", tone: "saved", detail: null, canRetrySync: false };
  if (stop.status === "blocked") return { label: "BLOCKED", tone: "blocked", detail: null, canRetrySync: false };
  return { label: "READY", tone: "ready", detail: null, canRetrySync: false };
}

export const HOLD_TO_CONFIRM_MS = 1100;
