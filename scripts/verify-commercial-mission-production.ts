import { randomUUID } from "node:crypto";
import {
  createTRPCProxyClient,
  httpBatchLink,
  type TRPCClient,
} from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "../server/routers";

const baseUrl = (
  process.env.COMMERCIAL_MISSION_E2E_BASE_URL ??
  "https://bldg-admin-api-production.up.railway.app"
).replace(/\/$/, "");

if (process.env.COMMERCIAL_MISSION_E2E !== "1") {
  throw new Error("Set COMMERCIAL_MISSION_E2E=1 to create the labeled production verification mission");
}

async function clientFor(
  role: "admin" | "driver",
  password: string | undefined
): Promise<TRPCClient<AppRouter>> {
  if (!password) throw new Error(`${role.toUpperCase()} password is not configured`);
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role, password }),
  });
  if (login.status < 200 || login.status >= 300)
    throw new Error(`${role} login failed (${login.status})`);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error(`${role} login did not return a session cookie`);
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        fetch(url, init) {
          const headers = new Headers(init?.headers);
          headers.set("cookie", cookie);
          headers.set(
            "origin",
            role === "admin"
              ? "https://admin.bldg.chat"
              : "https://driver.bldg.chat"
          );
          return fetch(url, { ...init, headers });
        },
      }),
    ],
  });
}

const admin = await clientFor("admin", process.env.ADMIN_PASSWORD);
const driver = await clientFor(
  "driver",
  process.env.DRIVER_PASSWORD ?? process.env.ADMIN_PASSWORD
);
const [adminUser, driverUser] = await Promise.all([
  admin.auth.me.query(),
  driver.auth.me.query(),
]);
if (!adminUser || !driverUser) throw new Error("Production sessions are not authenticated");

if (process.env.COMMERCIAL_MISSION_E2E_INSPECT_CONFIG === "1") {
  const [profile, tenant] = await Promise.all([
    admin.system.commercialProposal.profile.query(),
    admin.system.saas.me.query(),
  ]);
  console.log(JSON.stringify({ profile, tenantConfiguration: tenant.configuration }, null, 2));
  process.exit(0);
}

if (process.env.COMMERCIAL_MISSION_E2E_CLEANUP === "1") {
  const missions = await admin.system.commercialMission.list.query({ limit: 250 });
  const synthetic = missions.filter(item =>
    item.account.name.startsWith("CODEX PROPERTY MISSION E2E ")
  );
  const closed: Array<{ missionId: number; from: string; to: string }> = [];
  for (const item of synthetic) {
    let mission = item;
    if (mission.status === "won" || mission.status === "lost") continue;
    if (mission.status === "game_completed") {
      mission = await admin.system.commercialMission.transition.mutate({
        missionId: mission.id,
        expectedVersion: mission.version,
        toStatus: "phone_ready",
        idempotencyKey: `production-cleanup-unlock:${mission.id}`,
        metadata: { reason: "Synthetic production verification cleanup" },
      });
    }
    const from = mission.status;
    mission = await admin.system.commercialMission.transition.mutate({
      missionId: mission.id,
      expectedVersion: mission.version,
      toStatus: "lost",
      idempotencyKey: `production-cleanup-lost:${mission.id}`,
      metadata: {
        reason: "Synthetic production verification ended; no prospect was contacted.",
      },
    });
    closed.push({ missionId: mission.id, from, to: mission.status });
  }
  console.log(JSON.stringify({ syntheticCount: synthetic.length, closed }, null, 2));
  process.exit(0);
}

