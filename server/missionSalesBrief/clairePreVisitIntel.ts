import { z } from "zod";
import type {
  ClairePreVisitIntel,
  ClairePreVisitIntelItem,
  ClairePreVisitIntelSlot,
  MissionSalesBrief,
} from "../../shared/missionSalesBrief";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";
import { invokeLLM } from "../_core/llm";
import { ensureCurrentMissionSalesBrief } from "./missionSalesBriefService";
import { listEligibleSalesIntel } from "./salesIntelEligibility";

const SLOT_ORDER: ClairePreVisitIntelSlot[] = ["OPENING", "PROBE", "WEAPON"];

const SLOT_CATEGORIES: Record<ClairePreVisitIntelSlot, string[]> = {
  OPENING: ["opening", "prospecting", "rapport", "positioning"],
  PROBE: ["discovery", "questioning", "qualification", "sales_psychology"],
  WEAPON: [
    "objection_prevention",
    "objection_handling",
    "value",
    "positioning",
    "pricing",
    "negotiation",
  ],
};

const compiledSchema = z.object({
  items: z.array(z.object({
    slot: z.enum(["OPENING", "PROBE", "WEAPON"]),
    line: z.string().trim().min(1).max(280),
    why: z.string().trim().min(1).max(180),
  })).length(3),
});

const COMPILED_JSON_SCHEMA = {
  name: "claire_previsit_three",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      items: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            slot: { type: "string", enum: ["OPENING", "PROBE", "WEAPON"] },
            line: { type: "string", maxLength: 280 },
            why: { type: "string", maxLength: 180 },
          },
          required: ["slot", "line", "why"],
        },
      },
    },
    required: ["items"],
  },
} as const;

type SourceSelection = {
  slot: ClairePreVisitIntelSlot;
  teaching: SalesIntelTeaching | null;
  sourceText: string;
  fallbackWhy: string;
};

function normalizedCreator(teaching: SalesIntelTeaching): string {
  return teaching.creatorName.trim().toLowerCase();
}

function bestSourceText(teaching: SalesIntelTeaching): string {
  const exact = teaching.exampleLanguage.find(
    phrase => phrase.kind === "exact_source_phrase"
  );
  const paraphrase = teaching.exampleLanguage.find(
    phrase => phrase.kind === "paraphrased_principle"
  );
  return exact?.text ?? paraphrase?.text ?? teaching.principle;
}

function meaningfulTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(token => token.length >= 4)
  );
}

function teachingRelevance(
  teaching: SalesIntelTeaching,
  missionText: string
): number {
  const missionTokens = meaningfulTokens(missionText);
  const teachingTokens = meaningfulTokens(
    [
      teaching.title,
      teaching.principle,
      ...teaching.whenToUse,
      ...teaching.whenNotToUse,
      ...teaching.exampleLanguage.map(item => item.text),
    ].join(" ")
  );
  let overlap = 0;
  for (const token of teachingTokens) {
    if (missionTokens.has(token)) overlap += 1;
  }
  return overlap * 10 + (teaching.confidence ?? 0);
}

function rankTeachings(
  teachings: SalesIntelTeaching[],
  brief: MissionSalesBrief
): SalesIntelTeaching[] {
  const missionText = [
    brief.account.accountType ?? "",
    brief.mission.objective,
    brief.recommendedApproach.primaryObjective,
    ...brief.knownFacts.map(fact => fact.text),
    ...brief.priorOutcomes.map(fact => fact.text),
    ...brief.unknowns.map(item => item.question),
  ].join(" ");
  return [...teachings].sort((left, right) => {
    const score =
      teachingRelevance(right, missionText) -
      teachingRelevance(left, missionText);
    if (score !== 0) return score;
    return right.createdAt.localeCompare(left.createdAt);
  });
}

