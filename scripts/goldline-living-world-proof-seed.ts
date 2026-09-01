/**
 * Deterministic world fixture for browser proof.
 *
 * Every row here is invented for a disposable database. It exists so the rare
 * and irreversible transitions of the living world — a review-ready tower, an
 * evidence conflict, a dormant customer relighting on a real reorder — can be
 * demonstrated without manufacturing any of them in production.
 *
 * Run against a throwaway MySQL only. It refuses to touch a database whose URL
 * looks like the production one.
 */

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  commercialAccounts,
  commercialMissions,
  commercialOpportunities,
  commercialPipelineRecords,
  entityLocations,
  goldlineWorldEvents,
  orders,
  physicalEntities,
  physicalEntityAliases,
  physicalEntityBindings,
  propertyEvidenceItems,
  towerAssetVersions,
  towerForgeJobs,
  towerWeaponConcepts,
} from "../drizzle/schema";
import { getDb } from "../server/db";
import {
  getGeographicTruth,
  normalizeSourceAddress,
} from "../server/geography/geographicTruthService";

const TENANT = "default";

function assertDisposableDatabase() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is required");
  if (!/127\.0\.0\.1|localhost/.test(url)) {
    throw new Error(
      `Refusing to seed a non-local database. This fixture is for disposable proof databases only. Got: ${url.replace(/:[^:@]*@/, ":***@")}`
    );
  }
}

