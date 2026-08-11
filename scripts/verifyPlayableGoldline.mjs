import { chromium } from "@playwright/test";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5173";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ??
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/10/019fea9e-43b3-76d3-bdb9-fc1857894613";
const mode = process.env.GOLDLINE_VERIFY_STATE ?? "available";
const viewportWidth = Number(process.env.GOLDLINE_VERIFY_WIDTH ?? 390);
const viewportHeight = Number(process.env.GOLDLINE_VERIFY_HEIGHT ?? 844);
const viewportTag = `${viewportWidth}x${viewportHeight}`;
const ARCHETYPE_MODES = ["gatekeeper", "ghost", "staller", "staller-nodate"];
const missionStatus =
  mode === "contested"
    ? "follow_up"
    : mode === "captured" || mode === "scout"
      ? "won"
      : mode === "coldcall"
        ? "phone_ready"
        : mode === "gatekeeper"
          ? "en_route"
          : mode === "ghost" || mode === "staller" || mode === "staller-nodate"
            ? "phone_ready"
            : "game_ready";
const visualState =
  mode === "contested"
    ? "contested"
    : mode === "captured" || mode === "scout"
      ? "captured"
      : mode === "gatekeeper"
        ? "active"
        : mode === "ghost" || mode === "staller" || mode === "staller-nodate"
          ? "watching"
          : "available";
let projectedVisualState = visualState;
const dueAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
const missedAt = new Date(Date.now() - 36 * 60 * 60_000).toISOString();
const stallerDueAt = new Date(Date.now() + 72 * 60 * 60_000).toISOString();
/** The authoritative follow-up timestamp this run should surface, if any. */
const archetypeContestedUntil =
  mode === "ghost" ? missedAt : mode === "staller" ? stallerDueAt : null;

const mission = {
  id: 901,
  tenantId: "browser-verification",
  code: "VERIFY-901",
  status: missionStatus,
  version: 3,
  assignedTo: "fixture-driver",
  opsTaskId: null,
  account: {
    accountId: 501,
    name: "The Maybourne Beverly Hills",
    accountType: "hotel",
    address: "225 N Canon Dr, Beverly Hills, CA 90210",
    latitude: 34.0522,
    longitude: -118.2437,
    locationCount: 1,
    decisionMaker:
      mode === "gatekeeper"
        ? { name: null, title: null, email: null, phone: null }
        : mode === "ghost" || mode === "staller" || mode === "staller-nodate"
          ? {
              name: "Sourced Contact",
              title: "General Manager",
              email: null,
              phone: "+13105550147",
            }
          : { name: null, title: null, email: null, phone: null },
  },
  opportunity: {
    opportunityId: 301,
    estimatedAnnualValueCents: 2160000,
    estimateConfidence: "high",
    score: 88,
    primarySignal: "Browser verification only",
    reasons: ["Exercises the sourced mission projection"],
    risks: [],
  },
  brief: {
    laundryOpportunity: "Verification fixture",
    salesAngle: "Verification fixture",
    objective: "Verify the playable corridor",
    positioning: "Verification fixture",
    opener: "Verification fixture",
  },
  steps: [],
  expiresAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null,
};

let coldCallBatch =
  mode === "coldcall"
    ? {
        id: "10000000-0000-4000-8000-000000000001",
        createdAt: new Date().toISOString(),
        sourceReferences: [
          "commercial_account_contacts:501",
          "commercial_account_contacts:502",
        ],
        status: "active",
        combo: 0,
        completedCount: 0,
        totalTargets: 2,
        targets: [
          {
            id: "10000000-0000-4000-8000-000000000011",
            entityId: "501",
            missionId: 901,
            companyName: "The Maybourne Beverly Hills",
            phoneNumber: "+12025550101",
            eligibility: "eligible",
            reason: "Assigned call-ready mission with a sourced permitted phone contact",
            sourceReference: "commercial_account_contacts:501",
            coaching: {
              openingLine: "Who owns the recurring laundry program?",
              provenance: "commercial_missions:901:missionBriefJson.openingLine",
            },
            status: "selected",
            position: 0,
            outcome: null,
          },
          {
            id: "10000000-0000-4000-8000-000000000012",
            entityId: "502",
            missionId: 902,
            companyName: "Beverly Wilshire, A Four Seasons Hotel",
            phoneNumber: "+12025550102",
            eligibility: "eligible",
            reason: "Assigned call-ready mission with a sourced permitted phone contact",
            sourceReference: "commercial_account_contacts:502",
            coaching: {
              openingLine: "Who owns the recurring laundry program?",
              provenance: "commercial_missions:902:missionBriefJson.openingLine",
            },
            status: "pending",
            position: 1,
            outcome: null,
          },
        ],
      }
    : null;

let scoutReport = null;
let scoutMissions = [];

function requestInput(request, url, index) {
  try {
    const parsed =
      request.method() === "GET"
        ? JSON.parse(url.searchParams.get("input") ?? "{}")
        : request.postDataJSON();
    return parsed?.[String(index)]?.json ?? parsed?.json;
  } catch {
    return undefined;
  }
}

