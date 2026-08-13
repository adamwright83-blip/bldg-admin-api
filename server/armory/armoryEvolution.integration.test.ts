/**
 * Armory Evolution against real MySQL.
 *
 * Proves the load-bearing claims: an accepted framework reaches the driver
 * with no sync step, trainer teaching and personal evidence stay separate,
 * evidence is association rather than attribution, and one tenant can never
 * see another's history.
 */
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  armoryWeaponOutcomes,
  armoryWeaponUsages,
  salesIntelFrameworks,
  salesIntelSourceArtifacts,
  salesIntelTranscripts,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { importSalesIntelCorpus } from "../salesIntel/salesIntelImport";
import { setFrameworkReviewState } from "../salesIntel/salesIntelStore";
import {
  associateArmoryOutcome,
  listMissionWeaponUsage,
  recordArmoryWeaponUsage,
} from "./armoryEvidenceService";
import { listArmoryWeapons, trainerWeaponId } from "./armoryWeaponService";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

const artifactIds: string[] = [];
const tenantIds: string[] = [];

async function seedFramework(options: {
  archetype: "ANCHOR" | "GATEKEEPER" | "GHOST" | "STALLER";
  channel: "phone" | "in_person" | "follow_up" | "proposal";
  creator: string;
  frameworkName: string;
  objection: string;
  responseFamily: string;
  exampleLanguage?: Array<{
    kind: "exact_source_phrase" | "paraphrased_principle";
    text: string;
  }>;
}) {
  const result = await importSalesIntelCorpus({
    actorId: "admin-openid",
    payload: {
      creator: { name: options.creator, handle: null },
      source: {
        type: "youtube",
        url: `https://www.youtube.com/watch?v=${randomUUID().replace(/-/g, "").slice(0, 11)}`,
        externalId: randomUUID().slice(0, 11),
        publishedAt: null,
        title: null,
      },
      transcript: {
        text: `Teaching ${randomUUID()}`,
        contentKind: "supplied_transcript",
        provider: null,
        model: null,
        segments: [],
      },
      frameworks: [
        {
          archetype: options.archetype,
          channel: options.channel,
          exactObjection: options.objection,
          diagnosis: null,
          frameworkName: options.frameworkName,
          principle: "Principle under test",
          responseFamily: options.responseFamily,
          discoveryQuestions: ["What would have to change?"],
          exampleLanguage: options.exampleLanguage ?? [],
          whenToUse: [],
          whenNotToUse: [],
          followUpMoves: [],
          badResponses: [],
          confidence: 0.9,
          transcriptStartMs: null,
          transcriptEndMs: null,
        },
      ],
    },
  });
  artifactIds.push(result.artifact.id);
  return result;
}