const runId = randomUUID();
const mission = await admin.system.commercialMission.create.mutate({
  assignedTo: null,
  account: {
    providerName: "production-verifier",
    providerAccountId: runId,
    name: `CODEX PROPERTY MISSION E2E ${runId.slice(0, 8)} — SAFE TO ARCHIVE`,
    accountType: "property_management_test",
    website: null,
    address: "Synthetic test destination — no prospect location",
    latitude: null,
    longitude: null,
    locationCount: 1,
    decisionMaker: {
      name: "Synthetic Property Manager",
      title: "Test contact — never call",
      email: null,
      phone: null,
      relationshipType: "unknown",
      preferredChannel: "unknown",
      source: "operator_observation",
      sourceUrl: null,
      sourcedAt: new Date().toISOString(),
      notes: "Production verification fixture. No real person or property is represented.",
    },
  },
  opportunity: {
    estimatedAnnualValueCents: 120_000,
    estimateConfidence: "low",
    score: 50,
    primarySignal: "Synthetic production verification only",
    reasons: ["Exercises the complete persisted mission workflow"],
    risks: ["Not a real prospect; must never be contacted"],
    evidence: [{ fixture: true, externalProvider: false }],
  },
  brief: {
    laundryOpportunity: "Synthetic recurring property laundry scenario.",
    salesAngle: "Verify the product workflow without representing a real commercial claim.",
    openingLine: "This is a production test; no person should be contacted.",
    discoveryQuestions: ["Did every workflow checkpoint persist?"],
    objections: ["Synthetic test only"],
  },
  steps: [
    { key: "scout", label: "Scout", detail: "Synthetic evidence reviewed.", status: "skipped", position: 0 },
    { key: "prepare", label: "Prepare", detail: "Prepare the synthetic mission.", status: "ready", position: 1 },
    { key: "battle", label: "Battle", detail: "Complete BORESLAY.", status: "locked", position: 2 },
    { key: "field", label: "Field", detail: "Complete the synthetic field flow.", status: "locked", position: 3 },
  ],
  idempotencyKey: `production-e2e:${runId}`,
});

let current = await admin.system.commercialMission.activateForField.mutate({
  missionId: mission.id,
  expectedVersion: mission.version,
  assignedTo: driverUser.openId,
  requestId: randomUUID(),
});
await admin.system.commercialMission.createLuxuryHotelIrlPlan.mutate({
  missionId: mission.id,
  requestId: randomUUID(),
  referenceImageUrl: null,
  trainingVideoUrl: null,
  printShopName: "Synthetic print checkpoint",
  printShopAddress: "Synthetic test destination",
  convenienceStoreName: "Synthetic supply checkpoint",
  convenienceStoreAddress: "Synthetic test destination",
  hotelName: mission.account.name,
  hotelAddress: mission.account.address,
  printFulfillmentMode: "staged_demo",
  printCreditDisplayCopy: "No purchase — production verification",
});

const gameAttemptId = randomUUID();
const gameStarted = await driver.system.commercialMission.gameStart.mutate({
  missionId: mission.id,
  expectedVersion: current.version,
  gameAttemptId,
});
const gameCompleted = await driver.system.commercialMission.gameComplete.mutate({
  missionId: mission.id,
  expectedVersion: gameStarted.mission.version,
  gameAttemptId,
  telemetry: {
    sparkScore: 8,
    clockheadScore: 3,
    durationMs: 95_000,
    replay: { fixture: true, externalProvider: false },
  },
});
if (!gameCompleted.phoneMissionUnlocked || !gameCompleted.reward) {
  throw new Error("BORESLAY completion did not unlock the field mission and reward");
}

const dispatch = (await driver.system.commercialMission.myDispatches.query()).find(
  item => item.missionId === mission.id && item.channel === "in_app"
);
if (!dispatch) throw new Error("Game completion did not create an in-app dispatch");
await driver.system.commercialMission.openDispatch.mutate({ dispatchId: dispatch.id });

await driver.system.commercialMission.logCallAttempt.mutate({
  missionId: mission.id,
  requestId: randomUUID(),
  outcome: "contact_unavailable",
  notes: "Synthetic verification: no phone number and no real outreach attempted.",
});