function selectShelbySources(
  brief: MissionSalesBrief,
  eligible: SalesIntelTeaching[]
): SourceSelection[] {
  const shelby = rankTeachings(
    eligible.filter(
      teaching =>
        normalizedCreator(teaching) === "shelby sapp" ||
        normalizedCreator(teaching).includes("shelby sapp")
    ),
    brief
  );
  const used = new Set<string>();

  const choose = (slot: ClairePreVisitIntelSlot): SalesIntelTeaching | null => {
    const preferred = SLOT_CATEGORIES[slot];
    const match =
      shelby.find(
        teaching =>
          !used.has(teaching.id) && preferred.includes(teaching.category)
      ) ?? null;
    if (match) used.add(match.id);
    return match;
  };

  const opening = choose("OPENING");
  const probe = choose("PROBE");
  const weapon = choose("WEAPON");

  return [
    {
      slot: "OPENING",
      teaching: opening,
      sourceText:
        opening
          ? bestSourceText(opening)
          : brief.recommendedApproach.recommendedOpening ??
            brief.recommendedApproach.primaryObjective,
      fallbackWhy: opening
        ? `Reviewed Shelby Sapp teaching: ${opening.title}`
        : "Current mission brief opening",
    },
    {
      slot: "PROBE",
      teaching: probe,
      sourceText:
        probe
          ? bestSourceText(probe)
          : brief.recommendedApproach.questionsToAsk[0] ??
            brief.unknowns[0]?.question ??
            "Ask one question that identifies the real blocker.",
      fallbackWhy: probe
        ? `Reviewed Shelby Sapp teaching: ${probe.title}`
        : "Current mission brief discovery question",
    },
    {
      slot: "WEAPON",
      teaching: weapon,
      sourceText:
        weapon
          ? bestSourceText(weapon)
          : brief.recommendedApproach.actionsToTake[0] ??
            brief.recommendedApproach.thingsToAvoid[0] ??
            "Do not force a close; earn a concrete next step.",
      fallbackWhy: weapon
        ? `Reviewed Shelby Sapp teaching: ${weapon.title}`
        : "Current mission brief recommendation",
    },
  ];
}

function deterministicItems(
  sources: SourceSelection[]
): [ClairePreVisitIntelItem, ClairePreVisitIntelItem, ClairePreVisitIntelItem] {
  const items = sources.map(source => ({
    slot: source.slot,
    line: source.sourceText,
    why: source.fallbackWhy,
    provenance: source.teaching
      ? {
          kind: "trainer_source" as const,
          teachingId: source.teaching.id,
          creatorName: source.teaching.creatorName,
          teachingTitle: source.teaching.title,
        }
      : {
          kind: "mission_brief" as const,
          teachingId: null,
          creatorName: null,
          teachingTitle: null,
        },
  }));
  return items as [
    ClairePreVisitIntelItem,
    ClairePreVisitIntelItem,
    ClairePreVisitIntelItem,
  ];
}

const EVIDENCE_SENSITIVE_WORDS = [
  "provider",
  "vendor",
  "incumbent",
  "contract",
  "budget",
  "price",
  "pricing",
  "cost",
  "manager",
  "owner",
  "ownership",
  "hoa",
  "resident",
  "residents",
  "tenant",
  "tenants",
  "complaint",
  "complaints",
  "pickup",
  "pickups",
  "delivery",
  "deliveries",
  "approval",
  "approve",
  "decision",
  "interested",
  "interest",
  "amenity",
  "amenities",
  "staff",
] as const;

const COMMON_CAPITALIZED_WORDS = new Set([
  "Ask",
  "Could",
  "Can",
  "Would",
  "What",
  "Where",
  "When",
  "Why",
  "How",
  "If",
  "Do",
  "Does",
  "Is",
  "Are",
  "I",
  "We",
  "You",
]);

function hasUnsupportedCompiledFact(input: {
  brief: MissionSalesBrief;
  sources: SourceSelection[];
  lines: string[];
}): boolean {
  const corpus = [
    input.brief.account.name,
    input.brief.account.accountType ?? "",
    input.brief.mission.objective,
    input.brief.recommendedApproach.primaryObjective,
    ...input.brief.knownFacts.map(fact => fact.text),
    ...input.brief.priorOutcomes.map(fact => fact.text),
    ...input.brief.unknowns.map(item => item.question),
    ...input.sources.flatMap(source => [
      source.sourceText,
      source.teaching?.title ?? "",
      source.teaching?.principle ?? "",
      ...(source.teaching?.whenToUse ?? []),
      ...(source.teaching?.whenNotToUse ?? []),
    ]),
  ]
    .join(" ")
    .toLowerCase();

  const claims = input.lines.join(" ");
  const claimsLower = claims.toLowerCase();

  for (const word of EVIDENCE_SENSITIVE_WORDS) {
    const wordPattern = new RegExp(`\\b${word}\\b`, "i");
    if (wordPattern.test(claimsLower) && !wordPattern.test(corpus)) return true;
  }

  const properNouns = claims.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  for (const token of properNouns) {
    if (COMMON_CAPITALIZED_WORDS.has(token)) continue;
    if (!corpus.includes(token.toLowerCase())) return true;
  }

  return false;
}