/** Days back from now, as a real Date, so cadence maths behaves normally. */
function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function seed() {
  assertDisposableDatabase();
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const louise = "22222222-2222-4222-8222-222222222222";
  const meridian = "33333333-3333-4333-8333-333333333333";
  const louiseAddress = "1450 S La Cienega Blvd, Los Angeles, CA";
  const meridianAddress = "800 W Olympic Blvd, Los Angeles, CA";

  await db.insert(physicalEntities).values([
    {
      id: louise,
      tenantId: TENANT,
      kind: "building",
      displayName: "The Louise",
      identityStatus: "confirmed",
    },
    {
      // Two sources disagree about this one, so the city must show a fracture
      // rather than quietly picking a winner.
      id: meridian,
      tenantId: TENANT,
      kind: "building",
      displayName: "Meridian Court",
      identityStatus: "needs_review",
    },
  ]);

  await db.insert(physicalEntityAliases).values([
    {
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: louise,
      aliasType: "normalized_address",
      aliasValue: louiseAddress,
      normalizedAliasValue: normalizeSourceAddress(louiseAddress),
      evidenceReference: "google_places:proof-louise",
    },
    {
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: meridian,
      aliasType: "normalized_address",
      aliasValue: meridianAddress,
      normalizedAliasValue: normalizeSourceAddress(meridianAddress),
      evidenceReference: "google_places:proof-meridian",
    },
  ]);

  // A real commercial pursuit at The Louise, so the building itself is the marker.
  const [account] = await db
    .insert(commercialAccounts)
    .values({
      tenantId: TENANT,
      name: "The Louise",
      accountType: "residential_building",
    })
    .$returningId();

  const [opportunity] = await db
    .insert(commercialOpportunities)
    .values({
      tenantId: TENANT,
      accountId: account.id,
      score: 72,
      grade: "high",
      primarySignal: "Proof fixture opportunity",
      reasonsJson: [],
      risksJson: [],
      evidenceJson: [],
    })
    .$returningId();

  const [mission] = await db
    .insert(commercialMissions)
    .values({
      tenantId: TENANT,
      opportunityId: opportunity.id,
      code: "PROOF-1",
      status: "game_ready",
      accountSnapshotJson: { name: "The Louise", address: louiseAddress },
      opportunitySnapshotJson: {},
      missionBriefJson: {},
      createdBy: "proof-seed",
    })
    .$returningId();

  await db.insert(commercialPipelineRecords).values({
    tenantId: TENANT,
    accountId: account.id,
    opportunityId: opportunity.id,
    missionId: mission.id,
    stage: "proposal_sent",
  } as never);

  await db.insert(physicalEntityBindings).values([
    {
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: louise,
      bindingType: "commercial_account",
      bindingKey: String(account.id),
      evidenceReference: `commercial_accounts:${account.id}`,
      confidence: "high",
      reviewState: "accepted",
    },
    {
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: meridian,
      bindingType: "canonical_building",
      bindingKey: meridianAddress,
      evidenceReference: "proof:conflicting-sources",
      confidence: "low",
      reviewState: "review_required",
    },
  ]);

  await db.insert(entityLocations).values([
    {
      id: randomUUID(),
      tenantId: TENANT,
      entityType: "commercial_prospect",
      entityKey: String(account.id),
      sourceAddress: louiseAddress,
      normalizedSourceAddress: normalizeSourceAddress(louiseAddress),
      canonicalAddress: louiseAddress,
      latitude: "34.0480000",
      longitude: "-118.3760000",
      geocodeStatus: "success",
      geocodeProvider: "proof_fixture",
      geocodedAt: new Date(),
    },
  ]);

  /**
   * A dormant customer with real order history at The Louise. The history is
   * what makes the recovery path legitimate — without it there would be no
   * cadence to be late against.
   */
  const dormantPhone = "3105550142";
  await db.insert(orders).values(
    [220, 190, 160, 130].map((days, index) => ({
      tenantId: TENANT,
      firstName: "Marisol",
      lastName: "Vega",
      phone: dormantPhone,
      address: louiseAddress,
      status: "delivered" as const,
      paid: true,
      total: "8400",
      createdAt: daysAgo(days),
      updatedAt: daysAgo(days),
      paidAt: daysAgo(days),
      serviceType: "wash_fold" as const,
      pickupDate: daysAgo(days).toISOString().slice(0, 10),
      pickupTimeWindow: "9:00-11:00",
      deliveryDate: daysAgo(days - 1).toISOString().slice(0, 10),
      specialInstructions: `proof-fixture-order-${index}`,
    })) as never
  );

  /**
   * A second, active customer at the building whose sources disagree. Their
   * light stays warm — the uncertainty is about what Goldline knows, not about
   * whether these orders happened.
   */
  const activePhone = "3105550188";
  await db.insert(orders).values(
    [70, 42, 14].map((days, index) => ({
      tenantId: TENANT,
      firstName: "Dorian",
      lastName: "Ashford",
      phone: activePhone,
      address: meridianAddress,
      status: "delivered" as const,
      paid: true,
      total: "12600",
      serviceType: "wash_fold" as const,
      createdAt: daysAgo(days),
      updatedAt: daysAgo(days),
      paidAt: daysAgo(days),
      pickupDate: daysAgo(days).toISOString().slice(0, 10),
      pickupTimeWindow: "9:00-11:00",
      deliveryDate: daysAgo(days - 1).toISOString().slice(0, 10),
      specialInstructions: `proof-fixture-active-${index}`,
    })) as never
  );

  /**
   * The customer's geographic row is created by the app's own identity sync
   * rather than by guessing its key here, then given fixture coordinates. That
   * way this fixture cannot drift from how real customers are identified.
   */
  await getGeographicTruth({ tenantId: TENANT });
  await db
    .update(entityLocations)
    .set({
      canonicalAddress: louiseAddress,
      latitude: "34.0480000",
      longitude: "-118.3760000",
      geocodeStatus: "success",
      geocodeProvider: "proof_fixture",
      geocodedAt: new Date(),
    })
    .where(
      and(
        eq(entityLocations.tenantId, TENANT),
        eq(entityLocations.entityType, "customer"),
        eq(
          entityLocations.normalizedSourceAddress,
          normalizeSourceAddress(louiseAddress)
        )
      )
    );
  await db
    .update(entityLocations)
    .set({
      canonicalAddress: meridianAddress,
      latitude: "34.0450000",
      longitude: "-118.2670000",
      geocodeStatus: "success",
      geocodeProvider: "proof_fixture",
      geocodedAt: new Date(),
    })
    .where(
      and(
        eq(entityLocations.tenantId, TENANT),
        eq(entityLocations.entityType, "customer"),
        eq(
          entityLocations.normalizedSourceAddress,
          normalizeSourceAddress(meridianAddress)
        )
      )
    );

  // Real history, so the building has something honest to remember.
  const chronicle = [
    { type: "prospect_discovered", classification: "evidence", days: 120 },
    { type: "visited", classification: "action", days: 90 },
    { type: "visited", classification: "action", days: 60 },
    { type: "proposal_sent", classification: "action", days: 30 },
  ] as const;

  await db.insert(goldlineWorldEvents).values(
    chronicle.map(entry => ({
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: louise,
      eventType: entry.type,
      classification: entry.classification,
      actorType: "field" as const,
      actorId: "proof-seed",
      occurredAt: daysAgo(entry.days),
      observedAt: null,
      sourceType: "proof_fixture",
      sourceId: `${entry.type}-${entry.days}`,
      sourceEvidenceReference: `proof_fixture:${entry.type}:${entry.days}`,
      provenanceClass: "operator_observed" as const,
      verificationClass: "VERIFIED" as const,
      confidence: "high" as const,
      idempotencyKey: `proof:${entry.type}:${entry.days}`,
      correlationId: "proof-chronicle",
      metadataJson: {},
    })) as never
  );

  await db.insert(propertyEvidenceItems).values([
    {
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: louise,
      category: "field_evidence",
      factType: "architecture",
      valueJson: { value: "terraced roof deck" },
      provenanceClass: "operator_observed",
      sourceReference: "driver_sales_journals:proof-entry",
      sourceUrl: null,
    },
  ] as never);

  // A review-ready tower, so NEW TOWER DISCOVERED can be proven without
  // generating art against a real prospect.
  const forgeJob = randomUUID();
  const concept = randomUUID();
  await db.insert(towerForgeJobs).values([
    {
      id: forgeJob,
      tenantId: TENANT,
      physicalEntityId: louise,
      commercialAccountId: account.id,
      state: "review_ready",
      correlationId: "proof-forge",
      idempotencyKey: "proof-forge-job",
      candidateJson: { name: "The Louise", address: louiseAddress },
      lastError: null,
    },
  ] as never);

  await db.insert(towerWeaponConcepts).values([
    {
      id: concept,
      tenantId: TENANT,
      physicalEntityId: louise,
      forgeJobId: forgeJob,
      rank: 1,
      title: "Terrace Cascade Engine",
      sourceCharacteristic: "terraced roof deck",
      sourceEvidenceIdsJson: [],
      conceptJson: { summary: "Derived from an observed architectural feature" },
      similarityRisk: "low",
      selected: true,
    },
  ] as never);

  await db.insert(towerAssetVersions).values([
    {
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: louise,
      forgeJobId: forgeJob,
      conceptId: concept,
      provider: "proof_fixture",
      promptVersionHash: "proof",
      sourceEvidenceIdsJson: [],
      storageKey: "proof/goldline-world-empty.png",
      assetUrl: "/assets/goldline/generated/goldline-world-empty.png",
      variantType: "base",
      approvalStatus: "draft",
    },
  ] as never);

  const hunt = [
    {
      id: "44444444-4444-4444-8444-444444444441",
      name: "La Cienega Court",
      address: "1520 S La Cienega Blvd, Los Angeles, CA",
      latitude: "34.0621000",
      longitude: "-118.3812000",
    },
    {
      id: "44444444-4444-4444-8444-444444444442",
      name: "The Marble Arms",
      address: "1530 S La Cienega Blvd, Los Angeles, CA",
      latitude: "34.0624000",
      longitude: "-118.3808000",
    },
    {
      id: "44444444-4444-4444-8444-444444444443",
      name: "Sunwell House",
      address: "1540 S La Cienega Blvd, Los Angeles, CA",
      latitude: "34.0628000",
      longitude: "-118.3815000",
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Orchard Place",
      address: "1550 S La Cienega Blvd, Los Angeles, CA",
      latitude: "34.0631000",
      longitude: "-118.3809000",
    },
  ] as const;

  await db.insert(physicalEntities).values(
    hunt.map(building => ({
      id: building.id,
      tenantId: TENANT,
      kind: "building" as const,
      displayName: building.name,
      identityStatus: "confirmed" as const,
    }))
  );
  await db.insert(physicalEntityAliases).values(
    hunt.map(building => ({
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: building.id,
      aliasType: "normalized_address" as const,
      aliasValue: building.address,
      normalizedAliasValue: normalizeSourceAddress(building.address),
      evidenceReference: `proof:territory-hunt:${building.id}`,
    }))
  );

  for (const building of hunt) {
    const [huntAccount] = await db
      .insert(commercialAccounts)
      .values({
        tenantId: TENANT,
        name: building.name,
        accountType: "residential_building",
      })
      .$returningId();
    const [huntOpportunity] = await db
      .insert(commercialOpportunities)
      .values({
        tenantId: TENANT,
        accountId: huntAccount.id,
        score: 64,
        grade: "medium",
        primarySignal: "Proof fixture territory hunt",
        reasonsJson: [],
        risksJson: [],
        evidenceJson: [],
      })
      .$returningId();
    const [huntMission] = await db
      .insert(commercialMissions)
      .values({
        tenantId: TENANT,
        opportunityId: huntOpportunity.id,
        code: `PROOF-HUNT-${building.id.slice(-1)}`,
        status: "game_ready",
        accountSnapshotJson: { name: building.name, address: building.address },
        opportunitySnapshotJson: {},
        missionBriefJson: {},
        createdBy: "proof-seed",
      })
      .$returningId();
    await db.insert(commercialPipelineRecords).values({
      tenantId: TENANT,
      accountId: huntAccount.id,
      opportunityId: huntOpportunity.id,
      missionId: huntMission.id,
      stage: "qualified",
    } as never);
    await db.insert(physicalEntityBindings).values({
      id: randomUUID(),
      tenantId: TENANT,
      physicalEntityId: building.id,
      bindingType: "commercial_account",
      bindingKey: String(huntAccount.id),
      evidenceReference: `commercial_accounts:${huntAccount.id}`,
      confidence: "high",
      reviewState: "accepted",
    });
    await db.insert(entityLocations).values({
      id: randomUUID(),
      tenantId: TENANT,
      entityType: "commercial_prospect",
      entityKey: String(huntAccount.id),
      sourceAddress: building.address,
      normalizedSourceAddress: normalizeSourceAddress(building.address),
      canonicalAddress: building.address,
      latitude: building.latitude,
      longitude: building.longitude,
      geocodeStatus: "success",
      geocodeProvider: "proof_fixture",
      geocodedAt: new Date(),
    });
  }

  await db.insert(goldlineWorldEvents).values({
    id: randomUUID(),
    tenantId: TENANT,
    physicalEntityId: hunt[0]!.id,
    eventType: "field_commitment_made",
    classification: "action",
    actorType: "field",
    actorId: "goldline-proof-driver",
    occurredAt: daysAgo(2),
    observedAt: daysAgo(2),
    sourceType: "proof_fixture",
    sourceId: "territory-tether",
    sourceEvidenceReference: "proof:territory-tether",
    provenanceClass: "operator_reported",
    verificationClass: "ATTESTED",
    confidence: "medium",
    idempotencyKey: "proof-territory-tether",
    correlationId: hunt[0]!.id,
    metadataJson: {
      statement: "Return with the one-sheet tomorrow",
      promisedTo: "front desk",
      dueDate: new Date().toISOString().slice(0, 10),
    },
  } as never);

  const counts = await db.execute(
    sql`SELECT (SELECT COUNT(*) FROM physical_entities) AS entities, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM goldline_world_events) AS events`
  );
  console.log("Seeded deterministic proof world:", JSON.stringify(counts[0]));
}

seed().then(
  () => process.exit(0),
  error => {
    console.error(error);
    process.exit(1);
  }
);
