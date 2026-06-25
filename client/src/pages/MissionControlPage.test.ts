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

  it("does not claim a discovery agent already ran on mission creation -- offers Run discovery instead (updated in the 76a CTA bugfix)", () => {
    expect(source).toMatch(/Google Places discovery is available\. Run discovery to/);
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
    expect(source).toMatch(/effectiveMissionId \? agent\.statusWithMission : "Waiting for mission"/);
    for (const status of [
      "Ready to inspect places", "Waiting for provider keys", "AgentMail ready, canary gated",
      "Webhook ready", "Waiting for candidates", "Not configured yet",
    ]) {
      expect(source).toContain(status);
    }
  });

  it("the fixed sub-agent status copy never claims candidates were found (only real discovery results, added in Slice 76a, may)", () => {
    const subAgentsBlock = source.match(/const SUB_AGENTS: SubAgent\[\] = \[[\s\S]*?\];/)?.[0] ?? "";
    expect(subAgentsBlock).not.toMatch(/candidates found|vendors discovered|leads sourced/i);
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

describe("MissionControlPage -- Slice 76a Run discovery action", () => {
  it("renders a Run discovery action wired to the real runDiscovery mutation", () => {
    expect(source).toMatch(/Run discovery/);
    expect(source).toMatch(/vendorAcquisitionMission\.runDiscovery\.useMutation/);
  });

  it("displays the provider-config-needed state honestly", () => {
    expect(source).toMatch(/needs_provider_config/);
    expect(source).toMatch(/Map Scout needs a Google Places API key configured/);
  });

  it("displays a real discovery summary (found\\/persisted\\/already-discovered counts) without claiming outreach happened", () => {
    expect(source).toMatch(/Found \{runDiscovery\.data\.foundCount\}/);
    const summaryBlock = source.match(/Found \{runDiscovery\.data\.foundCount\}[\s\S]{0,120}/)?.[0] ?? "";
    expect(summaryBlock).not.toMatch(/contacted|outreach sent|message sent/i);
  });

  it("displays an honest zero-result state", () => {
    expect(source).toMatch(/No candidates found for this mission\./);
  });

  it("never renders a hardcoded/fake vendor name in the discovery UI", () => {
    expect(source).not.toMatch(/Paws & Polish|Happy Hounds|Wag Luxury|Beverly Barkers|Puppy Palace|The Dog Spa|Paw Spa LA/);
  });

  it("is disabled with no mission, and never auto-fires on initial render", () => {
    expect(source).toMatch(/disabled=\{!effectiveMissionId \|\| runDiscovery\.isPending\}/);
    expect(source).not.toMatch(/useEffect\([^)]*runDiscovery\.mutate/s);
  });
});

describe("MissionControlPage -- Slice 76a source isolation", () => {
  it("still never imports any outbound send adapter or live LLM", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid|openai|anthropic\./i);
  });

  it("still never claims a truth field is true", () => {
    expect(source).not.toMatch(/provider_accepted:\s*true|bookingConfirmed:\s*true|paymentAuthorized:\s*true|dispatched:\s*true/i);
  });
});

