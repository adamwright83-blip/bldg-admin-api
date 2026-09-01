/**
 * Territory compiler.
 *
 * Turns a set of real physical places into geographically coherent challenge
 * candidates. It does not invent members. If the world does not contain enough
 * real opportunities, it produces fewer — or zero — territories.
 *
 * Compilation is deterministic: the same source set yields the same candidate
 * membership, grammar, guardian and fantasy title. Publishing freezes that
 * definition; later compilations may propose future territories but must not
 * reshuffle an already-published member set.
 */

import {
  actionTypesForGrammar,
  stableHash,
  stableTerritoryKey,
  type TerritoryDefinition,
  type TerritoryGrammar,
  type TerritoryMember,
  type TerritorySourceOpportunity,
} from "./goldlineTerritories";
import { centroidOf, classifyGeometryMode, haversineKm } from "./goldlineTerritoryGeometry";
import { GUARDIAN_ROSTER_IDS, guardianIdForStableKey } from "./goldlineGuardians";

const MIN_MEMBERS = 3;
const MAX_MEMBERS = 8;
/** About half a mile. Dense enough to feel like a street, not a city-wide grab. */
const CLUSTER_RADIUS_KM = 0.85;

const VISIT_HUNT_TITLES = [
  "The Six Doors",
  "Mansion Street",
  "Crown Mile",
  "The Hidden Entrances",
  "Sun Key Row",
  "The Golden Thresholds",
];
const SILENCE_TITLES = [
  "The Quiet Bells",
  "Signal Towers",
  "Hush Court",
  "The Unanswered Mile",
];
const STANDARD_TITLES = [
  "The Golden Row",
  "Glass Kingdom",
  "Hancock Square",
  "Banner Walk",
];

export type TerritoryCandidate = {
  stableKey: string;
  grammar: TerritoryDefinition["grammar"];
  guardianId: string;
  fantasyTitle: string;
  realGeographyLabel: string | null;
  geometryMode: TerritoryDefinition["geometryMode"];
  members: TerritoryMember[];
  createdFrom: "territory_compiler";
};

function hasValidCoordinates(source: TerritorySourceOpportunity): boolean {
  return (
    Number.isFinite(source.latitude) &&
    Number.isFinite(source.longitude) &&
    source.latitude >= -90 &&
    source.latitude <= 90 &&
    source.longitude >= -180 &&
    source.longitude <= 180
  );
}

/**
 * Only unfinished real opportunities may form a production territory.
 * Won accounts stay in the world as themselves; they are not fabricated
 * into a hunt.
 */
export function eligibleTerritorySources(
  sources: readonly TerritorySourceOpportunity[]
): TerritorySourceOpportunity[] {
  return sources
    .filter(source => hasValidCoordinates(source))
    .filter(source => !source.isWonAccount)
    .filter(source => source.physicalEntityId.trim().length > 0)
    .slice()
    .sort((a, b) => a.physicalEntityId.localeCompare(b.physicalEntityId));
}

function grammarForCluster(
  members: readonly TerritorySourceOpportunity[]
): TerritoryGrammar {
  const visitNeed = members.filter(member => !member.hasVisitEvidence).length;
  const contactNeed = members.filter(member => !member.hasContactEvidence).length;
  const proposalNeed = members.filter(member => !member.hasProposalEvidence).length;
  if (visitNeed >= contactNeed && visitNeed >= proposalNeed && visitNeed > 0)
    return "visit_hunt";
  if (contactNeed >= proposalNeed && contactNeed > 0) return "break_the_silence";
  if (proposalNeed > 0) return "send_the_standard";
  return "visit_hunt";
}

function titleFor(input: {
  grammar: TerritoryGrammar;
  stableKey: string;
  memberCount: number;
}): string {
  const bank =
    input.grammar === "break_the_silence"
      ? SILENCE_TITLES
      : input.grammar === "send_the_standard"
        ? STANDARD_TITLES
        : VISIT_HUNT_TITLES;
  const chosen = bank[stableHash(input.stableKey) % bank.length]!;
  if (input.grammar === "visit_hunt" && chosen === "The Six Doors" && input.memberCount !== 6) {
    return input.memberCount === 1
      ? "The One Door"
      : `The ${numberWord(input.memberCount)} Doors`;
  }
  return chosen;
}

