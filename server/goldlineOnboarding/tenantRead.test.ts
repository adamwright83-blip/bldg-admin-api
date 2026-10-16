import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { onboardingReadTenantId, sessionForReader, tenantRecordVisible } from "../../shared/goldlineOnboarding";

const read = (name: string) => fs.readFileSync(path.resolve(import.meta.dirname, name), "utf8");

describe("onboarding tenant read", () => {
  it("does not let a second tenant id read as the default tenant", () => {
    expect(onboardingReadTenantId("second-tenant")).toBe("second-tenant");
    expect(tenantRecordVisible("default", "second-tenant")).toBe(false);
    expect(tenantRecordVisible("second-tenant", "default")).toBe(false);
    expect(sessionForReader({ tenantId: "default" }, "second-tenant")).toBeNull();
    const store = read("store.ts");
    const mission = read("firstMission.ts");
    const router = read("router.ts");
    expect(store).toContain("onboardingReadTenantId(tenantId)");
    expect(store).toContain("sessionForReader(session, reader)");
    expect(store).toContain("WHERE tenantId=${reader}");
    expect(mission).toContain("tenantRecordVisible(row.tenantId,reader)");
    expect(router).toContain('kind: z.literal("operator_authored_task")');
    expect(router).toContain('kind: z.literal("claire_preparation")');
    expect(router).toContain("prepareClaireOpening(session)");
    expect(router).not.toContain('tenantId: "default"');
  });
});