describe("MissionControlPage -- Run Discovery CTA activation bugfix", () => {
  it("sets activeMissionId from the createMission response, not just from the recentMissions refetch", () => {
    expect(source).toMatch(/const \[activeMissionId, setActiveMissionId\] = useState<string \| null>\(null\)/);
    expect(source).toMatch(/onSuccess: data => \{\s*if \(data\.allowed && data\.missionId\) setActiveMissionId\(data\.missionId\)/);
  });

  it("derives effectiveMissionId from activeMissionId first, falling back to the latest list entry", () => {
    expect(source).toMatch(/const effectiveMissionId = activeMissionId \?\? latestMission\?\.id \?\? null/);
  });

  it("Run discovery's click handler calls the mutation with effectiveMissionId via startDiscovery", () => {
    expect(source).toMatch(/function startDiscovery\(\) \{\s*if \(effectiveMissionId\) runDiscovery\.mutate\(\{ missionId: effectiveMissionId \}/);
    expect(source).toMatch(/onClick=\{startDiscovery\}/);
  });

  it("renders a second, prominent Run discovery CTA directly inside the green mission-active box", () => {
    const successBox = source.match(/createMission\.data\.allowed \? \([\s\S]*?\) : \(/)?.[0] ?? "";
    expect(successBox).toMatch(/Run discovery/);
    expect(successBox).toMatch(/onClick=\{startDiscovery\}/);
  });

  it("the Sub-Agent Orchestra Run discovery button is visually solid/obvious once a mission is active, not just a faint outline", () => {
    expect(source).toMatch(/effectiveMissionId\s*\n?\s*\?\s*"rounded-lg bg-amber-600[^"]*text-white/);
  });

  it("removed the stale 75a copy claiming connectors are not implemented", () => {
    expect(source).not.toMatch(/Google\/Yelp source\s*\n?\s*connectors are not implemented in this slice/);
  });

  it("shows the updated 76a-aware composer copy", () => {
    expect(source).toMatch(/Google Places discovery is available\. Run discovery to\s*\n?\s*find real candidates\. No outreach will be sent\./);
  });

  it("renders a visible error state if the discovery mutation fails", () => {
    expect(source).toMatch(/runDiscovery\.isError/);
    expect(source).toMatch(/Discovery request failed/);
  });

  it("shows an active-mission fallback line using activeMissionId even before recentMissions has refetched", () => {
    expect(source).toMatch(/Mission active &middot; id <span className="font-mono">\{activeMissionId\}<\/span>/);
  });

  it("never invokes any outreach/send path from the bugfixed activation flow", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
  });
});

describe("MissionControlPage -- Slice 76c Discovered Candidates panel", () => {
  it("renders the panel title, subtitle, and is wired to the real listDiscoveredCandidates query", () => {
    expect(source).toMatch(/Discovered Candidates/);
    expect(source).toMatch(/Review real candidates found by HELD before approving outreach\./);
    expect(source).toMatch(/vendorAcquisitionMission\.listDiscoveredCandidates\.useQuery/);
  });

  it("renders the honest empty state", () => {
    expect(source).toMatch(/No candidates discovered yet\. Run discovery to populate this list\./);
  });

  it("renders a Google Places source badge and the sourcing status, derived from real candidate fields only", () => {
    expect(source).toMatch(/Google Places<\/span>/);
    expect(source).toMatch(/label\(candidate\.sourcingStatus\)/);
  });

  it("renders rating/review count/address/phone/website only when present -- never fabricated", () => {
    expect(source).toMatch(/evidenceField\(candidate\.evidence, "rating"\)/);
    expect(source).toMatch(/typeof phone === "string"/);
    expect(source).toMatch(/typeof website === "string"/);
  });

  it("never renders a hardcoded/fake vendor name", () => {
    const panelSection = source.match(/Discovered Candidates[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(panelSection).not.toMatch(/Paws & Polish|Happy Hounds|Wag Luxury|Beverly Barkers|Puppy Palace|The Dog Spa|Paw Spa LA|Washing Spot/);
  });

  it("shows an explicit not-contacted safety line on every candidate", () => {
    expect(source).toMatch(/Not contacted &middot; No outreach sent/);
  });

  it("the Approve for draft outreach affordance is wired to the real draft-only mutation (Slice 78a) and never labeled Send", () => {
    expect(source).toMatch(/Approve for draft outreach/);
    expect(source).toMatch(/approveCandidateForDraftOutreach\.useMutation/);
    expect(source).not.toMatch(/>Send</);
  });

  it("Review, Open source, and Copy details never call a mutation or submit a form", () => {
    expect(source).toMatch(/setExpandedCandidateId\(expanded \? null : candidate\.id\)/);
    expect(source).toMatch(/onClick=\{\(\) => copyCandidateDetails\(candidate\)\}/);
    expect(source).not.toMatch(/<form/i);
  });

  it("Open source only renders a real anchor link to the candidate's own sourceUrl, never a hardcoded URL", () => {
    expect(source).toMatch(/href=\{sourceUrl\}/);
    expect(source).toMatch(/target="_blank"/);
  });

  it("refetches discovered candidates after a successful discovery run", () => {
    expect(source).toMatch(/onSuccess: \(\) => discoveredCandidates\.refetch\(\)/);
  });

  it("the raw per-candidate discovery dump is no longer the primary candidate UI -- the orchestra summary is concise", () => {
    expect(source).not.toMatch(/candidate\.rating !== null \? ` · \$\{candidate\.rating\}★`/);
    expect(source).toMatch(/see Discovered Candidates below for details\./);
  });
});

describe("MissionControlPage -- Slice 76c source isolation", () => {
  it("never imports any outbound send adapter or live LLM", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid|openai|anthropic\./i);
  });

  it("never claims a truth field is true", () => {
    expect(source).not.toMatch(/provider_accepted:\s*true|bookingConfirmed:\s*true|paymentAuthorized:\s*true|dispatched:\s*true/i);
  });

  it("never submits a web form, sends SMS, or invokes a phone call from this page", () => {
    expect(source).not.toMatch(/\.submit\(\)|sendSms\(|placeCall\(|sendYelpMessage\(/);
  });
});

describe("MissionControlPage -- Slice 77a mission-text-driven query planner", () => {
  it("passes the composer's actual text as missionText when creating a mission", () => {
    expect(source).toMatch(/missionText: composerNote/);
  });

  it("removes the stale copy claiming structured filters (not the composer text) drive mission creation", () => {
    expect(source).not.toMatch(/HELD uses the structured filters below to create this mission/);
    expect(source).toMatch(/HELD turns your mission into a source query plan\. Structured chips are safety constraints\./);
  });

  it("renders a Query Plan preview wired to the real previewQueryPlan query, with no LLM call", () => {
    expect(source).toMatch(/vendorAcquisitionMission\.previewQueryPlan\.useQuery/);
    expect(source).toMatch(/Query Plan/);
    expect(source).not.toMatch(/openai|anthropic\./i);
  });

  it("Query Plan preview shows service mode, location, and generated queries", () => {
    expect(source).toMatch(/queryPlanPreview\.data\.serviceMode/);
    expect(source).toMatch(/queryPlanPreview\.data\.locationText/);
    expect(source).toMatch(/queryPlanPreview\.data\.searchQueries\.join/);
  });

  it("Candidate Review shows 'Found via' using the real matchedQuery evidence field, never a hardcoded query", () => {
    expect(source).toMatch(/Found via: \{matchedQuery\}/);
    expect(source).toMatch(/evidenceField\(candidate\.evidence, "matchedQuery"\)/);
  });

  it("Candidate Review shows a service-mode badge derived only from real evidence", () => {
    expect(source).toMatch(/serviceModeBadge\(candidate\.evidence\)/);
    expect(source).toMatch(/function serviceModeBadge/);
    for (const badge of ["Mobile intent", "Storefront intent", "Needs review"]) {
      expect(source).toContain(badge);
    }
  });

  it("ranks candidates by matching service mode, then rating, review count, phone, website -- never a fixed/fake order", () => {
    expect(source).toMatch(/function rankCandidates/);
    expect(source).toMatch(/rankCandidates\(discoveredCandidates\.data, queryPlanPreview\.data\?\.serviceMode\)/);
  });

  it("does not hardcode the same service mode for every mission -- the planner output controls the badge/ranking, not a constant", () => {
    expect(source).not.toMatch(/serviceMode:\s*"mobile_required"\s*\}\)\s*\.map/);
  });

  it("still never enables a live send action and still shows the not-contacted safety line", () => {
    expect(source).toMatch(/Not contacted &middot; No outreach sent/);
    expect(source).toMatch(/Approve for draft outreach/);
    expect(source).not.toMatch(/>Send</);
  });
});

describe("MissionControlPage -- Slice 77a source isolation", () => {
  it("never imports any outbound send adapter or live LLM provider", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid|openai|anthropic\./i);
  });

  it("never claims a truth field is true", () => {
    expect(source).not.toMatch(/provider_accepted:\s*true|bookingConfirmed:\s*true|paymentAuthorized:\s*true|dispatched:\s*true/i);
  });

  it("never renders a hardcoded/fake vendor name anywhere on the page", () => {
    expect(source).not.toMatch(/Paws & Polish|Happy Hounds|Wag Luxury|Beverly Barkers|Puppy Palace|The Dog Spa/);
  });
});

describe("MissionControlPage -- Slice 77b structured parser plan source", () => {
  it("renders a plan-source label derived from the real discovery result, with the controlled label set", () => {
    expect(source).toMatch(/function planSourceLabel/);
    for (const sourceLabel of ["AI structured parser", "Deterministic fallback", "Provider config needed", "Invalid parser output fallback"]) {
      expect(source).toContain(sourceLabel);
    }
  });

  it("shows the plan source on both the zero-result and success discovery summaries", () => {
    expect(source).toMatch(/Plan source: \{planSourceLabel\(runDiscovery\.data\.queryPlannerSource, runDiscovery\.data\.queryPlannerFallbackReason\)\}/);
  });

  it("Candidate Review shows the planner source per candidate when evidence includes it", () => {
    expect(source).toMatch(/queryPlannerSource = evidenceField\(candidate\.evidence, "queryPlannerSource"\)/);
    expect(source).toMatch(/Plan source: \{planSourceLabel\(queryPlannerSource, null\)\}/);
  });

  it("does not call Claude on every render or keystroke -- the live composer preview stays deterministic-only", () => {
    expect(source).toMatch(/vendorAcquisitionMission\.previewQueryPlan\.useQuery/);
    expect(source).not.toMatch(/parseMissionWithClaude/);
  });

  it("still never enables a live send action and never renders a fake vendor name", () => {
    expect(source).toMatch(/Approve for draft outreach/);
    expect(source).not.toMatch(/>Send</);
    expect(source).not.toMatch(/Paws & Polish|Happy Hounds|Wag Luxury|Beverly Barkers|Puppy Palace|The Dog Spa/);
  });
});

describe("MissionControlPage -- Slice 77b source isolation", () => {
  it("never imports any outbound send adapter or live LLM SDK directly", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid|@anthropic-ai/i);
  });

  it("never claims a truth field is true", () => {
    expect(source).not.toMatch(/provider_accepted:\s*true|bookingConfirmed:\s*true|paymentAuthorized:\s*true|dispatched:\s*true/i);
  });
});

