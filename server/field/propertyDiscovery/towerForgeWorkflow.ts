import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  goldlineCreativeExclusions,
  physicalEntities,
  physicalEntityBindings,
  propertyEvidenceItems,
  towerAssetVersions,
  towerForgeJobs,
  towerWeaponConcepts,
} from "../../../drizzle/schema";
import type { FieldJournalExtraction } from "../../../shared/fieldJournal";
import { appendGoldlineWorldEvent } from "../../goldlineWorld/worldEventStore";
import { bindPhysicalEntity, createOrResolvePhysicalEntity, persistEvidence } from "../../geography/physicalEntityApplication";
import { buildTowerGenerationPrompt } from "../../../shared/towerGenerationPrompt";
import { selectPlaceCandidate } from "../../geography/propertyDiscoveryContracts";
import type { PropertyEvidence } from "../../../shared/propertyEvidence";
import { createCommercialMission } from "../../commercialMissions/commercialMissionStore";
import { getDb } from "../../db";
import { syncGeographicEntities, geocodePendingLocations } from "../../geography/geographicTruthService";
import { runGooglePlacesDiscovery } from "../../procurement/googlePlacesDiscoveryConnector";
import { storagePut } from "../../storage";
import { researchOfficialProperty } from "../../integrations/propertyResearch/officialPropertyResearch";
import {
  canTransitionTowerForge,
  generateWeaponCandidates,
  type TowerForgeState,
  type TowerWeaponConcept,
} from "../../../shared/towerForgeContracts";
import {
  defaultTowerImageProvider,
  productionTowerImageProvider,
  type TowerImageProvider,
} from "../../experience/goldline/builder/towerImageProvider";

type JournalPropertyCandidate = FieldJournalExtraction["entities"][number];

const locallyQueued = new Set<string>();

function evidenceValue(item: { value: string } | null | undefined) {
  return item?.value.trim() || null;
}