async function compileBuildingRelevantLines(input: {
  tenantId: string;
  brief: MissionSalesBrief;
  sources: SourceSelection[];
}): Promise<[ClairePreVisitIntelItem, ClairePreVisitIntelItem, ClairePreVisitIntelItem]> {
  const fallback = deterministicItems(input.sources);
  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      maxTokens: 700,
      temperature: 0.15,
      outputSchema: COMPILED_JSON_SCHEMA,
      messages: [
        {
          role: "system",
          content: [
            "You are Claire equipping a field operator with exactly three short sales moves before a real property visit.",
            "The three slots are OPENING, PROBE, and WEAPON.",
            "Adapt the supplied reviewed trainer teaching into natural words the operator can actually say at this specific account.",
            "Never invent a decision maker, objection, incumbent provider, relationship, prior conversation, amenity, budget, outcome, or any other business fact.",
            "Account name and account type may be used only as context; do not turn them into unsupported claims.",
            "If a slot uses mission-brief fallback material, preserve its meaning and do not attribute it to the trainer.",
            "OPENING should be a short first line. PROBE should be one useful question. WEAPON should be one short reframe or response the operator can remember.",
            "These are recommendations, never statements about what has already happened.",
            "Return the slots in OPENING, PROBE, WEAPON order.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            account: {
              name: input.brief.account.name,
              accountType: input.brief.account.accountType,
            },
            mission: {
              status: input.brief.mission.currentStatus,
              objective: input.brief.recommendedApproach.primaryObjective,
            },
            knownFacts: input.brief.knownFacts.map(fact => fact.text),
            unknowns: input.brief.unknowns.map(item => item.question),
            sourceMoves: input.sources.map(source => ({
              slot: source.slot,
              sourceKind: source.teaching ? "reviewed_shelby_sapp_teaching" : "mission_brief",
              teachingTitle: source.teaching?.title ?? null,
              principle: source.teaching?.principle ?? null,
              sourceText: source.sourceText,
              whenToUse: source.teaching?.whenToUse ?? [],
              whenNotToUse: source.teaching?.whenNotToUse ?? [],
            })),
          }),
        },
      ],
    });
    const raw = result.choices[0]?.message?.content;
    const parsed = compiledSchema.safeParse(
      JSON.parse(typeof raw === "string" ? raw : "")
    );
    if (!parsed.success) return fallback;
    if (
      hasUnsupportedCompiledFact({
        brief: input.brief,
        sources: input.sources,
        lines: parsed.data.items.map(item => item.line),
      })
    ) {
      return fallback;
    }

    const bySlot = new Map(parsed.data.items.map(item => [item.slot, item]));
    const items = SLOT_ORDER.map((slot, index) => {
      const compiled = bySlot.get(slot);
      if (!compiled) return fallback[index];
      return {
        ...fallback[index],
        line: compiled.line,
        why: compiled.why,
      };
    });
    return items as [
      ClairePreVisitIntelItem,
      ClairePreVisitIntelItem,
      ClairePreVisitIntelItem,
    ];
  } catch {
    return fallback;
  }
}

export async function getClairePreVisitIntel(input: {
  tenantId: string;
  missionId: number;
}): Promise<ClairePreVisitIntel | null> {
  const brief = await ensureCurrentMissionSalesBrief(input);
  if (!brief) return null;

  const eligible = await listEligibleSalesIntel();
  const sources = selectShelbySources(brief, eligible);
  const items = await compileBuildingRelevantLines({
    tenantId: input.tenantId,
    brief,
    sources,
  });

  return {
    missionId: input.missionId,
    accountName: brief.account.name,
    briefId: brief.id,
    briefVersion: brief.version,
    generatedAt: new Date().toISOString(),
    items,
  };
}
