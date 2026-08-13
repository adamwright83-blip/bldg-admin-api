/**
 * The Armory weapon query — one authoritative backend serving the game.
 *
 * Accepted Sales Intel frameworks become eligible here automatically the
 * moment they are accepted. There is no publish, sync, or copy step: the
 * driver reads this service, and this service reads the same tables the admin
 * ingestion pipeline writes.
 *
 * Two evidence layers are assembled side by side and never merged:
 *   trainer teaching  -> `provenance` (what a trainer taught, with a source)
 *   personal evidence -> `personalEvidence` (what happened when THIS player
 *                        used it, tenant/actor scoped, association only)
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  armoryWeaponOutcomes,
  armoryWeaponUsages,
  salesIntelSourceArtifacts,
} from "../../drizzle/schema";
import type {
  ObjectionArchetype,
  SalesIntelChannel,
  SalesIntelFramework,
} from "../../shared/salesIntel";
import { getDb } from "../db";
import { projectGoldlineProgressionForIdentity } from "../driverGameWorld/progressionProjectionService";
import {
  countIndependentSourceSupport,
  queryDriverVisibleFrameworks,
} from "../salesIntel/salesIntelStore";
import { foundationWeaponsFor } from "./armoryFoundation";
import {
  personalEvidenceConfidence,
  personalEvidenceSummary,
  type ArmoryPersonalEvidence,
  type ArmoryWeapon,
} from "./armoryTypes";

/** Encounters show at most three choices. */
export const MAX_ENCOUNTER_WEAPONS = 3;

export function trainerWeaponId(frameworkId: string): string {
  return `framework:${frameworkId}`;
}

type EvidenceRow = {
  weaponId: string;
  uses: number;
  outcomes: number;
  followUps: number;
  wins: number;
};

/**
 * Personal evidence for this tenant+actor only. One tenant's history is never
 * readable from another.
 */
async function loadPersonalEvidence(input: {
  tenantId: string;
  actorId: string;
  weaponIds: string[];
}): Promise<Map<string, ArmoryPersonalEvidence>> {
  const result = new Map<string, ArmoryPersonalEvidence>();
  if (!input.weaponIds.length) return result;

  const db = await getDb();
  if (!db) return result;

  const usageRows = await db
    .select({
      weaponId: armoryWeaponUsages.weaponId,
      uses: sql<number>`COUNT(*)`,
    })
    .from(armoryWeaponUsages)
    .where(
      and(
        eq(armoryWeaponUsages.tenantId, input.tenantId),
        eq(armoryWeaponUsages.actorId, input.actorId),
        inArray(armoryWeaponUsages.weaponId, input.weaponIds)
      )
    )
    .groupBy(armoryWeaponUsages.weaponId);

  const outcomeRows = await db
    .select({
      weaponId: armoryWeaponOutcomes.weaponId,
      outcomes: sql<number>`COUNT(*)`,
      followUps: sql<number>`SUM(CASE WHEN ${armoryWeaponOutcomes.outcomeKind} = 'follow_up_created' THEN 1 ELSE 0 END)`,
      wins: sql<number>`SUM(CASE WHEN ${armoryWeaponOutcomes.outcomeKind} = 'account_won' THEN 1 ELSE 0 END)`,
    })
    .from(armoryWeaponOutcomes)
    .where(
      and(
        eq(armoryWeaponOutcomes.tenantId, input.tenantId),
        eq(armoryWeaponOutcomes.actorId, input.actorId),
        inArray(armoryWeaponOutcomes.weaponId, input.weaponIds)
      )
    )
    .groupBy(armoryWeaponOutcomes.weaponId);

  const outcomeByWeapon = new Map(
    outcomeRows.map(row => [
      row.weaponId,
      {
        outcomes: Number(row.outcomes ?? 0),
        followUps: Number(row.followUps ?? 0),
        wins: Number(row.wins ?? 0),
      },
    ])
  );

  for (const row of usageRows) {
    const uses = Number(row.uses ?? 0);
    const observed = outcomeByWeapon.get(row.weaponId) ?? {
      outcomes: 0,
      followUps: 0,
      wins: 0,
    };
    // `no_change` is recorded evidence too, but it is not a next-step outcome.
    const outcomeEvidence = observed.followUps + observed.wins;
    const confidence = personalEvidenceConfidence({ uses, outcomeEvidence });
    result.set(row.weaponId, {
      uses,
      outcomeEvidence,
      followUpsObserved: observed.followUps,
      winsObserved: observed.wins,
      confidence,
      summary: personalEvidenceSummary({ uses, outcomeEvidence, confidence }),
    });
  }

  return result;
}

