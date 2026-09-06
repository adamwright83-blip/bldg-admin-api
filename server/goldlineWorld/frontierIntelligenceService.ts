import { invokeLLM } from "../_core/llm";
import { ENV } from "../_core/env";
import {
  runGooglePlacesDiscovery,
  type NormalizedPlaceCandidate,
} from "../procurement/googlePlacesDiscoveryConnector";
import {
  geometryContainsPoint,
  territoryByName,
} from "../../shared/lanternTerritories";

export type FrontierIntelligence = {
  status: "ready" | "partial";
  generatedAt: string;
  salons: NormalizedPlaceCandidate[];
  streets: Array<{ name: string; rationale: string }>;
  note: string | null;
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["rankedPlaceIds", "streets"],
  properties: {
    rankedPlaceIds: {
      type: "array",
      maxItems: 10,
      items: { type: "string" },
    },
    streets: {
      type: "array",
      minItems: 3,
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "rationale"],
        properties: {
          name: { type: "string" },
          rationale: { type: "string" },
        },
      },
    },
  },
} as const;

function fallbackRanking(candidates: NormalizedPlaceCandidate[]) {
  return [...candidates]
    .sort(
      (a, b) =>
        (b.rating ?? 0) - (a.rating ?? 0) ||
        (b.reviewCount ?? 0) - (a.reviewCount ?? 0)
    )
    .slice(0, 10);
}

export function filterCandidatesToTerritory(
  territoryId: string,
  candidates: readonly NormalizedPlaceCandidate[]
) {
  const territory = territoryByName(territoryId);
  if (!territory) return [];
  return candidates.filter(candidate =>
    candidate.coordinates
      ? geometryContainsPoint(territory.geometry, [
          candidate.coordinates.lng,
          candidate.coordinates.lat,
        ])
      : false
  );
}

export async function buildFrontierIntelligence(input: {
  tenantId: string;
  territoryId: string;
  neighbourhood: string;
  latitude: number;
  longitude: number;
}): Promise<FrontierIntelligence> {
  const discovery = await runGooglePlacesDiscovery({
    searchText: `hair salons and beauty salons in ${input.neighbourhood}, Los Angeles`,
    maxResults: 20,
    locationBias: {
      lat: input.latitude,
      lng: input.longitude,
      radiusMeters: 4500,
    },
  });
  if (discovery.status !== "ok") {
    return {
      status: "partial",
      generatedAt: new Date().toISOString(),
      salons: [],
      streets: [],
      note: "Google Places could not supply verified salon targets.",
    };
  }

  // Places locationBias is only a ranking hint. This hard WGS84 polygon gate
  // makes it impossible for Anthropic to select an out-of-territory salon.
  const candidates = filterCandidatesToTerritory(
    input.territoryId,
    discovery.candidates
  );
  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      model: ENV.anthropicModelMissionPlanner || undefined,
      temperature: 0,
      maxTokens: 1800,
      messages: [
        {
          role: "system",
          content:
            "You plan ethical local customer acquisition for a residential wash-and-fold pickup service. Rank only supplied Google Places candidates. Never invent a business or place ID. Suggest named residential streets as field-research candidates, prioritizing detached and owner-occupied housing patterns over high-rise corridors. State short practical rationales; do not claim parcel-level ownership certainty.",
        },
        {
          role: "user",
          content: JSON.stringify({
            neighbourhood: input.neighbourhood,
            objective:
              "Choose ten salons for physical flyer delivery and 3-6 promising residential streets for 100 door hangers.",
            candidates: candidates.map(candidate => ({
              placeId: candidate.placeId,
              name: candidate.businessName,
              address: candidate.address,
              rating: candidate.rating,
              reviewCount: candidate.reviewCount,
            })),
          }),
        },
      ],
      outputSchema: {
        name: "frontier_intelligence",
        schema: schema as unknown as Record<string, unknown>,
        strict: true,
      },
    });
    const content = result.choices[0]?.message.content;
    const parsed = JSON.parse(typeof content === "string" ? content : "{}") as {
      rankedPlaceIds?: string[];
      streets?: Array<{ name?: string; rationale?: string }>;
    };
    const byId = new Map(
      candidates.map(candidate => [candidate.placeId, candidate])
    );
    const salons = (parsed.rankedPlaceIds ?? [])
      .flatMap(placeId => (byId.get(placeId) ? [byId.get(placeId)!] : []))
      .filter(
        (candidate, index, rows) =>
          rows.findIndex(row => row.placeId === candidate.placeId) === index
      )
      .slice(0, 10);
    const streets = (parsed.streets ?? [])
      .filter((street): street is { name: string; rationale: string } =>
        Boolean(street.name?.trim() && street.rationale?.trim())
      )
      .slice(0, 6);
    return {
      status: salons.length && streets.length ? "ready" : "partial",
      generatedAt: new Date().toISOString(),
      salons: salons.length ? salons : fallbackRanking(candidates),
      streets,
      note: streets.length
        ? "Street recommendations are AI-ranked field candidates; verify posted restrictions before distribution."
        : "Salon targets are verified by Google Places; street ranking is temporarily unavailable.",
    };
  } catch {
    return {
      status: "partial",
      generatedAt: new Date().toISOString(),
      salons: fallbackRanking(candidates),
      streets: [],
      note: "Salon targets are verified by Google Places; AI street ranking is temporarily unavailable.",
    };
  }
}
