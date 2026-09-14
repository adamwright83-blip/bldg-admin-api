import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import {
  generateClairePreDriveOutput,
  previewClairePreDrive,
} from "./preDriveRuntime";
import { claireRouter } from "./claireRouter";

describe("G — Claire developer preview and shared generation path", () => {
  it("assembles production context and invokes the same brief generator without writes", async () => {
    const context = {
      phase: "pre_drive",
      generatedAt: "2026-09-14T12:00:00.000Z",
      businessDate: "2026-09-14",
      actorId: "admin-1",
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
    } satisfies ClaireDriveContext;
    const assemble = vi.fn().mockResolvedValue(context);
    const writeBrief = vi.fn().mockImplementation(async input => {
      input.onGeneration({
        kind: "opening_brief",
        source: "model",
        failureReason: null,
      });
      return "Shared generated brief.";
    });
    const result = await generateClairePreDriveOutput(
      {
        tenantId: "tenant-1",
        actorId: "admin-1",
        timeZone: "America/Los_Angeles",
      },
      { assemble, writeBrief }
    );
    expect(assemble).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      actorId: "admin-1",
      phase: "pre_drive",
      timeZone: "America/Los_Angeles",
    });
    expect(writeBrief).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      context,
      onGeneration: expect.any(Function),
    });
    expect(result).toMatchObject({
      brief: "Shared generated brief.",
      diagnostic: { source: "model" },
    });
    expect(result).not.toHaveProperty("write");
  });

  it("phone and authenticated preview are wired to the shared runtime", async () => {
    const fs = await import("node:fs/promises");
    const [phoneSource, routerSource] = await Promise.all([
      fs.readFile(new URL("./claireTwilio.ts", import.meta.url), "utf8"),
      fs.readFile(new URL("./claireRouter.ts", import.meta.url), "utf8"),
    ]);
    expect(phoneSource).toContain("generateClairePreDriveOutput(");
    expect(routerSource).toContain("previewClairePreDrive(");
    expect(routerSource).toContain("previewPreDrive: adminProcedure");
  });

  it("preview reports fallback diagnostics and cannot write business truth", async () => {
    const context = {
      phase: "pre_drive",
      generatedAt: "2026-09-14T12:00:00.000Z",
      businessDate: "2026-09-14",
      actorId: "admin-1",
      truthLaw: "game_projection_never_creates_business_truth",
      nextFixedCommitment: null,
      blockers: [],
      relevantTimeline: [],
      mission: null,
    } satisfies ClaireDriveContext;
    const preview = await previewClairePreDrive(
      { tenantId: "preview-fallback", actorId: "admin-1" },
      {
        assemble: vi.fn().mockResolvedValue(context),
        writeBrief: vi.fn().mockImplementation(async input => {
          input.onGeneration({
            kind: "opening_brief",
            source: "fallback",
            failureReason: "rate_limited",
          });
          return "Conservative fallback.";
        }),
      }
    );
    expect(preview).toMatchObject({
      brief: "Conservative fallback.",
      source: "fallback",
      failureReason: "rate_limited",
      writesBusinessTruth: false,
    });
  });

  it("rejects unauthenticated preview access", async () => {
    const caller = claireRouter.createCaller({
      req: undefined,
      res: undefined,
      user: null,
      vendorSession: null,
      tenantId: "tenant-1",
    } as never);
    await expect(caller.previewPreDrive({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
