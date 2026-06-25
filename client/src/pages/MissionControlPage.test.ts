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

  it("is honest that mobile preference is interpreted from mission text, not a wired structured toggle, rather than silently submitting it as real criteria", () => {
    expect(source).toMatch(/Mobile preference is currently interpreted from the mission text\./);
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

  it("defaults the composer ZIP to 90027, which resolves to OPUS LA", () => {
    expect(source).toMatch(/useState\("90027"\)/);
    expect(source).toMatch(/composerBuilding = resolveBuildingForZip\(zipCode\)/);
  });

  it("Slice 81d: clicking a building updates the ZIP chip directly (single ZIP source of truth), never a mutation", () => {
    expect(source).toMatch(/onClick=\{\(\) => setZipCode\(building\.zip\)\}/);
    expect(source).not.toMatch(/setZipCode\(building\.zip\)[\s\S]{0,80}mutate/);
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
  it("renders the panel title, subtitle, and is wired to the real listMissionShortlist query (Slice 79a/81c)", () => {
    expect(source).toMatch(/Mission Fulfillment Shortlist/);
    expect(source).toMatch(/Mobile building-service vendors first, then high-quality nearby drive-to fallbacks when mobile coverage is thin\./);
    expect(source).toMatch(/vendorAcquisitionMission\.listMissionShortlist\.useQuery/);
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
    const panelSection = source.match(/Mission Shortlist[\s\S]*?<\/section>/)?.[0] ?? "";
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

  it("refetches the mission shortlist after a successful discovery run", () => {
    expect(source).toMatch(/onSuccess: \(\) => missionShortlist\.refetch\(\)/);
  });

  it("the raw per-candidate discovery dump is no longer the primary candidate UI -- the orchestra summary is concise", () => {
    expect(source).not.toMatch(/candidate\.rating !== null \? ` · \$\{candidate\.rating\}★`/);
    expect(source).toMatch(/see Mission Shortlist below for details\./);
  });

  it("shows the mission target/found count and an overflow section, not every candidate ever discovered for the category", () => {
    expect(source).toMatch(/Showing \{missionShortlist\.data\.entries\.length\} of \{missionShortlist\.data\.totalFound\} found for this mission/);
    expect(source).toMatch(/Overflow \/ already discovered/);
    expect(source).toMatch(/additional candidates were found but not shortlisted\./);
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

  it("Candidate Review shows 'Found via' using the real mission-scoped matchedQuery field, never a hardcoded query", () => {
    expect(source).toMatch(/Found via: \{candidate\.matchedQuery\}/);
  });

  it("Candidate Review shows a service-mode badge derived only from the real mission match's serviceMode, honestly labeled as the query's intent (not vendor proof)", () => {
    expect(source).toMatch(/serviceModeBadge\(candidate\.serviceMode\)/);
    expect(source).toMatch(/function serviceModeBadge/);
    for (const badge of ["Mission query match: mobile", "Mission query match: storefront", "Mission query match: unclear"]) {
      expect(source).toContain(badge);
    }
  });

  it("ranking is computed server-side per mission (Slice 79a) -- the page renders entries in the order the shortlist query returns", () => {
    expect(source).not.toMatch(/function rankCandidates/);
    expect(source).toMatch(/missionShortlist\.data\.entries\.map/);
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

  it("Candidate Review shows the planner source per candidate from the real mission match row", () => {
    expect(source).toMatch(/Plan source: \{planSourceLabel\(candidate\.queryPlannerSource, null\)\}/);
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
    expect(source).toMatch(/serviceModeBadge\(candidate\.serviceMode\) === "Mission query match: unclear"/);
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

describe("MissionControlPage -- Slice 78b availability intake", () => {
  it("renders the Availability Intake panel for a real candidate, wired to the real queries/mutation", () => {
    expect(source).toMatch(/Availability Intake/);
    expect(source).toMatch(/HELD needs a dependable way to know whether this vendor can be booked/);
    expect(source).toMatch(/getCandidateAvailabilityIntake\.useQuery/);
    expect(source).toMatch(/saveCandidateAvailabilityIntake\.useMutation/);
  });

  it("can enter/save booking URL, service area, recurring availability, notice/duration/buffer, calendar method, and preferred channel", () => {
    expect(source).toMatch(/placeholder="Booking URL"/);
    expect(source).toMatch(/placeholder="Service areas \/ ZIPs, comma separated"/);
    expect(source).toMatch(/placeholder="Recurring days/);
    expect(source).toMatch(/placeholder="Minimum notice \(hours\)"/);
    expect(source).toMatch(/placeholder="Appointment duration \(minutes\)"/);
    expect(source).toMatch(/placeholder="Travel buffer \(minutes\)"/);
    expect(source).toMatch(/Calendar method&hellip;/);
    expect(source).toMatch(/Preferred contact channel&hellip;/);
  });

  it("shows a clear saved state without implying the vendor is onboarded or bookable", () => {
    expect(source).toMatch(/Availability intake saved &middot; Not onboarded yet/);
    expect(source).not.toMatch(/Onboarded\b|Bookable\b|Provider accepted/);
  });

  it("never triggers Google Calendar OAuth or any outreach/send action from the intake panel", () => {
    expect(source).not.toMatch(/oauth|googleapis\.com\/auth/i);
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
  });

  it("never renders fake intake data -- saved-state text only appears conditionally on a real save or real existing intake", () => {
    expect(source).toMatch(/intakeSavedAt \? \(/);
    expect(source).toMatch(/availabilityIntake\.data\?\.status === "ok" && availabilityIntake\.data\.intake/);
  });
});

describe("MissionControlPage -- Slice 79a mission-scoped shortlist", () => {
  it("panel heading is mission-specific 'Mission Shortlist', not the generic 'Discovered Candidates'", () => {
    expect(source).toMatch(/Mission Shortlist/);
    expect(source).not.toMatch(/<h2[^>]*>Discovered Candidates<\/h2>/);
  });

  it("is wired to listMissionShortlist keyed on the active mission, not a category-wide query", () => {
    expect(source).toMatch(/vendorAcquisitionMission\.listMissionShortlist\.useQuery\(\s*\{ missionId: effectiveMissionId/s);
    expect(source).not.toMatch(/vendorAcquisitionMission\.listDiscoveredCandidates/);
  });

  it("shows an honest 'no mission yet' state distinct from the empty-shortlist state", () => {
    expect(source).toMatch(/No mission launched yet\. Launch one above to see its shortlist\./);
  });

  it("shows a count of shown vs. total found, never silently displaying every category candidate as primary", () => {
    expect(source).toMatch(/Showing \{missionShortlist\.data\.entries\.length\} of \{missionShortlist\.data\.totalFound\} found for this mission/);
  });

  it("renders a collapsed overflow/already-discovered section distinct from the primary shortlist", () => {
    expect(source).toMatch(/<details[^>]*>[\s\S]*?Overflow \/ already discovered/);
    expect(source).toMatch(/missionShortlist\.data\.totalFound > missionShortlist\.data\.entries\.length/);
  });

  it("draft outreach approval still operates from the shortlist card using the real candidate id, and never sends anything", () => {
    expect(source).toMatch(/onClick=\{\(\) => approveDraft\(candidate\.id\)\}/);
    expect(source).not.toMatch(/from ["']agentmail|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
  });

  it("availability intake still renders and saves from the mission shortlist card", () => {
    expect(source).toMatch(/Availability Intake/);
    expect(source).toMatch(/onClick=\{\(\) => submitAvailabilityIntake\(candidate\.id\)\}/);
  });

  it("never shows all global category candidates as primary cards -- rendering is driven by the mission entries array only", () => {
    expect(source).not.toMatch(/category, limit: 50/);
  });
});

describe("MissionControlPage -- Slice 80a supervised outreach send canary", () => {
  it("renders 'Prepare supervised send' only after a draft is queued, wired to the real mutation", () => {
    expect(source).toMatch(/Prepare supervised send/);
    expect(source).toMatch(/vendorAcquisitionMission\.sendCandidateDraftOutreachCanary\.useMutation/);
    expect(source).toMatch(/draftQueueStatus\[candidate\.id\] \? \(\s*<button/);
  });

  it("requires a valid recipient email before the send button is enabled", () => {
    expect(source).toMatch(/const recipientEmailValid = \/\^\[\^\\s@\]\+@/);
    expect(source).toMatch(/disabled=\{!recipientEmailValid \|\| !sendConfirmed \|\| sendCandidateDraftOutreach\.isPending\}/);
  });

  it("requires the explicit confirmation checkbox before the send button is enabled", () => {
    expect(source).toMatch(/I confirm this is the vendor&rsquo;s real recipient email and I want to send exactly one supervised outreach email\./);
    expect(source).toMatch(/checked=\{sendConfirmed\}/);
  });

  it("shows the exact subject/body preview before send, sourced from the real queued draft, never a hardcoded sample", () => {
    expect(source).toMatch(/draftQueueStatus\[candidate\.id\]\?\.subject/);
    expect(source).toMatch(/draftQueueStatus\[candidate\.id\]\?\.body/);
  });

  it("renders a success state after a real sent result", () => {
    expect(source).toMatch(/Sent via AgentMail &middot; Awaiting reply/);
  });

  it("renders a gate-blocked state with the non-secret reason, never the API key", () => {
    expect(source).toMatch(/Send blocked by canary gate: \{sendCandidateDraftOutreach\.data\.blockedReasons\.join\(", "\)\}/);
  });

  it("renders a failure state without claiming sent truth", () => {
    expect(source).toMatch(/Send failed &middot; No sent truth recorded/);
  });

  it("only ever sends for one candidate at a time -- no bulk-send button or loop exists", () => {
    expect(source).not.toMatch(/sendAll|bulkSend|\.forEach\(candidate => .*sendSupervisedOutreach/);
    expect(source).toMatch(/function sendSupervisedOutreach\(candidateId: string\)/);
  });

  it("never auto-sends on render, discovery, or draft approval -- the send call only happens inside the explicit send button's onClick", () => {
    expect(source).not.toMatch(/useEffect\([^)]*sendCandidateDraftOutreach\.mutate/s);
    expect(source).toMatch(/onClick=\{\(\) => sendSupervisedOutreach\(candidate\.id\)\}/);
  });

  it("never invokes any SMS/Yelp/web-form/phone send path from this panel", () => {
    expect(source).not.toMatch(/sendSms|sendYelpMessage|placeCall|\.submit\(\)/);
  });

  it("never renders a hardcoded/fake vendor name or claims guaranteed volume/current booking", () => {
    expect(source).not.toMatch(/Paws & Polish|Happy Hounds|Wag Luxury|Beverly Barkers|Puppy Palace|The Dog Spa/);
    expect(source).not.toMatch(/guaranteed volume|currently booking|partnership/i);
  });
});

describe("MissionControlPage -- Slice 80a source isolation", () => {
  it("never imports any outbound send adapter directly -- only calls the tRPC mutation by name", () => {
    expect(source).not.toMatch(/from ["']agentmail|@anthropic-ai|sendVendorEmail|twilio|sendSms|elevenlabs|sendgrid/i);
  });

  it("never claims a truth field is true", () => {
    expect(source).not.toMatch(/provider_accepted:\s*true|bookingConfirmed:\s*true|paymentAuthorized:\s*true|dispatched:\s*true/i);
  });
});

describe("MissionControlPage -- Slice 80b supervised send guardrails", () => {
  it("warns that only the vendor's real business email should be used, and that a successful send records candidate-contacted truth", () => {
    expect(source).toMatch(/Use the vendor&rsquo;s real business email only\. A successful send records this candidate as contacted by HELD\./);
  });

  it("the confirmation checkbox explicitly says this is the vendor's real recipient email", () => {
    expect(source).toMatch(/I confirm this is the vendor&rsquo;s real recipient email and I want to send exactly one supervised outreach email\./);
  });

  it("never tells the operator to test with their own email or send to themselves", () => {
    expect(source).not.toMatch(/test with yourself|send to yourself|send to your own email|test-to-self|send to myself/i);
  });

  it("the send button remains one-at-a-time only -- no bulk-send UI was introduced", () => {
    expect(source).not.toMatch(/Send all|Bulk send|selectAll|sendAllCandidates/i);
  });

  it("the success state copy is unchanged: 'Sent via AgentMail · Awaiting reply'", () => {
    expect(source).toMatch(/Sent via AgentMail &middot; Awaiting reply/);
  });
});

describe("MissionControlPage -- Slice 81a service area verification + contact routing", () => {
  it("the shortlist card shows a service-area status badge sourced from serviceAreaVerification", () => {
    expect(source).toMatch(/candidate\.serviceAreaVerification \? \(/);
    expect(source).toMatch(/Service area: Verified/);
    expect(source).toMatch(/Service area: Likely out of area/);
    expect(source).toMatch(/Service area: Unverified/);
  });

  it("the shortlist card shows a contact-route label", () => {
    expect(source).toMatch(/Contact route: Email/);
    expect(source).toMatch(/Contact route: Contact form/);
    expect(source).toMatch(/Contact route: SMS\/call required/);
  });

  it("renders the out-of-area/unverified reason from real verification evidence, not invented copy", () => {
    expect(source).toMatch(/candidate\.serviceAreaVerification\.serviceAreaReasons\[0\]/);
    expect(source).toMatch(/Held back from shortlist: \{candidate\.overflowReason\}/);
  });

  it("does not present AgentMail as the clean next action when no email was discovered", () => {
    expect(source).toMatch(/Email not available\. Contact form\/SMS\/call workflow required later\./);
    expect(source).toMatch(/outreachReadiness !== "email_ready"/);
  });

  it("a manually entered email is clearly labeled as manual, not discovered", () => {
    expect(source).toMatch(/No email was discovered for this vendor.*manually supplied, not discovered\./);
  });

  it("no SMS/call/form-submission button exists anywhere in this page", () => {
    expect(source).not.toMatch(/sendSms\(|placeCall\(|\.submit\(\)|Send SMS|Place call|Submit form/);
  });
});

describe("MissionControlPage -- Slice 81b structured service-area interpretation", () => {
  it("the card shows 'Website interpreted by AI' when the interpreter source is anthropic_structured", () => {
    expect(source).toMatch(/Website interpreted by AI/);
    expect(source).toMatch(/anthropic_structured: "Website interpreted by AI"/);
  });

  it("the card shows 'Deterministic fallback' when fallback was used", () => {
    expect(source).toMatch(/Deterministic fallback/);
    expect(source).toMatch(/deterministic_fallback: "Deterministic fallback"/);
  });

  it("the card shows a human-review-required badge sourced from requiresHumanReview", () => {
    expect(source).toMatch(/candidate\.serviceAreaVerification\?\.requiresHumanReview \? \(/);
    expect(source).toMatch(/Human review required/);
  });

  it("contact-form/SMS-call-required path still renders for non-email-ready candidates", () => {
    expect(source).toMatch(/Contact route: Contact form/);
    expect(source).toMatch(/Contact route: SMS\/call required/);
  });

  it("does not show AgentMail as the clean path for non-email-ready candidates, even with structured interpretation", () => {
    expect(source).toMatch(/outreachReadiness !== "email_ready"/);
  });

  it("no SMS/call/form-submission button exists, including in the structured-interpretation badges", () => {
    expect(source).not.toMatch(/Send SMS|Place call|Submit form|Fill contact form/);
  });
});

describe("MissionControlPage -- Slice 81c tiered fulfillment shortlist", () => {
  it("panel title and subtitle reflect the fulfillment shortlist", () => {
    expect(source).toMatch(/Mission Fulfillment Shortlist/);
    expect(source).toMatch(/Mobile building-service vendors first, then high-quality nearby drive-to fallbacks when mobile coverage is thin\./);
  });

  it("the collapsed card shows the fulfillment label and tier-colored badge", () => {
    expect(source).toMatch(/candidate\.fulfillmentLabel \? \(/);
    expect(source).toMatch(/FULFILLMENT_TIER_CLASS\[candidate\.fulfillmentTier/);
  });

  it("the summary line shows mobile count and drive-to fallback count", () => {
    expect(source).toMatch(/mobile\/building-service options/);
    expect(source).toMatch(/drive-to fallback options/);
  });

  it("'Mission query match' is not treated as proof of vendor mobile qualification -- it is a separate, honestly-labeled badge from fulfillmentLabel", () => {
    expect(source).toMatch(/Mission query match: mobile/);
    expect(source).not.toMatch(/Mobile intent/);
  });

  it("drive-to fallback candidates render with the blue fallback badge, sourced from the server-derived fulfillmentLabel, never a client-invented label", () => {
    expect(source).toMatch(/blue:\s*"bg-blue-50/);
    expect(source).toMatch(/\{candidate\.fulfillmentLabel\}/);
  });

  it("storefront fallback candidates do not get the mobile draft-outreach button -- they show 'Storefront fallback copy needed' instead", () => {
    expect(source).toMatch(/Storefront fallback copy needed/);
    expect(source).toMatch(/candidate\.fulfillmentTier === "blue" \? \(/);
  });

  it("yellow (needs-review) candidates show 'Review service-area fit before outreach' instead of the draft button", () => {
    expect(source).toMatch(/Review service-area fit before outreach/);
  });

  it("red (out-of-area) candidates show 'Out of area · not outreach-ready' instead of the draft button", () => {
    expect(source).toMatch(/Out of area &middot; not outreach-ready/);
  });

  it("distance to target renders only when safely computed, never a fabricated number", () => {
    expect(source).toMatch(/typeof candidate\.distanceToTargetMiles === "number"/);
    expect(source).toMatch(/mi from target/);
  });

  it("the wrong OPUS LA/90027 building context is never shown for a 90067 mission -- the active-mission target label is derived from the mission's own geographyLabel", () => {
    expect(source).toMatch(/function deriveActiveMissionTargetLabel/);
    expect(source).toMatch(/activeMissionTargetLabel = deriveActiveMissionTargetLabel\(latestMission\?\.geographyLabel/);
    expect(source).not.toMatch(/activeMissionTargetLabel = selectedBuilding/);
  });

  it("mission ZIP appears in the target label when no known building matches, never an invented building", () => {
    expect(source).toMatch(/Mission ZIP: \$\{zip\}/);
    // LA_BUILDINGS has no entry for "Los Feliz Towers" -- the only
    // occurrence of that name in this file is the explanatory comment
    // describing why it is deliberately not invented, never a fake
    // building constant.
    expect(source).not.toMatch(/\{ id: "los-feliz|name: "Los Feliz Towers", zip:/);
  });

  it("never invents a coordinate or fabricated distance -- distance is only ever read from server-provided distanceToTargetMiles", () => {
    expect(source).not.toMatch(/distanceToTargetMiles\s*=\s*[\d.]/);
  });
});

describe("MissionControlPage -- Slice 81d composer ZIP extraction + active mission target sync", () => {
  it("extracts a ZIP from mission text deterministically, never via a Claude call", () => {
    expect(source).toMatch(/function extractZipFromMissionText\(text: string\): string \| null \{/);
    expect(source).toMatch(/text\.match\(\/\\b\(\\d\{5\}\)\\b\//);
  });

  it("typing mission text with a new ZIP updates the ZIP chip via updateComposerNote", () => {
    expect(source).toMatch(/function updateComposerNote\(nextText: string\) \{/);
    expect(source).toMatch(/if \(textZip && textZip !== lastSyncedTextZipRef\.current\) \{/);
    expect(source).toMatch(/setZipCode\(textZip\);/);
  });

  it("the textarea's onChange calls updateComposerNote, not a raw setComposerNote that would skip the ZIP sync", () => {
    expect(source).toMatch(/onChange=\{event => updateComposerNote\(event\.target\.value\)\}/);
  });

  it("mission text with no ZIP never overwrites the chip -- the sync only fires when a ZIP is actually found", () => {
    expect(source).toMatch(/if \(textZip && textZip !== lastSyncedTextZipRef\.current\)/);
  });

  it("a manually edited ZIP chip is not immediately stomped by an incidental (same-ZIP) text edit -- sync compares against the last AUTO-SYNCED zip, not the current chip value", () => {
    expect(source).toMatch(/lastSyncedTextZipRef\.current = textZip;/);
    expect(source).not.toMatch(/textZip !== zipCode/);
  });

  it("the map/building preview is driven by the ZIP chip via resolveBuildingForZip, never a separate selectedBuildingId", () => {
    expect(source).not.toMatch(/selectedBuildingId/);
    expect(source).not.toMatch(/selectedBuilding\.zip|selectedBuilding\.name/);
    expect(source).toMatch(/composerBuilding\?\.name \?\? `Mission ZIP: \$\{zipCode\}`/);
  });

  it("clicking a configured building in the picker sets the ZIP chip to that building's ZIP", () => {
    expect(source).toMatch(/onClick=\{\(\) => setZipCode\(building\.zip\)\}/);
  });

  it("Start Mission resolves the effective ZIP from mission text defensively, even if chip-sync lagged", () => {
    expect(source).toMatch(/const effectiveZip = extractZipFromMissionText\(composerNote\) \?\? zipCode;/);
    expect(source).toMatch(/geographyLabel: `\$\{effectiveZip\} \(\$\{radiusMiles\} mi radius\)`/);
  });

  it("90010 (an unconfigured ZIP) never resolves to a configured building -- resolveBuildingForZip returns null and the UI falls back to 'Mission ZIP: 90010'", () => {
    expect(source).toMatch(/function resolveBuildingForZip\(zip: string\): \(typeof LA_BUILDINGS\)\[number\] \| null \{/);
    expect(source).toMatch(/LA_BUILDINGS\.find\(building => building\.zip === zip\) \?\? null;/);
  });

  it("existing 90027 behavior is preserved -- the default ZIP and default mission text both still reference 90027", () => {
    expect(source).toMatch(/useState\("90027"\)/);
    expect(source).toMatch(/near 90027/);
  });
});
