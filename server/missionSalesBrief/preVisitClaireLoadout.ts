import { z } from "zod";
import { invokeLLM } from "../_core/llm";
import type { SalesIntelTeaching } from "../../shared/salesIntelTeaching";
import type { ClairePreVisitLoadout, ClairePreVisitLoadoutItem } from "../../shared/missionSalesBrief";
import { ensureCurrentMissionSalesBrief } from "./missionSalesBriefService";
import { listEligibleSalesIntel } from "./salesIntelEligibility";

const SLOT_ORDER = ["OPEN", "PROBE", "WEAPON"] as const;
type Slot = (typeof SLOT_ORDER)[number];

const SLOT_CATEGORIES: Record<Slot, readonly string[]> = {
  OPEN: ["opening", "prospecting", "rapport", "positioning"],
  PROBE: ["discovery", "questioning", "qualification"],
  WEAPON: ["objection_prevention", "objection_handling", "value", "positioning", "closing"],
};

function byConfidenceThenRecency(left: SalesIntelTeaching, right: SalesIntelTeaching) {
  const confidenceDelta = (right.confidence ?? 0) - (left.confidence ?? 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

export function selectClairePreVisitTeachings(
  teachings: SalesIntelTeaching[]
): Array<{ slot: Slot; teaching: SalesIntelTeaching | null }> {
  const accepted = teachings
    .filter(teaching => teaching.reviewState === "accepted" && teaching.active)
    .sort(byConfidenceThenRecency);
  const shelby = accepted.filter(teaching =>
    /\bshelby\s+sapp\b/i.test(teaching.creatorName)
  );
  const used = new Set<string>();

  return SLOT_ORDER.map(slot => {
    const preferred = SLOT_CATEGORIES[slot];
    const fromShelby = shelby.find(
      teaching => !used.has(teaching.id) && preferred.includes(teaching.category)
    ) ?? shelby.find(teaching => !used.has(teaching.id));
    const fallback = accepted.find(
      teaching => !used.has(teaching.id) && preferred.includes(teaching.category)
    ) ?? accepted.find(teaching => !used.has(teaching.id));
    const teaching = fromShelby ?? fallback ?? null;
    if (teaching) used.add(teaching.id);
    return { slot, teaching };
  });
}

function sourceLine(teaching: SalesIntelTeaching | null): string | null {
  if (!teaching) return null;
  const exact = teaching.exampleLanguage.find(item => item.kind === "exact_source_phrase");
  const any = teaching.exampleLanguage[0];
  return (exact ?? any)?.text?.trim() || teaching.principle.trim() || null;
}

function deterministicItems(input: {
  brief: NonNullable<Awaited<ReturnType<typeof ensureCurrentMissionSalesBrief>>>;
  selected: Array<{ slot: Slot; teaching: SalesIntelTeaching | null }>;
}): ClairePreVisitLoadoutItem[] {
  const opening =
    input.brief.recommendedApproach.recommendedOpening?.trim() ||
    sourceLine(input.selected.find(item => item.slot === "OPEN")?.teaching ?? null) ||
    "Lead with one clear reason for the visit, then let them respond.";
  const probe =
    input.brief.recommendedApproach.questionsToAsk[0]?.trim() ||
    sourceLine(input.selected.find(item => item.slot === "PROBE")?.teaching ?? null) ||
    input.brief.unknowns[0]?.question ||
    "Ask one question that reveals the real blocker before pitching harder.";
  const weaponTeaching = input.selected.find(item => item.slot === "WEAPON")?.teaching ?? null;
  const weapon =
    sourceLine(weaponTeaching) ||
    input.brief.recommendedApproach.thingsToAvoid[0]?.trim() ||
    "Do not manufacture urgency. Find the real friction and respond to that.";

  const lines: Record<Slot, string> = { OPEN: opening, PROBE: probe, WEAPON: weapon };
  return input.selected.map(({ slot, teaching }) => ({
    slot,
    line: lines[slot].slice(0, 220),
    sourceTeachingId: teaching?.id ?? null,
    sourceCreator: teaching?.creatorName ?? null,
    sourceTitle: teaching?.title ?? null,
    provenance: teaching ? "reviewed_sales_intel" : "mission_brief",
  }));
}

const responseSchema = z.object({
  items: z.array(z.object({
    slot: z.enum(SLOT_ORDER),
    sourceTeachingId: z.string().uuid().nullable(),
    line: z.string().trim().min(1).max(220),
  })).length(3),
});

const RESPONSE_JSON_SCHEMA = {
  name: "claire_previsit_tower_loadout",
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
            slot: { type: "string", enum: SLOT_ORDER },
            sourceTeachingId: { type: ["string", "null"] },
            line: { type: "string", maxLength: 220 },
          },
          required: ["slot", "sourceTeachingId", "line"],
        },
      },
    },
    required: ["items"],
  },
} as const;

