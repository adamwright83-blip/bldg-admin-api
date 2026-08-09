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

function inputForRequest(request, url, index) {
  if (request.method() === "GET") return inputAt(url, index);
  try {
    const parsed = request.postDataJSON();
    return parsed?.[String(index)]?.json ?? parsed?.json;
  } catch {
    return undefined;
  }
}

function responseFor(
  procedure,
  input,
  withMoves,
  singlePickupOnly = false,
  resolvedOrderIds = new Set(),
  openChannelState = { current: null }
) {
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
    if (singlePickupOnly)
      return input?.dateField === "deliveryDate"
        ? []
        : [pickup].filter(order => !resolvedOrderIds.has(order.id));
    const orders =
      input?.dateField === "deliveryDate"
        ? [paidDelivery, blockedDelivery]
        : [pickup];
    return orders.filter(order => !resolvedOrderIds.has(order.id));
  }
  if (procedure === "system.field.today") return fieldToday;
  if (procedure === "system.field.moves")
    return withMoves && !singlePickupOnly ? movesAvailable : noMoves;
  if (procedure === "system.commercialMission.myBuiltMissions")
    return singlePickupOnly ? [] : [builtMission];
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
  if (procedure === "system.openChannel.current")
    return openChannelState.current;
  if (procedure === "system.openChannel.progress") {
    const completedPickupCount = resolvedOrderIds.has(pickup.id) ? 1 : 0;
    const completedMissionStepCount =
      openChannelState.current?.tasks?.filter(
        task => task.status === "completed"
      ).length ?? 0;
    const completedRouteActions =
      completedPickupCount + completedMissionStepCount;
    return {
      businessDate,
      completedPickupCount,
      completedDeliveryCount: 0,
      completedMissionStepCount,
      completedRouteActions,
      avatarSpace: completedRouteActions,
    };
  }
  if (procedure === "system.openChannel.generateDraft") {
    const taskSeeds = [
      [
        "Secure a low-cost meal",
        "Choose a simple inexpensive grocery-store option.",
        25,
        "food",
        "inexpensive grocery store food near me",
      ],
      [
        "Barbershop outreach 1 of 3",
        "Bring collateral and record the decision-maker or next step.",
        20,
        "sales",
        "barbershops in Huntington Park CA",
      ],
      [
        "Barbershop outreach 2 of 3",
        "Bring collateral and record the decision-maker or next step.",
        20,
        "sales",
        "barbershops in Huntington Park CA",
      ],
      [
        "Barbershop outreach 3 of 3",
        "Bring collateral and record the decision-maker or next step.",
        20,
        "sales",
        "barbershops in Huntington Park CA",
      ],
      [
        "Start personal laundry",
        "Start the wash-and-dry cycle and set a return timer.",
        15,
        "personal",
        null,
      ],
      [
        "Collect Russell's quarters",
        "Collect and secure the quarters before reconciliation.",
        15,
        "finance",
        null,
      ],
      [
        "Count and reconcile cash",
        "Count the cash and record the total for Russell.",
        20,
        "finance",
        null,
      ],
    ];
    openChannelState.current = {
      id: "00000000-0000-4000-8000-000000000050",
      businessDate,
      status: "draft",
      title: "Use the Sunday gap",
      laraBriefing:
        "Channel received. We have time for food, three local shop visits, laundry, and the cash count. Check my order before we deploy.",
      transcript: input?.transcript ?? "Voice briefing",
      generationSource: "anthropic_structured",
      gapStartedAt: new Date().toISOString(),
      nextCommitmentAt: null,
      availableMinutes: input?.availableMinutes ?? null,
      approvedAt: null,
      completedAt: null,
      tasks: taskSeeds.map((task, index) => ({
        id: `00000000-0000-4000-8000-${String(51 + index).padStart(12, "0")}`,
        position: index,
        title: task[0],
        detail: task[1],
        estimatedMinutes: task[2],
        category: task[3],
        navigationQuery: task[4],
        status: "pending",
        completedAt: null,
      })),
    };
    return openChannelState.current;
  }
  if (procedure === "system.openChannel.approve") {
    openChannelState.current = {
      ...openChannelState.current,
      status: "active",
      title: input.title,
      approvedAt: new Date().toISOString(),
      tasks: input.tasks.map((task, index) => ({
        ...task,
        id: `00000000-0000-4000-8000-${String(71 + index).padStart(12, "0")}`,
        position: index,
        status: "pending",
        completedAt: null,
      })),
    };
    return openChannelState.current;
  }
  if (procedure === "system.openChannel.completeTask") {
    const completedAt = new Date().toISOString();
    const tasks = openChannelState.current.tasks.map(task =>
      task.id === input.taskId
        ? { ...task, status: "completed", completedAt }
        : task
    );
    openChannelState.current = {
      ...openChannelState.current,
      status: tasks.every(task => task.status === "completed")
        ? "completed"
        : "active",
      completedAt: tasks.every(task => task.status === "completed")
        ? completedAt
        : null,
      tasks,
    };
    return openChannelState.current;
  }
  if (procedure === "system.unload.resolveDay") return dayResolution;
  if (procedure === "admin.updateStatus") return { success: true };
  return {};
}

