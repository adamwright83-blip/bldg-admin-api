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

export type TerritoryBundleHint = {
  territoryId: string;
  memberPhysicalEntityIds: readonly string[];
};

function distanceSquared(a: GoldlineObjective, b: GoldlineObjective) {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return Number.POSITIVE_INFINITY;
  return (a.latitude - b.latitude) ** 2 + (a.longitude - b.longitude) ** 2;
}

function sameTerritory(
  a: GoldlineObjective,
  b: GoldlineObjective,
  bundles: readonly TerritoryBundleHint[]
): boolean {
  if (!a.physicalEntityId || !b.physicalEntityId) return false;
  return bundles.some(
    bundle =>
      bundle.memberPhysicalEntityIds.includes(a.physicalEntityId!) &&
      bundle.memberPhysicalEntityIds.includes(b.physicalEntityId!)
  );
}

/**
 * Reality-first procedural compiler. Fixed commitments are ordered by their
 * real windows before flexible work is inserted; completed/blocked work never
 * reappears as an objective. The output references authoritative IDs only.
 *
 * Territory bundles may only regroup legitimate existing work. They cannot
 * invent a visit, hide a delivery, or promote fiction over an obligation.
 */
export function compileGoldlineAdventure(input: {
  date: string;
  objectives: GoldlineObjective[];
  territoryBundles?: readonly TerritoryBundleHint[];
}): { ordered: GoldlineObjective[]; chapters: AdventureChapter[] } {
  const bundles = input.territoryBundles ?? [];
  const scoredDistance = (a: GoldlineObjective, b: GoldlineObjective) => {
    const raw = distanceSquared(a, b);
    if (!Number.isFinite(raw)) return raw;
    return sameTerritory(a, b, bundles) ? raw * 0.2 : raw;
  };
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
      scoredDistance(anchor, a) - scoredDistance(anchor, b) || b.priority - a.priority || a.id.localeCompare(b.id)
    )[0];
    if (nearby && scoredDistance(anchor, nearby) < 0.015) {
      ordered.push(nearby);
      remaining.delete(nearby.id);
    }
    ordered.push(commitment);
  }
  let anchor = ordered[ordered.length - 1] ?? null;
  while (remaining.size) {
    const next = Array.from(remaining.values()).sort((a, b) => {
      if (!anchor) return b.priority - a.priority || a.id.localeCompare(b.id);
      return scoredDistance(anchor, a) - scoredDistance(anchor, b) || b.priority - a.priority || a.id.localeCompare(b.id);
    })[0]!;
    ordered.push(next);
    remaining.delete(next.id);
    anchor = next;
  }
  const chapters: AdventureChapter[] = [];
  for (const objective of ordered) {
    const previous = chapters[chapters.length - 1];
    const fixedChapter = objective.authority === "fixed_commitment";
    const territory = bundles.find(bundle =>
      objective.physicalEntityId
        ? bundle.memberPhysicalEntityIds.includes(objective.physicalEntityId)
        : false
    );
    const label = fixedChapter
      ? "Commitments"
      : territory
        ? "Territory corridor"
        : "Opportunity corridor";
    if (!previous || previous.fixed !== fixedChapter || previous.label !== label || previous.objectiveIds.length >= 4)
      chapters.push({
        id: `${input.date}:${chapters.length + 1}`,
        label,
        objectiveIds: [objective.id],
        fixed: fixedChapter,
      });
    else previous.objectiveIds.push(objective.id);
  }
  return { ordered, chapters };
}