describe("MissionControlPage -- Slice 78a draft outreach queue", () => {
  it("renders Approve for draft outreach wired to the real mutation", () => {
    expect(source).toMatch(/Approve for draft outreach/);
    expect(source).toMatch(/vendorAcquisitionMission\.approveCandidateForDraftOutreach\.useMutation/);
  });

  it("clicking approval calls the draft mutation with the candidate id", () => {
    expect(source).toMatch(/function approveDraft\(candidateId: string\) \{/);
    expect(source).toMatch(/approveDraftOutreach\.mutate\(\{ candidateId \}/);
    expect(source).toMatch(/onClick=\{\(\) => approveDraft\(candidate\.id\)\}/);
  });

  it("shows 'Draft queued · No outreach sent' after a fresh approval, and 'Draft already queued' on idempotent re-approval", () => {
    expect(source).toMatch(/Draft queued.*No outreach sent/);
    expect(source).toMatch(/Draft already queued.*No outreach sent/);
    expect(source).toMatch(/result\.alreadyQueued \? "already_queued" : "queued"/);
  });

  it("shows a 'Review mobile fit before outreach' warning for needs-review candidates rather than disabling the action", () => {
    expect(source).toMatch(/Review mobile fit before outreach\./);
    expect(source).toMatch(/serviceModeBadge\(candidate\.evidence\) === "Needs review"/);
  });

  it("the approve button is never labeled Send and never claims a live send happened", () => {
    expect(source).not.toMatch(/>Send</);
    expect(source).not.toMatch(/Email sent|SMS sent|Message sent/i);
  });

  it("never invokes any AgentMail/SMS/Yelp/web-form/phone send path from the draft queue action", () => {
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid|sendYelpMessage|placeCall|\.submit\(\)/i);
  });

  it("never renders a fake vendor name in the draft queue UI", () => {
    expect(source).not.toMatch(/Paws & Polish|Happy Hounds|Wag Luxury|Beverly Barkers|Puppy Palace|The Dog Spa/);
  });
});
