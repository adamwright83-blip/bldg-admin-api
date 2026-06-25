import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "MissionControlPage.tsx"), "utf8");

describe("MissionControlPage -- Slice 75a source isolation", () => {
  it("never imports an AgentMail/SMS/Yelp/web-form/phone send path", () => {
    expect(source).not.toMatch(/agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
  });

  it("only calls the vendorAcquisitionMission router, not vendorCastingSprint outreach mutations", () => {
    expect(source).toMatch(/vendorAcquisitionMission\.createMission/);
    expect(source).toMatch(/vendorAcquisitionMission\.listMissions/);
    expect(source).not.toMatch(/sendOutreach|recordReplyAndTerms|simulateVendorReply/);
  });

  it("renders Mission Composer as the primary hero element, with a real Start Mission action", () => {
    expect(source).toMatch(/Mission Composer/);
    expect(source).toMatch(/Start Mission/);
  });

  it("does not claim a discovery agent ran -- explicitly states no candidates were found", () => {
    expect(source).toMatch(/No discovery agent has run yet/);
  });

  it("labels mobile-preferred as not yet wired, rather than silently submitting it as real criteria", () => {
    expect(source).toMatch(/not yet wired to mission criteria/);
    expect(source).not.toMatch(/mobilePreferred[^}]*qualityGates/s);
  });

  it("never auto-fires the createMission mutation on initial render (only inside the click handler)", () => {
    const mutateCallSites = source.match(/createMission\.mutate\(/g) ?? [];
    expect(mutateCallSites.length).toBeGreaterThan(0);
    expect(source).not.toMatch(/useEffect\([^)]*createMission\.mutate/s);
  });
});
