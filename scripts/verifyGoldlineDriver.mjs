import { chromium } from "@playwright/test";

const businessDate = new Date().toLocaleDateString("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pickup = {
  id: 701,
  firstName: "Riley",
  lastName: "Resident",
  address: "701 Goldline Way",
  pickupTimeWindow: "9:00am-11:00am",
  deliveryTimeWindow: null,
  paid: false,
};
const paidDelivery = {
  id: 702,
  firstName: "Drew",
  lastName: "Customer",
  address: "702 River Road",
  pickupTimeWindow: null,
  deliveryTimeWindow: "1:00pm-3:00pm",
  paid: true,
};
const blockedDelivery = {
  id: 703,
  firstName: "Carol",
  lastName: "Customer",
  address: "703 Canyon Drive",
  pickupTimeWindow: null,
  deliveryTimeWindow: "3:00pm-5:00pm",
  paid: false,
};

const fixedCommitment = {
  id: "pickup:701",
  kind: "pickup",
  source: {
    entityType: "order",
    entityId: "701",
    sourceReference: "orders:701",
  },
  scheduledAt: new Date(Date.now() + 90 * 60_000).toISOString(),
  urgency: "scheduled",
  title: "Pick up Riley Resident",
  subtitle: "Laundry pickup",
  status: "new",
  destination: {
    address: pickup.address,
    latitude: null,
    longitude: null,
  },
  customer: { name: "Riley Resident", phone: null, email: null },
  money: null,
  verificationClass: "VERIFIED",
  actions: [
    {
      type: "navigate",
      label: "Navigate",
      href: "https://www.google.com/maps/search/?api=1&query=701%20Goldline%20Way",
      mutation: null,
    },
  ],
};

const fieldToday = {
  generatedAt: new Date().toISOString(),
  businessDate,
  currentUserId: "fixture-driver",
  timeline: [
    fixedCommitment,
    {
      id: "payment-blocker:703",
      kind: "payment_blocker",
      source: {
        entityType: "order",
        entityId: "703",
        sourceReference: "orders:703",
      },
      scheduledAt: null,
      urgency: "blocked",
      title: "Payment blocks Carol Customer's delivery",
      subtitle: "This order is ready but not paid",
      status: "ready",
      destination: {
        address: blockedDelivery.address,
        latitude: null,
        longitude: null,
      },
      customer: { name: "Carol Customer", phone: null, email: null },
      money: null,
      verificationClass: "VERIFIED",
      actions: [
        {
          type: "payment",
          label: "Resolve payment",
          href: "/payment-reconciliation?orderId=703",
          mutation: null,
        },
      ],
    },
    {
      id: "follow-up:44",
      kind: "follow_up",
      source: {
        entityType: "commercial_follow_up",
        entityId: "44",
        sourceReference: "commercial_follow_ups:44",
      },
      scheduledAt: null,
      urgency: "overdue",
      title: "The Louise Los Feliz",
      subtitle: "Send the promised service outline",
      status: "pending",
      destination: null,
      customer: { name: "The Louise Los Feliz", phone: null, email: null },
      money: null,
      verificationClass: "VERIFIED",
      actions: [
        {
          type: "open",
          label: "Open",
          href: "/driver/sales-mission/91",
          mutation: null,
        },
      ],
    },
  ],
  nextFixedCommitment: fixedCommitment,
  blockers: [],
  dataQuality: {
    status: "partial",
    warnings: ["Travel duration unavailable until live routing is configured"],
    sources: ["orders", "commercial_follow_ups"],
  },
};

const builtMission = {
  id: 90,
  code: "GL-090",
  status: "game_ready",
  steps: [],
  expiresAt: null,
  account: {
    name: "The Maybourne Beverly Hills",
    address: "225 N Canon Dr",
  },
  opportunity: { estimatedAnnualValueCents: 4200000 },
};

