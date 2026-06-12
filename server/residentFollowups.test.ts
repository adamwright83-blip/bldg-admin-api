import { describe, expect, it } from "vitest";
import {
  buildOrderPatchFromReply,
  buildResidentReplyPayload,
  buildResidentReplySms,
  mapOpsTaskToResidentFollowup,
  normalizeWindowLabel,
} from "./residentFollowups";

// Shape produced by createOrderFollowupTaskTool for the live 5pm ask.
const LIVE_TASK = {
  id: 41,
  taskType: "vendor_followup" as const,
  status: "open" as const,
  orderId: 175,
  createdAt: new Date("2026-06-12T05:30:00Z"),
  metadataJson: {
    source: "resident_post_order_followup",
    followupType: "return_by_time",
    requestText: "i need my laundry delivered at 5pm though. 7pm is too late.",
    requestedWindow: "5pm",
    deadline: null,
    residentName: "John Stockton",
    residentPhone: "+13105550188",
    bldgUserId: 188,
    clientRequestId: "auto_188_20260612_2968740_laundry",
    orderId: 175,
  },
};

describe("mapOpsTaskToResidentFollowup", () => {
  it("maps a resident follow-up task to the banner item", () => {
    const item = mapOpsTaskToResidentFollowup(LIVE_TASK as never);
    expect(item).not.toBeNull();
    expect(item!.taskId).toBe(41);
    expect(item!.orderId).toBe(175);
    expect(item!.followupType).toBe("return_by_time");
    expect(item!.requestText).toContain("5pm");
    expect(item!.phone).toBe("+13105550188");
    expect(item!.bldgUserId).toBe(188);
  });

  it("ignores non-resident vendor_followup tasks and other task types", () => {
    expect(
      mapOpsTaskToResidentFollowup({ ...LIVE_TASK, metadataJson: { source: "other" } } as never),
    ).toBeNull();
    expect(
      mapOpsTaskToResidentFollowup({ ...LIVE_TASK, taskType: "unpaid_order" } as never),
    ).toBeNull();
  });
});

describe("buildOrderPatchFromReply — only APPROVE revises the real order", () => {
  it("approved return-by → deliveryTimeWindow patch with normalized label", () => {
    expect(buildOrderPatchFromReply("return_by_time", "approved", "5pm")).toEqual({
      deliveryTimeWindow: "by 5pm",
    });
  });

  it("approved pickup change → pickupTimeWindow patch", () => {
    expect(buildOrderPatchFromReply("pickup_time_change", "approved", "8am")).toEqual({
      pickupTimeWindow: "by 8am",
    });
  });

  it("declined never patches", () => {
    expect(buildOrderPatchFromReply("return_by_time", "declined", "5pm")).toBeNull();
  });

  it("plain reply (no decision) never patches", () => {
    expect(buildOrderPatchFromReply("return_by_time", undefined, "5pm")).toBeNull();
  });

  it("approve without a time never patches (nothing to apply)", () => {
    expect(buildOrderPatchFromReply("return_by_time", "approved", "")).toBeNull();
  });

  it("already-labelled values pass through", () => {
    expect(normalizeWindowLabel("before 4:30pm")).toBe("before 4:30pm");
    expect(normalizeWindowLabel("5pm")).toBe("by 5pm");
  });
});

describe("buildResidentReplyPayload — drives the returning courier", () => {
  it("carries identity, decision, and the applied windows", () => {
    const item = mapOpsTaskToResidentFollowup(LIVE_TASK as never)!;
    const patch = buildOrderPatchFromReply("return_by_time", "approved", "5pm");
    const payload = buildResidentReplyPayload(item, { message: "Yes — 5pm works.", decision: "approved", newTime: "5pm" }, patch);
    expect(payload.bldgUserId).toBe(188);
    expect(payload.orderId).toBe(175);
    expect(payload.operatorTaskId).toBe("41");
    expect(payload.decision).toBe("approved");
    expect(payload.newDeliveryTimeWindow).toBe("by 5pm");
    expect(payload.newPickupTimeWindow).toBeNull();
    expect(payload.message).toBe("Yes — 5pm works.");
  });
});

describe("buildResidentReplySms", () => {
  it("is short, quotes the operator, and links the app", () => {
    const item = mapOpsTaskToResidentFollowup(LIVE_TASK as never)!;
    const sms = buildResidentReplySms(item, "Yes — 5pm works.");
    expect(sms).toContain("LAUNDRY BUTLER replied");
    expect(sms).toContain("5pm works");
    expect(sms).toContain("app.bldg.chat");
  });
});
