export type GoldlineObjective = {
  id: string;
  physicalEntityId: string | null;
  kind: "pickup" | "delivery" | "commercial_visit" | "follow_up" | "recovery" | "field_capture";
  authority: "fixed_commitment" | "persisted_task" | "derived_recommendation";
  status: "ready" | "completed" | "blocked";
  latitude: number | null;
  longitude: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  priority: number;
  explanation: string;
  sourceEvidenceReference: string;
};

export type AdventureChapter = {
  id: string;
  label: string;
  objectiveIds: string[];
  fixed: boolean;
};

function distanceSquared(a: GoldlineObjective, b: GoldlineObjective) {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return Number.POSITIVE_INFINITY;
  return (a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2;
}

/**
 * Reality-first procedural compiler. Fixed commitments are ordered by their
 * real windows before flexible work is inserted; completed/blocked work never
 * reappears as an objective. The output references authoritative IDs only.
 */
export function compileGoldlineAdventure(input: { date: string; objectives: GoldlineObjective[] }): { ordered: GoldlineObjective[]; chapters: AdventureChapter[] } {
  const available = input.objectives.filter(item => item.status === "ready");
  const fixed = available.filter(item => item.authority === "fixed_commitment").sort((a, b) =>
    (a.windowStart ?? "9999").localeCompare(b.windowStart ?? "9999") || b.priority - a.priority || a.id.localeCompare(b.id)
  );
  const flexible = available.filter(item => item.authority !== "fixed_commitment");
  const ordered: GoldlineObjective[] = [];
  const remaining = new Map(flexible.map(item => [item.id, item]));
  for (const commitment of fixed) {
    const anchor = ordered[ordered.length - 1] ?? commitment;
    const nearby = Array.from(remaining.values()).sort((a, b) =>
      distanceSquared(anchor, a) - distanceSquared(anchor, b) || b.priority - a.priority || a.id.localeCompare(b.id)
    )[0];
    if (nearby && distanceSquared(anchor, nearby) < 0.015) {
      ordered.push(nearby);
      remaining.delete(nearby.id);
    }
    ordered.push(commitment);
  }
  let anchor = ordered[ordered.length - 1] ?? null;
  while (remaining.size) {
    const next = Array.from(remaining.values()).sort((a, b) => {
      if (!anchor) return b.priority - a.priority || a.id.localeCompare(b.id);
      return distanceSquared(anchor, a) - distanceSquared(anchor, b) || b.priority - a.priority || a.id.localeCompare(b.id);
    })[0]!;
    ordered.push(next);
    remaining.delete(next.id);
    anchor = next;
  }
  const chapters: AdventureChapter[] = [];
  for (const objective of ordered) {
    const previous = chapters[chapters.length - 1];
    const fixedChapter = objective.authority === "fixed_commitment";
    if (!previous || previous.fixed !== fixedChapter || previous.objectiveIds.length >= 4) chapters.push({ id: `${input.date}:${chapters.length + 1}`, label: fixedChapter ? "Commitments" : "Opportunity corridor", objectiveIds: [objective.id], fixed: fixedChapter });
    else previous.objectiveIds.push(objective.id);
  }
  return { ordered, chapters };
}

