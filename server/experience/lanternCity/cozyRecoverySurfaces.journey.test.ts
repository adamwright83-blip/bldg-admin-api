import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCozyRecoverySurfaces } from "./cozyRecoverySurfaces";
import {
  _resetScheduledOutreachMemoryStore,
  createScheduledOutreachDraft,
  listScheduledOutreachMessages,
  sendEarlyOutreachDraft,
} from "./scheduledOutreachService";

vi.mock("../../strategy/personalOutreachWrite", async () => {
  const actual = await vi.importActual<typeof import("../../strategy/personalOutreachWrite")>(
    "../../strategy/personalOutreachWrite"
  );
  return {
    ...actual,
    readPersonalOutreachRoster: vi.fn(async () => ({
      area: "Silver Lake",
      freshness: "current",
      lapsedCount: 2,
      emptyMeansNoLapsedCustomers: false,
      withheldReason: null,
      contacts: [
        {
          identityId: "cust_stable_1",
          name: "Mei Lin",
          phone: "+12135550141",
          daysSinceLastOrder: 34,
          paidOrders: 14,
          lifetimeCents: 62400,
          lastOrderDate: "2026-09-10",
          lastOrderSummary: "Wash & Fold 32 lbs",
          smsConsent: "unknown" as const,
          blocks: [],
        },
        {
          identityId: "cust_stable_2",
          name: "Barnaby Hayes",
          phone: "+12135550142",
          daysSinceLastOrder: 48,
          paidOrders: 8,
          lifetimeCents: 38200,
          lastOrderDate: "2026-08-27",
          lastOrderSummary: "Standard Wash & Fold",
          smsConsent: "unknown" as const,
          blocks: [],
        },
      ],
    })),
  };
});

vi.mock("../../strategy/winBackDossier", () => ({
  readWinBackDossier: vi.fn(async () => ({
    area: "Silver Lake",
    lapsedCount: 2,
    contacts: [
      {
        identityId: "cust_stable_1",
        name: "Mei Lin",
        phone: "+12135550141",
        daysSinceLastOrder: 34,
        paidOrders: 14,
        lifetimeCents: 62400,
        lastOrderDate: "2026-09-10",
        lastOrderSummary: "Wash & Fold 32 lbs",
      },
      {
        identityId: "cust_stable_2",
        name: "Barnaby Hayes",
        phone: "+12135550142",
        daysSinceLastOrder: 48,
        paidOrders: 8,
        lifetimeCents: 38200,
        lastOrderDate: "2026-08-27",
        lastOrderSummary: "Standard Wash & Fold",
      },
    ],
  })),
}));

