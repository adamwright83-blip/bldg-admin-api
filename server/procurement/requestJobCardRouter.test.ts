import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ listRequestJobCardSourceRecords: vi.fn() }));

const { listRequestJobCardSourceRecords } = await import("../db");
const { requestJobCardRouter } = await import("./requestJobCardRouter");

function context(user: { role: string } | null) {
  return { user, tenantId: "default", req: {}, res: {}, vendorSession: null } as never;
}

const emptySources = { serviceRequests: [], coordinatedRequests: [], residentPlans: [] };

describe("request job-card admin router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listRequestJobCardSourceRecords).mockResolvedValue(emptySources);
  });

  it("rejects unauthenticated and non-admin callers before querying records", async () => {
    await expect(requestJobCardRouter.createCaller(context(null)).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requestJobCardRouter.createCaller(context({ role: "user" })).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(listRequestJobCardSourceRecords).not.toHaveBeenCalled();
  });

  it("allows admins and applies bounded defaults", async () => {
    const result = await requestJobCardRouter.createCaller(context({ role: "admin" })).list();
    expect(listRequestJobCardSourceRecords).toHaveBeenCalledWith({
      tenantId: "default",
      sources: ["service_request", "resident_coordinated_request", "resident_agent_plan"],
      fetchCount: 26,
    });
    expect(result.page).toMatchObject({ limit: 25, offset: 0 });
  });

  it("supports an explicit source filter and safe pagination", async () => {
    await requestJobCardRouter.createCaller(context({ role: "admin" })).list({
      limit: 10, offset: 20, sources: ["resident_coordinated_request"],
    });
    expect(listRequestJobCardSourceRecords).toHaveBeenCalledWith({
      tenantId: "default", sources: ["resident_coordinated_request"], fetchCount: 31,
    });
  });

  it("rejects oversized pagination at validation", async () => {
    await expect(requestJobCardRouter.createCaller(context({ role: "admin" })).list({
      limit: 51, offset: 0,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(listRequestJobCardSourceRecords).not.toHaveBeenCalled();
  });
});