const movesAvailable = {
  generatedAt: new Date().toISOString(),
  recommendedMoves: [
    {
      id: "mission:91:call",
      moveType: "commercial_call",
      title: "Call The Louise Los Feliz",
      target: {
        entityType: "commercial_account",
        entityId: "91",
        name: "The Louise Los Feliz",
      },
      expectedDurationMinutes: 15,
      travelMinutes: 0,
      expectedValue: {
        value: { lowCents: 180000, highCents: 1800000 },
        provenance: "estimated",
        sourceReference: "commercial_opportunities:91",
      },
      confidence: "medium",
      relevance: "A sourced business contact is available",
      evidence: ["Contact source: verified import"],
      expiresAt: null,
      contactAllowed: true,
      withinServiceRadius: true,
      missionId: 91,
      missionVersion: 3,
      destinationPath: "/driver/sales-mission/91",
    },
    {
      id: "mission:92:visit",
      moveType: "nearby_commercial_visit",
      title: "Visit Ridge Apartments",
      target: {
        entityType: "commercial_account",
        entityId: "92",
        name: "Ridge Apartments",
      },
      expectedDurationMinutes: 25,
      travelMinutes: 8,
      expectedValue: {
        value: { lowCents: 90000, highCents: 900000 },
        provenance: "estimated",
        sourceReference: "commercial_opportunities:92",
      },
      confidence: "medium",
      relevance: "2.4 miles away with open field time",
      evidence: ["Opportunity score 82"],
      expiresAt: null,
      contactAllowed: true,
      withinServiceRadius: true,
      missionId: 92,
      missionVersion: 2,
      destinationPath: "/driver/sales-mission/92",
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
    sources: ["commercial_missions"],
  },
};

const noMoves = {
  ...movesAvailable,
  recommendedMoves: [],
  reason: "DATA_INSUFFICIENT",
  constraints: {
    availableMinutes: 90,
    capacityFull: false,
    currentLocationAvailable: false,
  },
};

const dayResolution = {
  id: "resolution-fixture",
  tenantId: "laundry-butler",
  businessDate,
  sourceThrough: new Date().toISOString(),
  completedWork: [
    {
      id: "operations:1",
      title: "Pickup completed for Riley Resident",
      sourceReference: "operations_events:1",
    },
  ],
  moneyEvents: [
    {
      id: "payment:1",
      title: "payment collected",
      amountCents: 94000,
      verificationClass: "VERIFIED",
      sourceReference: "order_payment_events:1",
    },
  ],
  relationshipEvents: [],
  commercialEvents: [{ id: "mission:1", eventType: "visit_completed" }],
  recoveryEvents: [],
  journal: {
    status: "saved",
    journalPoints: 12,
    sourceReference: "driver_sales_journals:1",
  },
  worldDeltas: [
    {
      id: "work:1",
      title: "Riley Resident: pickup completed",
      verificationClass: "VERIFIED",
      sourceReference: "operations_events:1",
    },
  ],
  tomorrowState: { itemCount: 3, blockerCount: 1 },
  motivationalAwards: [
    {
      type: "journal_points",
      points: 12,
      sourceReference: "driver_sales_journals:1",
    },
  ],
  dataQuality: {
    status: "trusted",
    warnings: [],
    sources: ["operations_events"],
  },
};

function inputAt(url, index) {
  const raw = url.searchParams.get("input");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return parsed[String(index)]?.json ?? parsed.json;
  } catch {
    return undefined;
  }
}

function responseFor(procedure, input, withMoves) {
  if (procedure === "auth.me") {
    return {
      id: 1,
      openId: "fixture-driver",
      name: "Driver",
      email: "driver@example.test",
      role: "driver",
    };
  }
  if (procedure === "admin.listByDate") {
    return input?.dateField === "deliveryDate"
      ? [paidDelivery, blockedDelivery]
      : [pickup];
  }
  if (procedure === "system.field.today") return fieldToday;
  if (procedure === "system.field.moves")
    return withMoves ? movesAvailable : noMoves;
  if (procedure === "system.commercialMission.myBuiltMissions")
    return [builtMission];
  if (procedure === "system.commercialMission.myDispatches") return [];
  if (procedure === "system.adaptiveSalesMeter.myMeter") {
    return {
      points: 92,
      maxPoints: 120,
      progress: 0.7667,
      stage: 3,
      windowDays: 30,
      level: 1,
      levelLabel: "LEVEL 1 · BUILD THE MUSCLE",
      nextLevelHint: "Persisted action drives this meter.",
      recentWins: 1,
      breakdown: { walkInPoints: 40, supportingPoints: 52, winBonus: 0 },
    };
  }
  if (procedure === "system.armory.get") {
    return {
      items: [
        {
          id: "journal:1",
          title: "Existing provider",
          cue: "Already has a company",
          response: "Ask where the current setup still creates extra work.",
          outcome: "worked",
          provenance: "personal_journal",
          sourceReference: "driver_sales_journals:1",
        },
      ],
      archetypes: [
        {
          archetype: "ANCHOR",
          count: 2,
          explanation: "The relationship is anchored to an incumbent provider.",
          evidence: [
            {
              text: "We already have a company",
              sourceReference: "driver_sales_journals:1",
            },
          ],
        },
      ],
      currentTactic: {
        title: "Disarm the incumbent",
        cue: "Existing provider",
        response: "Ask where the current setup still creates extra work.",
        followUp: "Offer a comparison pilot.",
        provenance: "personal_journal",
        sourceLabel: "Your field journal",
      },
    };
  }
  if (procedure === "system.voiceWalkIn.calendarStatus")
    return { connected: false };
  if (procedure === "system.unload.resolveDay") return dayResolution;
  if (procedure === "admin.updateStatus") return { success: true };
  return {};
}

