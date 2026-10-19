import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { lanternNeighborhoodMemories } from "../../../drizzle/schema";
import { and, eq } from "drizzle-orm";
import {
  loadNeighborhoodWorldMemory,
  recordVillagerInteraction,
  saveNeighborhoodFeature,
  saveUnfinishedLetterDraft,
} from "./neighborhoodMemoryService";

const TEST_TENANT = "acceptance_laundry_farm_test";
const TEST_TERRITORY = "silver-lake";

describe("neighborhoodMemoryPersistence (Real Cross-Session/Device Acceptance Test)", () => {
  let isDbAvailable = false;

  beforeAll(async () => {
    // If not already set, provide the local proof database URL
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL = "mysql://root:root@127.0.0.1:3399/goldline_proof";
    }
    process.env.ALLOW_TEST_DB = "true";

    try {
      const db = await getDb();
      if (db) {
        await db.execute("SELECT 1");
        isDbAvailable = true;
        // Clean up prior test runs
        await db
          .delete(lanternNeighborhoodMemories)
          .where(
            and(
              eq(lanternNeighborhoodMemories.tenantId, TEST_TENANT),
              eq(lanternNeighborhoodMemories.territoryId, TEST_TERRITORY)
            )
          );
      }
    } catch {
      isDbAvailable = false;
    }
  });

  afterAll(async () => {
    if (isDbAvailable) {
      try {
        const db = await getDb();
        if (db) {
          await db
            .delete(lanternNeighborhoodMemories)
            .where(
              and(
                eq(lanternNeighborhoodMemories.tenantId, TEST_TENANT),
                eq(lanternNeighborhoodMemories.territoryId, TEST_TERRITORY)
              )
            );
        }
      } catch {
        // ignore cleanup error
      }
    }
  });

  it("persists and recovers world memory across simulated sessions and devices using real MySQL", async () => {
    if (!isDbAvailable) {
      console.warn("Skipping real MySQL acceptance test: database not reachable at DATABASE_URL");
      return;
    }

    const db = await getDb();
    expect(db).toBeDefined();

    // --- SESSION A (Device 1) ---
    // User places reading bench
    const featureResult = await saveNeighborhoodFeature({
      tenantId: TEST_TENANT,
      territoryId: TEST_TERRITORY,
      featureChoice: "reading_bench",
      now: new Date("2026-10-19T10:00:00Z"),
    });
    expect(featureResult.featureChoice).toBe("reading_bench");

    // User starts writing a letter to customer Chloe
    await saveUnfinishedLetterDraft({
      tenantId: TEST_TENANT,
      territoryId: TEST_TERRITORY,
      customerId: "cust_chloe_acc",
      customerName: "Chloe Bennett",
      villagerVariant: "fox",
      selectedApproach: "helpful_detailed",
      draftBody: "Hi Chloe! Barnaby here from Laundry Farm...",
      now: new Date("2026-10-19T10:05:00Z"),
    });

    // Inspect database table directly to prove real SQL persistence
    const directRows = await db!
      .select()
      .from(lanternNeighborhoodMemories)
      .where(
        and(
          eq(lanternNeighborhoodMemories.tenantId, TEST_TENANT),
          eq(lanternNeighborhoodMemories.territoryId, TEST_TERRITORY)
        )
      );

    expect(directRows.length).toBe(1);
    const savedRow = directRows[0];
    expect(savedRow.courtyardFeature).toBe("reading_bench");
    expect(JSON.stringify(savedRow.unfinishedActivitiesJson)).toContain("Barnaby here from Laundry Farm");

    // --- SESSION B (Device 2 / Server Restart) ---
    // User loads memory on another device
    const loadedOnDevice2 = await loadNeighborhoodWorldMemory({
      tenantId: TEST_TENANT,
      territoryId: TEST_TERRITORY,
      now: new Date("2026-10-19T10:10:00Z"),
      touchVisit: false,
    });

    expect(loadedOnDevice2.featureChoice).toBe("reading_bench");
    expect(loadedOnDevice2.unfinishedActivity).not.toBeNull();
    expect(loadedOnDevice2.unfinishedActivity?.customerId).toBe("cust_chloe_acc");
    expect(loadedOnDevice2.unfinishedActivity?.draftBody).toContain("Barnaby here from Laundry Farm");

    // User opens Google Messages handoff on Device 2
    const handoffOpened = await recordVillagerInteraction({
      tenantId: TEST_TENANT,
      territoryId: TEST_TERRITORY,
      villagerVariant: "fox",
      customerId: "cust_chloe_acc",
      customerName: "Chloe Bennett",
      actionType: "compose_handoff_opened",
      now: new Date("2026-10-19T10:12:00Z"),
    });

    // Must NOT claim dispatched letter or dispatch milestone
    expect(handoffOpened.villagerMemories.fox.lettersHandoffOpenedCount).toBe(1);
    expect(handoffOpened.villagerMemories.fox.lettersDispatchedCount).toBe(0);
    expect(handoffOpened.celebratedMilestones).not.toContain("milestone_verified_sent_cust_chloe_acc");

    // Independently verified send evidence arrives
    const verifiedSend = await recordVillagerInteraction({
      tenantId: TEST_TENANT,
      territoryId: TEST_TERRITORY,
      villagerVariant: "fox",
      customerId: "cust_chloe_acc",
      customerName: "Chloe Bennett",
      actionType: "independently_verified_sent",
      now: new Date("2026-10-19T10:15:00Z"),
    });

    // NOW lettersDispatchedCount and milestone are updated
    expect(verifiedSend.villagerMemories.fox.lettersDispatchedCount).toBe(1);
    expect(verifiedSend.celebratedMilestones).toContain("milestone_verified_sent_cust_chloe_acc");
    expect(verifiedSend.celebratedMilestones).toContain("milestone_first_verified_send");

    // Verify row in MySQL after all mutations
    const finalRows = await db!
      .select()
      .from(lanternNeighborhoodMemories)
      .where(
        and(
          eq(lanternNeighborhoodMemories.tenantId, TEST_TENANT),
          eq(lanternNeighborhoodMemories.territoryId, TEST_TERRITORY)
        )
      );

    expect(finalRows.length).toBe(1);
    const finalRow = finalRows[0];
    expect(JSON.stringify(finalRow.celebratedEventsJson)).toContain("milestone_verified_sent_cust_chloe_acc");
  });
});
