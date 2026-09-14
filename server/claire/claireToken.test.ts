import { describe, expect, it } from "vitest";
import { issueClaireToken, verifyClaireToken } from "./claireToken";

const secret = "test-secret-long-enough-for-signing";

describe("Claire call tokens", () => {
  it("round-trips a scoped pre-drive conversation reference", () => {
    const token = issueClaireToken(
      {
        kind: "pre_drive_conversation",
        tenantId: "tenant-1",
        userId: "adam",
        conversationId: "conversation-1",
      },
      { secret, nowMs: 1_000_000, ttlSeconds: 60 }
    );
    expect(
      verifyClaireToken(token, { secret, nowMs: 1_010_000 })
    ).toMatchObject({
      kind: "pre_drive_conversation",
      tenantId: "tenant-1",
      userId: "adam",
      conversationId: "conversation-1",
    });
  });

  it("round-trips signed drive claims without carrying business truth", () => {
    const token = issueClaireToken(
      {
        kind: "drive_call",
        tenantId: "tenant-1",
        userId: "adam",
        missionId: 42,
        missionAccess: "field",
        phase: "post_stop",
      },
      { secret, nowMs: 1_000_000, ttlSeconds: 60 }
    );
    expect(
      verifyClaireToken(token, { secret, nowMs: 1_010_000 })
    ).toMatchObject({
      kind: "drive_call",
      tenantId: "tenant-1",
      userId: "adam",
      missionId: 42,
      missionAccess: "field",
      phase: "post_stop",
    });
  });

  it("rejects tampering", () => {
    const token = issueClaireToken(
      {
        kind: "drive_call",
        tenantId: "tenant-1",
        userId: "adam",
        missionId: 42,
        missionAccess: "field",
        phase: "post_stop",
      },
      { secret, nowMs: 1_000_000 }
    );
    expect(() =>
      verifyClaireToken(`${token}x`, { secret, nowMs: 1_010_000 })
    ).toThrow();
  });

  it("rejects expired tokens", () => {
    const token = issueClaireToken(
      {
        kind: "drive_call",
        tenantId: "tenant-1",
        userId: "adam",
        missionId: 42,
        missionAccess: "field",
        phase: "post_stop",
      },
      { secret, nowMs: 1_000_000, ttlSeconds: 1 }
    );
    expect(() =>
      verifyClaireToken(token, { secret, nowMs: 1_002_000 })
    ).toThrow(/expired/);
  });
});
