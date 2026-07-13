/**
 * Proves the public/internal mission-identity split for the boss-demo
 * tenant: the internal `commercial_missions.id` primary key is free to
 * change on every reset, but the public story code the presenter relies on
 * ("MISSION 042") must never drift. DB-gated like the other release
 * integration tests — skips cleanly without a live MySQL connection.
 *
 * Usage: DAYFORGE_RELEASE_DB=1 DATABASE_URL=... pnpm vitest run --config
 * vitest.integration.config.ts server/dayforgeDemo/demoMissionCode.integration.test.ts
 */
import { describe, expect, it } from "vitest";
import { getDb } from "../db";
import { commercialMissions } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import {
  DEMO_MISSION_PUBLIC_CODE,
  demoTenantId,
  seedDemoTenant,
} from "./demoTenantSeed";
import { resetDemoTenant } from "./demoTenantReset";
import { getCommercialMission } from "../commercialMissions/commercialMissionStore";

const runDatabaseGate =
  process.env.DAYFORGE_RELEASE_DB === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!runDatabaseGate)(
  "DayForge boss-demo mission code stability",
  () => {
    it(
      "keeps the public code MISSION 042 fixed across resets while the internal mission id changes",
      { timeout: 30_000 },
      async () => {
        const db = await getDb();
        expect(db, "DATABASE_URL must connect to the release MySQL service").not.toBeNull();
        const tenantId = demoTenantId();

        // 1. Fresh seed: public code is the fixed story code, not derived
        //    from whatever internal id the row happened to get.
        const first = await seedDemoTenant();
        expect(first.mission.code).toBe(DEMO_MISSION_PUBLIC_CODE);

        // 2. Mutations (events, transitions) still key off the real internal
        //    id, not the display code -- getCommercialMission takes an id.
        const reloaded = await getCommercialMission({
          tenantId,
          missionId: first.mission.id,
        });
        expect(reloaded?.id).toBe(first.mission.id);
        expect(reloaded?.code).toBe(DEMO_MISSION_PUBLIC_CODE);

        // 3. Reset + reseed: internal id changes (a brand new row), public
        //    code does not.
        await resetDemoTenant({ role: "admin", id: "test-actor" });
        const second = await seedDemoTenant();
        expect(second.mission.id).not.toBe(first.mission.id);
        expect(second.mission.code).toBe(DEMO_MISSION_PUBLIC_CODE);

        // 4. Duplicate reset+reseed does not create two active MISSION 042
        //    rows for the tenant -- the old row was actually deleted, not
        //    left dangling with a colliding code.
        const activeCodeRows = await db!
          .select({ id: commercialMissions.id })
          .from(commercialMissions)
          .where(
            and(
              eq(commercialMissions.tenantId, tenantId),
              eq(commercialMissions.code, DEMO_MISSION_PUBLIC_CODE)
            )
          );
        expect(activeCodeRows).toHaveLength(1);
        expect(activeCodeRows[0].id).toBe(second.mission.id);

        // 5. Calling seedDemoTenant again without a reset in between is
        //    idempotent (same idempotency key resolves the existing row) --
        //    it must not create a second mission or throw on the unique
        //    (tenantId, code) constraint.
        const third = await seedDemoTenant();
        expect(third.mission.id).toBe(second.mission.id);
        expect(third.mission.code).toBe(DEMO_MISSION_PUBLIC_CODE);
      }
    );
  }
);