function numberWord(value: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"];
  return words[value] ?? String(value);
}

function clusterSources(
  sources: readonly TerritorySourceOpportunity[]
): TerritorySourceOpportunity[][] {
  const remaining = [...sources];
  const clusters: TerritorySourceOpportunity[][] = [];
  while (remaining.length) {
    const seed = remaining.shift()!;
    const nearby = [seed];
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index]!;
      if (haversineKm(seed, candidate) <= CLUSTER_RADIUS_KM) {
        nearby.push(candidate);
        remaining.splice(index, 1);
      }
    }
    nearby.sort((a, b) => a.physicalEntityId.localeCompare(b.physicalEntityId));
    if (nearby.length < MIN_MEMBERS) continue;
    const center = centroidOf(nearby)!;
    const limited =
      nearby.length <= MAX_MEMBERS
        ? nearby
        : [...nearby]
            .sort(
              (a, b) =>
                haversineKm(center, a) - haversineKm(center, b) ||
                a.physicalEntityId.localeCompare(b.physicalEntityId)
            )
            .slice(0, MAX_MEMBERS)
            .sort((a, b) => a.physicalEntityId.localeCompare(b.physicalEntityId));
    clusters.push(limited);
  }
  clusters.sort((a, b) => a[0]!.physicalEntityId.localeCompare(b[0]!.physicalEntityId));
  return clusters;
}

function sourceReason(grammar: TerritoryGrammar, source: TerritorySourceOpportunity): string {
  if (grammar === "visit_hunt") {
    return source.hasVisitEvidence
      ? "Geographically coherent with this visit hunt"
      : "Legitimate in-person visit still outstanding";
  }
  if (grammar === "break_the_silence") {
    return source.hasContactEvidence
      ? "Geographically coherent with this contact hunt"
      : "Legitimate first contact or follow-up still outstanding";
  }
  return source.hasProposalEvidence
    ? "Geographically coherent with this standard"
    : "Legitimate proposal still outstanding";
}

export function compileTerritoryCandidates(input: {
  tenantId: string;
  sources: readonly TerritorySourceOpportunity[];
  occupiedPhysicalEntityIds?: ReadonlySet<string>;
}): TerritoryCandidate[] {
  const occupied = input.occupiedPhysicalEntityIds ?? new Set<string>();
  const eligible = eligibleTerritorySources(input.sources).filter(
    source => !occupied.has(source.physicalEntityId)
  );
  if (eligible.length < MIN_MEMBERS) return [];

  return clusterSources(eligible).map(cluster => {
    const grammar = grammarForCluster(cluster);
    const ids = cluster.map(member => member.physicalEntityId);
    const stableKey = stableTerritoryKey({
      tenantId: input.tenantId,
      grammar,
      physicalEntityIds: ids,
    });
    const geometryMode = classifyGeometryMode(cluster);
    const requiredAction = actionTypesForGrammar(grammar);
    const members: TerritoryMember[] = cluster.map((member, order) => ({
      physicalEntityId: member.physicalEntityId,
      requiredAction,
      order,
      sourceReason: sourceReason(grammar, member),
    }));
    const geographyLabels = cluster
      .map(member => member.realGeographyLabel)
      .filter((label): label is string => Boolean(label));
    const realGeographyLabel = geographyLabels.sort()[0] ?? null;
    return {
      stableKey,
      grammar,
      guardianId: guardianIdForStableKey(stableKey),
      fantasyTitle: titleFor({ grammar, stableKey, memberCount: members.length }),
      realGeographyLabel,
      geometryMode,
      members,
      createdFrom: "territory_compiler",
    };
  });
}

export function candidateMatchesPublished(
  candidate: TerritoryCandidate,
  published: Pick<TerritoryDefinition, "stableKey" | "version">
): boolean {
  return candidate.stableKey === published.stableKey;
}

export { GUARDIAN_ROSTER_IDS };