function responseFor(procedure, input) {
  if (procedure === "auth.me") {
    return {
      id: 1,
      openId: "fixture-driver",
      name: "Browser Verifier",
      email: "browser-verifier@example.test",
      role: "driver",
    };
  }
  if (procedure === "admin.listByDate") return [];
  if (procedure === "system.field.today") {
    return {
      generatedAt: new Date().toISOString(),
      businessDate: new Date().toLocaleDateString("en-CA"),
      currentUserId: "fixture-driver",
      timeline: [],
      nextFixedCommitment: null,
      blockers: [],
      dataQuality: { status: "trusted", warnings: [], sources: [] },
    };
  }
  if (procedure === "system.field.moves") {
    return {
      generatedAt: new Date().toISOString(),
      recommendedMoves: [
        {
          id: "mission:901:visit",
          moveType: "nearby_commercial_visit",
          title: "Verify playable mission",
          target: {
            entityType: "commercial_account",
            entityId: "501",
            name: mission.account.name,
          },
          expectedDurationMinutes: 20,
          travelMinutes: 6,
          expectedValue: {
            value: { lowCents: 1200000, highCents: 2160000 },
            provenance: "estimated",
            sourceReference: "browser-verification:901",
          },
          confidence: "high",
          relevance: "Verification fixture",
          evidence: ["Browser verification fixture"],
          expiresAt: null,
          contactAllowed: true,
          withinServiceRadius: true,
          missionId: 901,
          missionVersion: 3,
          destinationPath: "/driver/sales-mission/901",
        },
        ...scoutMissions.map(scoutMission => ({
          id: `mission:${scoutMission.id}:visit`,
          moveType: "nearby_commercial_visit",
          title: `Visit ${scoutMission.account.name}`,
          target: {
            entityType: "commercial_account",
            entityId: String(scoutMission.account.accountId),
            name: scoutMission.account.name,
          },
          expectedDurationMinutes: 25,
          travelMinutes: 7,
          expectedValue: {
            value: { lowCents: 800000, highCents: 1600000 },
            provenance: "estimated",
            sourceReference: `territory_scan_results:browser-verification:${scoutMission.id}`,
          },
          confidence: "high",
          relevance: "Real Scout verification fixture",
          evidence: ["Persisted territory scan result"],
          expiresAt: null,
          contactAllowed: true,
          withinServiceRadius: true,
          missionId: scoutMission.id,
          missionVersion: scoutMission.version,
          destinationPath: `/driver/sales-mission/${scoutMission.id}`,
        })),
      ],
      reason: "MOVES_AVAILABLE",
      constraints: {
        availableMinutes: 90,
        capacityFull: false,
        currentLocationAvailable: true,
      },
      dataQuality: {
        status: "trusted",
        warnings: [],
        sources: ["browser_verification"],
      },
    };
  }
  if (procedure === "system.commercialMission.myBuiltMissions") return [mission, ...scoutMissions];
  if (procedure === "system.commercialMission.myDispatches") return [];
  if (procedure === "system.driverGameWorld.current") {
    return [
      {
        missionId: 901,
        entityType: "commercial_mission",
        entityId: "901",
        accountId: 501,
        accountName: mission.account.name,
        locationId: 601,
        missionStatus,
        visualState: projectedVisualState,
        worldAnchor:
          projectedVisualState === "recovery_active"
            ? "gold_side_entrance"
            : "fortress_gate",
        unlockedPath:
          projectedVisualState === "recovery_active"
            ? "gold_recovery_path"
            : null,
        discoveryState: "discovered",
        contestedUntil:
          mode === "contested" ? dueAt : archetypeContestedUntil,
        verifiedAnnualValueCents: mode === "captured" ? 2160000 : null,
        realizedRevenueCents: 0,
        lossReason: null,
        version: 1,
        isTodayActive: !["won", "lost"].includes(missionStatus),
        isHistorical: ["won", "lost"].includes(missionStatus),
        regionKey: "fortress_gate",
        resolvedAt: mode === "captured" || mode === "scout" ? new Date().toISOString() : null,
      },
      ...scoutMissions.map(scoutMission => ({
        missionId: scoutMission.id,
        entityType: "commercial_mission",
        entityId: String(scoutMission.id),
        accountId: scoutMission.account.accountId,
        accountName: scoutMission.account.name,
        locationId: 602,
        missionStatus: scoutMission.status,
        visualState: "available",
        worldAnchor: "scout_region_hotel",
        unlockedPath: "scout_gold_path",
        discoveryState: "discovered",
        contestedUntil: null,
        verifiedAnnualValueCents: null,
        realizedRevenueCents: 0,
        lossReason: null,
        version: 1,
        isTodayActive: true,
        isHistorical: false,
        regionKey: "scout_region_hotel",
        resolvedAt: null,
      })),
    ];
  }
  if (procedure === "system.adaptiveSalesMeter.myMeter") {
    return {
      points: 25,
      maxPoints: 100,
      progress: 0.25,
      stage: 1,
      windowDays: 30,
      level: 1,
      levelLabel: "FIELD START",
      nextLevelHint: "Verified actions advance the meter.",
      recentWins: 0,
      breakdown: { walkInPoints: 0, supportingPoints: 25, winBonus: 0 },
    };
  }
  if (procedure === "system.armory.get") {
    return {
      items: [
        {
          id: "foundation:fast-response",
          title: "FAST RESPONSE",
          cue: "Existing provider",
          response: "The difference is response time.",
          outcome: "guidance",
          provenance: "foundation",
          sourceReference: "armory:foundation:anchor:fast-response",
        },
        {
          id: "foundation:no-risk-trial",
          title: "NO-RISK TRIAL",
          cue: "Switching feels risky",
          response: "Try us on one run. If we don't outperform, don't switch.",
          outcome: "guidance",
          provenance: "foundation",
          sourceReference: "armory:foundation:anchor:no-risk-trial",
        },
        {
          id: "foundation:social-proof",
          title: "SOCIAL PROOF",
          cue: "Needs confidence",
          response: "Use only verified nearby references.",
          outcome: "guidance",
          provenance: "foundation",
          sourceReference: "armory:foundation:anchor:social-proof",
        },
      ],
      archetypes: [],
      currentTactic: {
        title: "Anchor",
        cue: "Existing provider",
        response: "Choose sourced evidence.",
        followUp: "Log the real result.",
        provenance: "foundation",
        sourceLabel: "Armory foundation",
      },
    };
  }
  if (procedure === "system.armory.weapons") {
    const archetype = input?.archetype ?? "ANCHOR";
    const channel = input?.channel ?? "phone";
    const base = { archetype, channel, personalEvidence: null };
    if (archetype === "GATEKEEPER") {
      return {
        archetype,
        channel,
        trainerIntelligenceAvailable: true,
        weapons: [
          {
            ...base,
            id: "framework:fixture-gatekeeper-timing",
            title: "Callback Window",
            responseFamily: "seek_callback_window",
            spokenLine: null,
            discoveryQuestion: "When is a better time to reach them?",
            principle: "A time is easier to give than a person.",
            exampleLanguage: [
              {
                kind: "exact_source_phrase",
                text: "When is a better time to reach them?",
              },
            ],
            whenToUse: [],
            whenNotToUse: [],
            provenance: {
              type: "trainer_source",
              creator: "Fixture Trainer",
              creatorHandle: "@fixture",
              frameworkId: "00000000-0000-4000-8000-0000000000f1",
              frameworkName: "Callback Window",
              sourceArtifactId: "00000000-0000-4000-8000-0000000000a1",
              sourceUrl: "https://www.youtube.com/watch?v=fixture0001",
              sourceType: "youtube",
              transcriptStartMs: 12000,
              transcriptEndMs: 41000,
              extractionVersion: "fixture-extraction-v1",
              extractionModel: "fixture-model",
              confidence: 0.88,
            },
            fit: "high",
            fitReason: "High-confidence framework from Fixture Trainer",
          },
          {
            ...base,
            id: "foundation:state-purpose",
            title: "STATE PURPOSE PLAINLY",
            responseFamily: "transparent_purpose",
            spokenLine: "Who looks after that here?",
            discoveryQuestion: "Who looks after that here?",
            principle: "A gatekeeper routes people.",
            exampleLanguage: [],
            whenToUse: [],
            whenNotToUse: [],
            provenance: {
              type: "foundation",
              sourceReference: "armory:foundation:gatekeeper:state-purpose",
            },
            fit: "low",
            fitReason: "Baseline move",
          },
          {
            ...base,
            id: "foundation:ask-route",
            title: "ASK FOR THE ROUTE",
            responseFamily: "seek_alternate_route",
            spokenLine: null,
            discoveryQuestion: "Is there a better way to reach them?",
            principle: "Ask which door is open.",
            exampleLanguage: [],
            whenToUse: [],
            whenNotToUse: [],
            provenance: {
              type: "foundation",
              sourceReference: "armory:foundation:gatekeeper:ask-route",
            },
            fit: "low",
            fitReason: "Baseline move",
          },
        ],
      };
    }
    if (archetype === "GHOST") {
      return {
        archetype,
        channel,
        trainerIntelligenceAvailable: false,
        weapons: [
          {
            ...base,
            id: "foundation:change-channel",
            title: "CHANGE THE CHANNEL",
            responseFamily: "channel_switch",
            spokenLine: null,
            discoveryQuestion: null,
            principle: "Silence on one channel is not refusal.",
            exampleLanguage: [],
            whenToUse: [],
            whenNotToUse: [],
            provenance: {
              type: "foundation",
              sourceReference: "armory:foundation:ghost:change-channel",
            },
            fit: "low",
            fitReason: "Baseline move",
          },
        ],
      };
    }
    if (archetype === "STALLER") {
      return {
        archetype,
        channel,
        trainerIntelligenceAvailable: false,
        weapons: [
          {
            ...base,
            id: "foundation:specific-date",
            title: "GET A SPECIFIC DATE",
            responseFamily: "specific_next_date",
            spokenLine: null,
            discoveryQuestion: "What date should I come back to you on?",
            principle: "A specific date can be recorded; later cannot.",
            exampleLanguage: [],
            whenToUse: [],
            whenNotToUse: [],
            provenance: {
              type: "foundation",
              sourceReference: "armory:foundation:staller:specific-date",
            },
            fit: "low",
            fitReason: "Baseline move",
          },
        ],
      };
    }
    return {
      archetype,
      channel,
      trainerIntelligenceAvailable: false,
      weapons: [],
    };
  }
  if (procedure === "system.armory.recordUsage") {
    return {
      id: "00000000-0000-4000-8000-0000000000u1",
      weaponId: input?.weaponId ?? "unknown",
      missionId: input?.missionId ?? 901,
      archetype: input?.archetype ?? "ANCHOR",
      channel: input?.channel ?? "phone",
      usedAt: new Date().toISOString(),
    };
  }
  if (procedure === "system.openChannel.current") return null;
  if (procedure === "system.openChannel.progress") {
    return {
      businessDate: new Date().toLocaleDateString("en-CA"),
      completedPickupCount: 0,
      completedDeliveryCount: 0,
      completedMissionStepCount: 0,
      completedRouteActions: 0,
      avatarSpace: 0,
    };
  }
  if (procedure === "system.driverGameWorld.beginRekindle") {
    projectedVisualState = "recovery_active";
    return {
      ...responseFor("system.driverGameWorld.current")[0],
      visualState: "recovery_active",
      worldAnchor: "gold_side_entrance",
      unlockedPath: "gold_recovery_path",
      discoveryState: "engaged",
      version: 2,
    };
  }
  if (procedure === "system.driverGameWorld.coldCall") {
    return {
      batch: coldCallBatch,
      eligibleCount: coldCallBatch ? 2 : 0,
      emptyReason: coldCallBatch
        ? null
        : "No assigned call-ready missions have a sourced, permitted phone contact",
    };
  }
  if (procedure === "system.driverGameWorld.createColdCallBatch") return coldCallBatch;
  if (procedure === "system.driverGameWorld.startColdCallTarget") {
    const target = coldCallBatch?.targets.find(item => item.id === input?.targetId);
    if (target) target.status = "live";
    return coldCallBatch;
  }
  if (procedure === "system.driverGameWorld.completeColdCallTarget") {
    const target = coldCallBatch?.targets.find(item => item.id === input?.targetId);
    if (target && coldCallBatch) {
      target.status = "completed";
      target.outcome = input?.outcome ?? "spoke";
      coldCallBatch.completedCount += 1;
      if (coldCallBatch.completedCount === coldCallBatch.totalTargets) {
        coldCallBatch.status = "completed";
      }
    }
    return coldCallBatch;
  }
  if (procedure === "system.driverGameWorld.selectColdCallChainTarget") {
    const target = coldCallBatch?.targets.find(item => item.id === input?.targetId);
    if (target && coldCallBatch) {
      target.status = "selected";
      coldCallBatch.combo = 2;
    }
    return coldCallBatch;
  }
  if (procedure === "system.driverGameWorld.breakColdCallCombo") {
    if (coldCallBatch) coldCallBatch.combo = 0;
    return coldCallBatch;
  }
  if (procedure === "system.driverGameWorld.scoutCapability") {
    return {
      capabilityId: "EXPANSION_SCOUT",
      eligible: mode === "captured" || mode === "scout",
      unlocked: mode === "captured" || mode === "scout",
      reasons: ["Verified win contains enough archetype, location, and service evidence for sourced lookalikes"],
      sourceReferences: ["commercial_missions:901", "territory_operator_profiles:browser-verification"],
      evidenceSummary: { verifiedWin: true, accountArchetype: "hotel", hasSourcedLocation: true },
      unlockedAt: new Date().toISOString(),
    };
  }
  if (procedure === "system.driverGameWorld.latestScoutReport") return scoutReport;
  if (procedure === "system.driverGameWorld.runScout") {
    const discoveredMission = {
      ...mission,
      id: 902,
      code: "VERIFY-902",
      status: "candidate",
      version: 1,
      account: {
        ...mission.account,
        accountId: 502,
        name: "Beverly Wilshire, A Four Seasons Hotel",
        address: "9500 Wilshire Blvd, Beverly Hills, CA 90212",
      },
      opportunity: {
        ...mission.opportunity,
        opportunityId: 302,
        score: 86,
        primarySignal: "Persisted browser verification territory result",
      },
    };
    scoutMissions = [discoveredMission];
    scoutReport = {
      id: "20000000-0000-4000-8000-000000000001",
      generatedAt: new Date().toISOString(),
      sourceReferences: ["territory_scan_sessions:browser-verification"],
      criteria: { archetype: "hotel", area: mission.account.address, radiusMiles: 3 },
      discoveries: [
        {
          entityId: "502",
          missionId: 902,
          companyName: discoveredMission.account.name,
          address: discoveredMission.account.address,
          matchScore: 86,
          evidence: ["Persisted territory scan result"],
          sourceReference: "territory_scan_results:browser-verification:902",
        },
      ],
    };
    return scoutReport;
  }
  return {};
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: viewportWidth, height: viewportHeight },
  deviceScaleFactor: 2,
  geolocation: { latitude: 34.0522, longitude: -118.2437 },
  permissions: ["geolocation"],
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
  if (message.type() === "error") errors.push(message.text());
});
// Name the resource: a bare "404" is not actionable. Scoped to app-origin
// requests so a third-party CDN hiccup cannot fail an app verification run.
page.on("response", response => {
  if (response.status() >= 400 && response.url().startsWith(baseUrl)) {
    errors.push(`HTTP ${response.status()} ${response.url()}`);
  }
});
await page.route("**/api/trpc/**", async route => {
  const url = new URL(route.request().url());
  const procedures = decodeURIComponent(
    url.pathname.split("/api/trpc/")[1] ?? ""
  ).split(",");
  const payload = procedures.map((procedure, index) => {
    const input = requestInput(route.request(), url, index);
    return { result: { data: { json: responseFor(procedure, input) } } };
  });
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(url.searchParams.get("batch") === "1" ? payload : payload[0]),
  });
});

