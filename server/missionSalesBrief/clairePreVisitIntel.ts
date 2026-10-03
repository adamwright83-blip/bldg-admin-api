import { z } from "zod";
import type {
  ClairePreVisitIntel,
  ClairePreVisitIntelItem,
  ClairePreVisitIntelSlot,
  MissionSalesBrief,
} from "../../shared/missionSalesBrief";
import type { ObjectionArchetype } from "../../shared/salesIntel";
import type { ArmoryWeapon } from "../armory/armoryTypes";
import { classifyObjectionArchetype } from "../armory/armoryService";
import { listArmoryWeapons } from "../armory/armoryWeaponService";
import { invokeLLM } from "../_core/llm";
import { ensureCurrentMissionSalesBrief } from "./missionSalesBriefService";

const SLOT_ORDER: ClairePreVisitIntelSlot[] = ["OPENING", "PROBE", "WEAPON"];

const compiledSchema = z.object({
  items: z.array(z.object({
    slot: z.enum(["OPENING", "PROBE", "WEAPON"]),
    line: z.string().trim().min(1).max(280),
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
          },
          required: ["slot", "line"],
        },
      },
    },
    required: ["items"],
  },
} as const;

type EquipSource = {
  slot: ClairePreVisitIntelSlot;
  line: string;
  why: string;
  provenance: ClairePreVisitIntelItem["provenance"];
};

function missionSituation(brief: MissionSalesBrief): string {
  return [
    brief.mission.objective,
    brief.recommendedApproach.primaryObjective,
    ...brief.knownFacts.map(fact => fact.text),
    ...brief.priorOutcomes.map(fact => fact.text),
    ...brief.unknowns.map(item => item.question),
  ].join(" ");
}

function encounterArchetype(brief: MissionSalesBrief): ObjectionArchetype {
  // This is only a recommendation context, never a claim that the real person
  // is a particular archetype. When nothing in the mission points elsewhere,
  // a first in-person tower visit equips for access/routing by default.
  return classifyObjectionArchetype(missionSituation(brief)) ?? "GATEKEEPER";
}

function weaponProvenance(
  weapon: ArmoryWeapon
): ClairePreVisitIntelItem["provenance"] {
  if (weapon.provenance.type === "trainer_source") {
    return {
      kind: "trainer_source",
      teachingId: null,
      frameworkId: weapon.provenance.frameworkId,
      creatorName: weapon.provenance.creator,
      teachingTitle: weapon.provenance.frameworkName,
      sourceReference: weapon.provenance.sourceArtifactId,
    };
  }
  return {
    kind: "foundation",
    teachingId: null,
    frameworkId: null,
    creatorName: null,
    teachingTitle: weapon.title,
    sourceReference:
      weapon.provenance.type === "foundation"
        ? weapon.provenance.sourceReference
        : null,
  };
}

function missionBriefProvenance(): ClairePreVisitIntelItem["provenance"] {
  return {
    kind: "mission_brief",
    teachingId: null,
    frameworkId: null,
    creatorName: null,
    teachingTitle: null,
    sourceReference: null,
  };
}

function selectArmoryLine(
  weapons: ArmoryWeapon[],
  kind: "probe" | "weapon"
): { weapon: ArmoryWeapon; line: string } | null {
  for (const weapon of weapons) {
    const line =
      kind === "probe"
        ? weapon.discoveryQuestion
        : weapon.spokenLine ?? weapon.principle;
    if (line?.trim()) return { weapon, line: line.trim() };
  }
  return null;
}

function buildEquipSources(input: {
  brief: MissionSalesBrief;
  weapons: ArmoryWeapon[];
}): [EquipSource, EquipSource, EquipSource] {
  const opening =
    input.brief.recommendedApproach.recommendedOpening ??
    input.brief.recommendedApproach.primaryObjective;
  const probeWeapon = selectArmoryLine(input.weapons, "probe");
  const responseWeapon = selectArmoryLine(
    probeWeapon
      ? [
          ...input.weapons.filter(weapon => weapon.id !== probeWeapon.weapon.id),
          probeWeapon.weapon,
        ]
      : input.weapons,
    "weapon"
  );

  const probe =
    probeWeapon?.line ??
    input.brief.recommendedApproach.questionsToAsk[0] ??
    input.brief.unknowns[0]?.question ??
    "Who is the right person to speak with about this?";
  const response =
    responseWeapon?.line ??
    input.brief.recommendedApproach.actionsToTake[0] ??
    input.brief.recommendedApproach.thingsToAvoid[0] ??
    "Do not force a close; earn one concrete next step.";

  return [
    {
      slot: "OPENING",
      line: opening,
      why: "Current mission brief opening",
      provenance: missionBriefProvenance(),
    },
    {
      slot: "PROBE",
      line: probe,
      why: probeWeapon
        ? `Armory move for ${probeWeapon.weapon.archetype.toLowerCase()} access`
        : "Current mission brief discovery question",
      provenance: probeWeapon
        ? weaponProvenance(probeWeapon.weapon)
        : missionBriefProvenance(),
    },
    {
      slot: "WEAPON",
      line: response,
      why: responseWeapon
        ? `Armory response for ${responseWeapon.weapon.archetype.toLowerCase()} friction`
        : "Current mission brief recommendation",
      provenance: responseWeapon
        ? weaponProvenance(responseWeapon.weapon)
        : missionBriefProvenance(),
    },
  ];
}

