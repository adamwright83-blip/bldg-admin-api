import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import type { Order } from "@shared/types";
import type { DayDirectorCommitment } from "@shared/dayDirector";
import type { CanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import {
  buildDayPlanProjection,
  executableDayLineStops,
  liveObjectivesFromFieldToday,
} from "../../../client/src/pages/driver/goldlineDayPlanModel";
import type { FieldTodayItem, FieldTodayProjection } from "../../field/types";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { buildShowrunnerBriefing, showrunnerOpening } from "./showrunnerBriefing";
import { runShowrunnerTurn, type ShowrunnerCallState } from "./showrunnerTurn";
import {
  loadDriverDayLineForCall,
  speakDriverDayLineCall,
  projectDriverDayLineForCall,
  type DriverDayLineCallFacts,
  type DriverDayLineProjectionInput,
} from "./driverDayLineCall";
import type { OpenChannelMission } from "../../openChannel/openChannelTypes";

const NOW = new Date("2026-10-16T14:30:00.000Z");

function fieldItem(
  over: Partial<FieldTodayItem> & Pick<FieldTodayItem, "id" | "kind" | "title" | "status">
): FieldTodayItem {
  return {
    source: { entityType: "fixture", entityId: over.id, sourceReference: `fixture:${over.id}` },
    scheduledAt: null,
    urgency: "scheduled",
    subtitle: over.title,
    destination: null,
    customer: null,
    money: null,
    verificationClass: "VERIFIED",
    actions: [],
    ...over,
  };
}

const harbor = fieldItem({
  id: "follow-up:harbor",
  kind: "follow_up",
  title: "Call Harbor Laundry",
  status: "open",
});
const towels = fieldItem({
  id: "follow-up:towels",
  kind: "follow_up",
  title: "Return the towels",
  status: "completed",
});
const napkins = fieldItem({
  id: "pressure:napkins",
  kind: "field_commitment",
  title: "Fold the napkins",
  status: "completed",
});
const greystar = fieldItem({
  id: "visit:greystar",
  kind: "commercial_visit",
  title: "Greystar walk",
  status: "open",
  urgency: "blocked",
});
const ada = fieldItem({
  id: "recovery:ada",
  kind: "customer_recovery",
  title: "Recovery · Ada",
  status: "draft_pending_review",
});
const payment = fieldItem({
  id: "payment-blocker:7",
  kind: "payment_blocker",
  title: "Payment blocks Carol's delivery",
  status: "ready",
  urgency: "blocked",
  subtitle: "Ready but not paid.",
});

const field: FieldTodayProjection = {
  generatedAt: NOW.toISOString(),
  businessDate: "2026-10-16",
  currentUserId: "adam",
  timeline: [harbor, towels, napkins, greystar, ada],
  authoritativeCompletedObjectiveIds: ["pickup:42", "follow-up:towels"],
  nextFixedCommitment: null,
  blockers: [payment],
  dataQuality: { status: "partial", warnings: [], sources: ["fixture"] },
};

const collected = {
  id: 42,
  status: "collected",
  firstName: "Carol",
  lastName: "Ng",
  address: "1 Main",
  pickupTimeWindow: "9:00 AM",
  paid: true,
  updatedAt: "2026-10-16T16:00:00.000Z",
} as Order;

const deposit = {
  id: "cash",
  businessDate: "2026-10-16",
  title: "Deposit the cash",
  kind: "prep",
  quantity: null,
  provenance: "manual",
  status: "open",
  completedAt: null,
} as DayDirectorCommitment;

const designated = {
  id: "harbor-mission",
  businessDate: "2026-10-16",
  title: "Win the harbor",
  kind: "growth",
  quantity: null,
  provenance: "user_reported",
  status: "open",
  completedAt: null,
  sourceText: "Win the harbor account",
  command: { role: "primary", designatedAt: "2026-10-16T14:00:00.000Z" },
  operatorMission: { completionCondition: "One visit" },
} as DayDirectorCommitment;

const draftBriefing = {
  id: "oc-draft",
  businessDate: "2026-10-16",
  status: "draft",
  title: "Review the morning sheet",
  tasks: [],
} as OpenChannelMission;

function projectionInput(): DriverDayLineProjectionInput {
  return {
    businessDate: "2026-10-16",
    now: NOW,
    field,
    pickups: [collected],
    deliveries: [],
    commitments: [deposit, designated],
    openChannelMission: draftBriefing,
    pendingApproval: [{ id: "postcard", title: "Postcard draft" }],
  };
}

function facts(): DriverDayLineCallFacts {
  return projectDriverDayLineForCall(projectionInput());
}

describe("driver Day Line on the Claire call", () => {
  it("uses the same projection and start filter the driver executes", () => {
    const input = projectionInput();
    const line = projectDriverDayLineForCall(input);
    const direct = buildDayPlanProjection({
      businessDate: input.businessDate,
      pickups: input.pickups,
      deliveries: input.deliveries,
      openChannelMission: input.openChannelMission,
      commitments: input.commitments,
      now: input.now,
      nextCommitmentAt: input.field.nextFixedCommitment?.scheduledAt ?? null,
      liveObjectives: liveObjectivesFromFieldToday(input.field.timeline),
    });
    expect(line.read).toBe("read");
    expect(line.stops.map(stop => stop.id)).toEqual(direct.stops.map(stop => stop.id));
    expect(line.stops.filter(stop => stop.executable).map(stop => stop.id)).toEqual(
      executableDayLineStops(direct.stops).map(stop => stop.id)
    );
    expect(line.designatedMission).toEqual({ id: "harbor-mission", title: "Win the harbor" });
    expect(line.stops.find(stop => stop.title === "Call Harbor Laundry")).toMatchObject({
      executable: true,
      completion: "unfinished",
      needsApproval: false,
    });
    expect(line.stops.find(stop => stop.title === "Return the towels")).toMatchObject({
      executable: false,
      completion: "completed_with_evidence",
      evidence: "follow-up:towels",
    });
    expect(line.stops.find(stop => stop.title === "Carol Ng")).toMatchObject({
      executable: false,
      completion: "completed_with_evidence",
      evidence: "pickup:42",
    });
    expect(line.stops.find(stop => stop.title === "Fold the napkins")).toMatchObject({
      completion: "completed_without_evidence",
      evidence: null,
    });
    expect(line.stops.find(stop => stop.title === "Greystar walk")).toMatchObject({
      executable: false,
      completion: "blocked",
    });
    expect(line.stops.find(stop => stop.title === "Recovery · Ada")).toMatchObject({
      executable: true,
      needsApproval: true,
    });
    expect(line.fieldBlockers.map(item => item.title)).toEqual(["Payment blocks Carol's delivery"]);
    expect(line.pendingApproval.map(item => item.title)).toEqual([
      "Postcard draft",
      "Review the morning sheet",
    ]);
    expect(line.stops.some(stop => stop.title === "Review the morning sheet")).toBe(false);
  });

  it("the morning briefing and the evening call speak that same line", () => {
    const line = facts();
    const shared = {
      purpose: "morning_readiness" as const,
      businessDate: "2026-10-16",
      weekday: "Friday",
      objective: "Win Silver Lake",
      weekPlan: null,
      today: [],
      tomorrow: [],
      developments: [],
      pendingDecision: null,
      adaptations: [],
      uncertain: [],
      weekToDate: { reportedOutcomes: [], planChanges: [] },
      driverDayLine: line,
    };
    const morning = showrunnerOpening(shared);
    const evening = showrunnerOpening({ ...shared, purpose: "evening_debrief" });
    for (const spoken of [morning, evening]) {
      expect(spoken).toContain("Win the harbor");
      expect(spoken).toContain("Call Harbor Laundry");
      expect(spoken).toContain("Deposit the cash");
      expect(spoken).toContain("Done and verified:");
      expect(spoken).toContain("Return the towels");
      expect(spoken).toContain("Carol Ng");
      expect(spoken).toContain("Marked done, not yet verified: Fold the napkins.");
      expect(spoken).toContain("Blocked or deferred: Greystar walk and Payment blocks Carol's delivery.");
      expect(spoken).toContain("Waiting on your approval:");
      expect(spoken).toContain("Recovery · Ada");
      expect(spoken).toContain("Postcard draft");
      expect(spoken).toContain("Review the morning sheet");
    }
    expect(morning).toMatch(/^Good morning, it's Claire\./);
    expect(morning).toMatch(/Are you ready to get going\?$/);
    expect(morning).toContain("Today's mission is Win the harbor.");
    expect(evening).toMatch(/^Hi, it's Claire for today's wrap\./);
    expect(evening).toMatch(/How did it go\?$/);
    expect(evening).toContain("Today's mission was Win the harbor.");
  });

  it("does not invent the line when the field read fails", async () => {
    const line = await loadDriverDayLineForCall({
      caller: {
        tenantId: "tenant-a",
        userId: "adam",
        includeAllAssignees: true,
        dayDirectorActorId: "actor-1",
        dayDirectorActorIds: ["actor-1"],
        canonicalOperatorId: "op-1",
      },
      businessDate: "2026-10-16",
      now: NOW,
      timeZone: "America/Los_Angeles",
      pendingApproval: [{ id: "postcard", title: "Postcard draft" }],
      getField: async () => {
        throw new Error("database unavailable");
      },
    });
    expect(line.read).toBe("unread");
    const spoken = showrunnerOpening({
      purpose: "morning_readiness",
      businessDate: "2026-10-16",
      weekday: "Friday",
      objective: null,
      weekPlan: null,
      today: [{ id: "cash", title: "Deposit the cash", objective: null, status: "open", window: null, note: null }],
      tomorrow: [],
      developments: [],
      pendingDecision: null,
      adaptations: [],
      uncertain: [],
      weekToDate: { reportedOutcomes: [], planChanges: [] },
      driverDayLine: line,
    });
    expect(spoken).toContain("I couldn't read today's Day Line, so I won't guess what's on it.");
    expect(spoken).not.toContain("Deposit the cash");
    expect(spoken).toContain("Postcard draft");
  });

  it("loads the field timeline before it projects the line", async () => {
    const getField = vi.fn(async () => field);
    const line = await loadDriverDayLineForCall({
      caller: {
        tenantId: "tenant-a",
        userId: "adam",
        includeAllAssignees: false,
        dayDirectorActorId: "actor-1",
        dayDirectorActorIds: ["actor-1"],
        canonicalOperatorId: "op-1",
      },
      businessDate: "2026-10-16",
      now: NOW,
      timeZone: "America/Los_Angeles",
      getField,
      listOrders: async input => (input.status === "collected" ? [collected] : []),
      listExternal: async () => [],
      getDay: async () =>
        ({
          processingLocation: null,
          commitments: [deposit, designated],
          dismissedPromptKeys: [],
          intelligenceAvailable: false,
        }) as never,
      getPlan: async () => null,
      listSales: async () => [],
      readOpenChannel: async () => draftBriefing,
    });
    expect(getField).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      userId: "adam",
      includeAllAssignees: false,
      now: NOW,
      timeZone: "America/Los_Angeles",
      businessDate: "2026-10-16",
    });
    expect(line.read).toBe("read");
    expect(line.stops.some(stop => stop.title === "Call Harbor Laundry")).toBe(true);
    expect(line.stops.some(stop => stop.evidence === "pickup:42")).toBe(true);
  });

  it("names an incomplete CleanCloud schedule instead of reading the day as whole", async () => {
    const { assessScheduleFreshness } = await import("../../../shared/cleancloudScheduleFreshness");
    const line = await loadDriverDayLineForCall({
      caller: {
        tenantId: "tenant-a",
        userId: "adam",
        includeAllAssignees: false,
        dayDirectorActorId: "actor-1",
        dayDirectorActorIds: ["actor-1"],
        canonicalOperatorId: "op-1",
      },
      businessDate: "2026-10-16",
      now: NOW,
      timeZone: "America/Los_Angeles",
      getField: async () => field,
      listOrders: async () => [],
      listExternal: async () => [],
      getDay: async () => ({ processingLocation: null, commitments: [], dismissedPromptKeys: [], intelligenceAvailable: false }) as never,
      getPlan: async () => null,
      listSales: async () => [],
      readOpenChannel: async () => null,
      readScheduleFreshness: async ({ now }) =>
        assessScheduleFreshness(
          {
            usesCleanCloud: true,
            pickupConnection: { enabled: true, capturedAt: new Date(now.getTime() - 3 * 3_600_000), lastError: null },
            deliveriesSynced: false,
          },
          now
        ),
    });
    expect(line.omissions).toEqual(expect.arrayContaining(["cleancloud_pickups", "cleancloud_deliveries"]));
    expect(speakDriverDayLineCall(line, "morning_readiness")).toContain(
      "I could not read current CleanCloud pickups and CleanCloud deliveries, so this is not the full Day Line."
    );
  });

  it("a simulated morning turn reads the line and does not treat a report as execution evidence", async () => {
    const line = facts();
    let prompt = "";
    const state: ShowrunnerCallState = {
      purpose: "morning_readiness",
      tenantId: "tenant-a",
      canonicalOperatorId: "op-1",
      operatorUserId: "adam",
      dayDirectorActorId: "actor-1",
      dayDirectorActorIds: ["actor-1"],
      timeZone: "America/Los_Angeles",
      businessDate: "2026-10-16",
      briefing: {
        purpose: "morning_readiness",
        businessDate: "2026-10-16",
        weekday: "Friday",
        objective: "Win Silver Lake",
        weekPlan: null,
        today: [],
        tomorrow: [],
        developments: [],
        pendingDecision: null,
        adaptations: [],
        uncertain: [],
        weekToDate: { reportedOutcomes: [], planChanges: [] },
        driverDayLine: line,
      },
      captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
      replan: null,
      turns: 0,
    };
    const result = await runShowrunnerTurn({
      state,
      history: [],
      utterance: "What's still unfinished?",
      sourceEventId: "sim-1",
      conversationKey: "sim-call",
      now: NOW,
      record: async () => undefined,
      invoke: (async (request: { messages: Array<{ role: string; content: string }> }) => {
        prompt = request.messages.map(message => message.content).join("\n");
        return {
          choices: [
            {
              message: {
                content: JSON.stringify({
                  speak: "Call Harbor Laundry is still unfinished.",
                  operatorIsDone: false,
                  missionUpdates: [
                    {
                      itemId: "living-world-follow-up:harbor",
                      outcome: "done",
                      operatorWords: "I finished it",
                    },
                  ],
                  developments: [],
                  readinessNeeds: [],
                  planEdits: [],
                }),
              },
            },
          ],
        };
      }) as never,
    });
    const briefing = JSON.parse(prompt.slice(prompt.indexOf("{"))).BRIEFING;
    expect(briefing.driverDayLine.stops.map((stop: { title: string }) => stop.title)).toContain(
      "Call Harbor Laundry"
    );
    expect(prompt).toContain("completed_with_evidence");
    expect(prompt).toContain("not execution evidence");
    expect(result.state.briefing.driverDayLine?.stops.find(stop => stop.title === "Call Harbor Laundry")).toMatchObject({
      completion: "unfinished",
      evidence: null,
    });
    expect(result.state.captured.missionUpdates[0]).toMatchObject({
      itemId: "living-world-follow-up:harbor",
      outcome: "done",
    });
  });

  it("the 7:30 AM and 6:30 PM briefings read the driver Day Line", async () => {
    const morningNow = new Date("2026-10-16T14:30:00.000Z");
    const eveningNow = new Date("2026-10-17T01:30:00.000Z");
    expect(formatInTimeZone(morningNow, "America/Los_Angeles", "HH:mm")).toBe("07:30");
    expect(formatInTimeZone(eveningNow, "America/Los_Angeles", "HH:mm")).toBe("18:30");
    const getField = vi.fn(async () => field);
    const identity = {
      tenantId: "tenant-a",
      canonicalOperatorId: "op-1",
      canonicalOpenId: "adam",
      dayDirectorActorId: "actor-1",
      dayDirectorActorIds: ["actor-1"],
      membership: { canonical: "owner", source: "owner" },
    } as CanonicalOperatorIdentity;
    const loadDriverDayLine: typeof loadDriverDayLineForCall = args =>
      loadDriverDayLineForCall({
        ...args,
        getField,
        listOrders: async input => (input.status === "collected" ? [collected] : []),
        listExternal: async () => [],
        getDay: async () =>
          ({
            processingLocation: null,
            commitments: [deposit, designated],
            dismissedPromptKeys: [],
            intelligenceAvailable: false,
          }) as never,
        getPlan: async () => null,
        listSales: async () => [],
        readOpenChannel: async () => draftBriefing,
      });
    const spoken: Record<string, string> = {};
    const readDayDirector = vi.fn<typeof getDayDirectorState>(async () => ({
      processingLocation: null,
      commitments: [],
      dismissedPromptKeys: [],
      intelligenceAvailable: false,
    }));
    for (const [purpose, now] of [
      ["morning_readiness", morningNow],
      ["evening_debrief", eveningNow],
    ] as const) {
      const briefing = await buildShowrunnerBriefing({
        identity,
        purpose,
        timeZone: "America/Los_Angeles",
        now,
        loadDriverDayLine,
        getDay: readDayDirector,
      });
      expect(briefing.businessDate).toBe("2026-10-16");
      expect(briefing.driverDayLine?.read).toBe("read");
      expect(briefing.driverDayLine?.stops.map(stop => stop.title)).toEqual(
        expect.arrayContaining(["Call Harbor Laundry", "Win the harbor", "Return the towels", "Greystar walk"])
      );
      expect(getField).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: "tenant-a",
          userId: "adam",
          includeAllAssignees: true,
          businessDate: "2026-10-16",
          timeZone: "America/Los_Angeles",
        })
      );
      const opening = showrunnerOpening(briefing);
      spoken[purpose] = opening;
      expect(opening).toContain("Call Harbor Laundry");
      expect(opening).toContain("Today's mission");
      expect(opening).toContain("Win the harbor");
      expect(opening).toContain("Done and verified:");
      expect(opening).toContain("Return the towels");
      expect(opening).toContain("Marked done, not yet verified: Fold the napkins.");
      expect(opening).toContain("Blocked or deferred:");
      expect(opening).toContain("Greystar walk");
      expect(opening).toContain("Payment blocks Carol's delivery");
      expect(opening).toContain("Waiting on your approval:");
      expect(opening).toContain("Recovery · Ada");
      let prompt = "";
      await runShowrunnerTurn({
        state: {
          purpose,
          tenantId: identity.tenantId,
          canonicalOperatorId: identity.canonicalOperatorId,
          operatorUserId: identity.canonicalOpenId,
          dayDirectorActorId: identity.dayDirectorActorId,
          dayDirectorActorIds: identity.dayDirectorActorIds,
          timeZone: "America/Los_Angeles",
          businessDate: briefing.businessDate,
          briefing,
          captured: { missionUpdates: [], developments: [], readinessNeeds: [] },
          replan: null,
          turns: 0,
        },
        history: [{ speaker: "claire", text: opening }],
        utterance: purpose === "morning_readiness" ? "What's still unfinished?" : "What actually got done?",
        sourceEventId: `sim-${purpose}`,
        conversationKey: `sim-${purpose}`,
        now,
        record: async () => undefined,
        invoke: (async (request: { messages: Array<{ content: string }> }) => {
          prompt = request.messages.map(message => message.content).join("\n");
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    speak: "Call Harbor Laundry is still unfinished.",
                    operatorIsDone: false,
                    missionUpdates: [],
                    developments: [],
                    readinessNeeds: [],
                    planEdits: [],
                  }),
                },
              },
            ],
          };
        }) as never,
      });
      expect(prompt).toContain("Call Harbor Laundry");
      expect(prompt).toContain("completed_with_evidence");
      expect(prompt).toContain("driverDayLine");
    }
    expect(spoken.morning_readiness).toMatch(/^Good morning, it's Claire\./);
    expect(spoken.morning_readiness).toMatch(/Are you ready to get going\?$/);
    expect(spoken.evening_debrief).toMatch(/^Hi, it's Claire for today's wrap\./);
    expect(spoken.evening_debrief).toMatch(/How did it go\?$/);
    expect(getField).toHaveBeenCalledTimes(2);
    expect(readDayDirector).toHaveBeenCalledTimes(4);
    expect(readDayDirector).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a", businessDate: "2026-10-16" })
    );
    expect(readDayDirector).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a", businessDate: "2026-10-17" })
    );
  });

  it("the scheduled call passes that opening into the dialer", () => {
    const source = readFileSync(
      new URL("../../agents/persistentOperator/operatorAppointmentExecution.ts", import.meta.url),
      "utf8"
    );
    expect(source).toContain("const briefing = await buildShowrunnerBriefing(");
    expect(source).toContain("composeShowrunnerOpening(briefing, { tone: daphneDecision?.tone ?? null })");
    expect(source).toContain("briefing.openingAskedCarried = opening.askedCarried;");
    expect(source).toContain("openingOverride: opening.text");
    expect(source).toContain("briefing,");
  });
});