function frameworkToWeapon(input: {
  framework: SalesIntelFramework;
  sourceUrl: string | null;
  sourceType: string;
  independentSourceSupportCount: number;
}): ArmoryWeapon {
  const { framework } = input;
  const exact = framework.exampleLanguage.find(
    phrase => phrase.kind === "exact_source_phrase"
  );
  const anyPhrase = framework.exampleLanguage[0] ?? null;
  return {
    id: trainerWeaponId(framework.id),
    archetype: framework.archetype,
    channel: framework.channel,
    title: framework.frameworkName,
    responseFamily: framework.responseFamily,
    spokenLine: (exact ?? anyPhrase)?.text ?? null,
    discoveryQuestion: framework.discoveryQuestions[0] ?? null,
    principle: framework.principle,
    exampleLanguage: framework.exampleLanguage,
    whenToUse: framework.whenToUse,
    whenNotToUse: framework.whenNotToUse,
    provenance: {
      type: "trainer_source",
      creator: framework.creatorName,
      creatorHandle: framework.creatorHandle,
      frameworkId: framework.id,
      frameworkName: framework.frameworkName,
      sourceArtifactId: framework.sourceArtifactId,
      sourceUrl: input.sourceUrl,
      sourceType: input.sourceType,
      transcriptStartMs: framework.transcriptStartMs,
      transcriptEndMs: framework.transcriptEndMs,
      extractionVersion: framework.extractionVersion,
      extractionModel: framework.extractionModel,
      confidence: framework.confidence,
      independentSourceSupportCount: input.independentSourceSupportCount,
    },
    personalEvidence: null,
    fit: "medium",
    fitReason: "Trainer framework matched to this objection and channel",
  };
}

/**
 * Explainable ranking. Every term is a stated reason, not a learned weight,
 * and personal evidence can only ever nudge — it never manufactures certainty.
 */
function rankScore(weapon: ArmoryWeapon): number {
  let score = 0;
  if (weapon.provenance.type === "trainer_source") {
    score += 40;
    score += Math.round((weapon.provenance.confidence ?? 0) * 20);
  } else if (weapon.provenance.type === "foundation") {
    score += 20;
  }
  const evidence = weapon.personalEvidence;
  if (evidence) {
    if (evidence.confidence === "strong") score += 25;
    else if (evidence.confidence === "emerging") score += 10;
    // Insufficient evidence deliberately adds nothing.
    score += Math.min(evidence.outcomeEvidence, 5);
  }
  return score;
}

/**
 * A fact about how many other accepted sources independently teach the same
 * response for this archetype/channel — never an effectiveness claim. Zero is
 * stated plainly rather than omitted, so silence never implies corroboration.
 */
function sourceSupportClause(count: number): string {
  if (count <= 0) return "";
  return ` — also taught by ${count} other source${count === 1 ? "" : "s"}`;
}

export function assignFit(weapon: ArmoryWeapon): ArmoryWeapon {
  const evidence = weapon.personalEvidence;
  if (evidence?.confidence === "strong") {
    return {
      ...weapon,
      fit: "high",
      fitReason: `Your own evidence is strongest here — ${evidence.summary.toLowerCase()}`,
    };
  }
  if (
    weapon.provenance.type === "trainer_source" &&
    (weapon.provenance.confidence ?? 0) >= 0.8
  ) {
    return {
      ...weapon,
      fit: "high",
      fitReason: `High-confidence framework from ${weapon.provenance.creator}${sourceSupportClause(weapon.provenance.independentSourceSupportCount)}`,
    };
  }
  if (weapon.provenance.type === "trainer_source") {
    return {
      ...weapon,
      fit: "medium",
      fitReason: `Framework from ${weapon.provenance.creator} for this objection${sourceSupportClause(weapon.provenance.independentSourceSupportCount)}`,
    };
  }
  if (evidence?.confidence === "emerging") {
    return {
      ...weapon,
      fit: "medium",
      fitReason: evidence.summary,
    };
  }
  return {
    ...weapon,
    fit: "low",
    fitReason: "Baseline move — no sourced framework or personal evidence yet",
  };
}