export async function queueForgeCandidatesFromJournal(input: {
  tenantId: string;
  journalEntryId: string;
  actorId: string;
  extraction: FieldJournalExtraction;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const candidates = input.extraction.entities.filter(entity =>
    entity.kind === "potential_property" || entity.kind === "existing_property"
  );
  const jobs = [];
  for (const candidate of candidates) {
    const idempotencyKey = `field-journal-forge:${input.journalEntryId}:${candidate.clientEntityKey}`;
    const id = randomUUID();
    await db.insert(towerForgeJobs).values({
      id,
      tenantId: input.tenantId,
      journalEntryId: input.journalEntryId,
      state: "entity_resolving",
      correlationId: `field-journal:${input.journalEntryId}`,
      idempotencyKey,
      candidateJson: { actorId: input.actorId, candidate },
    }).onDuplicateKeyUpdate({ set: { idempotencyKey } });
    const [job] = await db.select().from(towerForgeJobs).where(and(
      eq(towerForgeJobs.tenantId, input.tenantId),
      eq(towerForgeJobs.idempotencyKey, idempotencyKey)
    )).limit(1);
    if (job) {
      jobs.push(job);
      queueTowerForgeJob({ tenantId: input.tenantId, forgeJobId: job.id });
    }
  }
  return jobs;
}

export function queueTowerForgeJob(input: { tenantId: string; forgeJobId: string }) {
  const key = `${input.tenantId}:${input.forgeJobId}`;
  if (locallyQueued.has(key)) return;
  locallyQueued.add(key);
  setTimeout(() => {
    void processTowerForgeJob(input)
      .catch(error => console.error("[WorldForge] job failed", {
        forgeJobId: input.forgeJobId,
        error: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => locallyQueued.delete(key));
  }, 0);
}

async function transitionJob(input: {
  tenantId: string;
  jobId: string;
  from: TowerForgeState;
  to: TowerForgeState;
  values?: Partial<typeof towerForgeJobs.$inferInsert>;
}) {
  if (!canTransitionTowerForge(input.from, input.to))
    throw new Error(`Invalid tower forge transition ${input.from} → ${input.to}`);
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(towerForgeJobs).set({ state: input.to, ...input.values }).where(and(
    eq(towerForgeJobs.tenantId, input.tenantId),
    eq(towerForgeJobs.id, input.jobId),
    eq(towerForgeJobs.state, input.from)
  ));
}

function fieldEvidence(candidate: JournalPropertyCandidate, journalEntryId: string): PropertyEvidence[] {
  const evidence: PropertyEvidence[] = [];
  const add = (factType: string, item: JournalPropertyCandidate["propertyName"] | JournalPropertyCandidate["amenities"][number]) => {
    if (!item) return;
    evidence.push({
      id: randomUUID(),
      factType,
      value: item.value,
      provenance: item.provenance === "operator_observed" ? "operator_observed" : "operator_reported",
      sourceReference: `driver_sales_journals:${journalEntryId}`,
    });
  };
  add("property_name", candidate.propertyName);
  add("address_clue", candidate.addressClue);
  candidate.amenities.forEach(item => add("amenity", item));
  candidate.architecture.forEach(item => add("architecture", item));
  return evidence;
}

export async function processTowerForgeJob(input: {
  tenantId: string;
  forgeJobId: string;
  imageProvider?: TowerImageProvider;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [job] = await db.select().from(towerForgeJobs).where(and(
    eq(towerForgeJobs.tenantId, input.tenantId),
    eq(towerForgeJobs.id, input.forgeJobId)
  )).limit(1);
  if (!job) throw new Error("Tower forge job not found");
  if (["review_ready", "generation_unconfigured", "generation_failed"].includes(job.state)) {
    if (!job.physicalEntityId) throw new Error("A resolved physical entity is required before art generation");
    const [entity] = await db.select().from(physicalEntities).where(and(eq(physicalEntities.tenantId, input.tenantId), eq(physicalEntities.id, job.physicalEntityId))).limit(1);
    const concepts = await db.select().from(towerWeaponConcepts).where(and(eq(towerWeaponConcepts.tenantId, input.tenantId), eq(towerWeaponConcepts.forgeJobId, job.id))).orderBy(asc(towerWeaponConcepts.rank));
    const selectedRow = concepts.find(item => item.selected) ?? concepts[0];
    if (!entity || !selectedRow) throw new Error("Tower identity or evidence-backed concept is missing");
    const evidenceRows = await db.select().from(propertyEvidenceItems).where(and(eq(propertyEvidenceItems.tenantId, input.tenantId), eq(propertyEvidenceItems.forgeJobId, job.id)));
    const exclusions = await db.select().from(goldlineCreativeExclusions).where(and(eq(goldlineCreativeExclusions.tenantId, input.tenantId), eq(goldlineCreativeExclusions.active, true)));
    const provider = input.imageProvider ?? defaultTowerImageProvider();
    if (!provider.configured()) return job;
    const concept = selectedRow.conceptJson as TowerWeaponConcept;
    const evidence = evidenceRows.map(row => ({ id: row.id, factType: row.factType, value: String((row.valueJson as { value?: unknown }).value ?? ""), provenance: row.provenanceClass, sourceReference: row.sourceReference })) as PropertyEvidence[];
    await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: job.state, to: "rendering", values: { lastError: null } });
    try {
      const prompt = buildTowerGenerationPrompt({ propertyName: entity.displayName, evidence, concept, excludedThemes: exclusions.map(item => item.themeKey) });
      const generated = await provider.generate({ physicalEntityId: entity.id, prompt, promptVersion: "goldline-tower-v1", sourceEvidenceIds: concept.sourceEvidenceIds });
      if (generated.provider === "deterministic_test_only" && process.env.NODE_ENV === "production") throw new Error("Test-only tower image adapter cannot run in production");
      const assetId = randomUUID();
      const stored = await storagePut(`goldline/towers/${entity.id}/${assetId}.png`, generated.bytes, generated.mimeType);
      await db.insert(towerAssetVersions).values({ id: assetId, tenantId: input.tenantId, physicalEntityId: entity.id, forgeJobId: job.id, conceptId: selectedRow.id, provider: generated.provider, modelVersion: generated.modelVersion, promptVersionHash: generated.promptVersionHash, sourceEvidenceIdsJson: concept.sourceEvidenceIds, storageKey: stored.key, assetUrl: stored.url, variantType: "base", approvalStatus: "draft" });
      await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "rendering", to: "review_ready" });
      await appendGoldlineWorldEvent({ tenantId: input.tenantId, physicalEntityId: entity.id, eventType: "tower_review_ready", classification: "game_projection", actorType: "system", actorId: null, occurredAt: new Date().toISOString(), observedAt: null, sourceType: "tower_forge_jobs", sourceId: job.id, sourceEvidenceReference: `tower_forge_jobs:${job.id}`, provenanceClass: "generated_game_fiction", verificationClass: "VERIFIED", confidence: "high", idempotencyKey: `tower-review-ready:${job.id}:${assetId}`, correlationId: job.correlationId, metadata: { assetId, regenerated: true } });
      return { ...job, state: "review_ready" as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "rendering", to: "generation_failed", values: { lastError: message.slice(0, 512), retryCount: job.retryCount + 1 } });
      throw error;
    }
  }
  if (["approved", "rejected", "published"].includes(job.state)) return job;
  const metadata = job.candidateJson as { actorId: string; candidate: JournalPropertyCandidate };
  const candidate = metadata.candidate;
  const reportedName = evidenceValue(candidate.propertyName);
  const reportedAddress = evidenceValue(candidate.addressClue);
  if (!reportedName && !reportedAddress) {
    await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: job.state, to: "needs_review", values: { lastError: "Property identity lacks a name and address clue" } });
    return { ...job, state: "needs_review" as const };
  }
  try {
    const places = await runGooglePlacesDiscovery({
      searchText: [reportedName, reportedAddress, evidenceValue(candidate.neighborhood)].filter(Boolean).join(" "),
      maxResults: 5,
    });
    const placeResolution = places.status === "ok"
      ? selectPlaceCandidate({ propertyName: reportedName, addressClue: reportedAddress, candidates: places.candidates })
      : { status: places.status === "needs_provider_config" ? "provider_unconfigured" as const : "provider_error" as const, reasons: [places.status] };
    if (placeResolution.status === "needs_review") {
      await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: job.state, to: "needs_review", values: { lastError: placeResolution.reasons.join("; "), candidateJson: { ...metadata, placeCandidates: placeResolution.candidates } } });
      return { ...job, state: "needs_review" as const };
    }
    const place = placeResolution.status === "matched" ? placeResolution.candidate : null;
    const name = place?.businessName ?? reportedName!;
    const address = place?.address ?? reportedAddress;
    if (!address) {
      await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: job.state, to: "needs_review", values: { lastError: "A real address is required before prospect creation" } });
      return { ...job, state: "needs_review" as const };
    }
    const identity = await createOrResolvePhysicalEntity({ tenantId: input.tenantId, jobId: job.id, name, placeId: place?.placeId ?? null, address, evidenceReference: place ? `google_places:${place.placeId}` : `driver_sales_journals:${job.journalEntryId}` });
    if (identity.status === "needs_review") {
      await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: job.state, to: "needs_review", values: { lastError: identity.reason } });
      return { ...job, state: "needs_review" as const };
    }
    await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: job.state, to: "geography_verifying", values: { physicalEntityId: identity.physicalEntityId } });

    /*
      One building keeps one commercial relationship. A second journal about
      the same place must extend the existing account, not open a rival one —
      otherwise the same property accumulates duplicate accounts, duplicate
      geographic authority rows and eventually a duplicate published tower.
      The physical entity's own binding is the authority on whether a
      commercial account already exists here.
    */
    const existingAccountBinding = await db
      .select({ bindingKey: physicalEntityBindings.bindingKey })
      .from(physicalEntityBindings)
      .where(
        and(
          eq(physicalEntityBindings.tenantId, input.tenantId),
          eq(physicalEntityBindings.physicalEntityId, identity.physicalEntityId),
          eq(physicalEntityBindings.bindingType, "commercial_account")
        )
      )
      .limit(1);
    const boundAccountId = existingAccountBinding[0]
      ? Number(existingAccountBinding[0].bindingKey)
      : null;

    const mission: { id: number | null; account: { accountId: number } } =
      boundAccountId && Number.isSafeInteger(boundAccountId)
      ? { id: null, account: { accountId: boundAccountId } }
      : await createCommercialMission({
      tenantId: input.tenantId,
      assignedTo: metadata.actorId,
      initialPipelineStage: "discovered",
      account: {
        providerName: place ? "google_places" : null,
        providerAccountId: place?.placeId ?? null,
        name,
        accountType: "property",
        website: place?.website ?? evidenceValue(candidate.websiteDomain),
        address,
        latitude: place?.coordinates?.lat ?? null,
        longitude: place?.coordinates?.lng ?? null,
        locationCount: 1,
        decisionMaker: { name: null, title: null, email: null, phone: null, relationshipType: "unknown", preferredChannel: "unknown", source: "operator_observation", sourceUrl: null, sourcedAt: null, notes: null },
      },
      opportunity: {
        estimatedAnnualValueCents: null,
        estimateConfidence: "low",
        score: 0,
        primarySignal: "Field Journal discovery",
        reasons: ["Operator captured a real property for investigation"],
        risks: ["Commercial fit and relationship are not yet established"],
        evidence: [{ source: "driver_sales_journals", journalEntryId: job.journalEntryId, placeId: place?.placeId ?? null }],
      },
      brief: {
        laundryOpportunity: "Investigate whether this real property has a legitimate laundry-service opportunity.",
        salesAngle: "Unknown until real discovery establishes fit.",
        openingLine: "Introduce Laundry Butler and ask who evaluates resident-service partnerships.",
        discoveryQuestions: ["How are resident laundry needs handled today?", "Who evaluates resident-service partnerships?"],
        objections: [],
      },
      steps: [
        { key: "investigate", label: "Investigate", detail: "Review evidence and identify a legitimate next action.", status: "ready", position: 0 },
      ],
      actor: { type: "driver", id: metadata.actorId },
      idempotencyKey: `world-forge-prospect:${job.id}`,
      });
    await syncGeographicEntities(input.tenantId);
    await geocodePendingLocations({ tenantId: input.tenantId, batchSize: 10 });
    await bindPhysicalEntity({ tenantId: input.tenantId, physicalEntityId: identity.physicalEntityId, bindingType: "commercial_account", bindingKey: String(mission.account.accountId), evidenceReference: `commercial_accounts:${mission.account.accountId}` });
    await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "geography_verifying", to: "prospect_created", values: { commercialAccountId: mission.account.accountId } });
    await appendGoldlineWorldEvent({
      tenantId: input.tenantId,
      physicalEntityId: identity.physicalEntityId,
      eventType: "prospect_discovered",
      classification: "evidence",
      actorType: "field",
      actorId: metadata.actorId,
      occurredAt: new Date().toISOString(),
      observedAt: null,
      sourceType: "commercial_pipeline_records",
      sourceId: mission.id === null ? `entity:${identity.physicalEntityId}` : String(mission.id),
      sourceEvidenceReference: `driver_sales_journals:${job.journalEntryId}`,
      provenanceClass: place ? "provider_verified" : "operator_reported",
      verificationClass: place ? "VERIFIED" : "ATTESTED",
      confidence: place ? "high" : "medium",
      idempotencyKey: `prospect-discovered:${job.id}`,
      correlationId: job.correlationId,
      metadata: { commercialAccountId: mission.account.accountId, stage: "discovered" },
    });

    await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "prospect_created", to: "researching" });
    const field = fieldEvidence(candidate, job.journalEntryId!);
    if (place) field.push(
      { id: randomUUID(), factType: "canonical_name", value: place.businessName, provenance: "provider_verified", sourceReference: `google_places:${place.placeId}` },
      { id: randomUUID(), factType: "canonical_address", value: place.address ?? address, provenance: "provider_verified", sourceReference: `google_places:${place.placeId}` }
    );
    await persistEvidence({ tenantId: input.tenantId, physicalEntityId: identity.physicalEntityId, forgeJobId: job.id, items: field, category: "field_evidence" });
    const website = place?.website ?? evidenceValue(candidate.websiteDomain);
    const research = website ? await researchOfficialProperty({ website }) : null;
    const official: PropertyEvidence[] = research && (research.status === "ok" || research.status === "partial")
      ? research.facts.map(fact => ({ id: randomUUID(), factType: fact.factType, value: fact.value, provenance: "official_property_source", sourceReference: fact.sourceUrl }))
      : [];
    await persistEvidence({ tenantId: input.tenantId, physicalEntityId: identity.physicalEntityId, forgeJobId: job.id, items: official, category: "official_property_intelligence", sourceUrl: research && "sourceUrl" in research ? research.sourceUrl : null });
    await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "researching", to: official.length ? "concepting" : "research_partial", values: official.length ? undefined : { lastError: website ? "Official research returned no usable characteristics" : "No official property website is known" } });
    if (!official.length) await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "research_partial", to: "concepting" });

    const exclusions = await db.select().from(goldlineCreativeExclusions).where(and(eq(goldlineCreativeExclusions.tenantId, input.tenantId), eq(goldlineCreativeExclusions.active, true)));
    const concepts = generateWeaponCandidates({ evidence: [...field, ...official], excludedThemes: exclusions.map(item => item.themeKey), existingThemes: ["golf club", "golf ball", "Century Park East signature"] });
    if (!concepts.length) {
      await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "concepting", to: "needs_review", values: { lastError: "No evidence-backed weapon concept is available" } });
      return { ...job, state: "needs_review" as const };
    }
    const conceptRows = concepts.map((concept, index) => ({
      id: randomUUID(), tenantId: input.tenantId, physicalEntityId: identity.physicalEntityId, forgeJobId: job.id,
      rank: concept.rank, title: concept.title, sourceCharacteristic: concept.sourceCharacteristic,
      sourceEvidenceIdsJson: concept.sourceEvidenceIds, conceptJson: concept,
      similarityRisk: concept.similarityRisk, selected: index === 0,
    }));
    await db.insert(towerWeaponConcepts).values(conceptRows).onDuplicateKeyUpdate({ set: { title: concepts[0]!.title } });
    const provider = input.imageProvider ?? defaultTowerImageProvider();
    if (!provider.configured()) {
      await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "concepting", to: "generation_unconfigured", values: { lastError: "OPENAI_API_KEY or another supported tower image provider is not configured" } });
      await appendGoldlineWorldEvent({
        tenantId: input.tenantId, physicalEntityId: identity.physicalEntityId, eventType: "tower_forge_awaiting_art", classification: "game_projection", actorType: "system", actorId: null,
        occurredAt: new Date().toISOString(), observedAt: null, sourceType: "tower_forge_jobs", sourceId: job.id, sourceEvidenceReference: `tower_forge_jobs:${job.id}`,
        provenanceClass: "derived", verificationClass: "VERIFIED", confidence: "high", idempotencyKey: `tower-awaiting-art:${job.id}`, correlationId: job.correlationId,
        metadata: { state: "generation_unconfigured" },
      });
      return { ...job, state: "generation_unconfigured" as const };
    }
    await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "concepting", to: "rendering" });
    const selected = concepts[0]!;
    const prompt = buildTowerGenerationPrompt({ propertyName: name, evidence: [...field, ...official], concept: selected, excludedThemes: exclusions.map(item => item.themeKey) });
    const generated = await provider.generate({ physicalEntityId: identity.physicalEntityId, prompt, promptVersion: "goldline-tower-v1", sourceEvidenceIds: selected.sourceEvidenceIds });
    if (generated.provider === "deterministic_test_only" && process.env.NODE_ENV === "production") throw new Error("Test-only tower image adapter cannot run in production");
    const assetId = randomUUID();
    const storageKey = `goldline/towers/${identity.physicalEntityId}/${assetId}.png`;
    const stored = await storagePut(storageKey, generated.bytes, generated.mimeType);
    await db.insert(towerAssetVersions).values({
      id: assetId, tenantId: input.tenantId, physicalEntityId: identity.physicalEntityId, forgeJobId: job.id,
      conceptId: conceptRows[0]!.id, provider: generated.provider, modelVersion: generated.modelVersion,
      promptVersionHash: generated.promptVersionHash, sourceEvidenceIdsJson: selected.sourceEvidenceIds,
      storageKey: stored.key, assetUrl: stored.url, variantType: "base", approvalStatus: "draft",
    });
    await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "rendering", to: "review_ready" });
    await appendGoldlineWorldEvent({
      tenantId: input.tenantId, physicalEntityId: identity.physicalEntityId, eventType: "tower_review_ready", classification: "game_projection", actorType: "system", actorId: null,
      occurredAt: new Date().toISOString(), observedAt: null, sourceType: "tower_forge_jobs", sourceId: job.id, sourceEvidenceReference: `tower_forge_jobs:${job.id}`,
      provenanceClass: "generated_game_fiction", verificationClass: "VERIFIED", confidence: "high", idempotencyKey: `tower-review-ready:${job.id}`, correlationId: job.correlationId,
      metadata: { assetId },
    });
    return { ...job, state: "review_ready" as const, physicalEntityId: identity.physicalEntityId, commercialAccountId: mission.account.accountId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const [fresh] = await db.select().from(towerForgeJobs).where(eq(towerForgeJobs.id, job.id)).limit(1);
    const current = fresh?.state ?? job.state;
    if (["rendering", "concepting"].includes(current)) {
      await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: current as TowerForgeState, to: "generation_failed", values: { lastError: message.slice(0, 512), retryCount: job.retryCount + 1 } });
    } else {
      await db.update(towerForgeJobs).set({ lastError: message.slice(0, 512), retryCount: job.retryCount + 1 }).where(eq(towerForgeJobs.id, job.id));
    }
    throw error;
  }
}

