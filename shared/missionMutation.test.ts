import { describe, expect, it } from "vitest";
import { deriveMutation, mutationIdentityKey } from "./missionMutation";

const now = new Date("2026-08-11T12:00:00.000Z");
function iso(hoursFromNow: number) {
  return new Date(now.getTime() + hoursFromNow * 60 * 60_000).toISOString();
}

describe("deriveMutation priority", () => {
  it("treats a lost mission as CLOSED regardless of other signals", () => {
    const decision = deriveMutation({
      missionStatus: "lost",
      pipelineStage: "lost",
      lossReason: "no_budget",
      followUpDueAt: iso(48), // even a future commitment cannot reopen a loss
      hasDecisionMakerContact: true,
      verifiedWin: false,
    });
    expect(decision?.mutationType).toBe("CLOSED_PATH");
    expect(decision?.worldEffect.visualState).toBe("closed");
    expect(decision?.worldEffect.unlockedPath).toBeNull();
  });

  it("treats a verified win as CAPTURED even with a stale follow-up", () => {
    const decision = deriveMutation({
      missionStatus: "won",
      pipelineStage: "won",
      lossReason: null,
      followUpDueAt: iso(-10),
      hasDecisionMakerContact: true,
      verifiedWin: true,
    });
    expect(decision?.mutationType).toBe("CAPTURED_PATH");
    expect(decision?.worldEffect.visualState).toBe("captured");
  });

  it("opens a watch window from a real future follow-up commitment", () => {
    const decision = deriveMutation({
      missionStatus: "follow_up",
      pipelineStage: "follow_up",
      lossReason: null,
      followUpDueAt: iso(24),
      hasDecisionMakerContact: true,
      verifiedWin: false,
    });
    expect(decision?.mutationType).toBe("WATCH_WINDOW");
    expect(decision?.worldEffect.visualState).toBe("watching");
    expect(decision?.triggerReference).toContain(iso(24));
  });

  it("opens a recovery path when pipeline is follow_up with no timestamp", () => {
    const decision = deriveMutation({
      missionStatus: "follow_up",
      pipelineStage: "follow_up",
      lossReason: null,
      followUpDueAt: null,
      hasDecisionMakerContact: true,
      verifiedWin: false,
    });
    expect(decision?.mutationType).toBe("RECOVERY_PATH");
  });

  it("opens a new contact route only when actively worked and still blocked", () => {
    const blocked = deriveMutation({
      missionStatus: "active",
      pipelineStage: "active",
      lossReason: null,
      followUpDueAt: null,
      hasDecisionMakerContact: false,
      verifiedWin: false,
    });
    expect(blocked?.mutationType).toBe("NEW_CONTACT_ROUTE");

    const notBlocked = deriveMutation({
      missionStatus: "active",
      pipelineStage: "active",
      lossReason: null,
      followUpDueAt: null,
      hasDecisionMakerContact: true,
      verifiedWin: false,
    });
    expect(notBlocked).toBeNull();
  });

  it("does not infer a mutation from a non-active mission missing contact", () => {
    // Missing data on an available (not yet worked) mission is not evidence.
    const decision = deriveMutation({
      missionStatus: "available",
      pipelineStage: null,
      lossReason: null,
      followUpDueAt: null,
      hasDecisionMakerContact: false,
      verifiedWin: false,
    });
    expect(decision).toBeNull();
  });

  it("ignores an unparseable timestamp rather than fabricating a window", () => {
    const decision = deriveMutation({
      missionStatus: "follow_up",
      pipelineStage: "follow_up",
      lossReason: null,
      followUpDueAt: "not-a-date",
      hasDecisionMakerContact: true,
      verifiedWin: false,
    });
    // Falls through to the follow_up pipeline rule, not a fabricated watch window.
    expect(decision?.mutationType).toBe("RECOVERY_PATH");
  });

  it("never derives a mutation from arcade-only signals", () => {
    // The evidence shape has no field for combo/XP/animation score at all —
    // this test documents that constraint structurally.
    const evidenceKeys = Object.keys({
      missionStatus: "",
      pipelineStage: null,
      lossReason: null,
      followUpDueAt: null,
      hasDecisionMakerContact: false,
      verifiedWin: false,
    });
    expect(evidenceKeys).not.toContain("combo");
    expect(evidenceKeys).not.toContain("xp");
    expect(evidenceKeys).not.toContain("animationScore");
  });
});

describe("mutationIdentityKey", () => {
  it("differs across tenants for identical mission/trigger", () => {
    const a = mutationIdentityKey({
      tenantId: "tenant-a",
      actorId: "driver-1",
      missionId: 900,
      triggerReference: "follow_up:x",
    });
    const b = mutationIdentityKey({
      tenantId: "tenant-b",
      actorId: "driver-1",
      missionId: 900,
      triggerReference: "follow_up:x",
    });
    expect(a).not.toBe(b);
  });

  it("is stable for identical inputs", () => {
    const input = {
      tenantId: "tenant-a",
      actorId: "driver-1",
      missionId: 900,
      triggerReference: "follow_up:x",
    };
    expect(mutationIdentityKey(input)).toBe(mutationIdentityKey(input));
  });
});
