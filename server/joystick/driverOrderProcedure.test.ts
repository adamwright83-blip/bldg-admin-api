/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import type { User } from "../../drizzle/schema";

const access = vi.hoisted(() => ({
  resolveMembership: vi.fn(),
}));

const memory = vi.hoisted(() => ({
  role: "field" as string,
  orders: [] as Array<{
    id: number;
    tenantId: string | null;
    status: string;
    paid: boolean;
    pickupDate: string;
    deliveryDate: string | null;
    phone: string;
  }>,
  transitions: [] as Array<{ tenantId: string; orderId: number; to: string }>,
  listedTenants: [] as string[],
}));

const effects = vi.hoisted(() => ({
  collected: vi.fn(async () => undefined),
  delivered: vi.fn(async () => undefined),
}));

vi.mock("../saas/tenantAccess", async importOriginal => {
  const actual = await importOriginal<typeof import("../saas/tenantAccess")>();
  return {
    ...actual,
    resolveLegacyDayforgeMembership: access.resolveMembership,
  };
});

vi.mock("../_core/sdk", () => ({
  sdk: {
    authenticateRequest: vi.fn(),
  },
}));

vi.mock("./driverOrderEffects", () => ({
  recordDriverOrderCollected: effects.collected,
  recordDriverOrderDelivered: effects.delivered,
}));

vi.mock("./driverOrderStore", () => ({
  listDriverOrdersByStatus: vi.fn(async (input: { tenantId: string }) => {
    memory.listedTenants.push(input.tenantId);
    return memory.orders.slice();
  }),
  listDriverOrdersByDate: vi.fn(async (input: { tenantId: string }) => {
    memory.listedTenants.push(input.tenantId);
    return memory.orders.slice();
  }),
  getDriverOrderForTenant: vi.fn(async (input: { orderId: number }) => {
    return memory.orders.find(order => order.id === input.orderId) ?? null;
  }),
  transitionDriverOrder: vi.fn(
    async (input: {
      tenantId: string;
      orderId: number;
      from?: string[];
      to: string;
    }) => {
      memory.transitions.push({
        tenantId: input.tenantId,
        orderId: input.orderId,
        to: input.to,
      });
      const order = memory.orders.find(row => row.id === input.orderId);
      if (!order) return { changed: false };
      if (input.from && !input.from.includes(order.status)) return { changed: false };
      order.status = input.to;
      return { changed: true };
    }
  ),
}));

import { createContext } from "../_core/context";
import { sdk } from "../_core/sdk";
import { appRouter } from "../routers";
import { driverOrderRouter } from "./driverOrderRouter";
import { transitionDriverOrder } from "./driverOrderStore";
import { orderVisibleToTenant } from "./driverOrderTenant";

