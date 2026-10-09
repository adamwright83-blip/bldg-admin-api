import { existsSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./permissions";

const dbMocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  createOrReuseResidentLaundryOrder: vi.fn(),
  getOrderById: vi.fn(),
  updateOrderStatus: vi.fn(),
  createResidentAgentPlan: vi.fn(),
  getResidentAgentPlan: vi.fn(),
  updateResidentAgentPlan: vi.fn(),
  createResidentCoordinatedRequest: vi.fn(),
}));

const opsTaskMocks = vi.hoisted(() => ({
  createOpsTask: vi.fn(),
}));

vi.mock("../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db")>()),
  ...dbMocks,
}));

vi.mock("../domains/orders/orderLifecycleService", async importOriginal => ({
  ...(await importOriginal<typeof import("../domains/orders/orderLifecycleService")>()),
  createOrReuseResidentOrder: dbMocks.createOrReuseResidentLaundryOrder,
}));

vi.mock("../opsTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../opsTasks")>()),
  ...opsTaskMocks,
}));

import { assertToolPermission } from "./permissions";
import { s2sAgentToolAllowlist } from "./s2sEndpoint";
import { createLaundryOrderTool } from "./tools/createLaundryOrderTool";
import { createResidentAgentPlanTool } from "./tools/createResidentAgentPlanTool";
import { updateResidentAgentPlanTool } from "./tools/updateResidentAgentPlanTool";
import { createResidentCoordinatedRequestTool } from "./tools/createResidentCoordinatedRequestTool";
import { createOrderFollowupTaskTool } from "./tools/createOrderFollowupTaskTool";
import { cancelResidentOrderTool } from "./tools/cancelResidentOrderTool";

const residentCtx: AgentContext = {
  tenantId: "default",
  agentType: "resident_agent",
  actorType: "resident_chat",
  actorId: "bldg_user:42",
  sessionId: "sess_123",
  conversationId: "conv_123",
};

