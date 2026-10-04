import type { Layout } from "./grid";
import { GUEST_ORDER, type GuestId } from "./guests";

export type AnatomyProject = "lining_stairs" | "strap_hammock" | "pocket_loft";
export type KeepsakeKind = "ticket" | "bun" | "bookmark";

export interface ResidentState {
  guest: GuestId;
  arrivedOrder: number;
  branch: string;
}

export interface KeepsakeState {
  guest: GuestId;
  kind: KeepsakeKind;
  text: string;
}

export interface EpisodeState {
  residents: ResidentState[];
  keepsakes: KeepsakeState[];
  projects: AnatomyProject[];
  arrivals: number;
}

export const emptyEpisode = (): EpisodeState => ({
  residents: [],
  keepsakes: [],
  projects: [],
  arrivals: 0,
});

const KEEPSAKES: Record<GuestId, Omit<KeepsakeState, "guest">> = {
  conductor: {
    kind: "ticket",
    text: "A punched railway ticket, tucked beside the window.",
  },
  baker: {
    kind: "bun",
    text: "One tiny bun, wrapped in paper for whoever wakes first.",
  },
  reader: {
    kind: "bookmark",
    text: "A paper bookmark with a furious note about chapter nine.",
  },
};

export function normalizeEpisode(input: Partial<EpisodeState> | null | undefined): EpisodeState {
  const residents = Array.isArray(input?.residents)
    ? input!.residents.filter((r): r is ResidentState => Boolean(r && GUEST_ORDER.includes(r.guest)))
    : [];
  const keepsakes = Array.isArray(input?.keepsakes)
    ? input!.keepsakes.filter((k): k is KeepsakeState => Boolean(k && GUEST_ORDER.includes(k.guest)))
    : [];
  const projects = Array.isArray(input?.projects)
    ? input!.projects.filter((p): p is AnatomyProject => ["lining_stairs", "strap_hammock", "pocket_loft"].includes(p))
    : [];
  return {
    residents,
    keepsakes,
    projects: [...new Set(projects)],
    arrivals: Math.max(Number(input?.arrivals ?? residents.length) || 0, residents.length),
  };
}

export function nextArrival(state: EpisodeState): GuestId | null {
  const present = new Set(state.residents.map(r => r.guest));
  return GUEST_ORDER.find(guest => !present.has(guest)) ?? null;
}

export function completeStay(state: EpisodeState, guest: GuestId, branch: string): EpisodeState {
  if (state.residents.some(r => r.guest === guest)) return state;
  const keepsake = KEEPSAKES[guest];
  return {
    ...state,
    arrivals: state.arrivals + 1,
    residents: [...state.residents, { guest, branch, arrivedOrder: state.arrivals + 1 }],
    keepsakes: [...state.keepsakes, { guest, ...keepsake }],
  };
}

export function projectStatus(
  project: AnatomyProject,
  state: EpisodeState,
  layout: Layout,
): { available: boolean; complete: boolean; reason: string } {
  const complete = state.projects.includes(project);
  if (complete) return { available: false, complete: true, reason: "Already part of the suitcase." };

  if (project === "lining_stairs") {
    if (!layout.windowCut) return { available: false, complete: false, reason: "Cut the lining first." };
    return { available: true, complete: false, reason: "Fold the loose lining into steps." };
  }

  if (project === "strap_hammock") {
    if (state.residents.length < 1) return { available: false, complete: false, reason: "Let someone stay first." };
    return { available: true, complete: false, reason: "Tension the luggage straps into a hammock." };
  }

  if (!state.projects.includes("lining_stairs")) {
    return { available: false, complete: false, reason: "The pocket is too high to reach." };
  }
  return { available: true, complete: false, reason: "Open the satin pocket into a little loft." };
}

export function completeProject(state: EpisodeState, project: AnatomyProject): EpisodeState {
  if (state.projects.includes(project)) return state;
  return { ...state, projects: [...state.projects, project] };
}

export function roomCapacity(state: EpisodeState): number {
  let capacity = 1;
  if (state.projects.includes("strap_hammock")) capacity += 1;
  if (state.projects.includes("pocket_loft")) capacity += 1;
  return capacity;
}

export function arrivalGate(state: EpisodeState): { canRing: boolean; reason: string } {
  if (!nextArrival(state)) return { canRing: false, reason: "Everyone on this little line is already here." };
  const capacity = roomCapacity(state);
  if (state.residents.length >= capacity) {
    if (!state.projects.includes("strap_hammock")) {
      return { canRing: false, reason: "No spare sleeping place. The luggage straps could become one." };
    }
    if (!state.projects.includes("pocket_loft")) {
      return { canRing: false, reason: "The hotel is full. The lid pocket could become another room." };
    }
    return { canRing: false, reason: "The suitcase is full tonight." };
  }
  return { canRing: true, reason: "Open the hotel to the next arrival." };
}

export function episodeLine(state: EpisodeState): string {
  const count = state.residents.length;
  if (!count) return "No one lives here yet.";
  if (count === 1) return "1 traveler now calls the suitcase home.";
  return `${count} travelers share the suitcase now.`;
}