current = await driver.system.commercialMission.get.query({ missionId: mission.id });
let activeStep = current.steps.find(step => step.type !== "generic" && step.status === "ready");
if (!activeStep?.id || activeStep.key !== "wardrobe") {
  throw new Error("Wardrobe proof step was not ready");
}
await driver.system.commercialMission.advanceIrlStep.mutate({
  missionId: mission.id,
  stepKey: activeStep.key,
  requestId: randomUUID(),
  action: "start",
});
const proof = await driver.system.commercialMission.submitProof.mutate({
  missionId: mission.id,
  missionStepId: activeStep.id,
  requestId: randomUUID(),
  mimeType: "image/png",
  dataBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlQAAAAAElFTkSuQmCC",
});
await admin.system.commercialMission.reviewProof.mutate({
  proofId: proof.id,
  requestId: randomUUID(),
  decision: "approve",
  note: "Synthetic one-pixel production proof; no real-world claim.",
});

let coachingStatus: string | null = null;
for (;;) {
  current = await driver.system.commercialMission.get.query({ missionId: mission.id });
  activeStep = current.steps.find(
    step => step.type !== "generic" && ["ready", "active"].includes(step.status)
  );
  if (!activeStep) break;
  if (activeStep.status === "ready") {
    await driver.system.commercialMission.advanceIrlStep.mutate({
      missionId: mission.id,
      stepKey: activeStep.key,
      requestId: randomUUID(),
      action: "start",
    });
  }
  if (activeStep.type === "sales_training" && activeStep.id) {
    const coaching = await driver.system.commercialMission.generateCoaching.mutate({
      missionId: mission.id,
      stepId: activeStep.id,
      requestId: randomUUID(),
    });
    coachingStatus = coaching.generationStatus;
  }
  await driver.system.commercialMission.advanceIrlStep.mutate({
    missionId: mission.id,
    stepKey: activeStep.key,
    requestId: randomUUID(),
    action: "complete",
  });
}

const existingProfile = await admin.system.commercialProposal.profile.query();
const profile = existingProfile ?? await admin.system.commercialProposal.saveProfile.mutate({
  storeName: "Laundry Butler",
  operatorName: "Adam Wright",
  phone: "(323) 807-4661",
  email: "support@laundrybutler.com",
  website: "https://laundrybutler.com",
  address: "Los Angeles, CA",
  logoUrl: "https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/WZKCbJMLcYxTxbBz.png",
  commercialPricePerPoundCents: 225,
  minimumOrderCents: null,
  turnaroundLabel: "Turnaround confirmed for each account",
  pickupScheduleLabel: "Scheduled pickup and delivery",
  serviceAreaLabel: "Greater Los Angeles",
  insuranceLabel: null,
  services: [
    "Commercial wash, dry, and fold",
    "Scheduled pickup and delivery",
    "Towels, mats, staff items, and approved tenant laundry",
    "Account-level order history and consolidated billing",
  ],
});
const proposal = await admin.system.commercialProposal.generate.mutate({
  missionId: mission.id,
  requestId: randomUUID(),
});
await admin.system.commercialProposal.approve.mutate({
  missionId: mission.id,
  proposalId: proposal.id,
  requestId: randomUUID(),
});

let field = await driver.system.commercialMission.fieldStartPreparation.mutate({
  missionId: mission.id,
  expectedMissionVersion: current.version,
  requestId: randomUUID(),
});
for (const item of field.checklist.filter(item => item.required)) {
  field = await driver.system.commercialMission.fieldChecklist.mutate({
    missionId: mission.id,
    expectedFieldVersion: field.field!.version,
    itemKey: item.itemKey,
    status: "completed",
    requestId: randomUUID(),
  });
}
field = await driver.system.commercialMission.fieldDepart.mutate({
  missionId: mission.id,
  expectedMissionVersion: field.mission.version,
  expectedFieldVersion: field.field!.version,
  requestId: randomUUID(),
});
field = await driver.system.commercialMission.fieldArrive.mutate({
  missionId: mission.id,
  expectedMissionVersion: field.mission.version,
  expectedFieldVersion: field.field!.version,
  requestId: randomUUID(),
  checkInMethod: "manual",
});
field = await driver.system.commercialMission.fieldOutcome.mutate({
  missionId: mission.id,
  expectedMissionVersion: field.mission.version,
  expectedFieldVersion: field.field!.version,
  requestId: randomUUID(),
  outcome: "follow_up",
  notes: "Synthetic production verification completed without visiting or contacting anyone.",
  followUpAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
  decisionMakerStatus: "not_recorded",
  collateralDelivered: false,
  quoteRequested: false,
  pilotRequested: false,
  followUpRequested: true,
});

