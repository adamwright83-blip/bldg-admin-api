import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  recurrenceIdempotencyKey,
  recurrenceSourceIdentity,
  shouldProjectRule,
} from "./workdayRecurrenceService";

describe("Day Line recurrence", () => {
  it("projects onto matching weekdays only", () => {
    const rule = { status: "active" as const, weekday: "monday" };
    expect(shouldProjectRule(rule, "2026-09-21")).toBe(true);
    expect(shouldProjectRule(rule, "2026-09-22")).toBe(false);
    expect(shouldProjectRule({ ...rule, status: "cancelled" }, "2026-09-21")).toBe(false);
  });

  it("uses a stable identity and per-date idempotency key", () => {
    const identity = recurrenceSourceIdentity({ actorId: "1", title: "John pickup", weekday: "monday" });
    expect(identity).toBe(recurrenceSourceIdentity({ actorId: "1", title: "John pickup", weekday: "monday" }));
    expect(recurrenceIdempotencyKey("rule-1", "2026-09-28")).toBe("recurrence:rule-1:2026-09-28");
    expect(recurrenceIdempotencyKey("rule-1", "2026-09-28")).toBe(recurrenceIdempotencyKey("rule-1", "2026-09-28"));
  });

  it("does not create orders — the key is a Day Line projection key", () => {
    expect(recurrenceIdempotencyKey("rule-1", "2026-09-28")).not.toMatch(/order/);
    const source = readFileSync(new URL("./workdayRecurrenceService.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\(orders\)|\.insert\(orders\)/);
  });
});