vi.mock("../../strategy/strategicEvidenceReaders", () => ({
  readObjectiveArea: vi.fn(async () => ({
    goal: {
      g: {
        id: "goal_silver_lake_recovery",
        statement: "Recover dormant laundry customers in Silver Lake",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
      scope: null,
    },
    label: "Silver Lake",
    filters: { addressAny: ["Silver Lake"], addressLabel: "in Silver Lake" },
  })),
}));

const TENANT = "tenant_journey";
const OPERATOR = "op_journey";

describe("cozy recovery surfaces journey", () => {
  beforeEach(() => {
    _resetScheduledOutreachMemoryStore();
  });

  it("keeps one customer id from the village through a simulated send, the outbox, and the Day Line card", async () => {
    const opened = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
      now: new Date("2026-10-15T18:00:00.000Z"),
    });
    expect(opened.mission.targets.map(target => target.customerId)).toEqual([
      "cust_stable_1",
      "cust_stable_2",
    ]);
    expect(opened.mission.targets.every(target => target.communicationState === "draft_prepared")).toBe(true);
    expect(opened.mission.targets.every(target => target.pose === "idle")).toBe(true);
    expect(opened.dayLineCard?.objectiveId).toBe("goal_silver_lake_recovery");
    expect(opened.dayLineCard?.objectiveComplete).toBe(false);
    expect(opened.dayLineCard?.customerId).toBe("cust_stable_1");
    expect(opened.mission.world.worldEventAppended).toBe(false);

    const draft = await createScheduledOutreachDraft({
      tenantId: TENANT,
      operatorId: OPERATOR,
      customerId: "cust_stable_1",
      customerName: "Mei Lin",
      recipientPhone: "+12135550141",
      originalSuggestedDraft: opened.mission.targets[0]!.suggestedMessage,
      messageBody: "Hey Mei, this is the edited draft.",
      scheduledFor: "2026-10-16T17:00:00.000Z",
      timezone: "America/Los_Angeles",
      slotId: "slot_04",
      territoryId: "silver-lake",
      now: new Date("2026-10-15T18:00:00.000Z"),
    });

    const scheduled = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
      now: new Date("2026-10-15T18:05:00.000Z"),
    });
    const scheduledMei = scheduled.mission.targets.find(target => target.customerId === "cust_stable_1")!;
    expect(scheduledMei.slotId).toBe("slot_04");
    expect(scheduledMei.communicationState).toBe("scheduled");
    expect(scheduledMei.pose).toBe("wave");
    expect(scheduledMei.preparedMessage).toBe("Hey Mei, this is the edited draft.");
    expect(scheduledMei.outreachActionComplete).toBe(false);
    expect(scheduled.dayLineCard?.objectiveId).toBe("goal_silver_lake_recovery");
    expect(scheduled.dayLineCard?.messageId).toBe(draft.id);
    expect(scheduled.dayLineCard?.objectiveComplete).toBe(false);

    const sent = await sendEarlyOutreachDraft({
      tenantId: TENANT,
      operatorId: OPERATOR,
      messageId: draft.id,
      leaseHolder: `operator_${OPERATOR}`,
      now: new Date("2026-10-15T18:10:00.000Z"),
      testSenderAdapter: {
        send: async () => ({
          externalMessageId: "simulated:android_msg_1",
          evidenceName: "simulated_personal_android_dispatch",
        }),
      },
    });
    expect(sent.status).toBe("dispatched");
    expect(sent.evidenceName).toBe("simulated_personal_android_dispatch");

    const after = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
      now: new Date("2026-10-15T18:11:00.000Z"),
    });
    const sentMei = after.mission.targets.find(target => target.customerId === "cust_stable_1")!;
    const waiting = after.mission.targets.find(target => target.customerId === "cust_stable_2")!;
    expect(sentMei.communicationState).toBe("send_observed");
    expect(sentMei.pose).toBe("acknowledged");
    expect(sentMei.transport).toBe("simulated");
    expect(sentMei.paidOrder.status).toBe("unavailable");
    expect(sentMei.reply.status).toBe("unavailable");
    expect(sentMei.outreachActionComplete).toBe(true);
    expect(sentMei.objectiveComplete).toBe(false);
    expect(waiting.communicationState).toBe("draft_prepared");
    expect(waiting.pose).toBe("idle");
    expect(after.dayLineCard?.objectiveId).toBe("goal_silver_lake_recovery");
    expect(after.dayLineCard?.customerId).toBe("cust_stable_2");
    expect(after.dayLineCard?.messageBody).toBe(waiting.suggestedMessage);
    expect(after.dayLineCard?.objectiveComplete).toBe(false);
    expect(after.dayLineCard?.outreachActionComplete).toBe(false);
    expect(after.mission.world.recoveryState).toBe("none");

    const admin = await listScheduledOutreachMessages({ tenantId: TENANT, operatorId: OPERATOR });
    expect(admin).toHaveLength(1);
    expect(admin[0]!.id).toBe(draft.id);
    expect(admin[0]!.customerId).toBe("cust_stable_1");
    expect(admin[0]!.status).toBe("dispatched");
    expect(admin[0]!.externalMessageId).toBe("simulated:android_msg_1");
    expect(admin[0]!.currentMessageBody).toBe(sentMei.preparedMessage);

    const reloaded = await loadCozyRecoverySurfaces({
      tenantId: TENANT,
      canonicalOperatorId: OPERATOR,
      territoryId: "silver-lake",
      now: new Date("2026-10-15T20:00:00.000Z"),
    });
    expect(reloaded.dayLineCard?.objectiveId).toBe(after.dayLineCard?.objectiveId);
    expect(reloaded.mission.targets.find(target => target.customerId === "cust_stable_1")?.pose).toBe(
      "acknowledged"
    );
    expect(reloaded.mission.targets.filter(target => target.customerId === "cust_stable_1")).toHaveLength(1);
  });
});
