import { describe, expect, it, vi, beforeEach } from "vitest";

const envState = { dayforgeDemoEnabled: true, dayforgeDemoTenantSlug: "sunset-laundry-demo" };
vi.mock("../_core/env", () => ({
  get ENV() {
    return envState;
  },
}));

const writeDayforgeEventWith = vi.fn(async () => ({ auditEventId: 1 }));
vi.mock("../dayforgeEvents/dayforgeEventStore", () => ({
  writeDayforgeEventWith: (...args: unknown[]) => writeDayforgeEventWith(...args),
}));

const eqSpy = vi.fn();
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (...args: Parameters<typeof actual.eq>) => {
      eqSpy(...args);
      return actual.eq(...args);
    },
  };
});

const whereMock = vi.fn(async () => undefined);
const deleteMock = vi.fn(() => ({ where: whereMock }));
const getDbMock = vi.fn();
vi.mock("../db", () => ({
  getDb: () => getDbMock(),
}));

// Import after mocks are registered.
import { resetDemoTenant, DemoResetDisabledError, DemoResetForbiddenError } from "./demoTenantReset";
import { demoTenantId } from "./demoTenantSeed";

describe("resetDemoTenant", () => {
  beforeEach(() => {
    envState.dayforgeDemoEnabled = true;
    eqSpy.mockClear();
    deleteMock.mockClear();
    whereMock.mockClear();
    writeDayforgeEventWith.mockClear();
    getDbMock.mockReset();
    getDbMock.mockResolvedValue({
      transaction: async (fn: (tx: unknown) => unknown) =>
        fn({ delete: deleteMock }),
    });
  });

  it("throws and never touches the database when DAYFORGE_DEMO_ENABLED is not true", async () => {
    envState.dayforgeDemoEnabled = false;
    await expect(
      resetDemoTenant({ role: "admin", id: "u1" })
    ).rejects.toBeInstanceOf(DemoResetDisabledError);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("throws and never touches the database when the actor is not admin", async () => {
    await expect(
      resetDemoTenant({ role: "operator", id: "u1" })
    ).rejects.toBeInstanceOf(DemoResetForbiddenError);
    await expect(
      resetDemoTenant({ role: null, id: null })
    ).rejects.toBeInstanceOf(DemoResetForbiddenError);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("scopes every delete to the demo tenant only, and writes an audit event", async () => {
    const result = await resetDemoTenant({ role: "admin", id: "admin-1" });

    expect(deleteMock.mock.calls.length).toBeGreaterThan(10);
    // Every `eq(table.tenantId, X)` call made during the purge must use the
    // demo tenant id -- this is the guarantee that reset never touches any
    // other tenant's data.
    const tenantIdArgs = eqSpy.mock.calls.map(call => call[1]);
    expect(tenantIdArgs.length).toBeGreaterThan(0);
    for (const arg of tenantIdArgs) {
      expect(arg).toBe(demoTenantId());
    }

    expect(writeDayforgeEventWith).toHaveBeenCalledTimes(1);
    const [, eventInput] = writeDayforgeEventWith.mock.calls[0] as [
      unknown,
      { tenantId: string; eventName: string; actor: { type: string; id: string | null } },
    ];
    expect(eventInput.tenantId).toBe(demoTenantId());
    expect(eventInput.eventName).toBe("dayforge_demo.reset");
    expect(eventInput.actor).toEqual({ type: "admin", id: "admin-1" });

    expect(result.tenantId).toBe(demoTenantId());
  });
});