function memberUser(overrides: Partial<User> = {}): User {
  return {
    id: 7,
    tenantId: "tenant-a",
    openId: "dayforge:member-a",
    name: "Ada Field",
    email: "ada@tenant-a.example",
    loginMethod: "dayforge_password",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
}

function callerContext(overrides: {
  user?: User | null;
  tenantId?: string;
  vendor?: boolean;
} = {}): TrpcContext {
  return {
    req: undefined as never,
    res: undefined as never,
    vendorSession: overrides.vendor ? ({ vendorId: 4 } as never) : null,
    tenantId: overrides.tenantId ?? "tenant-a",
    user: overrides.user === undefined ? memberUser() : overrides.user,
  };
}

function seedOrders() {
  memory.orders.push(
    {
      id: 11,
      tenantId: "tenant-a",
      status: "new",
      paid: false,
      pickupDate: "2026-09-23",
      deliveryDate: "2026-09-24",
      phone: "3105550101",
    },
    {
      id: 12,
      tenantId: "tenant-b",
      status: "new",
      paid: true,
      pickupDate: "2026-09-23",
      deliveryDate: "2026-09-24",
      phone: "3105550102",
    },
    {
      id: 13,
      tenantId: "tenant-a",
      status: "new",
      paid: false,
      pickupDate: "2026-09-24",
      deliveryDate: null,
      phone: "3105550103",
    },
    {
      id: 14,
      tenantId: "tenant-a",
      status: "ready",
      paid: true,
      pickupDate: "2026-09-22",
      deliveryDate: "2026-09-23",
      phone: "3105550104",
    },
    {
      id: 15,
      tenantId: null,
      status: "new",
      paid: false,
      pickupDate: "2026-09-23",
      deliveryDate: null,
      phone: "3105550105",
    },
    {
      id: 16,
      tenantId: "tenant-a",
      status: "ready",
      paid: false,
      pickupDate: "2026-09-22",
      deliveryDate: "2026-09-23",
      phone: "3105550106",
    },
    {
      id: 17,
      tenantId: "tenant-a",
      status: "cancelled",
      paid: false,
      pickupDate: "2026-09-23",
      deliveryDate: null,
      phone: "3105550107",
    }
  );
}

describe("driver order procedure", () => {
  beforeEach(() => {
    memory.role = "field";
    memory.orders.length = 0;
    memory.transitions.length = 0;
    memory.listedTenants.length = 0;
    effects.collected.mockClear();
    effects.delivered.mockClear();
    access.resolveMembership.mockImplementation(
      async ({ tenantId, userOpenId }: { tenantId: string; userOpenId: string }) => {
        if (userOpenId === "dayforge:member-a" && tenantId === "tenant-a") {
          return { tenantId, userOpenId, role: memory.role };
        }
        if (userOpenId === "dayforge:viewer") {
          return { tenantId, userOpenId, role: "viewer" };
        }
        if (userOpenId === "driver-primary") {
          return { tenantId, userOpenId, role: "field" };
        }
        return null;
      }
    );
    seedOrders();
  });

  it("treats a blank order tenant as the legacy default tenant only", () => {
    expect(orderVisibleToTenant({ tenantId: null }, "default")).toBe(true);
    expect(orderVisibleToTenant({ tenantId: "  " }, "default")).toBe(true);
    expect(orderVisibleToTenant({ tenantId: null }, "tenant-a")).toBe(false);
    expect(orderVisibleToTenant({ tenantId: "tenant-a" }, "tenant-b")).toBe(false);
  });

  it("lists and updates the signed-in tenant from the membership, not the request", async () => {
    const orders = driverOrderRouter.createCaller(callerContext());
    const sameDay = await orders.listByDate({
      date: "2026-09-23",
      status: "new",
      dateField: "pickupDate",
    });
    expect(sameDay.map(order => order.id)).toEqual([11]);
    expect(memory.listedTenants).toEqual(["tenant-a"]);

    const byStatus = await orders.listByStatus({ status: "new" });
    expect(byStatus.map(order => order.id).sort()).toEqual([11, 13]);

    const collected = await orders.updateStatus({ orderId: 11, status: "collected" });
    expect(collected).toEqual({ success: true, alreadyCompleted: false });
    expect(memory.transitions).toEqual([
      { tenantId: "tenant-a", orderId: 11, to: "collected" },
    ]);
    expect(effects.collected).toHaveBeenCalledTimes(1);
    expect(effects.collected).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a", actorUserId: 7 })
    );
    expect(effects.collected.mock.calls[0]?.[0].order.phone).toBe("3105550101");

    const replay = await orders.updateStatus({ orderId: 11, status: "collected" });
    expect(replay).toEqual({ success: true, alreadyCompleted: true });
    expect(memory.transitions).toHaveLength(1);
    expect(effects.collected).toHaveBeenCalledTimes(1);

    const delivered = await orders.updateStatus({ orderId: 14, status: "delivered" });
    expect(delivered).toEqual({ success: true });
    expect(effects.delivered).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-a" })
    );
    expect(memory.orders.find(order => order.id === 14)?.status).toBe("delivered");
    const deliveredAgain = await orders.updateStatus({
      orderId: 14,
      status: "delivered",
    });
    expect(deliveredAgain).toEqual({ success: true, alreadyCompleted: true });
    expect(effects.delivered).toHaveBeenCalledTimes(1);

    memory.orders.push({
      id: 18,
      tenantId: "tenant-a",
      status: "intake-pending",
      paid: false,
      pickupDate: "2026-09-23",
      deliveryDate: null,
      phone: "3105550108",
    });
    const intake = await orders.updateStatus({ orderId: 18, status: "collected" });
    expect(intake).toEqual({ success: true, alreadyCompleted: false });
    expect(memory.transitions.at(-1)).toEqual({
      tenantId: "tenant-a",
      orderId: 18,
      to: "collected",
    });
  });

  it("rejects a browser-supplied tenant and an unsupported status", async () => {
    const orders = driverOrderRouter.createCaller(callerContext());
    await expect(
      orders.listByStatus({ status: "new", tenantId: "tenant-b" } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      orders.updateStatus({ orderId: 12, status: "processing" } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      orders.updateStatus({ orderId: 0, status: "collected" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      orders.updateStatus({ orderId: 999, status: "collected" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(memory.transitions).toEqual([]);
    expect(memory.listedTenants).toEqual([]);
    expect(memory.orders.find(order => order.id === 12)?.status).toBe("new");
  });

  it("does not let tenant A read or update tenant B", async () => {
    const orders = driverOrderRouter.createCaller(callerContext());
    const listed = await orders.listByStatus({ status: "new" });
    expect(listed.map(order => order.id)).not.toContain(12);
    expect(listed.map(order => order.id)).not.toContain(15);

    await expect(
      orders.updateStatus({ orderId: 12, status: "collected" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      orders.updateStatus({ orderId: 12, status: "delivered" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(memory.orders.find(order => order.id === 12)?.status).toBe("new");
    expect(memory.transitions).toEqual([]);
    expect(effects.collected).not.toHaveBeenCalled();
    expect(effects.delivered).not.toHaveBeenCalled();
  });

  it("blocks delivery until the order is paid and blocks collecting a cancelled order", async () => {
    const orders = driverOrderRouter.createCaller(callerContext());
    await expect(
      orders.updateStatus({ orderId: 16, status: "delivered" })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Charge the order before marking it delivered.",
    });
    await expect(
      orders.updateStatus({ orderId: 17, status: "collected" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(memory.transitions).toEqual([]);
    expect(effects.delivered).not.toHaveBeenCalled();
    expect(effects.collected).not.toHaveBeenCalled();
  });

  it("refuses a missing session, a missing membership, and a non-field role", async () => {
    await expect(
      driverOrderRouter
        .createCaller(callerContext({ user: null }))
        .listByStatus({ status: "new" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      driverOrderRouter
        .createCaller(callerContext({ user: null, vendor: true }))
        .listByStatus({ status: "new" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      driverOrderRouter
        .createCaller(
          callerContext({
            user: memberUser({ openId: "route-driver", role: "driver" }),
          })
        )
        .listByStatus({ status: "new" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      driverOrderRouter
        .createCaller(
          callerContext({
            user: memberUser({ openId: "dayforge:viewer" }),
          })
        )
        .updateStatus({ orderId: 11, status: "collected" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.listedTenants).toEqual([]);
    expect(memory.transitions).toEqual([]);
  });

  it("does not let a field member use admin order routes or tenant admin routes", async () => {
    const ctx = callerContext();
    const admin = appRouter.createCaller(ctx);
    await expect(
      admin.admin.listByDate({
        date: "2026-09-23",
        status: "new",
        dateField: "pickupDate",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      admin.admin.listByStatus({ status: "new" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      admin.admin.updateStatus({ orderId: 11, status: "collected" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(admin.system.saas.members()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(admin.system.team.get()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(memory.orders.find(order => order.id === 11)?.status).toBe("new");
    expect(memory.transitions).toEqual([]);
  });

  it("does not let the shared driver password act for a SaaS tenant", async () => {
    const orders = driverOrderRouter.createCaller(
      callerContext({
        tenantId: "tenant-a",
        user: memberUser({
          openId: "driver-primary",
          role: "driver",
          tenantId: "tenant-victim",
        }),
      })
    );
    await expect(orders.listByStatus({ status: "new" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      orders.updateStatus({ orderId: 11, status: "collected" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.listedTenants).toEqual([]);
    expect(memory.transitions).toEqual([]);
    expect(effects.collected).not.toHaveBeenCalled();
  });

  it("does not report a pickup collected when the tenant write changes nothing", async () => {
    vi.mocked(transitionDriverOrder).mockResolvedValueOnce({ changed: false });
    await expect(
      driverOrderRouter.createCaller(callerContext()).updateStatus({
        orderId: 11,
        status: "collected",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(memory.orders.find(order => order.id === 11)?.status).toBe("new");
    expect(effects.collected).not.toHaveBeenCalled();
  });

  it("keeps a legacy shared-password driver on the legacy tenant's orders", async () => {
    const orders = driverOrderRouter.createCaller(
      callerContext({
        tenantId: "default",
        user: memberUser({
          id: 2,
          openId: "driver-primary",
          role: "driver",
          tenantId: "tenant-victim",
          name: "Driver",
        }),
      })
    );
    const listed = await orders.listByStatus({ status: "new" });
    expect(memory.listedTenants).toEqual(["default"]);
    expect(listed.map(order => order.id)).toEqual([15]);
    const collected = await orders.updateStatus({
      orderId: 15,
      status: "collected",
    });
    expect(collected.success).toBe(true);
    expect(memory.transitions).toEqual([
      { tenantId: "default", orderId: 15, to: "collected" },
    ]);
    await expect(
      orders.updateStatus({ orderId: 11, status: "delivered" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(memory.orders.find(order => order.id === 11)?.status).toBe("new");
  });

  it("rejects a membership row whose tenant does not match the session", async () => {
    access.resolveMembership.mockResolvedValueOnce({
      tenantId: "tenant-b",
      userOpenId: "dayforge:member-a",
      role: "field",
    });
    await expect(
      driverOrderRouter
        .createCaller(callerContext())
        .listByStatus({ status: "new" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(memory.listedTenants).toEqual([]);
  });

  it("resolves the same membership order list on Admin and Driver hosts", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue(memberUser() as never);
    const request = {
      headers: { host: "admin.bldg.chat", "x-tenant-id": "tenant-b" },
      protocol: "https",
    };
    const admin = await createContext({
      req: { ...request, headers: { ...request.headers, host: "admin.bldg.chat" } } as never,
      res: {} as never,
    });
    const driver = await createContext({
      req: {
        ...request,
        headers: { host: "driver.bldg.chat", "x-tenant-id": "tenant-victim" },
      } as never,
      res: {} as never,
    });
    expect(admin.tenantId).toBe("tenant-a");
    expect(driver.tenantId).toBe(admin.tenantId);
    expect(driver.user?.openId).toBe(admin.user?.openId);

    const adminOrders = await driverOrderRouter.createCaller(admin).listByStatus({
      status: "new",
    });
    const driverOrders = await driverOrderRouter.createCaller(driver).listByStatus({
      status: "new",
    });
    expect(driverOrders.map(order => order.id)).toEqual(adminOrders.map(order => order.id));
    expect(driverOrders.map(order => order.id).sort()).toEqual([11, 13]);
    expect(memory.listedTenants).toEqual(["tenant-a", "tenant-a"]);
  });

  it("keeps a poisoned shared-password session on the host legacy tenant", async () => {
    vi.mocked(sdk.authenticateRequest).mockResolvedValue(
      memberUser({
        id: 2,
        openId: "driver-primary",
        role: "driver",
        tenantId: "tenant-victim",
        name: "Driver",
      }) as never
    );
    const ctx = await createContext({
      req: {
        headers: {
          host: "driver.bldg.chat",
          "x-tenant-id": "tenant-victim",
        },
        protocol: "https",
      } as never,
      res: {} as never,
    });
    expect(ctx.tenantId).toBe("default");
    const listed = await driverOrderRouter.createCaller(ctx).listByStatus({
      status: "new",
    });
    expect(listed.map(order => order.id)).toEqual([15]);
    expect(memory.listedTenants).toEqual(["default"]);
  });
});
