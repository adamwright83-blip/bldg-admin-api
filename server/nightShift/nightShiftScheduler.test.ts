import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runNightShiftForBusinessDate: vi.fn(),
  resolveAutonomousNightShiftScope: vi.fn(),
}));

vi.mock("./authoredDayService", async importOriginal => {
  const actual = await importOriginal<typeof import("./authoredDayService")>();
  return {
    ...actual,
    runNightShiftForBusinessDate: mocks.runNightShiftForBusinessDate,
    isNightShiftEnabled: () => true,
  };
});
vi.mock("./nightShiftScope", async importOriginal => {
  const actual = await importOriginal<typeof import("./nightShiftScope")>();
  return {
    ...actual,
    resolveAutonomousNightShiftScope: mocks.resolveAutonomousNightShiftScope,
  };
});

vi.mock("../_core/env", () => ({
  ENV: {
    goldlineNightShiftEnabled: true,
    ownerOpenId: "owner-open-id",
  },
}));

import { readFileSync } from "node:fs";
import { triggerNightShiftRun, startNightShiftScheduler } from "./nightShiftScheduler";
import { zonedDayStartUtc } from "../dashboardZoned";

describe("Night Shift scheduler scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runNightShiftForBusinessDate.mockResolvedValue({
      status: "authored",
      authoredDay: { businessDate: "2026-09-09" },
    });
  });

  it("does not invent operator owner or user 1 when scope is unresolved", async () => {
    mocks.resolveAutonomousNightShiftScope.mockResolvedValue(null);
    await triggerNightShiftRun();
    expect(mocks.runNightShiftForBusinessDate).not.toHaveBeenCalled();
  });

  it("runs only with an authoritative autonomous scope", async () => {
    const scope = {
      tenantId: "default",
      operatorId: "owner-open-id",
      userId: "42",
    };
    const timeZone = "America/Los_Angeles";
    const now = new Date(zonedDayStartUtc("2026-09-09", timeZone).getTime() + 1000);
    await triggerNightShiftRun({ ...scope, now });
    expect(mocks.runNightShiftForBusinessDate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "default",
        operatorId: "owner-open-id",
        userId: "42",
        businessDate: "2026-09-09",
      })
    );
  });

  it("does not schedule autonomous runs without resolved scope", async () => {
    mocks.resolveAutonomousNightShiftScope.mockResolvedValue(null);
    const scheduler = readFileSync(new URL("./nightShiftScheduler.ts", import.meta.url), "utf8");
    expect(scheduler).not.toContain('operatorId: "owner"');
    expect(scheduler).not.toContain('userId: "1"');
    const stop = startNightShiftScheduler({ intervalMs: 10_000 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.runNightShiftForBusinessDate).not.toHaveBeenCalled();
    stop();
  });
});

describe("Night Shift router uses request context", () => {
  it("uses ctx tenant/operator/user in the router", () => {
    const router = readFileSync(new URL("./nightShiftRouter.ts", import.meta.url), "utf8");
    expect(router).toContain("tenantId: ctx.tenantId");
    expect(router).toContain("operatorId: ctx.user.openId");
    expect(router).toContain("userId: String(ctx.user.id)");
    expect(router).not.toContain('operatorId: "owner"');
    expect(router).not.toContain('userId: "1"');
  });
});