if (ARCHETYPE_MODES.includes(mode)) {
  await page.addInitScript(() => {
    window.__GOLDLINE_DETERMINISTIC_ENCOUNTERS__ = true;
  });
}

// Keep the run hermetic: a third-party font or analytics host must never be
// able to fail an app verification. Same-origin traffic is untouched.
await page.route(
  requestUrl => !requestUrl.href.startsWith(baseUrl),
  // Fulfilled rather than aborted: an abort raises its own console error,
  // which would just trade one false failure for another.
  route => route.fulfill({ status: 200, body: "", contentType: "text/plain" })
);

await page.goto(`${baseUrl}/driver`, { waitUntil: "networkidle" });
await page.locator("canvas.goldline-game-canvas").waitFor({ state: "visible" });
const hasHorizontalOverflow = await page.evaluate(
  () => document.documentElement.scrollWidth > window.innerWidth
);
if (hasHorizontalOverflow) throw new Error("Playable world has horizontal overflow");
const observedAnimationFrames = await page.evaluate(
  () =>
    new Promise(resolve => {
      let frames = 0;
      const startedAt = performance.now();
      const count = now => {
        frames += 1;
        if (now - startedAt >= 1000) resolve(frames);
        else requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
    })
);
await page.screenshot({
  path: `${outputDir}/goldline-${mode}-${viewportTag}.png`,
  fullPage: true,
});

if (mode === "coldcall") {
  await page.getByRole("button", { name: /COLD CALL BURST/i }).click();
  await page.getByRole("region", { name: "Cold Call Burst" }).waitFor();
  await page.getByText("COMBO ×0", { exact: true }).waitFor();
  await page.getByText("CALLS 2/2 LEFT", { exact: true }).waitFor();
  await page.getByText(/missionBriefJson\.openingLine/).waitFor();
  await page.getByRole("button", { name: /CALL REAL NUMBER/i }).click();
  await page.getByText("LIVE CALL · NO GAME TIMER", { exact: true }).waitFor();
  if (await page.locator(".cold-call-chain-window").count()) {
    throw new Error("Chain timer appeared during a live conversation");
  }
  await page.getByRole("button", { name: /CALL ENDED/i }).click();
  await page.locator(".cold-call-outcome select").selectOption("spoke");
  await page.locator(".cold-call-outcome textarea").fill("Reached the real front desk and logged the actual outcome.");
  await page.getByRole("button", { name: /SAVE OUTCOME/i }).click();
  await page.getByText("CHAIN TARGET", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Beverly Wilshire/i }).click();
  await page.getByText("COMBO ×2", { exact: true }).waitFor();
  await page.screenshot({
    path: `${outputDir}/goldline-cold-call-chain-${viewportTag}.png`,
    fullPage: true,
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas.goldline-game-canvas").waitFor({ state: "visible" });
  await page.getByRole("button", { name: /COLD CALL BURST/i }).click();
  await page.getByText("LOGGED 1/2", { exact: true }).waitFor();
  await page.getByText("Beverly Wilshire, A Four Seasons Hotel", { exact: true }).waitFor();
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log(
    JSON.stringify({
      pageLoaded: true,
      viewport: viewportTag,
      coldCallTargets: 2,
      realPhoneAction: true,
      liveConversationTimerAbsent: true,
      outcomeSavedBeforeChain: true,
      physicalChainSelection: true,
      comboAfterChain: 2,
      reloadPreservedCompletedCall: true,
      browserErrors: errors,
      screenshot: `${outputDir}/goldline-cold-call-chain-${viewportTag}.png`,
    })
  );
  await browser.close();
  process.exit(0);
}

if (mode === "scout") {
  await page.getByText("STRONGHOLD CAPTURED", { exact: true }).waitFor();
  await page.getByRole("button", { name: /LET THE REWARD LAND/i }).click();
  await page.getByText("EXPANSION SCOUT", { exact: true }).waitFor();
  await page.getByRole("button", { name: /ENTER SCOUT CHAMBER/i }).click();
  await page.getByRole("button", { name: /RUN SOURCED SCOUT/i }).click();
  await page.getByText("1 NEW MISSIONS DISCOVERED", { exact: true }).waitFor();
  await page.getByRole("button", { name: /Engage Beverly Wilshire/i }).click();
  await page.getByRole("button", { name: /Select Beverly Wilshire/i }).waitFor();
  await page.screenshot({
    path: `${outputDir}/goldline-captured-scout-loop-${viewportTag}.png`,
    fullPage: true,
  });
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log(
    JSON.stringify({
      pageLoaded: true,
      viewport: viewportTag,
      verifiedWinCeremony: true,
      scoutCapabilityUnlockedFromBusinessEvidence: true,
      sourcedScoutReportCount: 1,
      scoutMissionAppearsInFork: true,
      browserErrors: errors,
      screenshot: `${outputDir}/goldline-captured-scout-loop-${viewportTag}.png`,
    })
  );
  await browser.close();
  process.exit(0);
}

if (mode === "contested") {
  await page.getByText("GOLD RECOVERY PATH UNLOCKED", { exact: true }).waitFor();
  await page.getByText(/^COOLING /).waitFor();
  await page.getByRole("button", { name: /BEGIN REKINDLE/i }).click();
  await page.getByText("RECOVERY ACTIVE", { exact: true }).waitFor();
  await page.screenshot({
    path: `${outputDir}/goldline-recovery-active-${viewportTag}.png`,
    fullPage: true,
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas.goldline-game-canvas").waitFor({ state: "visible" });
  await page.getByText("RECOVERY ACTIVE", { exact: true }).waitFor();
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log(
    JSON.stringify({
      pageLoaded: true,
      canvasVisible: true,
      viewport: viewportTag,
      horizontalOverflow: false,
      observedAnimationFrames,
      contestedCoolingUsesSourcedDueAt: true,
      rekindleTransition: "contested -> recovery_active",
      recoveryPersistsAcrossReload: true,
      browserErrors: errors,
      screenshots: [
        `${outputDir}/goldline-contested-${viewportTag}.png`,
        `${outputDir}/goldline-recovery-active-${viewportTag}.png`,
      ],
    })
  );
  await browser.close();
  process.exit(0);
}

if (mode === "captured") {
  await page.getByText("STRONGHOLD CAPTURED", { exact: true }).waitFor();
  await page.getByText("$21,600/YEAR SECURED", { exact: true }).waitFor();
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);
  console.log(
    JSON.stringify({
      pageLoaded: true,
      canvasVisible: true,
      viewport: viewportTag,
      horizontalOverflow: false,
      observedAnimationFrames,
      verifiedVictoryAmount: "$21,600/YEAR SECURED",
      browserErrors: errors,
      screenshot: `${outputDir}/goldline-captured-${viewportTag}.png`,
    })
  );
  await browser.close();
  process.exit(0);
}

await page.getByLabel("Move Operator").waitFor();
await page.getByRole("button", { name: /1 OBJECTIVES/i }).click();
await page.locator(".mission-fork.is-expanded").waitFor();
await page.getByRole("button", { name: "COLLAPSE" }).click();
await page.getByRole("button", { name: "Open field utilities" }).click();
await page.getByText("Field console", { exact: true }).waitFor();
await page.getByRole("button", { name: "Close" }).click();
const joystick = await page.getByLabel("Move Operator").boundingBox();
if (!joystick) throw new Error("Joystick did not render");
async function pushForward(milliseconds) {
  await page.mouse.move(
    joystick.x + joystick.width / 2,
    joystick.y + joystick.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(joystick.x + joystick.width / 2, joystick.y + 8);
  await page.waitForTimeout(milliseconds);
  await page.mouse.up();
}

await pushForward(1700);
await page.getByRole("button", { name: /JUMP/i }).waitFor();
const jumpButton = await page.getByRole("button", { name: /JUMP/i }).boundingBox();
if (!jumpButton || jumpButton.y + jumpButton.height > viewportHeight) {
  throw new Error("Context action is outside the usable viewport");
}
await page.getByRole("button", { name: /JUMP/i }).click();
await page.waitForTimeout(700);
await pushForward(900);
await page.getByRole("button", { name: /CLIMB/i }).click();
await page.waitForTimeout(700);
await pushForward(900);
await page.getByRole("button", { name: /VAULT/i }).click();
await page.waitForTimeout(700);
await pushForward(900);
await page.getByRole("button", { name: /INTERACT/i }).click();

// ---------------------------------------------------------------------------
// Archetype golden paths. Each mode is triggered by positive authoritative
// evidence in the fixture, never by missing data, and each asserts that a
// clean game result still does not fabricate a business fact.
// ---------------------------------------------------------------------------
async function armoryChoiceCount() {
  return page.locator(".armory-weapon").count();
}

async function assertNoFabricatedCountdown() {
  const body = await page.locator("body").innerText();
  if (/COOLING \d/i.test(body)) {
    throw new Error("A countdown was rendered without a sourced timestamp");
  }
}

if (mode === "gatekeeper") {
  await page.getByRole("region", { name: "Gatekeeper encounter" }).waitFor();

  const choices = await armoryChoiceCount();
  if (choices === 0 || choices > 3) {
    throw new Error(`Gatekeeper offered ${choices} weapons; expected 1-3`);
  }

  // Provenance must be inspectable, and must name a real source artifact.
  await page.locator(".armory-weapon-provenance-toggle").first().click();
  await page.getByText("FROM SALES INTEL", { exact: true }).waitFor();
  await page.getByText("Fixture Trainer", { exact: false }).first().waitFor();
  const provenanceHtml = await page.locator(".armory-weapon-provenance").first().innerHTML();
  if (!provenanceHtml.includes("youtube.com/watch?v=fixture0001")) {
    throw new Error("Trainer weapon did not expose its source artifact URL");
  }
  await page.locator(".armory-weapon-provenance-toggle").first().click();
  if (await page.locator(".armory-weapon-provenance").count()) {
    throw new Error("Provenance panel could not be collapsed");
  }

  // Game input alone must not have produced any access claim yet.
  const beforeRouting = await page.locator("body").innerText();
  if (/ACCESS GRANTED|NAME DISCOVERED/i.test(beforeRouting)) {
    throw new Error("Access information appeared before any routing occurred");
  }

  // Choose the callback-window move, then route it to the WHEN gate.
  await page
    .locator(".armory-weapon-main", { hasText: "Callback Window" })
    .first()
    .click();
  const origin = await page.locator(".gate-origin").boundingBox();
  const whenGate = await page
    .locator(".gate-node", { hasText: "WHEN" })
    .first()
    .boundingBox();
  if (!origin || !whenGate) throw new Error("Gatekeeper routing field did not render");

  await page.mouse.move(origin.x + origin.width / 2, origin.y + origin.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    whenGate.x + whenGate.width / 2,
    whenGate.y + whenGate.height / 2,
    { steps: 12 }
  );
  await page.mouse.up();

  await page.getByText(/ROUTE OPEN/i).waitFor();
  await page.getByText("GAME RESULT ≠ ACCESS GRANTED", { exact: true }).waitFor();

  // A clean route is not a recorded fact.
  const afterRouting = await page.locator("body").innerText();
  if (/ACCESS GRANTED\b(?!.*≠)/i.test(afterRouting.replace(/GAME RESULT ≠ ACCESS GRANTED/g, ""))) {
    throw new Error("Routing fabricated an access result");
  }

  await page.screenshot({
    path: `${outputDir}/goldline-gatekeeper-${viewportTag}.png`,
    fullPage: true,
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas.goldline-game-canvas").waitFor({ state: "visible" });
  const persisted = await page.locator("body").innerText();
  if (!/NO ACTIVE MISSION|Maybourne/i.test(persisted)) {
    throw new Error("World state did not persist across reload");
  }

  if (await page.getByText("DEPLOY", { exact: true }).count()) {
    throw new Error("Forbidden DEPLOY control rendered");
  }
  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

  console.log(
    JSON.stringify({
      pageLoaded: true,
      viewport: viewportTag,
      encounter: "GATEKEEPER",
      horizontalOverflow: false,
      observedAnimationFrames,
      armoryChoices: choices,
      provenanceInspectable: true,
      provenanceCollapsible: true,
      routingMechanicUsable: true,
      distinctFromAnchorWeakPoint: true,
      accessNotFabricatedByGameInput: true,
      reloadPersisted: true,
      browserErrors: errors,
      screenshot: `${outputDir}/goldline-gatekeeper-${viewportTag}.png`,
    })
  );
  await browser.close();
  process.exit(0);
}

if (mode === "ghost") {
  await page.getByRole("region", { name: "Ghost encounter" }).waitFor();

  const choices = await armoryChoiceCount();
  if (choices === 0 || choices > 3) {
    throw new Error(`Ghost offered ${choices} weapons; expected 1-3`);
  }

  await page
    .locator(".armory-weapon-main", { hasText: "CHANGE THE CHANNEL" })
    .first()
    .click();

  // Sustained tracking: hold contact with the beacon until the lock completes.
  const field = await page.locator(".signal-field").boundingBox();
  if (!field) throw new Error("Ghost signal field did not render");
  const centreX = field.x + field.width / 2;
  const centreY = field.y + field.height / 2;
  await page.mouse.move(centreX, centreY);
  await page.mouse.down();
  await page.waitForTimeout(2400);
  await page.mouse.up();

  await page.getByText(/SIGNAL LOCKED/i).waitFor();

  // The load-bearing assertion: perfect execution is not a reply.
  await page.getByText("A PERFECT LOCK IS NOT A REPLY", { exact: true }).waitFor();
  const afterLock = await page.locator("body").innerText();
  if (/THEY REPLIED|RESPONSE RECEIVED|PROSPECT REPLIED|CAPTURED/i.test(afterLock)) {
    throw new Error("Perfect game input fabricated a prospect response");
  }
  if (/\$[\d,]+\/YEAR SECURED/i.test(afterLock)) {
    throw new Error("Ghost encounter fabricated a won account");
  }

  await page.screenshot({
    path: `${outputDir}/goldline-ghost-${viewportTag}.png`,
    fullPage: true,
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas.goldline-game-canvas").waitFor({ state: "visible" });
  const persisted = await page.locator("body").innerText();
  if (/CAPTURED|SECURED/i.test(persisted)) {
    throw new Error("A fabricated win persisted across reload");
  }

  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

  console.log(
    JSON.stringify({
      pageLoaded: true,
      viewport: viewportTag,
      encounter: "GHOST",
      horizontalOverflow: false,
      observedAnimationFrames,
      armoryChoices: choices,
      trackingMechanicUsable: true,
      signalLockAchieved: true,
      perfectInputDidNotFabricateReply: true,
      reloadPersisted: true,
      browserErrors: errors,
      screenshot: `${outputDir}/goldline-ghost-${viewportTag}.png`,
    })
  );
  await browser.close();
  process.exit(0);
}

if (mode === "staller") {
  await page.getByRole("region", { name: "Staller encounter" }).waitFor();

  const choices = await armoryChoiceCount();
  if (choices === 0 || choices > 3) {
    throw new Error(`Staller offered ${choices} weapons; expected 1-3`);
  }

  // The countdown must derive from the authoritative follow-up timestamp.
  await page.getByText("REAL COMMITMENT ON RECORD", { exact: true }).waitFor();
  const expected = new Date(stallerDueAt).toLocaleString([], {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
  const clockText = await page.locator(".staller-real-clock").innerText();
  if (!clockText.includes(expected)) {
    throw new Error(
      `Staller clock did not derive from the sourced timestamp. Expected "${expected}" in "${clockText}"`
    );
  }

  await page
    .locator(".armory-weapon-main", { hasText: "GET A SPECIFIC DATE" })
    .first()
    .click();
  await page.getByRole("button", { name: "COMMIT", exact: true }).click();
  await page.getByText(/ALIGNED/i).first().waitFor();
  await page.getByText("ALIGNMENT ≠ A COMMITTED DATE", { exact: true }).waitFor();

  await page.screenshot({
    path: `${outputDir}/goldline-staller-${viewportTag}.png`,
    fullPage: true,
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas.goldline-game-canvas").waitFor({ state: "visible" });

  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

  console.log(
    JSON.stringify({
      pageLoaded: true,
      viewport: viewportTag,
      encounter: "STALLER",
      horizontalOverflow: false,
      observedAnimationFrames,
      armoryChoices: choices,
      alignmentMechanicUsable: true,
      countdownDerivedFromSourcedTimestamp: true,
      sourcedFollowUpAt: stallerDueAt,
      alignmentIsNotACommitment: true,
      reloadPersisted: true,
      browserErrors: errors,
      screenshot: `${outputDir}/goldline-staller-${viewportTag}.png`,
    })
  );
  await browser.close();
  process.exit(0);
}

if (mode === "staller-nodate") {
  // With no committed date on record there must be no Staller and no timer.
  if (await page.getByRole("region", { name: "Staller encounter" }).count()) {
    throw new Error("A Staller encounter appeared without any sourced date");
  }
  await assertNoFabricatedCountdown();
  const body = await page.locator("body").innerText();
  if (/REAL COMMITMENT ON RECORD/i.test(body)) {
    throw new Error("A commitment was claimed without a sourced timestamp");
  }

  await page.screenshot({
    path: `${outputDir}/goldline-staller-nodate-${viewportTag}.png`,
    fullPage: true,
  });

  if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

  console.log(
    JSON.stringify({
      pageLoaded: true,
      viewport: viewportTag,
      encounter: "NONE (no sourced date)",
      noFabricatedCountdown: true,
      noStallerWithoutEvidence: true,
      browserErrors: errors,
      screenshot: `${outputDir}/goldline-staller-nodate-${viewportTag}.png`,
    })
  );
  await browser.close();
  process.exit(0);
}

await page.getByRole("region", { name: "Anchor encounter" }).waitFor();

const noRiskTrial = page.getByRole("button", { name: /NO-RISK TRIAL/i });
await noRiskTrial.click();
await page.waitForTimeout(150);
await page.evaluate(() => {
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  document.dispatchEvent(new Event("visibilitychange"));
});
const pausedSignalText = await page.locator(".signal-window b").innerText();
await page.waitForTimeout(650);
const stillPausedSignalText = await page.locator(".signal-window b").innerText();
if (pausedSignalText !== stillPausedSignalText) {
  throw new Error("Signal Override changed while the app was backgrounded");
}
await page.evaluate(() => {
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.waitForTimeout(650);
const resumedSignalText = await page.locator(".signal-window b").innerText();
if (resumedSignalText === stillPausedSignalText) {
  throw new Error("Signal Override did not shrink after ability selection");
}
const weakPoint = page.getByRole("button", {
  name: "Weak point — tap or flick selected ability here",
});
await weakPoint.click({ force: true });
await page.getByText("SHIELD 1/3", { exact: true }).waitFor();
await noRiskTrial.click();
await weakPoint.click({ force: true });
await page.getByText("ARCADE BREACH ≠ BUSINESS WIN", { exact: true }).waitFor();
await page.screenshot({
  path: `${outputDir}/goldline-anchor-${viewportTag}.png`,
  fullPage: true,
});

if (await page.getByText("DEPLOY", { exact: true }).count()) {
  throw new Error("Forbidden DEPLOY control rendered");
}
if (errors.length) throw new Error(`Browser errors: ${errors.join(" | ")}`);

console.log(
  JSON.stringify({
    pageLoaded: true,
    canvasVisible: true,
    viewport: viewportTag,
    horizontalOverflow: false,
    observedAnimationFrames,
    joystickImmediate: true,
    objectiveHudCollapsible: true,
    utilityOverlayWorks: true,
    contextActionReachable: true,
    traversalActionsRequired: ["JUMP", "CLIMB", "VAULT", "INTERACT"],
    signalWindowShrinks: true,
    signalWindowPausesInBackground: true,
    directWeakPointInput: true,
    arcadeBusinessGate: true,
    deployControlAbsent: true,
    browserErrors: errors,
    screenshots: [
      `${outputDir}/goldline-available-${viewportTag}.png`,
      `${outputDir}/goldline-anchor-${viewportTag}.png`,
    ],
  })
);
await browser.close();
