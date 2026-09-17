import { describe, expect, it, beforeEach } from "vitest";
import {
  recordMissedCommitment,
  resolveRecoveryItem,
  archiveStaleQueuedItems,
  evaluateDropPatterns,
  formatRecoveryClaireUtterance,
  getRecoveryState,
  _clearRecoveryStores,
} from "./recoveryService";
import { lintDisappointmentFraming } from "../claire/disappointmentLint";

describe("Slice 10: Recovery and Drop Patterns", () => {
  const tenantId = "tenant_slice10_test";

  beforeEach(() => {
    _clearRecoveryStores();
  });

  it("guardrail.G3.max_one_visible: exactly zero or one item is visible; remainder queued", async () => {
    // Record 6 missed commitments
    for (let i = 1; i <= 6; i++) {
      await recordMissedCommitment({
        tenantId,
        commitmentRef: `com_${i}`,
        playId: "play_slice10",
        title: `Visit Luxury Building #${i}`,
      });
    }

    const state = getRecoveryState(tenantId);
    expect(state.visibleItem).not.toBeNull();
    expect(state.visibleItem?.commitmentRef).toBe("com_1");
    expect(state.queuedCount).toBe(5); // 1 visible + 5 queued = 6 total
  });

  it("drop requires a reason; dropping without reason throws error", async () => {
    const item = await recordMissedCommitment({
      tenantId,
      commitmentRef: "com_drop_test",
      title: "Deliver flyers to Greystar",
    });

    // Empty reason must throw
    await expect(
      resolveRecoveryItem({
        tenantId,
        itemId: item.id,
        action: "drop",
        dropReason: "",
      })
    ).rejects.toThrow("Dropping a recovery item requires an explicit named reason.");

    // With explicit reason must succeed
    const resolved = await resolveRecoveryItem({
      tenantId,
      itemId: item.id,
      action: "drop",
      dropReason: "Property manager requested rescheduling to next month due to lobby renovations.",
    });

    expect(resolved.item.state).toBe("dropped");
    expect(resolved.item.dropReason).toContain("lobby renovations");
  });

  it("one promotion per day: resolving visible item promotes at most one queued item per day", async () => {
    const item1 = await recordMissedCommitment({
      tenantId,
      commitmentRef: "com_promo_1",
      title: "Task 1",
    });
    const item2 = await recordMissedCommitment({
      tenantId,
      commitmentRef: "com_promo_2",
      title: "Task 2",
    });
    const item3 = await recordMissedCommitment({
      tenantId,
      commitmentRef: "com_promo_3",
      title: "Task 3",
    });

    expect(item1.state).toBe("visible");
    expect(item2.state).toBe("queued");
    expect(item3.state).toBe("queued");

    // Resolve task 1 today
    const res1 = await resolveRecoveryItem({
      tenantId,
      itemId: item1.id,
      action: "repair",
      todayYmd: "2026-09-17",
    });

    // Item 2 should now be promoted to visible
    expect(res1.nextPromotedItem?.id).toBe(item2.id);

    // Resolve task 2 on the SAME day
    const res2 = await resolveRecoveryItem({
      tenantId,
      itemId: item2.id,
      action: "repair",
      todayYmd: "2026-09-17", // Same day
    });

    // Item 3 must NOT be promoted today (max 1 promotion per day)
    expect(res2.nextPromotedItem).toBeNull();
    const state = getRecoveryState(tenantId);
    expect(state.visibleItem).toBeNull();
    expect(state.queuedCount).toBe(1); // Item 3 still safely queued
  });

  it("guardrail.G3.no_silent_deletion & archived_still_counted: items older than 21 days archive to chronicle and count", async () => {
    const now = new Date("2026-09-20T12:00:00Z");
    const twentyTwoDaysAgo = new Date("2026-08-28T12:00:00Z");

    // Add 1 visible item
    await recordMissedCommitment({
      tenantId,
      commitmentRef: "com_recent",
      title: "Recent item",
      missedAt: now,
    });

    // Add 5 old queued items
    for (let i = 1; i <= 5; i++) {
      await recordMissedCommitment({
        tenantId,
        commitmentRef: `com_old_${i}`,
        title: `Old task ${i}`,
        missedAt: twentyTwoDaysAgo,
      });
    }

    const stateBefore = getRecoveryState(tenantId);
    expect(stateBefore.queuedCount).toBe(5);

    // Archive stale queued items
    const archivedCount = await archiveStaleQueuedItems({
      tenantId,
      ageDays: 21,
      now,
    });
    expect(archivedCount).toBe(5);

    const stateAfter = getRecoveryState(tenantId);
    expect(stateAfter.queuedCount).toBe(0);
    expect(stateAfter.archivedCount).toBe(5);

    // Evaluate drop patterns: 5 archived items must trigger archived_backlog pattern flag!
    const patterns = await evaluateDropPatterns({ tenantId, now });
    expect(patterns.some(p => p.patternType === "archived_backlog")).toBe(true);
  });

  it("pattern thresholds fire correctly for play drops and overall drops", async () => {
    const now = new Date("2026-09-20T12:00:00Z");

    // Drop 3 items under the same play
    for (let i = 1; i <= 3; i++) {
      const item = await recordMissedCommitment({
        tenantId,
        commitmentRef: `com_playdrop_${i}`,
        playId: "play_door_tags",
        title: `Door tag stop ${i}`,
        missedAt: now,
      });
      await resolveRecoveryItem({
        tenantId,
        itemId: item.id,
        action: "drop",
        dropReason: "Gate locked",
      });
    }

    const patterns = await evaluateDropPatterns({ tenantId, now });
    const playFlag = patterns.find(p => p.patternType === "play_cluster_drops");
    expect(playFlag).toBeDefined();
    expect(playFlag?.playId).toBe("play_door_tags");
    expect(playFlag?.occurrenceCount).toBe(3);
  });

  it("guardrail.G2.recovery_language: kintsugi framing passes G2 disappointment lint", () => {
    const utterance = formatRecoveryClaireUtterance({
      id: "rec_01",
      tenantId,
      commitmentRef: "com_01",
      playId: "play_01",
      title: "Call Property Manager at Greystar",
      state: "visible",
      dropReason: null,
      rescheduledToDate: null,
      missedAt: "2026-09-17T08:00:00Z",
      resolvedAt: null,
      promotedVisibleAt: "2026-09-17T08:00:00Z",
      chronicleRef: "chronicle:rec_01",
    });

    expect(utterance).toContain("One line remains in Recovery");
    expect(utterance).toContain("repair it today, reschedule it for an upcoming route, or set it aside with a reason");

    const lint = lintDisappointmentFraming(utterance);
    expect(lint.passes).toBe(true);
  });

  it("repaired completion emits allowlisted warmth under G1", async () => {
    const item = await recordMissedCommitment({
      tenantId,
      commitmentRef: "com_warmth_test",
      title: "Repairable line",
    });

    const resolved = await resolveRecoveryItem({
      tenantId,
      itemId: item.id,
      action: "repair",
    });

    expect(resolved.item.state).toBe("repaired");
    expect(resolved.warmthEventEmitted).toBe(true);
  });

  it("tenant isolation: recovery items and drop patterns are strictly isolated", async () => {
    await recordMissedCommitment({
      tenantId: "tenant_rec_A",
      commitmentRef: "com_A",
      title: "Task A",
    });

    const stateA = getRecoveryState("tenant_rec_A");
    expect(stateA.visibleItem).not.toBeNull();
    expect(stateA.visibleItem?.title).toBe("Task A");

    const stateB = getRecoveryState("tenant_rec_B");
    expect(stateB.visibleItem).toBeNull();
    expect(stateB.queuedCount).toBe(0);
  });
});
