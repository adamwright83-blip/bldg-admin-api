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

  it("still never claims a truth field is true (display copy may honestly state they are false)", () => {
    expect(source).not.toMatch(/provider_accepted:\s*true|bookingConfirmed:\s*true|paymentAuthorized:\s*true|dispatched:\s*true/i);
    expect(source).not.toMatch(/provider_accepted: \{|booking_confirmed: \{|payment_authorized: \{/);
  });
});

describe("MissionControlPage -- Slice 75c Sent Messages feed", () => {
  it("renders the section title and reuses the existing Slice 74 recentContactAttempts query", () => {
    expect(source).toMatch(/Sent Messages/);
    expect(source).toMatch(/vendorCastingSprint\.recentContactAttempts\.useQuery/);
  });

  it("renders the honest empty-state copy", () => {
    expect(source).toMatch(/No outbound attempts yet\. Launch a mission and approve outreach to begin\./);
  });

  it("renders all six channel icon labels, with Phone / Voice marked Coming soon", () => {
    for (const channelLabel of ["Email", "SMS", "Yelp", "Web Form", "Phone / Voice", "Reply"]) {
      expect(source).toContain(channelLabel);
    }
    expect(source).toMatch(/Phone \/ Voice.*comingSoon: true/s);
  });

  it("never renders a fake vendor name, fake message body, or hardcoded sent row", () => {
    expect(source).not.toMatch(/Paws & Polish|Happy Hounds|Wag Luxury|Beverly Barkers|Puppy Palace|The Dog Spa/);
  });

  it("never invokes any outbound send mutation for this feed", () => {
    expect(source).not.toMatch(/recentAttempts[\s\S]{0,40}\.mutate/);
  });
});

describe("MissionControlPage -- Slice 75c Sub-Agent Training composer", () => {
  it("renders the training composer and labels itself as guidance, not real model training", () => {
    expect(source).toMatch(/Sub-Agent Training/);
    expect(source).toMatch(/human guidance for message drafting, not model training/);
    expect(source).toMatch(/Local guidance draft.*persistence comes next/);
  });

  it("renders the required training chips", () => {
    for (const chip of ["Tone: Luxury & Warm", "Focus: Availability", "Qualify: Pricing", "Objection: Busy", "Add rule"]) {
      expect(source).toContain(chip);
    }
  });

  it("adding a rule only updates local component state, never persists or calls a mutation", () => {
    expect(source).toMatch(/setSavedTrainingRules\(rules => \[\.\.\.rules, trainingDraft\.trim\(\)\]\)/);
    const addRuleBlock = source.match(/onClick={\(\) => \{\s*setSavedTrainingRules[\s\S]{0,150}?\}\}/)?.[0] ?? "";
    expect(addRuleBlock).not.toMatch(/\.mutate/);
  });

  it("never calls an LLM and never claims model improvement", () => {
    expect(source).not.toMatch(/openai|anthropic\.|chatCompletion|generateText/i);
    expect(source).not.toMatch(/model (improved|trained|learned)/i);
  });
});

describe("MissionControlPage -- Slice 75c source isolation", () => {
  it("still never imports any outbound send adapter", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
  });

  it("still never claims a truth field is true (display copy may honestly state they are false)", () => {
    expect(source).not.toMatch(/provider_accepted:\s*true|bookingConfirmed:\s*true|paymentAuthorized:\s*true|dispatched:\s*true/i);
    expect(source).not.toMatch(/provider_accepted: \{|booking_confirmed: \{|payment_authorized: \{/);
  });
});
