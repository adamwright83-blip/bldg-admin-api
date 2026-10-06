import { afterEach, describe, expect, it } from "vitest";
import {
  daphneAdaptationReceiptIdempotencyMaterial,
  daphneExecutingSha,
} from "./adaptationReceipts";

const originalRailway = process.env.RAILWAY_GIT_COMMIT_SHA;
const originalVercel = process.env.VERCEL_GIT_COMMIT_SHA;
const originalGitHub = process.env.GITHUB_SHA;
const originalGit = process.env.GIT_COMMIT_SHA;

afterEach(() => {
  if (originalRailway === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
  else process.env.RAILWAY_GIT_COMMIT_SHA = originalRailway;
  if (originalVercel === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = originalVercel;
  if (originalGitHub === undefined) delete process.env.GITHUB_SHA;
  else process.env.GITHUB_SHA = originalGitHub;
  if (originalGit === undefined) delete process.env.GIT_COMMIT_SHA;
  else process.env.GIT_COMMIT_SHA = originalGit;
});

describe("Daphne adaptation receipt contract", () => {
  it("pins idempotency to the exact directive, conversation and turn", () => {
    const base = {
      tenantId: "tenant-a",
      canonicalOperatorId: "tenant:tenant-a:operator:adam",
      directiveId: "11111111-1111-4111-8111-111111111111",
      conversationId: "conversation-a",
      turnId: "conversation-a:2",
    };
    const first = daphneAdaptationReceiptIdempotencyMaterial(base);
    expect(daphneAdaptationReceiptIdempotencyMaterial({ ...base })).toBe(first);
    expect(
      daphneAdaptationReceiptIdempotencyMaterial({
        ...base,
        turnId: "conversation-a:3",
      })
    ).not.toBe(first);
    expect(
      daphneAdaptationReceiptIdempotencyMaterial({
        ...base,
        conversationId: "conversation-b",
      })
    ).not.toBe(first);
  });

  it("always records an execution-code witness", () => {
    delete process.env.RAILWAY_GIT_COMMIT_SHA;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    delete process.env.GITHUB_SHA;
    delete process.env.GIT_COMMIT_SHA;
    expect(daphneExecutingSha()).toBe("unavailable");
    expect(daphneExecutingSha("head-sha")).toBe("head-sha");
    process.env.RAILWAY_GIT_COMMIT_SHA = "railway-sha";
    expect(daphneExecutingSha()).toBe("railway-sha");
  });

  it("bounds the executing SHA field instead of omitting it", () => {
    expect(daphneExecutingSha("x".repeat(100))).toHaveLength(64);
  });
});
