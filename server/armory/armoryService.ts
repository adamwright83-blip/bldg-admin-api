import { and, desc, eq } from "drizzle-orm";
import { commercialMissionCoachingArtifacts, driverSalesJournals } from "../../drizzle/schema";
import { getDb } from "../db";
import { selectMissionDiamond, type SalesJournalInsights } from "../commercialMissions/driverSalesMotivationService";
import type { ArmoryItem, ArchetypeSummary, ObjectionArchetype } from "./armoryTypes";

const ARCHETYPE_PATTERNS: Array<{ archetype: ObjectionArchetype; pattern: RegExp; explanation: string }> = [
  { archetype: "GATEKEEPER", pattern: /decision.?maker|manager|owner|not authorized|not my decision|couldn.?t reach/i, explanation: "Repeated difficulty reaching the person who can decide" },
  { archetype: "GHOST", pattern: /no response|ghost|didn.?t repl(?:y|ied)|never (?:called|repl(?:y|ied))|unresponsive|no answer/i, explanation: "A factual pattern of contact attempts without response" },
  { archetype: "ANCHOR", pattern: /already have|current provider|contract|vendor|switch|incumbent/i, explanation: "The relationship is anchored to an incumbent provider or existing arrangement" },
  { archetype: "STALLER", pattern: /later|think about|not now|timing|next quarter|circle back|busy/i, explanation: "The contact defers a decision or next step" },
];

export function classifyObjectionArchetype(text: string): ObjectionArchetype | null {
  return ARCHETYPE_PATTERNS.find(entry => entry.pattern.test(text))?.archetype ?? null;
}

export async function getArmory(input: { tenantId: string; userId: string; accountType?: string }): Promise<{ items: ArmoryItem[]; archetypes: ArchetypeSummary[]; currentTactic: Awaited<ReturnType<typeof selectMissionDiamond>> }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [journals, artifacts, currentTactic] = await Promise.all([
    db.select().from(driverSalesJournals).where(and(eq(driverSalesJournals.tenantId, input.tenantId), eq(driverSalesJournals.driverId, input.userId))).orderBy(desc(driverSalesJournals.createdAt)).limit(30),
    db.select().from(commercialMissionCoachingArtifacts).where(and(eq(commercialMissionCoachingArtifacts.tenantId, input.tenantId), eq(commercialMissionCoachingArtifacts.active, true))).orderBy(desc(commercialMissionCoachingArtifacts.createdAt)).limit(20),
    selectMissionDiamond({ tenantId: input.tenantId, driverId: input.userId, accountType: input.accountType ?? "service business" }),
  ]);
  const items: ArmoryItem[] = [
    {
      id: "foundation:fast-response",
      title: "FAST RESPONSE",
      cue: "Incumbent provider is already in place",
      response:
        "Totally fair — most properties already have a company. The difference is response time.",
      outcome: "guidance",
      provenance: "foundation",
      sourceReference: "armory:foundation:anchor:fast-response",
    },
    {
      id: "foundation:no-risk-trial",
      title: "NO-RISK TRIAL",
      cue: "Switching feels risky",
      response:
        "Try us on one run. If we don't outperform, don't switch.",
      outcome: "guidance",
      provenance: "foundation",
      sourceReference: "armory:foundation:anchor:no-risk-trial",
    },
    {
      id: "foundation:social-proof",
      title: "SOCIAL PROOF",
      cue: "The prospect needs relevant proof",
      response: "We already handle buildings like yours nearby.",
      outcome: "guidance",
      provenance: "foundation",
      sourceReference: "armory:foundation:anchor:social-proof",
    },
  ];
  const occurrences = new Map<ObjectionArchetype, Array<{ text: string; sourceReference: string }>>();
  for (const journal of journals) {
    const insights = journal.insightsJson as SalesJournalInsights;
    for (let index = 0; index < (insights.objections ?? []).length; index += 1) {
      const objection = insights.objections[index]!;
      const sourceReference = `driver_sales_journals:${journal.id}:objection:${index}`;
      items.push({ id: sourceReference, title: objection.objection, cue: objection.attemptedResponse || "No attempted response recorded", response: objection.betterResponse || objection.attemptedResponse || "No response recorded", outcome: objection.worked ? "worked" : "did_not_work", provenance: "personal_journal", sourceReference });
      const archetype = classifyObjectionArchetype(objection.objection);
      if (archetype) occurrences.set(archetype, [...(occurrences.get(archetype) ?? []), { text: objection.objection, sourceReference }]);
    }
  }
  for (const artifact of artifacts) {
    const output = artifact.structuredOutputJson as { generatedSummary?: string; openingLine?: string; discoveryQuestions?: string[] } | null;
    if (!output) continue;
    items.push({ id: `coaching:${artifact.id}`, title: output.generatedSummary ?? "Mission coaching", cue: output.openingLine ?? "Mission-specific guidance", response: output.discoveryQuestions?.[0] ?? "Review the grounded mission coaching", outcome: "guidance", provenance: "evidence_backed_mission_context", sourceReference: `commercial_mission_coaching_artifacts:${artifact.id}` });
  }
  const archetypes = ARCHETYPE_PATTERNS.flatMap(entry => {
    const evidence = occurrences.get(entry.archetype) ?? [];
    return evidence.length ? [{ archetype: entry.archetype, count: evidence.length, explanation: entry.explanation, evidence: evidence.slice(0, 5) }] : [];
  });
  return { items, archetypes, currentTactic };
}
