import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0035_commercial_mission_spine.sql", import.meta.url),
  "utf8",
);
const store = readFileSync(new URL("./commercialMissionStore.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("./commercialMissionRouter.ts", import.meta.url), "utf8");

describe("commercial mission production spine", () => {
  it("normalizes the account, opportunity, mission, event, step, and outcome records", () => {
    for (const table of [
      "commercial_accounts",
      "commercial_account_locations",
      "commercial_account_contacts",
      "commercial_opportunities",
      "commercial_missions",
      "commercial_mission_events",
      "commercial_mission_steps",
      "commercial_visit_outcomes",
    ]) {
      expect(migration).toContain(`CREATE TABLE \`${table}\``);
    }
  });

  it("enforces tenant-scoped idempotency and optimistic mission versions", () => {
    expect(migration).toContain(
      "CONSTRAINT `uq_commercial_mission_events_tenant_idempotency` UNIQUE(`tenantId`,`idempotencyKey`)",
    );
    expect(store).toContain("eq(commercialMissions.version, input.expectedVersion)");
    expect(store).toContain("commercial mission transition lost an optimistic concurrency race".replace(/^c/, "C"));
  });

  it("uses a current locking read after the account identity upsert", () => {
    expect(store).toContain('eq(commercialAccounts.identityKey, identityKey),\n      )).limit(1).for("update")');
  });

  it("derives actor authority from the authenticated procedure", () => {
    expect(router).not.toContain("actorType: actorTypeSchema");
    expect(router).toContain('actor: { type: "operator", id: ctx.user.openId }');
    expect(router).toContain("dayforgeMissionOperatorProcedure");
    expect(router).toContain("dayforgeMissionFieldProcedure");
  });
});