export async function listForgeJobs(input: { tenantId: string; limit?: number }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(towerForgeJobs).where(eq(towerForgeJobs.tenantId, input.tenantId)).orderBy(asc(towerForgeJobs.createdAt)).limit(input.limit ?? 100);
}

export async function getForgeReview(input: { tenantId: string; forgeJobId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [job] = await db.select().from(towerForgeJobs).where(and(eq(towerForgeJobs.tenantId, input.tenantId), eq(towerForgeJobs.id, input.forgeJobId))).limit(1);
  if (!job) throw new Error("Tower forge job not found");
  const [entity, evidence, concepts, assets] = await Promise.all([
    job.physicalEntityId ? db.select().from(physicalEntities).where(and(eq(physicalEntities.tenantId, input.tenantId), eq(physicalEntities.id, job.physicalEntityId))).limit(1) : Promise.resolve([]),
    db.select().from(propertyEvidenceItems).where(and(eq(propertyEvidenceItems.tenantId, input.tenantId), eq(propertyEvidenceItems.forgeJobId, job.id))).orderBy(asc(propertyEvidenceItems.createdAt)),
    db.select().from(towerWeaponConcepts).where(and(eq(towerWeaponConcepts.tenantId, input.tenantId), eq(towerWeaponConcepts.forgeJobId, job.id))).orderBy(asc(towerWeaponConcepts.rank)),
    db.select().from(towerAssetVersions).where(and(eq(towerAssetVersions.tenantId, input.tenantId), eq(towerAssetVersions.forgeJobId, job.id))).orderBy(desc(towerAssetVersions.createdAt)),
  ]);
  return { job, entity: entity[0] ?? null, evidence, concepts, assets };
}

export async function selectTowerWeaponConcept(input: { tenantId: string; forgeJobId: string; conceptId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [concept] = await db.select().from(towerWeaponConcepts).where(and(eq(towerWeaponConcepts.tenantId, input.tenantId), eq(towerWeaponConcepts.forgeJobId, input.forgeJobId), eq(towerWeaponConcepts.id, input.conceptId))).limit(1);
  if (!concept) throw new Error("Weapon concept not found in this forge job");
  await db.update(towerWeaponConcepts).set({ selected: false }).where(and(eq(towerWeaponConcepts.tenantId, input.tenantId), eq(towerWeaponConcepts.forgeJobId, input.forgeJobId)));
  await db.update(towerWeaponConcepts).set({ selected: true, reviewState: "accepted" }).where(eq(towerWeaponConcepts.id, concept.id));
  return { selectedConceptId: concept.id };
}

export async function rejectTowerForgeJob(input: { tenantId: string; forgeJobId: string; reason: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [job] = await db.select().from(towerForgeJobs).where(and(eq(towerForgeJobs.tenantId, input.tenantId), eq(towerForgeJobs.id, input.forgeJobId))).limit(1);
  if (!job) throw new Error("Tower forge job not found");
  if (!canTransitionTowerForge(job.state, "rejected")) throw new Error(`A ${job.state} forge job cannot be rejected`);
  await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: job.state, to: "rejected", values: { lastError: input.reason, completedAt: new Date() } });
  await db.update(towerAssetVersions).set({ approvalStatus: "rejected" }).where(and(eq(towerAssetVersions.tenantId, input.tenantId), eq(towerAssetVersions.forgeJobId, job.id), eq(towerAssetVersions.approvalStatus, "draft")));
  return { state: "rejected" as const };
}

export async function approveAndPublishTower(input: { tenantId: string; forgeJobId: string; assetId: string; actorId: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [job] = await db.select().from(towerForgeJobs).where(and(eq(towerForgeJobs.tenantId, input.tenantId), eq(towerForgeJobs.id, input.forgeJobId))).limit(1);
  if (!job || !job.physicalEntityId) throw new Error("Resolved tower forge job not found");
  if (job.state !== "review_ready") throw new Error("Only review-ready generated art can be approved");
  const [asset] = await db.select().from(towerAssetVersions).where(and(eq(towerAssetVersions.tenantId, input.tenantId), eq(towerAssetVersions.forgeJobId, job.id), eq(towerAssetVersions.id, input.assetId))).limit(1);
  if (!asset) throw new Error("Tower asset does not belong to this forge job");
  await db.update(towerAssetVersions).set({ approvalStatus: "superseded", supersededBy: asset.id }).where(and(eq(towerAssetVersions.tenantId, input.tenantId), eq(towerAssetVersions.physicalEntityId, job.physicalEntityId), eq(towerAssetVersions.approvalStatus, "approved")));
  await db.update(towerAssetVersions).set({ approvalStatus: "approved", supersededBy: null }).where(eq(towerAssetVersions.id, asset.id));
  await bindPhysicalEntity({ tenantId: input.tenantId, physicalEntityId: job.physicalEntityId, bindingType: "tower_asset", bindingKey: asset.id, evidenceReference: `tower_asset_versions:${asset.id}` });
  await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "review_ready", to: "approved" });
  await transitionJob({ tenantId: input.tenantId, jobId: job.id, from: "approved", to: "published", values: { completedAt: new Date(), lastError: null } });
  await appendGoldlineWorldEvent({
    tenantId: input.tenantId, physicalEntityId: job.physicalEntityId, eventType: "tower_published", classification: "game_projection", actorType: "operator", actorId: input.actorId,
    occurredAt: new Date().toISOString(), observedAt: null, sourceType: "tower_asset_versions", sourceId: asset.id, sourceEvidenceReference: `tower_asset_versions:${asset.id}`,
    provenanceClass: "generated_game_fiction", verificationClass: "VERIFIED", confidence: "high", idempotencyKey: `tower-published:${job.id}:${asset.id}`, correlationId: job.correlationId,
    metadata: { assetId: asset.id, commercialAccountId: job.commercialAccountId, representationOnly: true },
  });
  return { state: "published" as const, physicalEntityId: job.physicalEntityId, assetId: asset.id };
}
