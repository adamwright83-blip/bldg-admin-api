import { describe, expect, it, vi } from "vitest";
import { createVendorProposalReviewRouter } from "./vendorProposalReviewRouter";

const preview = { versionId: "version-1" } as never;
function context(user: { role: "admin" | "user" } | null) {
  return { user, tenantId: "default", req: {}, res: {} } as never;
}

describe("internal proposal review router", () => {
  it("rejects unauthenticated and non-admin access before DB/store access", async () => {
    const store = { listVersions: vi.fn(), getVersion: vi.fn() };
    const router = createVendorProposalReviewRouter(store as never);
    await expect(router.createCaller(context(null)).list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(router.createCaller(context({ role: "user" })).get({ versionId: "version-1" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.listVersions).not.toHaveBeenCalled();
    expect(store.getVersion).not.toHaveBeenCalled();
  });

  it("lists proposal previews for admins with bounded input", async () => {
    const store = { listVersions: vi.fn(async () => ({ items: [preview], page: { limit: 20, offset: 0, hasMore: false } })),
      getVersion: vi.fn() };
    const result = await createVendorProposalReviewRouter(store as never).createCaller(context({ role: "admin" }))
      .list({ limit: 20, offset: 0 });
    expect(result.items).toHaveLength(1);
    expect(store.listVersions).toHaveBeenCalledWith({ limit: 20, offset: 0 });
  });

  it("reads one preview and returns NOT_FOUND safely", async () => {
    const store = { listVersions: vi.fn(), getVersion: vi.fn(async () => preview) };
    const caller = createVendorProposalReviewRouter(store as never).createCaller(context({ role: "admin" }));
    expect((await caller.get({ versionId: "version-1" })).versionId).toBe("version-1");
    store.getVersion.mockResolvedValueOnce(null as never);
    await expect(caller.get({ versionId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("contains no mutations", () => {
    const router = createVendorProposalReviewRouter({ listVersions: vi.fn(), getVersion: vi.fn() } as never);
    expect(Object.keys(router._def.record)).toEqual(["list", "get"]);
  });
});