let pipeline = (await admin.system.commercialPipeline.list.query()).find(
  item => item.mission.id === mission.id
);
if (!pipeline) throw new Error("Mission pipeline projection is missing");
let detail = await admin.system.commercialPipeline.detail.query({ pipelineId: pipeline.id });
let followUp = detail?.followUps.find(item => item.status === "open");
if (!followUp) {
  detail = await admin.system.commercialPipeline.scheduleFollowUp.mutate({
    pipelineId: pipeline.id,
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    note: "Synthetic verification follow-up",
    requestId: randomUUID(),
  });
  followUp = detail.followUps.find(item => item.status === "open");
}
if (!followUp) throw new Error("Follow-up was not persisted");
detail = await admin.system.commercialPipeline.completeFollowUp.mutate({
  pipelineId: pipeline.id,
  followUpId: followUp.id,
  requestId: randomUUID(),
});
if (detail.followUps.find(item => item.id === followUp!.id)?.status !== "completed") {
  throw new Error("Follow-up completion was not persisted");
}
detail = await admin.system.commercialPipeline.resolve.mutate({
  pipelineId: pipeline.id,
  expectedMissionVersion: field.mission.version,
  action: "lost",
  reason: "Synthetic production verification finished; no prospect was contacted.",
  requestId: randomUUID(),
});

const [events, attempts, gameState, proofs] = await Promise.all([
  admin.system.commercialMission.events.query({ missionId: mission.id }),
  driver.system.commercialMission.callAttempts.query({ missionId: mission.id }),
  driver.system.commercialMission.gameState.query({ missionId: mission.id }),
  admin.system.commercialMission.proofs.query({ missionId: mission.id }),
]);
const requiredEvents = [
  "mission_created",
  "mission_assigned",
  "game_started",
  "game_completed",
  "phone_unlocked",
  "cold_call_logged",
  "preparation_started",
  "departed",
  "arrived",
  "follow_up_required",
  "account_lost",
];
const eventNames = events.map(event => event.eventName);
for (const eventName of requiredEvents) {
  if (!eventNames.includes(eventName)) throw new Error(`Missing mission event ${eventName}`);
}
if (!gameState?.reward || gameState.reward.xpAwarded <= 0) throw new Error("Game XP reward is missing");
if (attempts.length !== 1) throw new Error("Expected one persisted call attempt");
if (proofs[0]?.reviewStatus !== "approved") throw new Error("Approved proof is missing");
if (detail.mission.status !== "lost" || detail.stage !== "lost") {
  throw new Error("Mission and pipeline did not reach a truthful terminal state");
}

console.log(JSON.stringify({
  ok: true,
  runId,
  missionId: mission.id,
  missionCode: mission.code,
  driverId: driverUser.openId,
  dispatchStatus: "opened",
  callOutcome: attempts[0]?.outcome,
  proofStatus: proofs[0]?.reviewStatus,
  coachingStatus,
  xpAwarded: gameState.reward.xpAwarded,
  streakDays: gameState.reward.streakDays,
  followUpStatus: detail.followUps.find(item => item.id === followUp!.id)?.status,
  pipelineStage: detail.stage,
  missionStatus: detail.mission.status,
  eventCount: events.length,
}, null, 2));