export async function getClairePreVisitLoadout(input: {
  tenantId: string;
  missionId: number;
}): Promise<ClairePreVisitLoadout | null> {
  const brief = await ensureCurrentMissionSalesBrief(input);
  if (!brief) return null;

  const selected = selectClairePreVisitTeachings(await listEligibleSalesIntel());
  const fallback = deterministicItems({ brief, selected });
  const teachingById = new Map(
    selected.flatMap(item => item.teaching ? [[item.teaching.id, item.teaching] as const] : [])
  );

  let items = fallback;
  try {
    const result = await invokeLLM({
      tenantId: input.tenantId,
      maxTokens: 700,
      temperature: 0.2,
      outputSchema: RESPONSE_JSON_SCHEMA,
      messages: [
        {
          role: "system",
          content: [
            "You are Claire equipping a field operator with exactly three short spoken moves before entering a real sales visit.",
            "The slots are OPEN, PROBE, WEAPON.",
            "Use only the supplied mission facts and reviewed trainer teachings.",
            "Adapt the wording to this building only when the supplied facts support it.",
            "Never invent a manager, objection, incumbent vendor, complaint, relationship, interest level, urgency, or prior conversation.",
            "OPEN is what the operator can say first. PROBE is one useful question. WEAPON is one concise reframe or response principle.",
            "Keep each line natural enough to say out loud and under 220 characters.",
            "Preserve sourceTeachingId exactly when a source teaching is used. If a slot is based only on the mission brief, use null.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            building: brief.account,
            knownFacts: brief.knownFacts.map(fact => fact.text),
            keyUnknown: brief.unknowns[0]?.question ?? null,
            missionObjective: brief.recommendedApproach.primaryObjective,
            existingRecommendedOpening: brief.recommendedApproach.recommendedOpening,
            existingQuestions: brief.recommendedApproach.questionsToAsk,
            selectedTeachings: selected.map(({ slot, teaching }) => ({
              slot,
              sourceTeachingId: teaching?.id ?? null,
              creator: teaching?.creatorName ?? null,
              category: teaching?.category ?? null,
              title: teaching?.title ?? null,
              principle: teaching?.principle ?? null,
              whenToUse: teaching?.whenToUse ?? [],
              whenNotToUse: teaching?.whenNotToUse ?? [],
              exampleLanguage: teaching?.exampleLanguage ?? [],
            })),
          }),
        },
      ],
    });
    const raw = result.choices[0]?.message?.content;
    const parsed = responseSchema.safeParse(JSON.parse(typeof raw === "string" ? raw : ""));
    if (parsed.success) {
      const bySlot = new Map(parsed.data.items.map(item => [item.slot, item]));
      const candidate = SLOT_ORDER.map(slot => bySlot.get(slot)).filter(Boolean);
      if (candidate.length === 3) {
        items = candidate.map((item, index) => {
          const row = item!;
          const source = row.sourceTeachingId ? teachingById.get(row.sourceTeachingId) ?? null : null;
          return {
            slot: SLOT_ORDER[index],
            line: row.line,
            sourceTeachingId: source?.id ?? null,
            sourceCreator: source?.creatorName ?? null,
            sourceTitle: source?.title ?? null,
            provenance: source ? "reviewed_sales_intel" : "mission_brief",
          };
        });
      }
    }
  } catch {
    items = fallback;
  }

  return {
    missionId: brief.missionId,
    briefId: brief.id,
    briefVersion: brief.version,
    buildingName: brief.account.name,
    buildingAddress: brief.account.address,
    generatedAt: new Date().toISOString(),
    items,
  };
}
