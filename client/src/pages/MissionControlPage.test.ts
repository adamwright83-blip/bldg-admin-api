import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "MissionControlPage.tsx"), "utf8");

describe("MissionControlPage -- Slice 75a source isolation", () => {
  it("never imports an AgentMail/SMS/Yelp/web-form/phone send path", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
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

describe("MissionControlPage -- Slice 75b compact map card", () => {
  it("renders a map preview card with an expand-map affordance, without claiming to be a live interactive map", () => {
    expect(source).toMatch(/Map preview/);
    expect(source).toMatch(/Expand map/);
    expect(source).toMatch(/no live map provider configured/);
  });

  it("renders the required legend entries", () => {
    expect(source).toMatch(/Target Building/);
    expect(source).toMatch(/Search Radius/);
    expect(source).toMatch(/Discovered Vendors/);
  });

  it("labels discovered vendors as preview/none, never a fabricated count or vendor name", () => {
    expect(source).toMatch(/Discovered Vendors \(none yet/);
    expect(source).not.toMatch(/Paws & Polish|Happy Hounds|Wag Luxury Grooming|Beverly Barkers|Puppy Palace/);
  });

  it("does not install or import a map SDK", () => {
    expect(source).not.toMatch(/mapbox|leaflet|@react-google-maps|maplibre/i);
  });
});

describe("MissionControlPage -- Slice 75b market tabs", () => {
  it("renders the global market preview row, all disabled", () => {
    for (const city of ["London", "Dubai", "Singapore", "Paris", "Tokyo"]) {
      expect(source).toContain(city);
    }
    expect(source).toMatch(/GLOBAL_MARKET_PREVIEW_CITIES[\s\S]*?disabled/);
  });

  it("renders the US market row with only Los Angeles active", () => {
    expect(source).toMatch(/Los Angeles.*active: true/);
    for (const city of ["NYC", "Atlanta", "Dallas", "Chicago"]) {
      expect(source).toMatch(new RegExp(`${city}.*active: false`));
    }
  });

  it("never claims HELD is live outside Los Angeles", () => {
    expect(source).not.toMatch(/London.*\bactive: true\b|Dubai.*\bactive: true\b|Tokyo.*\bactive: true\b/);
  });
});

describe("MissionControlPage -- Slice 75b building selector", () => {
  it("renders OPUS LA and Century Park East with their real zip codes", () => {
    expect(source).toMatch(/OPUS LA.*90027/s);
    expect(source).toMatch(/Century Park East.*90067/s);
  });

  it("defaults the selected building to OPUS LA (matching the composer's default 90027 zip)", () => {
    expect(source).toMatch(/useState<\(typeof LA_BUILDINGS\)\[number\]\["id"\]>\("opus-la"\)/);
  });

  it("building selection is local UI state only -- never calls a mutation", () => {
    expect(source).toMatch(/setSelectedBuildingId\(building\.id\)/);
    expect(source).not.toMatch(/setSelectedBuildingId[\s\S]{0,80}mutate/);
  });
});

describe("MissionControlPage -- Slice 75b sub-agent orchestra", () => {
  it("renders all six sub-agent cards with role subtitles", () => {
    for (const agent of ["Map Scout", "Directory Digger", "Outreach Ace", "Reply Whisperer", "Verifier", "Web Seeker"]) {
      expect(source).toContain(agent);
    }
  });

  it("never renders a fake progress percentage", () => {
    expect(source).not.toMatch(/\b\d{1,3}%\b/);
  });

  it("shows 'Waiting for mission' when no mission exists, and only mission-gated honest statuses otherwise", () => {
    expect(source).toMatch(/latestMission \? agent\.statusWithMission : "Waiting for mission"/);
    for (const status of [
      "Ready to inspect places", "Waiting for provider keys", "AgentMail ready, canary gated",
      "Webhook ready", "Waiting for candidates", "Not configured yet",
    ]) {
      expect(source).toContain(status);
    }
  });

  it("never claims candidates were found by a sub-agent", () => {
    expect(source).not.toMatch(/candidates found|vendors discovered|leads sourced/i);
  });
});

describe("MissionControlPage -- Slice 75b source isolation", () => {
  it("still never imports any outbound send adapter", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
  });

  it("still never touches truth fields", () => {
    expect(source).not.toMatch(/provider_accepted|booking_confirmed|payment_authorized|\bdispatched\b/);
  });
});
