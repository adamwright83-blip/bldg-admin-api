import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { onboardingPreviewForConnection, onboardingReadTenantId, tenantRecordVisible } from "@shared/goldlineOnboarding";

const read = (name: string) => fs.readFileSync(path.resolve(import.meta.dirname, name), "utf8");

describe("onboarding preview labeling", () => {
  it("labels a preview without a connection as illustrative and does not read a second tenant as default", () => {
    const preview = onboardingPreviewForConnection({ connection: "none", connectedNames: ["Jane Doe"] });
    expect(preview.label).toBe("Illustrative");
    expect(preview.factualNames).toEqual([]);
    expect(onboardingReadTenantId("second-tenant")).not.toBe("default");
    expect(tenantRecordVisible("default", "second-tenant")).toBe(false);

    const interview = read("GoldlineOnboarding.tsx");
    const world = read("DesignPartnerWorld.tsx");
    const desk = read("FirstActionDesk.tsx");
    expect(interview).toContain('data-testid="onboarding-preview-label"');
    expect(interview).toContain('onboardingPreviewForConnection({ connection: "none" })');
    expect(interview).toContain("{preview.note}");
    expect(interview).toContain("<FirstActionDesk session={session} />");
    expect(world).toContain('connection:"none"');
    expect(world).toContain('data-testid="world-preview-label"');
    expect(world).toContain("holdings.length>0");
    expect(desk).toContain('kind: "operator_authored_task"');
    expect(desk).toContain('kind: "claire_preparation"');
    expect(desk).toContain("Not a verified sale or customer result.");
    expect(desk).toContain("No customer connection and no phone needed.");
    expect(interview + desk + world).not.toMatch(/Jane Doe|John Smith/);
  });
});