async function installApi(
  page,
  withMoves,
  observedMoveInputs,
  observedMutations,
  singlePickupOnly = false
) {
  const resolvedOrderIds = new Set();
  const openChannelState = { current: null };
  await page.route("**/api/trpc/**", async route => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(
      url.pathname.split("/api/trpc/")[1] ?? ""
    ).split(",");
    const payload = procedures.map((procedure, index) => {
      const input = inputForRequest(route.request(), url, index);
      if (procedure === "system.field.moves") observedMoveInputs.push(input);
      if (route.request().method() === "POST") {
        observedMutations.push(procedure);
        if (procedure === "admin.updateStatus" && input?.orderId)
          resolvedOrderIds.add(input.orderId);
      }
      return {
        result: {
          data: {
            json: responseFor(
              procedure,
              input,
              withMoves,
              singlePickupOnly,
              resolvedOrderIds,
              openChannelState
            ),
          },
        },
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
await page.locator(".goldline-route-completion").waitFor();
await page.waitForTimeout(280);
const confirmationScreenshot =
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/goldline-pickup-confirmed.png";
await page.screenshot({ path: confirmationScreenshot, fullPage: true });
const greenConfirmation = {
  checkmark: await page.locator(".goldline-route-completion svg").count(),
  pickupSecured: await page
    .getByText("PICKUP SECURED", { exact: true })
    .count(),
};
await page.locator(".drawer-backdrop").waitFor({
  state: "hidden",
  timeout: 5_000,
});
const routeCompletionFlow = {
  confirmationScreenshot,
  greenConfirmation,
  drawerClosed: (await page.locator(".drawer-backdrop").count()) === 0,
  pickupCardRemoved:
    (await page
      .locator(".route-stop", { hasText: "Riley Resident" })
      .count()) === 0,
  laraAdvancing: await page.locator(".is-route-progressing").count(),
  progressionTrail: await page.locator(".goldline-progress-trail").count(),
};
if (
  routeCompletionFlow.greenConfirmation.checkmark !== 1 ||
  routeCompletionFlow.greenConfirmation.pickupSecured !== 1 ||
  !routeCompletionFlow.drawerClosed ||
  !routeCompletionFlow.pickupCardRemoved ||
  routeCompletionFlow.laraAdvancing !== 1 ||
  routeCompletionFlow.progressionTrail !== 1
) {
  throw new Error(
    `Goldline pickup completion sequence failed: ${JSON.stringify(routeCompletionFlow)}`
  );
}
const progressionScreenshot =
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/goldline-lara-advancing.png";
await page.waitForTimeout(450);
await page.screenshot({ path: progressionScreenshot, fullPage: true });
routeCompletionFlow.progressionScreenshot = progressionScreenshot;
await page.locator(".goldline-progress-trail").waitFor({
  state: "detached",
  timeout: 5_000,
});
await page.getByRole("img", { name: "Lara is on board space 1" }).waitFor();
routeCompletionFlow.persistentBoardSpace = await page
  .getByRole("img", { name: "Lara is on board space 1" })
  .count();
if (routeCompletionFlow.persistentBoardSpace !== 1) {
  throw new Error(
    `Goldline did not retain Lara's completed board space: ${JSON.stringify(routeCompletionFlow)}`
  );
}

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

const openChannelContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  geolocation: { latitude: 33.974, longitude: -118.23 },
  permissions: ["geolocation"],
});
const openChannelPage = await openChannelContext.newPage();
const openChannelErrors = [];
const openChannelMutations = [];
openChannelPage.on("pageerror", error => openChannelErrors.push(error.message));
openChannelPage.on("console", message => {
  if (message.type() === "error") openChannelErrors.push(message.text());
});
await installApi(openChannelPage, false, [], openChannelMutations, true);
await openChannelPage.goto("http://127.0.0.1:5173/driver", {
  waitUntil: "networkidle",
});
await openChannelPage
  .getByRole("button", { name: "Open today's route" })
  .click();
await openChannelPage
  .getByText("Riley Resident", { exact: true })
  .last()
  .click();
await openChannelPage.getByText("MARK COLLECTED", { exact: true }).click();
await openChannelPage.locator(".goldline-progress-trail").waitFor();
await openChannelPage.locator(".goldline-progress-trail").waitFor({
  state: "detached",
  timeout: 5_000,
});
await openChannelPage
  .getByRole("img", { name: "Lara is on board space 1" })
  .waitFor();
await openChannelPage
  .getByRole("button", { name: "Open Channel mission briefing" })
  .waitFor();
const openChannelSignalScreenshot =
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/open-channel-signal.png";
await openChannelPage.screenshot({
  path: openChannelSignalScreenshot,
  fullPage: true,
});
await openChannelPage
  .getByRole("button", { name: "Open Channel mission briefing" })
  .click();
await openChannelPage
  .getByPlaceholder(
    "It’s Sunday at 11:16. I’m at Lugo’s with three and a half hours…"
  )
  .fill(
    "It is Sunday at 11:16 and I have three and a half hours. I am hungry but should not spend money. I have collateral for three local barbershops in Huntington Park. Then I need to start personal laundry, collect Russell's quarters, and count cash."
  );
await openChannelPage
  .getByRole("button", { name: "BUILD DRAFT MISSION" })
  .click();
await openChannelPage.locator('input[aria-label="Mission title"]').waitFor();
const openChannelDraftScreenshot =
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/open-channel-draft.png";
await openChannelPage.screenshot({
  path: openChannelDraftScreenshot,
  fullPage: true,
});
const draftTaskCount = await openChannelPage
  .locator(".open-channel-task-editor article")
  .count();
await openChannelPage
  .getByRole("button", { name: "APPROVE & LOAD THE BOARD" })
  .evaluate(button => button.click());
await openChannelPage.getByText("MISSION ACTIVE", { exact: true }).waitFor();
await openChannelPage
  .getByRole("button", { name: "RETURN TO THE BOARD" })
  .evaluate(button => button.click());
await openChannelPage
  .locator(".route-stop", { hasText: "Secure a low-cost meal" })
  .evaluate(button => button.click());
await openChannelPage
  .getByText("COMPLETE BOARD SPACE", { exact: true })
  .evaluate(button => button.click());
await openChannelPage
  .getByText("MISSION SPACE CLEARED", { exact: true })
  .waitFor();
const openChannelStepScreenshot =
  "/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/open-channel-step-complete.png";
await openChannelPage.screenshot({
  path: openChannelStepScreenshot,
  fullPage: true,
});
await openChannelPage.locator(".drawer-backdrop").waitFor({
  state: "hidden",
  timeout: 5_000,
});
await openChannelPage.locator(".goldline-progress-trail").waitFor();
await openChannelPage.locator(".goldline-progress-trail").waitFor({
  state: "detached",
  timeout: 5_000,
});
await openChannelPage
  .getByRole("img", { name: "Lara is on board space 2" })
  .waitFor();
const openChannelFlow = {
  signalScreenshot: openChannelSignalScreenshot,
  draftScreenshot: openChannelDraftScreenshot,
  stepScreenshot: openChannelStepScreenshot,
  draftTaskCount,
  firstStepRemoved:
    (await openChannelPage
      .locator(".route-stop", { hasText: "Secure a low-cost meal" })
      .count()) === 0,
  mutations: openChannelMutations.filter(procedure =>
    procedure.startsWith("system.openChannel")
  ),
  errors: openChannelErrors,
  persistentBoardSpace: await openChannelPage
    .getByRole("img", { name: "Lara is on board space 2" })
    .count(),
};
if (
  draftTaskCount !== 7 ||
  !openChannelFlow.firstStepRemoved ||
  JSON.stringify(openChannelFlow.mutations) !==
    JSON.stringify([
      "system.openChannel.generateDraft",
      "system.openChannel.approve",
      "system.openChannel.completeTask",
    ]) ||
  openChannelFlow.persistentBoardSpace !== 1 ||
  openChannelErrors.length
) {
  throw new Error(
    `Open Channel end-to-end flow failed: ${JSON.stringify(openChannelFlow)}`
  );
}

const placementViewports = [
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 430, height: 932 },
  { width: 390, height: 700 },
];
const placementChecks = [];

for (const viewport of placementViewports) {
  const placementContext = await browser.newContext({ viewport });
  const placementPage = await placementContext.newPage();
  const placementErrors = [];
  placementPage.on("pageerror", error => placementErrors.push(error.message));
  placementPage.on("console", message => {
    if (message.type() === "error") placementErrors.push(message.text());
  });
  await installApi(placementPage, false, [], [], true);
  await placementPage.goto("http://127.0.0.1:5173/driver", {
    waitUntil: "networkidle",
  });
  await placementPage.getByRole("main").waitFor();
  await placementPage
    .locator('.route-stop[data-route-anchor="lower-gold-reliquary"]')
    .waitFor();

  const layout = await placementPage.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const overlaps = (left, right) =>
      Boolean(
        left &&
          right &&
          left.left < right.right &&
          left.right > right.left &&
          left.top < right.bottom &&
          left.bottom > right.top
      );
    const fontSize = selector => {
      const element = document.querySelector(selector);
      return element
        ? Number.parseFloat(getComputedStyle(element).fontSize)
        : 0;
    };

    const layer = rect(".goldline-route-layer");
    const card = rect('.route-stop[data-route-anchor="lower-gold-reliquary"]');
    const node = rect('.energy-node[data-route-anchor="lower-gold-reliquary"]');
    const laraSafeZone = layer
      ? {
          left: layer.left,
          right: layer.left + layer.width * 0.42,
          top: layer.top + layer.height * 0.53,
          bottom: layer.top + layer.height * 0.96,
        }
      : null;
    const hudSelectors = [
      ".route-summary",
      ".hustle",
      ".objectives-tab",
      ".vorgan-card",
      ".action-bar",
    ];
    const cardStyle = document.querySelector(
      '.route-stop[data-route-anchor="lower-gold-reliquary"]'
    );
    const nodeStyle = document.querySelector(
      '.energy-node[data-route-anchor="lower-gold-reliquary"]'
    );
    const anchorCoordinates = element =>
      element
        ? {
            x: element.style.getPropertyValue("--goldline-anchor-x"),
            y: element.style.getPropertyValue("--goldline-anchor-y"),
          }
        : null;
    const actionBar = rect(".action-bar");

    return {
      routeStopCount: document.querySelectorAll(".route-stop").length,
      card,
      node,
      laraSafeZone,
      overlapsLara: overlaps(card, laraSafeZone),
      hudCollisions: hudSelectors.filter(selector =>
        overlaps(card, rect(selector))
      ),
      cardAnchor: anchorCoordinates(cardStyle),
      nodeAnchor: anchorCoordinates(nodeStyle),
      actionBarVisible: Boolean(
        actionBar &&
          actionBar.top >= 0 &&
          actionBar.bottom <= window.innerHeight
      ),
      overflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      fontSizes: {
        date: fontSize(".date-stone strong"),
        routeTitle: fontSize(".route-summary > b"),
        routeCounts: fontSize(".route-summary > span"),
        hustle: fontSize(".hustle-labels"),
        objectives: fontSize(".objectives-tab"),
      },
    };
  });

  const screenshotPath =
    `/Users/adamwrightpfi/.codex/visualizations/2026/08/09/019fe538-2f7e-72f1-bdc1-0d86e50cfc5c/` +
    `goldline-anchor-${viewport.width}x${viewport.height}.png`;
  await placementPage.screenshot({ path: screenshotPath, fullPage: true });

  const failures = [];
  if (layout.routeStopCount !== 1) failures.push("expected one seeded pickup");
  if (layout.overlapsLara) failures.push("pickup card overlaps Lara safe zone");
  if (layout.hudCollisions.length)
    failures.push(
      `pickup card collides with ${layout.hudCollisions.join(", ")}`
    );
  if (JSON.stringify(layout.cardAnchor) !== JSON.stringify(layout.nodeAnchor))
    failures.push(
      "route card and energy node use different anchor coordinates"
    );
  if (!layout.actionBarVisible)
    failures.push("action bar is not fully visible");
  if (layout.overflow !== 0) failures.push("horizontal overflow detected");
  if (layout.fontSizes.date < 16) failures.push("date is too small");
  if (layout.fontSizes.routeTitle < 14)
    failures.push("route title is too small");
  if (layout.fontSizes.routeCounts < 10)
    failures.push("route counts are too small");
  if (layout.fontSizes.hustle < 10) failures.push("hustle meter is too small");
  if (layout.fontSizes.objectives < 10)
    failures.push("follow-up objectives are too small");
  if (placementErrors.length)
    failures.push(`browser errors: ${placementErrors.join(" | ")}`);
  if (failures.length)
    throw new Error(
      `${viewport.width}x${viewport.height} Goldline placement failed: ${failures.join("; ")}`
    );

  placementChecks.push({ viewport, screenshotPath, ...layout });
  await placementContext.close();
}

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
      routeCompletionFlow,
      quietState,
      deniedMoveInputs,
      pageErrors,
      quietErrors,
      openChannelFlow,
      placementChecks,
    },
    null,
    2
  )
);

await context.close();
await quietContext.close();
await browser.close();
