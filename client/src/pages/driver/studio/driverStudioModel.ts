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
  scene: DriverSceneId;
  jobs: DayPlanStop[];
};

const squash = (v: string | null | undefined) =>
  (v ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function chooseDriverScene(stop: Pick<DayPlanStop, "title" | "address" | "physicalEntityId">): DriverSceneId {
  const place = [stop.physicalEntityId, stop.title, stop.address].filter(Boolean).join(" ").toLowerCase();
  const compact = squash(place);
  if (/century park east|century park e|centurypark/.test(place) || compact.includes("centuryparkeast")) return "century-park-east";
  if (place.includes("opus") || /3545\s+wilshire/.test(place)) return "opus";
  if (place.includes("silver lake") || place.includes("silverlake")) return "silver-lake";
  if (place.includes("beverly hills") || place.includes("kith treats")) return "beverly-hills";
  if (place.includes("koreatown") || place.includes("k-town")) return "koreatown";
  if (place.includes("hollywood") && !place.includes("east hollywood")) return "hollywood";
  return "plain";
}

/** Only existing, checked-in game imagery. No generated facsimiles of shipped games. */
export const SCENES: Record<DriverSceneId, { label: string; image: string | null; position: string; effect: string }> = {
  "silver-lake": {
    label: "Silver Lake courtyard",
    image: "/joystick/gameplay/silver-lake.jpg",
    position: "50% 40%",
    effect: "The courtyard responds",
  },
  "beverly-hills": {
    label: "The Other Rodeo",
    image: "/assets/goldline/beverly-hills-2d/01-look.png",
    position: "center",
    effect: "The herd stirs",
  },
  "century-park-east": {
    label: "Century Park East / building cutaway",
    image: "/joystick/gameplay/century-park-east.jpg",
    position: "center 45%",
    effect: "The building responds",
  },
  "opus": {
    label: "OPUS clubhouse concept",
    image: "/goldline/opus-clubhouse/room.webp",
    position: "50% 50%",
    effect: "The clubhouse reacts",
  },
  "koreatown": {
    label: "Koreatown",
    image: "/joystick/driver-studio/koreatown-boba.svg",
    position: "center",
    effect: "The boba shop responds",
  },
  "hollywood": {
    label: "Hollywood",
    image: null,
    position: "center",
    effect: "The neighborhood responds",
  },
  plain: { label: "Business stop", image: null, position: "center", effect: "Job recorded" },
};

/** Parse time labels conservatively. Returns null when a schedule cannot be read. */
export function timeOfStop(label: string): number | null {
  const match = label.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (!match) return null;
  const h = Number(match[1]);
  if (h < 1 || h > 12) return null;
  return (h % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)) * 60 + Number(match[2] ?? "0");
}

/** Group consecutive jobs at the same address within 30 minutes. Do not merge distinct visits. */
export function groupRouteVisits(stops: DayPlanStop[]): RouteVisit[] {
  const visits: RouteVisit[] = [];
  for (const job of stops) {
    // Processing and intake movements are not customer visit cards.
    if (job.kind === "processing" || job.status === "cancelled" || (job.source === "derived_operation" && /\\b(jetro|lugos|lugo.s lavanderia)\\b/i.test(job.title))) continue;
    const key = squash(job.address);
    const t = timeOfStop(job.timeLabel);
    const previous = visits[visits.length - 1];
    const lastJob = previous?.jobs[previous.jobs.length - 1];
    const previousTime = lastJob ? timeOfStop(lastJob.timeLabel) : null;
    const samePhysicalPlace = Boolean(key && lastJob && squash(lastJob.address) === key);
    const sameTime = t !== null && previousTime !== null && Math.abs(t - previousTime) <= 30;
    if (previous && samePhysicalPlace && sameTime) {
      previous.jobs.push(job);
    } else {
      visits.push({
        id: job.id,
        location: job.title,
        address: job.address,
        timeLabel: job.timeLabel,
        scene: chooseDriverScene(job),
        jobs: [job],
      });
    }
  }
  return visits;
}

export function hasSavedJob(stop: DayPlanStop, savedIds: ReadonlySet<string>) {
  return stop.status === "completed" || savedIds.has(stop.id);
}

export function formatJobKind(kind: DayPlanStop["kind"]) {
  return kind === "pickup" ? "PICK UP" : kind === "dropoff" ? "DROP OFF" : kind.toUpperCase();
}

export function canHoldToComplete(stop: DayPlanStop): boolean {
  return Boolean((stop.kind === "pickup" || stop.kind === "dropoff") && stop.action && stop.status !== "blocked" && stop.status !== "cancelled" && stop.status !== "completed" &&
    (stop.action.type !== "order" || stop.action.eligible));
}