export type ArmoryWeaponResult = {
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  weapons: ArmoryWeapon[];
  /** True when nothing sourced exists yet, so the UI can say so honestly. */
  trainerIntelligenceAvailable: boolean;
};

/**
 * Weapons for one archetype on one channel. `ANCHOR + phone` and
 * `ANCHOR + in_person` legitimately return different sets.
 */
export async function listArmoryWeapons(input: {
  tenantId: string;
  actorId: string;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  missionId?: number | null;
  limit?: number;
}): Promise<ArmoryWeaponResult> {
  const [visibleFrameworks, progression] = await Promise.all([
    queryDriverVisibleFrameworks({
      archetype: input.archetype,
      channel: input.channel,
      limit: 12,
    }),
    input.missionId == null
      ? Promise.resolve(null)
      : projectGoldlineProgressionForIdentity({
          tenantId: input.tenantId,
          actorId: input.actorId,
        }),
  ]);
  const eligibleFrameworkIds = new Set(
    (progression?.techniques ?? [])
      .filter(technique => technique.eligible && !technique.reviewOnly)
      .map(technique => technique.frameworkId)
  );
  // Accepted doctrine is necessary but not sufficient. Trainer techniques
  // enter the live Armory only when this player's real branch evidence makes
  // that exact framework eligible. Foundation moves always remain available.
  const frameworks =
    input.missionId == null
      ? visibleFrameworks // doctrine/review read; not a playable encounter
      : visibleFrameworks.filter(framework =>
          eligibleFrameworkIds.has(framework.id)
        );

  const sourceById = new Map<string, { url: string | null; type: string }>();
  if (frameworks.length) {
    const db = await getDb();
    if (db) {
      const rows = await db
        .select({
          id: salesIntelSourceArtifacts.id,
          canonicalUrl: salesIntelSourceArtifacts.canonicalUrl,
          sourceUrl: salesIntelSourceArtifacts.sourceUrl,
          sourceType: salesIntelSourceArtifacts.sourceType,
        })
        .from(salesIntelSourceArtifacts)
        .where(
          inArray(
            salesIntelSourceArtifacts.id,
            frameworks.map(framework => framework.sourceArtifactId)
          )
        );
      for (const row of rows) {
        sourceById.set(row.id, {
          url: row.canonicalUrl ?? row.sourceUrl ?? null,
          type: row.sourceType,
        });
      }
    }
  }

  const supportCounts = await Promise.all(
    frameworks.map(framework =>
      countIndependentSourceSupport({
        frameworkId: framework.id,
        sourceArtifactId: framework.sourceArtifactId,
        archetype: framework.archetype,
        channel: framework.channel,
        responseFamily: framework.responseFamily,
      })
    )
  );

  const trainerWeapons = frameworks.map((framework, index) => {
    const source = sourceById.get(framework.sourceArtifactId);
    return frameworkToWeapon({
      framework,
      sourceUrl: source?.url ?? null,
      sourceType: source?.type ?? "unknown",
      independentSourceSupportCount: supportCounts[index],
    });
  });

  const foundationWeapons: ArmoryWeapon[] = foundationWeaponsFor({
    archetype: input.archetype,
    channel: input.channel,
  }).map(weapon => ({
    id: weapon.id,
    archetype: weapon.archetype,
    channel: input.channel,
    title: weapon.title,
    responseFamily: weapon.responseFamily,
    spokenLine: weapon.spokenLine,
    discoveryQuestion: weapon.discoveryQuestion,
    principle: weapon.principle,
    exampleLanguage: [],
    whenToUse: [],
    whenNotToUse: [],
    provenance: { type: "foundation", sourceReference: weapon.sourceReference },
    personalEvidence: null,
    fit: "low",
    fitReason: "Baseline move",
  }));

  const combined = [...trainerWeapons, ...foundationWeapons];
  const evidence = await loadPersonalEvidence({
    tenantId: input.tenantId,
    actorId: input.actorId,
    weaponIds: combined.map(weapon => weapon.id),
  });

  const withEvidence = combined
    .map(weapon => ({
      ...weapon,
      personalEvidence: evidence.get(weapon.id) ?? null,
    }))
    .map(assignFit);

  withEvidence.sort((left, right) => rankScore(right) - rankScore(left));

  return {
    archetype: input.archetype,
    channel: input.channel,
    weapons: withEvidence.slice(0, input.limit ?? MAX_ENCOUNTER_WEAPONS),
    trainerIntelligenceAvailable: trainerWeapons.length > 0,
  };
}