function deterministicItems(
  sources: [EquipSource, EquipSource, EquipSource]
): [ClairePreVisitIntelItem, ClairePreVisitIntelItem, ClairePreVisitIntelItem] {
  return sources.map(source => ({
    slot: source.slot,
    line: source.line,
    why: source.why,
    provenance: source.provenance,
  })) as [
    ClairePreVisitIntelItem,
    ClairePreVisitIntelItem,
    ClairePreVisitIntelItem,
  ];
}

function groundedFactCorpus(brief: MissionSalesBrief): string {
  return [
    brief.account.name,
    brief.account.accountType ?? "",
    ...brief.knownFacts.map(fact => fact.text),
    ...brief.priorOutcomes.map(fact => fact.text),
  ].join(" ").toLowerCase();
}

function sourceGuidanceCorpus(sources: EquipSource[]): string {
  return sources
    .map(source => source.line)
    .filter(line => !isQuestionLike(line))
    .join(" ")
    .toLowerCase();
}

function questionCorpus(brief: MissionSalesBrief, sources: EquipSource[]): string {
  return [
    ...brief.unknowns.map(item => item.question),
    ...sources.map(source => source.line).filter(isQuestionLike),
  ].join(" ").toLowerCase();
}

const RISKY_ASSERTIONS = [
  /\bsince your\b/i,
  /\bbecause your\b/i,
  /\byour current\b/i,
  /\byour (?:building|property|team|residents?|provider|vendor|budget|contract|staff|manager|owner|amenit(?:y|ies))\b/i,
  /\bthis (?:building|property) (?:has|uses|needs|wants|gets|pays|spends)\b/i,
  /\byou already\b/i,
  /\bthey already\b/i,
  /\byou (?:said|told|asked|requested)\b/i,
  /\bthey (?:said|told|asked|requested)\b/i,
  /\bi know (?:you|your|they|their)\b/i,
  /\bwe know (?:you|your|they|their)\b/i,
];

const ADAPTATION_GLUE_WORDS = new Set([
  "a", "about", "after", "again", "also", "am", "an", "and", "are", "as", "at",
  "be", "been", "before", "being", "by", "can", "could", "did", "do", "does",
  "for", "from", "had", "has", "have", "he", "her", "here", "him", "his", "i",
  "if", "in", "into", "is", "it", "its", "just", "like", "may", "might", "more",
  "my", "need", "of", "on", "one", "only", "or", "our", "right",
  "she", "should", "so", "that", "the", "their", "them", "then", "there", "these",
  "they", "this", "to", "today", "us", "was", "we", "were", "what", "when",
  "where", "which", "who", "why", "will", "with", "would", "yes", "you", "your",
]);

function contentTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter(token => token.length >= 2 && !ADAPTATION_GLUE_WORDS.has(token))
  );
}