describe("resident-safe agent tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    opsTaskMocks.createOpsTask.mockResolvedValue({
      id: 88,
      title: "task",
      status: "open",
      priority: "high",
    });
    dbMocks.createOrReuseResidentLaundryOrder.mockResolvedValue({
      orderId: 172,
      reused: false,
    });
  });

  it("allows resident_agent to run the resident-safe plan and coordinated request tools", () => {
    expect(() => assertToolPermission(residentCtx, "createResidentAgentPlanTool")).not.toThrow();
    expect(() => assertToolPermission(residentCtx, "updateResidentAgentPlanTool")).not.toThrow();
    expect(() => assertToolPermission(residentCtx, "createResidentCoordinatedRequestTool")).not.toThrow();
    expect(() => assertToolPermission(residentCtx, "createOrderFollowupTaskTool")).not.toThrow();
    expect(() => assertToolPermission(residentCtx, "cancelResidentOrderTool")).not.toThrow();
    expect(() => assertToolPermission(residentCtx, "createLaundryOrderTool")).not.toThrow();
  });

  it("does not allow resident_agent to run unsafe vendor/admin tools", () => {
    expect(() => assertToolPermission(residentCtx, "searchNetworkVendorsTool")).toThrow(
      "resident_agent is not allowed"
    );
    expect(() => assertToolPermission(residentCtx, "requestVendorBookingConfirmationTool")).toThrow(
      "resident_agent is not allowed"
    );
    expect(() => assertToolPermission(residentCtx, "createVendorPeerServiceRequestTool")).toThrow(
      "resident_agent is not allowed"
    );
  });

  it("S2S allowlist permits the resident-safe tools", () => {
    expect(s2sAgentToolAllowlist.has("createResidentAgentPlanTool")).toBe(true);
    expect(s2sAgentToolAllowlist.has("updateResidentAgentPlanTool")).toBe(true);
    expect(s2sAgentToolAllowlist.has("createResidentCoordinatedRequestTool")).toBe(true);
    expect(s2sAgentToolAllowlist.has("createOrderFollowupTaskTool")).toBe(true);
    expect(s2sAgentToolAllowlist.has("cancelResidentOrderTool")).toBe(true);
  });

  it("S2S allowlist keeps unsafe confirmation tools unavailable to resident orchestration", () => {
    expect(s2sAgentToolAllowlist.has("requestVendorBookingConfirmationTool")).toBe(false);
  });

  it("creates a parent plan with original message and planJson", async () => {
    dbMocks.createResidentAgentPlan.mockResolvedValue(901);

    const result = await createResidentAgentPlanTool.execute({
      bldgUserId: 42,
      residentName: "Ada Lovelace",
      buildingSlug: "opus-la",
      buildingName: "Opus LA",
      unit: "1201",
      originalMessage: "dog grooming, car detail, and laundry tomorrow",
      planJson: { items: ["dog_grooming", "car_detail", "laundry"] },
    }, residentCtx);

    expect(result.output).toMatchObject({
      planId: 901,
      planStatus: "pending_confirmation",
    });
    expect(dbMocks.createResidentAgentPlan).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "default",
      bldgUserId: 42,
      originalMessage: "dog grooming, car detail, and laundry tomorrow",
      planJson: { items: ["dog_grooming", "car_detail", "laundry"] },
      conversationId: "conv_123",
      sessionId: "sess_123",
    }));
  });

  it("updates a parent plan after child tool executions", async () => {
    dbMocks.getResidentAgentPlan.mockResolvedValue({
      id: 901,
      tenantId: "default",
      bldgUserId: 42,
      conversationId: "conv_123",
      sessionId: "sess_123",
      planStatus: "pending_confirmation",
      planJson: null,
    });

    const result = await updateResidentAgentPlanTool.execute({
      planId: "901",
      planStatus: "partially_confirmed",
      planJson: { items: [{ status: "confirmed" }, { status: "pending_operator_review" }] },
    }, residentCtx);

    expect(result.output).toEqual({
      planId: 901,
      planStatus: "partially_confirmed",
    });
    expect(dbMocks.updateResidentAgentPlan).toHaveBeenCalledWith("default", 901, {
      planStatus: "partially_confirmed",
      planJson: { items: [{ status: "confirmed" }, { status: "pending_operator_review" }] },
    });
  });

  it("creates durable coordinated requests without charging or confirming", async () => {
    dbMocks.createResidentCoordinatedRequest.mockResolvedValue(701);
    dbMocks.getResidentAgentPlan.mockResolvedValue({
      id: 901,
      tenantId: "default",
      bldgUserId: 42,
      conversationId: "conv_123",
      sessionId: "sess_123",
      planStatus: "pending_confirmation",
      planJson: null,
    });

    const result = await createResidentCoordinatedRequestTool.execute({
      bldgUserId: 42,
      residentName: "Ada Lovelace",
      residentPhone: "+13235550123",
      buildingSlug: "opus-la",
      buildingName: "Opus LA",
      unit: "1201",
      serviceCategory: "dog_grooming",
      serviceRequested: "Dog groomer before guest visit",
      deadlineDate: "2026-05-18",
      deadlineReason: "mother-in-law visit",
      parentPlanId: "901",
    }, residentCtx);

    expect(result.output).toMatchObject({
      requestId: 701,
      parentPlanId: 901,
      status: "pending_operator_review",
      residentVisibleStatus: "pending_operator_review",
      requiresProviderConfirmation: true,
      customerCharged: false,
    });
    expect(dbMocks.createResidentCoordinatedRequest).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "default",
      serviceCategory: "dog_grooming",
      deadlineDate: "2026-05-18",
      deadlineReason: "mother-in-law visit",
      customerCharged: false,
      requiresHumanApproval: true,
      parentPlanId: 901,
    }));
  });

  it("stores airport transport origin/destination and keeps it pending", async () => {
    dbMocks.createResidentCoordinatedRequest.mockResolvedValue(702);

    const result = await createResidentCoordinatedRequestTool.execute({
      serviceCategory: "airport_transport",
      serviceRequested: "Airport pickup",
      origin: "LAX",
      destination: "Opus LA",
    }, residentCtx);

    expect(result.output.status).toBe("pending_operator_review");
    expect(result.output.customerCharged).toBe(false);
    expect(dbMocks.createResidentCoordinatedRequest).toHaveBeenCalledWith(expect.objectContaining({
      serviceCategory: "airport_transport",
      origin: "LAX",
      destination: "Opus LA",
    }));
  });

  it("stores car detail requested window", async () => {
    dbMocks.createResidentCoordinatedRequest.mockResolvedValue(703);

    await createResidentCoordinatedRequestTool.execute({
      serviceCategory: "car_detail",
      serviceRequested: "Car detail",
      requestedDate: "2026-05-18",
      requestedWindow: "morning",
    }, residentCtx);

    expect(dbMocks.createResidentCoordinatedRequest).toHaveBeenCalledWith(expect.objectContaining({
      serviceCategory: "car_detail",
      requestedDate: "2026-05-18",
      requestedWindow: "morning",
    }));
  });

  it("routes dry cleaning as a coordinated request, not a fake confirmed booking", async () => {
    dbMocks.createResidentCoordinatedRequest.mockResolvedValue(704);

    const result = await createResidentCoordinatedRequestTool.execute({
      serviceCategory: "dry_cleaning",
      serviceRequested: "Dry clean a suit",
    }, residentCtx);

    expect(result.output).toMatchObject({
      serviceCategory: "dry_cleaning",
      status: "pending_operator_review",
      customerCharged: false,
    });
    expect(result.output.status).not.toBe("confirmed");
    expect(dbMocks.createOrder).not.toHaveBeenCalled();
  });

  it("keeps createLaundryOrderTool registered as the direct laundry path", () => {
    expect(createLaundryOrderTool.name).toBe("createLaundryOrderTool");
    expect(createLaundryOrderTool.description).toContain("existing order creation helper");
  });

  it("binds resident laundry creation to authenticated resident identity", async () => {
    const result = await createLaundryOrderTool.execute(
      {
        bldgUserId: 42,
        clientRequestId: "resident-42-request-1",
        serviceType: "wash_fold",
        pickupDate: "2026-10-06",
        pickupTimeWindow: "9-11 AM",
        address: "100 Main St",
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "+13235550123",
      },
      residentCtx
    );

    expect(result.output).toEqual({ orderId: 172, reused: false });
    expect(dbMocks.createOrReuseResidentLaundryOrder).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "default", bldgUserId: 42 }),
      { clientRequestId: "resident-42-request-1" }
    );

    dbMocks.createOrReuseResidentLaundryOrder.mockClear();
    await expect(
      createLaundryOrderTool.execute(
        {
          bldgUserId: 99,
          pickupDate: "2026-10-06",
          pickupTimeWindow: "9-11 AM",
          address: "100 Main St",
          firstName: "Ada",
          lastName: "Lovelace",
          phone: "+13235550123",
        },
        residentCtx
      )
    ).rejects.toThrow("Resident actor identity does not match resident authority");
    expect(dbMocks.createOrReuseResidentLaundryOrder).not.toHaveBeenCalled();
  });

  it("rejects forged resident plan lineage at creation", async () => {
    await expect(
      createResidentAgentPlanTool.execute(
        {
          bldgUserId: 42,
          sourceConversationId: "other-conversation",
          originalMessage: "book services",
        },
        residentCtx
      )
    ).rejects.toThrow("conversationId does not match authenticated context");

    expect(dbMocks.createResidentAgentPlan).not.toHaveBeenCalled();
  });

  it("rejects resident follow-up tasks for foreign orders", async () => {
    dbMocks.getOrderById.mockResolvedValue({
      id: 180,
      tenantId: "default",
      bldgUserId: 99,
      status: "new",
    });

    await expect(
      createOrderFollowupTaskTool.execute(
        {
          orderId: 180,
          followupType: "cancel_request",
          requestText: "cancel it",
          bldgUserId: 42,
        },
        residentCtx
      )
    ).rejects.toThrow("Order does not belong to resident");

    dbMocks.getOrderById.mockResolvedValue({
      id: 181,
      tenantId: "other-tenant",
      bldgUserId: 42,
      status: "new",
    });

    await expect(
      createOrderFollowupTaskTool.execute(
        {
          orderId: 181,
          followupType: "return_by_time",
          requestText: "return at 5",
          bldgUserId: 42,
        },
        residentCtx
      )
    ).rejects.toThrow("Order does not belong to tenant");

    dbMocks.getOrderById.mockResolvedValue({
      id: 182,
      tenantId: null,
      bldgUserId: 42,
      status: "new",
    });

    await expect(
      createOrderFollowupTaskTool.execute(
        {
          orderId: 182,
          followupType: "return_by_time",
          requestText: "return at 6",
          bldgUserId: 42,
        },
        residentCtx
      )
    ).rejects.toThrow("Order does not belong to tenant");

    expect(opsTaskMocks.createOpsTask).not.toHaveBeenCalled();
  });

  it("rejects coordinated requests linked to another resident's parent plan", async () => {
    dbMocks.getResidentAgentPlan.mockResolvedValue({
      id: 903,
      tenantId: "default",
      bldgUserId: 99,
      conversationId: "conv_other",
      sessionId: "sess_other",
      planStatus: "pending_confirmation",
      planJson: null,
    });

    await expect(
      createResidentCoordinatedRequestTool.execute(
        {
          bldgUserId: 42,
          parentPlanId: 903,
          serviceCategory: "dog_grooming",
          serviceRequested: "Dog groomer",
        },
        residentCtx
      )
    ).rejects.toThrow("Resident agent plan does not belong to resident");

    expect(dbMocks.createResidentCoordinatedRequest).not.toHaveBeenCalled();
  });

  it("creates resident follow-up ops tasks for existing orders", async () => {
    dbMocks.getOrderById.mockResolvedValue({
      id: 172,
      tenantId: "default",
      bldgUserId: 42,
      status: "new",
    });

    const result = await createOrderFollowupTaskTool.execute({
      orderId: 172,
      followupType: "return_by_time",
      requestText: "deliver at 5pm",
      requestedWindow: "5pm",
      bldgUserId: 42,
    }, residentCtx);

    expect(result.output).toMatchObject({ orderId: 172, status: "open" });
  });

  it("cancels resident orders directly without vendor permission", async () => {
    dbMocks.getOrderById.mockResolvedValue({ id: 172, tenantId: "default", bldgUserId: 42, status: "new" });

    const result = await cancelResidentOrderTool.execute({ orderId: 172, bldgUserId: 42 }, residentCtx);

    expect(dbMocks.updateOrderStatus).toHaveBeenCalledWith(
      172,
      "cancelled",
      expect.objectContaining({
        actorUserId: "bldg_user:42",
        actorDisplayName: "resident_chat",
      }),
      expect.objectContaining({
        expectedTenantId: "default",
      })
    );
    expect(result.output).toMatchObject({ orderCancelled: true, orderId: 172, status: "cancelled" });
  });

  it("rejects resident cancellation across tenant or resident authority boundaries", async () => {
    dbMocks.getOrderById.mockResolvedValue({
      id: 172,
      tenantId: "other-tenant",
      bldgUserId: 42,
      status: "new",
    });
    await expect(
      cancelResidentOrderTool.execute({ orderId: 172, bldgUserId: 42 }, residentCtx)
    ).rejects.toThrow("Order does not belong to tenant");

    dbMocks.getOrderById.mockResolvedValue({
      id: 173,
      tenantId: "default",
      bldgUserId: 99,
      status: "new",
    });
    await expect(
      cancelResidentOrderTool.execute({ orderId: 173, bldgUserId: 42 }, residentCtx)
    ).rejects.toThrow("Order does not belong to resident");

    await expect(
      cancelResidentOrderTool.execute(
        { orderId: 174, bldgUserId: 42 },
        { ...residentCtx, actorId: "bldg_user:99" }
      )
    ).rejects.toThrow("Resident actor identity does not match cancellation authority");

    await expect(
      cancelResidentOrderTool.execute(
        { orderId: 174 },
        { ...residentCtx, actorId: "bldg_user:42" }
      )
    ).rejects.toThrow("requires the resident owner id");

    await expect(
      cancelResidentOrderTool.execute(
        { orderId: 174, bldgUserId: 42 },
        { ...residentCtx, actorType: "human" }
      )
    ).rejects.toThrow("requires the resident action authority");

    expect(dbMocks.updateOrderStatus).not.toHaveBeenCalled();
  });

  it("includes a real migration for the new resident tables", () => {
    const migrationPath = join(process.cwd(), "drizzle", "0030_resident_agent_plans.sql");
    expect(existsSync(migrationPath)).toBe(true);
  });
});
