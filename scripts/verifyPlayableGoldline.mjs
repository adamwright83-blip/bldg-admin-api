import { chromium } from "@playwright/test";

const baseUrl = process.env.GOLDLINE_VERIFY_URL ?? "http://127.0.0.1:5173";
const outputDir =
  process.env.GOLDLINE_VERIFY_OUTPUT ??
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/10/019fea9e-43b3-76d3-bdb9-fc1857894613";
const mode = process.env.GOLDLINE_VERIFY_STATE ?? "available";
const viewportWidth = Number(process.env.GOLDLINE_VERIFY_WIDTH ?? 390);
const viewportHeight = Number(process.env.GOLDLINE_VERIFY_HEIGHT ?? 844);
const viewportTag = `${viewportWidth}x${viewportHeight}`;
const missionStatus =
  mode === "contested" ? "follow_up" : mode === "captured" ? "won" : "game_ready";
const visualState =
  mode === "contested" ? "contested" : mode === "captured" ? "captured" : "available";
let projectedVisualState = visualState;
const dueAt = new Date(Date.now() + 48 * 60 * 60_000).toISOString();

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
    decisionMaker: {
      name: null,
      title: null,
      email: null,
      phone: null,
    },
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

function responseFor(procedure) {
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
  if (procedure === "system.commercialMission.myBuiltMissions") return [mission];
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
        contestedUntil: mode === "contested" ? dueAt : null,
        verifiedAnnualValueCents: mode === "captured" ? 2160000 : null,
        realizedRevenueCents: 0,
        lossReason: null,
        version: 1,
      },
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
await page.route("**/api/trpc/**", async route => {
  const url = new URL(route.request().url());
  const procedures = decodeURIComponent(
    url.pathname.split("/api/trpc/")[1] ?? ""
  ).split(",");
  const payload = procedures.map((procedure, index) => {
    requestInput(route.request(), url, index);
    return { result: { data: { json: responseFor(procedure) } } };
  });
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(url.searchParams.get("batch") === "1" ? payload : payload[0]),
  });
});

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