function isQuestionLike(line: string): boolean {
  const trimmed = line.trim().toLowerCase();
  return trimmed.endsWith("?") &&
    /^(?:who|what|when|where|why|how|do|does|did|is|are|am|can|could|would|will|have|has|had|should|may|might)\b/.test(trimmed);
}
function hasNegation(text: string): boolean {
  return /\b(?:no|not|never|none|without|isn['’]?t|aren['’]?t|doesn['’]?t|don['’]?t|didn['’]?t|hasn['’]?t|haven['’]?t)\b/i.test(text);
}

function reversesKnownPolarity(line: string, brief: MissionSalesBrief): boolean {
  const lineTokens = contentTokens(line);
  if (lineTokens.size < 2) return false;
  for (const fact of [...brief.knownFacts, ...brief.priorOutcomes]) {
    const factText = fact.text;
    const factTokens = contentTokens(factText);
    let overlap = 0;
    for (const token of lineTokens) if (factTokens.has(token)) overlap += 1;
    if (overlap >= 2 && hasNegation(line) !== hasNegation(factText)) return true;
  }
  return false;
}


function hasUnsupportedCompiledFact(input: {
  brief: MissionSalesBrief;
  sources: EquipSource[];
  lines: string[];
}): boolean {
  const factCorpus = groundedFactCorpus(input.brief);
  const guidanceCorpus = sourceGuidanceCorpus(input.sources);
  const questions = questionCorpus(input.brief, input.sources);
  const factTokens = contentTokens(factCorpus);
  const guidanceTokens = contentTokens(guidanceCorpus);
  const questionTokens = contentTokens(questions);

  for (const line of input.lines) {
    const questionLike = isQuestionLike(line);
    if (!questionLike && reversesKnownPolarity(line, input.brief)) return true;

    // Guidance may be paraphrased as guidance, but vocabulary that only
    // exists inside a source/mission question may survive only as a question.
    // That prevents "Does this tower have a pool?" from becoming "This tower
    // has a pool." while still allowing Claire to ask the grounded question.
    for (const token of contentTokens(line)) {
      if (factTokens.has(token) || guidanceTokens.has(token)) continue;
      if (questionLike && questionTokens.has(token)) continue;
      return true;
    }

    // Property/customer assertions require factual evidence specifically.
    // A matching phrase inside coaching, a recommendation, or a question is
    // never enough to turn it into a business fact.
    for (const pattern of RISKY_ASSERTIONS) {
      const match = line.match(pattern)?.[0]?.toLowerCase();
      if (!match) continue;
      if (factCorpus.includes(match)) continue;
      return true;
    }

    const claimNumbers = line.match(/\b\d[\d,.]*\b/g) ?? [];
    for (const number of claimNumbers) {
      if (factCorpus.includes(number.toLowerCase())) continue;
      if (guidanceCorpus.includes(number.toLowerCase())) continue;
      if (questionLike && questions.includes(number.toLowerCase())) continue;
      return true;
    }
  }
  return false;
}

async function adaptEquipLines(input: {
  tenantId: string;
  brief: MissionSalesBrief;
  archetype: ObjectionArchetype;
  sources: [EquipSource, EquipSource, EquipSource];
}): Promise<[ClairePreVisitIntelItem, ClairePreVisitIntelItem, ClairePreVisitIntelItem]> {
  const fallback = deterministicItems(input.sources);
  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      maxTokens: 650,
      temperature: 0.1,
      outputSchema: COMPILED_JSON_SCHEMA,
      messages: [
        {
          role: "system",
          content: [
            "You are Claire equipping a field operator before one real high-rise sales encounter.",
            "Return exactly OPENING, PROBE, WEAPON in that order.",
            "Adapt only the supplied source move into concise natural language for this mission.",
            "Never invent a person, incumbent vendor, objection, relationship, prior conversation, amenity, budget, approval state, interest, or outcome.",
            "Unknowns stay questions. Recommendations never become facts.",
            "Do not add a building-specific claim merely to sound customized.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            account: {
              name: input.brief.account.name,
              accountType: input.brief.account.accountType,
            },
            likelyEncounterContext: input.archetype,
            knownFacts: input.brief.knownFacts.map(fact => fact.text),
            unknowns: input.brief.unknowns.map(item => item.question),
            sourceMoves: input.sources.map(source => ({
              slot: source.slot,
              sourceKind: source.provenance.kind,
              sourceText: source.line,
              creatorName: source.provenance.creatorName,
              frameworkId: source.provenance.frameworkId,
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

    const bySlot = new Map(parsed.data.items.map(item => [item.slot, item.line]));
    return SLOT_ORDER.map((slot, index) => ({
      ...fallback[index],
      line: bySlot.get(slot) ?? fallback[index].line,
    })) as [
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
  actorId: string;
  missionId: number;
}): Promise<ClairePreVisitIntel | null> {
  const brief = await ensureCurrentMissionSalesBrief(input);
  if (!brief) return null;

  const archetype = encounterArchetype(brief);
  const armory = await listArmoryWeapons({
    tenantId: input.tenantId,
    actorId: input.actorId,
    archetype,
    channel: "in_person",
    missionId: input.missionId,
    limit: 3,
  });
  const sources = buildEquipSources({
    brief,
    weapons: armory.weapons,
  });
  const items = await adaptEquipLines({
    tenantId: input.tenantId,
    brief,
    archetype,
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