describe.skipIf(!runDatabaseGate)("Armory Evolution", () => {
  afterAll(async () => {
    const db = await getDb();
    if (!db) return;
    if (tenantIds.length) {
      await db
        .delete(armoryWeaponOutcomes)
        .where(inArray(armoryWeaponOutcomes.tenantId, tenantIds));
      await db
        .delete(armoryWeaponUsages)
        .where(inArray(armoryWeaponUsages.tenantId, tenantIds));
    }
    if (artifactIds.length) {
      await db
        .delete(salesIntelFrameworks)
        .where(inArray(salesIntelFrameworks.sourceArtifactId, artifactIds));
      await db
        .delete(salesIntelTranscripts)
        .where(inArray(salesIntelTranscripts.sourceArtifactId, artifactIds));
      await db
        .delete(salesIntelSourceArtifacts)
        .where(inArray(salesIntelSourceArtifacts.id, artifactIds));
    }
  });

  it("delivers an accepted framework to the driver with no publish step", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const objection = `Incumbent ${randomUUID()}`;
    const seeded = await seedFramework({
      archetype: "ANCHOR",
      channel: "phone",
      creator: "Supplied Trainer A",
      frameworkName: `Constraint isolation ${randomUUID().slice(0, 6)}`,
      objection,
      responseFamily: "isolate_constraint",
      exampleLanguage: [
        { kind: "exact_source_phrase", text: "What would have to change?" },
      ],
    });

    const result = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "ANCHOR",
      channel: "phone",
      limit: 6,
    });

    const weapon = result.weapons.find(
      item => item.id === trainerWeaponId(seeded.frameworks[0]!.id)
    );
    expect(weapon).toBeDefined();
    expect(result.trainerIntelligenceAvailable).toBe(true);
    expect(weapon!.provenance.type).toBe("trainer_source");
    if (weapon!.provenance.type === "trainer_source") {
      expect(weapon!.provenance.creator).toBe("Supplied Trainer A");
      expect(weapon!.provenance.sourceArtifactId).toBe(seeded.artifact.id);
      expect(weapon!.provenance.sourceUrl).toContain("youtube.com");
    }
    // Exact source phrasing is preferred for the spoken line.
    expect(weapon!.spokenLine).toBe("What would have to change?");
    // No personal history yet, so layer B is absent rather than fabricated.
    expect(weapon!.personalEvidence).toBeNull();
  });

  it("keeps accepted doctrine out when the client supplies no authoritative mission context", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const seeded = await seedFramework({
      archetype: "GATEKEEPER",
      channel: "phone",
      creator: "Supplied Trainer Evidence Gate",
      frameworkName: `Evidence-gated ${randomUUID().slice(0, 6)}`,
      objection: `Evidence gate ${randomUUID()}`,
      responseFamily: "seek_callback_window",
    });

    const liveEncounter = await listArmoryWeapons({
      tenantId,
      actorId: "driver-without-branch-evidence",
      archetype: "GATEKEEPER",
      channel: "phone",
      missionId: 9_999,
      limit: 6,
    });

    expect(liveEncounter.weapons.map(weapon => weapon.id)).not.toContain(
      trainerWeaponId(seeded.frameworks[0]!.id)
    );
    expect(liveEncounter.trainerIntelligenceAvailable).toBe(false);
    expect(
      liveEncounter.weapons.every(
        weapon => weapon.provenance.type === "foundation"
      )
    ).toBe(true);
  });

  it("returns different weapons for the same archetype on a different channel", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const phoneOnly = await seedFramework({
      archetype: "ANCHOR",
      channel: "phone",
      creator: "Supplied Trainer B",
      frameworkName: `Phone-only ${randomUUID().slice(0, 6)}`,
      objection: `Phone objection ${randomUUID()}`,
      responseFamily: "phone_family",
    });

    const phone = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "ANCHOR",
      channel: "phone",
      limit: 6,
    });
    const inPerson = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "ANCHOR",
      channel: "in_person",
      limit: 6,
    });

    const target = trainerWeaponId(phoneOnly.frameworks[0]!.id);
    expect(phone.weapons.map(w => w.id)).toContain(target);
    expect(inPerson.weapons.map(w => w.id)).not.toContain(target);
  });

  it("never returns a framework belonging to another archetype", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const ghost = await seedFramework({
      archetype: "GHOST",
      channel: "follow_up",
      creator: "Supplied Trainer C",
      frameworkName: `Ghost ${randomUUID().slice(0, 6)}`,
      objection: `Ghost objection ${randomUUID()}`,
      responseFamily: "channel_switch",
    });

    const staller = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "STALLER",
      channel: "follow_up",
      limit: 6,
    });
    expect(staller.weapons.map(w => w.id)).not.toContain(
      trainerWeaponId(ghost.frameworks[0]!.id)
    );
    expect(staller.weapons.every(w => w.archetype === "STALLER")).toBe(true);
  });

  it("stays playable with foundation weapons when no corpus exists", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const result = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "GATEKEEPER",
      channel: "in_person",
    });
    expect(result.weapons.length).toBeGreaterThan(0);
    expect(result.weapons.length).toBeLessThanOrEqual(3);
    expect(
      result.weapons.some(weapon => weapon.provenance.type === "foundation")
    ).toBe(true);
  });

  it("caps an encounter loadout at three choices", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    for (let index = 0; index < 4; index += 1) {
      await seedFramework({
        archetype: "STALLER",
        channel: "proposal",
        creator: `Supplied Trainer ${index}`,
        frameworkName: `Staller ${randomUUID().slice(0, 6)}`,
        objection: `Staller objection ${randomUUID()}`,
        responseFamily: "isolate_concern",
      });
    }
    const result = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "STALLER",
      channel: "proposal",
    });
    expect(result.weapons).toHaveLength(3);
  });

  it("keeps a rejected framework out of the loadout", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const seeded = await seedFramework({
      archetype: "GATEKEEPER",
      channel: "phone",
      creator: "Supplied Trainer D",
      frameworkName: `Rejected ${randomUUID().slice(0, 6)}`,
      objection: `Rejected objection ${randomUUID()}`,
      responseFamily: "transparent_purpose",
    });
    await setFrameworkReviewState({
      frameworkId: seeded.frameworks[0]!.id,
      reviewState: "rejected",
      reviewedBy: "admin-openid",
    });

    const result = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "GATEKEEPER",
      channel: "phone",
      limit: 6,
    });
    expect(result.weapons.map(w => w.id)).not.toContain(
      trainerWeaponId(seeded.frameworks[0]!.id)
    );
  });

  it("persists weapon usage idempotently and reports it as insufficient evidence", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const requestId = randomUUID();

    const first = await recordArmoryWeaponUsage({
      tenantId,
      actorId: "driver-openid",
      missionId: 4_101,
      weaponId: "foundation:isolate-the-delay",
      frameworkId: null,
      archetype: "STALLER",
      channel: "phone",
      provenanceKind: "foundation",
      requestId,
    });
    const retry = await recordArmoryWeaponUsage({
      tenantId,
      actorId: "driver-openid",
      missionId: 4_101,
      weaponId: "foundation:isolate-the-delay",
      frameworkId: null,
      archetype: "STALLER",
      channel: "phone",
      provenanceKind: "foundation",
      requestId,
    });
    expect(retry.id).toBe(first.id);
    expect(
      await listMissionWeaponUsage({
        tenantId,
        actorId: "driver-openid",
        missionId: 4_101,
      })
    ).toHaveLength(1);

    const result = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "STALLER",
      channel: "phone",
      limit: 6,
    });
    const used = result.weapons.find(
      weapon => weapon.id === "foundation:isolate-the-delay"
    );
    expect(used?.personalEvidence?.uses).toBe(1);
    expect(used?.personalEvidence?.confidence).toBe("insufficient");
    expect(used?.personalEvidence?.summary).toMatch(/not enough/i);
  });

  it("associates a later real outcome without rewriting the usage record", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const missionId = 4_202;

    for (let index = 0; index < 8; index += 1) {
      await recordArmoryWeaponUsage({
        tenantId,
        actorId: "driver-openid",
        missionId,
        weaponId: "foundation:specific-date",
        frameworkId: null,
        archetype: "STALLER",
        channel: "phone",
        provenanceKind: "foundation",
        requestId: randomUUID(),
      });
    }

    const followUpId = randomUUID();
    const associated = await associateArmoryOutcome({
      tenantId,
      actorId: "driver-openid",
      missionId,
      outcomeKind: "follow_up_created",
      outcomeReference: followUpId,
    });
    expect(associated).toBe(8);

    // Re-reporting the same real outcome must not inflate the evidence.
    await associateArmoryOutcome({
      tenantId,
      actorId: "driver-openid",
      missionId,
      outcomeKind: "follow_up_created",
      outcomeReference: followUpId,
    });

    await associateArmoryOutcome({
      tenantId,
      actorId: "driver-openid",
      missionId,
      outcomeKind: "account_won",
      outcomeReference: randomUUID(),
    });

    const result = await listArmoryWeapons({
      tenantId,
      actorId: "driver-openid",
      archetype: "STALLER",
      channel: "phone",
      limit: 6,
    });
    const weapon = result.weapons.find(
      item => item.id === "foundation:specific-date"
    );
    expect(weapon?.personalEvidence?.uses).toBe(8);
    // 8 usages x 2 distinct real outcomes, deduped on the repeated report.
    expect(weapon?.personalEvidence?.followUpsObserved).toBe(8);
    expect(weapon?.personalEvidence?.winsObserved).toBe(8);
    expect(weapon?.personalEvidence?.confidence).toBe("strong");
    expect(weapon?.personalEvidence?.summary).toMatch(/observed/i);
    expect(weapon?.personalEvidence?.summary.toLowerCase()).not.toMatch(
      /caused|because/
    );
  });

  it("never leaks one tenant's personal evidence into another", async () => {
    const tenantA = `t-${randomUUID()}`;
    const tenantB = `t-${randomUUID()}`;
    tenantIds.push(tenantA, tenantB);

    await recordArmoryWeaponUsage({
      tenantId: tenantA,
      actorId: "driver-openid",
      missionId: 4_303,
      weaponId: "foundation:change-channel",
      frameworkId: null,
      archetype: "GHOST",
      channel: "follow_up",
      provenanceKind: "foundation",
      requestId: randomUUID(),
    });

    const seenByB = await listArmoryWeapons({
      tenantId: tenantB,
      actorId: "driver-openid",
      archetype: "GHOST",
      channel: "follow_up",
      limit: 6,
    });
    const weapon = seenByB.weapons.find(
      item => item.id === "foundation:change-channel"
    );
    expect(weapon).toBeDefined();
    expect(weapon!.personalEvidence).toBeNull();
  });

  it("does not associate outcomes with usage outside the window", async () => {
    const tenantId = `t-${randomUUID()}`;
    tenantIds.push(tenantId);
    const missionId = 4_404;

    await recordArmoryWeaponUsage({
      tenantId,
      actorId: "driver-openid",
      missionId,
      weaponId: "foundation:close-the-loop",
      frameworkId: null,
      archetype: "GHOST",
      channel: "follow_up",
      provenanceKind: "foundation",
      requestId: randomUUID(),
    });

    const associated = await associateArmoryOutcome({
      tenantId,
      actorId: "driver-openid",
      missionId,
      outcomeKind: "account_won",
      outcomeReference: randomUUID(),
      // A window that closed before the usage was recorded.
      windowMs: 1,
    });
    expect(associated).toBe(0);
  });
});