async function installApi(
  page,
  withMoves,
  observedMoveInputs,
  observedMutations
) {
  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(
      url.pathname.split("/api/trpc/")[1] ?? ""
    ).split(",");
    const payload = procedures.map((procedure, index) => {
      const input = inputAt(url, index);
      if (procedure === "system.field.moves") observedMoveInputs.push(input);
      if (route.request().method() === "POST")
        observedMutations.push(procedure);
      return {
        result: { data: { json: responseFor(procedure, input, withMoves) } },
      };
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        url.searchParams.get("batch") === "1" ? payload : payload[0]
      ),
    });
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  geolocation: { latitude: 34.0522, longitude: -118.2437 },
  permissions: ["geolocation"],
});
const page = await context.newPage();
const pageErrors = [];
const observedMoveInputs = [];
const observedMutations = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("console", message => {
  if (message.type() === "error") pageErrors.push(message.text());
});
await installApi(page, true, observedMoveInputs, observedMutations);
await page.goto("http://127.0.0.1:5173/driver", { waitUntil: "networkidle" });
await page.getByRole("main").waitFor();
await page.getByText("THE MAYBOURNE BEVERLY HILLS", { exact: false }).waitFor();

const screenshot =
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/goldline-driver-live-phone.png";
await page.screenshot({ path: screenshot, fullPage: true });

await page.getByRole("button", { name: "Open today's route" }).click();
await page.getByText("Carol Customer", { exact: true }).last().click();
const blockedActions = {
  markDelivered: await page
    .getByText("MARK DELIVERED", { exact: true })
    .count(),
  resolvePayment: await page
    .getByText("RESOLVE PAYMENT", { exact: true })
    .count(),
};
await page.getByRole("button", { name: "Close" }).click();

await page.getByRole("button", { name: "Open today's route" }).click();
await page.getByText("Riley Resident", { exact: true }).last().click();
await page.getByText("MARK COLLECTED", { exact: true }).click();
await page.getByRole("button", { name: "Close" }).click();

await page.getByText("NEW ORDER", { exact: true }).click();
await page.getByRole("dialog", { name: "Create new order" }).waitFor();
const realOrderSheet = await page
  .getByText("Create New Order", { exact: true })
  .count();
await page
  .getByRole("dialog", { name: "Create new order" })
  .locator("header button")
  .click();

await page.getByText("LOG A WALK-IN", { exact: true }).click();
await page.getByText("Log this visit", { exact: true }).waitFor();
const realWalkIn = await page
  .getByText("VOICE-FIRST FIELD MEMORY", { exact: true })
  .count();
await page.getByRole("button", { name: "Close" }).first().click();

await page.getByText("UNLOAD THE DAY", { exact: true }).click();
await page.getByText("RESOLVE THIS BUSINESS DAY", { exact: true }).click();
await page.getByText("Verified money events", { exact: true }).waitFor();
const realUnload = await page
  .getByText("Completed work", { exact: true })
  .count();
await page.getByRole("button", { name: "Close" }).click();

const overflow = await page.evaluate(
  () =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth
);
const actionBarVisible = await page.locator(".action-bar").evaluate(element => {
  const rect = element.getBoundingClientRect();
  return (
    rect.bottom <= window.innerHeight && rect.bottom > 0 && rect.height > 0
  );
});

const quietContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const quietPage = await quietContext.newPage();
const quietErrors = [];
const deniedMoveInputs = [];
const quietMutations = [];
quietPage.on("pageerror", error => quietErrors.push(error.message));
await installApi(quietPage, false, deniedMoveInputs, quietMutations);
await quietPage.goto("http://127.0.0.1:5173/driver", {
  waitUntil: "networkidle",
});
await quietPage.getByRole("main").waitFor();
const quietState = {
  callShrines: await quietPage.locator(".call-shrine").count(),
  sideQuests: await quietPage.getByText("SIDE QUEST", { exact: true }).count(),
};

console.log(
  JSON.stringify(
    {
      screenshot,
      blockedActions,
      realOrderSheet,
      realWalkIn,
      realUnload,
      overflow,
      actionBarVisible,
      observedMoveInputs,
      observedMutations,
      quietState,
      deniedMoveInputs,
      pageErrors,
      quietErrors,
    },
    null,
    2
  )
);

await context.close();
await quietContext.close();
await browser.close();
