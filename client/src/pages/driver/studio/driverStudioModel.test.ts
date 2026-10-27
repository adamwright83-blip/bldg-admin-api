import { describe, expect, it } from "vitest";
import type { DayPlanStop } from "../goldlineDayPlanModel";
import {
  canHoldToComplete, chooseDriverScene, findVisit, groupRouteVisits, hasSavedJob, jobTruth, minutesOfStop, SCENES, timeOfStop, visitPeriod, visitTitle,
} from "./driverStudioModel";

const stop = (id: string, overrides: Partial<DayPlanStop> = {}): DayPlanStop => ({
  id,
  kind: "pickup",
  title: "Synthetic customer",
  source: "cleancloud",
  sourceLabel: "CleanCloud",
  timeLabel: "11:15–12:00",
  sortKey: "11:15",
  estimatedMinutes: null,
  status: "ready",
  fixed: true,
  address: "2170 Century Park East, Los Angeles",
  navigationUrl: "https://www.google.com/maps/dir/?api=1",
  missionTarget: null,
  completedAt: null,
  ...overrides,
});

const bridge = (state: NonNullable<DayPlanStop["pickupBridge"]>["state"], error: string | null = null): DayPlanStop["pickupBridge"] => ({
  state, bagCount: 2, garmentCount: 0, observedAt: "2026-10-27T18:00:00Z", verifiedAt: null, error,
});

describe("Driver Studio grouping", () => {
  it("groups two jobs at the same address and adjacent time into one visit, keeping separate job ids", () => {
    const s = groupRouteVisits([
      stop("a"),
      stop("b", { kind: "dropoff", sortKey: "11:17", timeLabel: "11:17–12:00" }),
      stop("c", { kind: "dropoff", sortKey: "20:30", timeLabel: "20:30–21:00" }),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0].jobs.map(j => j.id)).toEqual(["a", "b"]);
    expect(s[1].jobs.map(j => j.id)).toEqual(["c"]);
  });
  it("groups real CleanCloud 24h windows and compact operations windows (no AM/PM)", () => {
    const visits = groupRouteVisits([
      stop("a", { sortKey: "14:00", timeLabel: "14:00–15:00" }),
      stop("b", { kind: "dropoff", sortKey: "14:00", timeLabel: "2:00–3:00" }),
    ]);
    expect(visits).toHaveLength(1);
    expect(visits[0].minutes).toBe(14 * 60);
  });
  it("keeps an afternoon visit and an evening revisit to the same building separate", () => {
    const visits = groupRouteVisits([
      stop("a", { sortKey: "15:00" }),
      stop("b", { kind: "dropoff", sortKey: "19:00" }),
    ]);
    expect(visits.map(v => visitPeriod(v))).toEqual(["day", "evening"]);
  });
  it("never groups different physical destinations", () => {
    expect(groupRouteVisits([stop("a"), stop("b", { address: "3545 Wilshire Blvd" })])).toHaveLength(2);
  });
  it("does not group jobs whose time is unknown", () => {
    expect(groupRouteVisits([stop("a", { sortKey: "60:00", timeLabel: "Time TBD" }), stop("b", { sortKey: "60:00", timeLabel: "Time TBD" })])).toHaveLength(2);
  });
  it("does not surface processing, cancelled, or excluded supplier logistics", () => {
    expect(groupRouteVisits([
      stop("a", { kind: "processing" }),
      stop("b", { status: "cancelled" }),
      stop("c", { source: "derived_operation", kind: "prep", title: "JETRO restock" }),
    ])).toEqual([]);
  });
  it("keeps genuine field tasks, including derived work that is not supplier logistics", () => {
    const visits = groupRouteVisits([stop("a", { source: "derived_operation", kind: "prep", title: "Load the van" }), stop("b", { kind: "sales", title: "Visit the leasing office", address: null })]);
    expect(visits.map(v => v.id)).toEqual(["a", "b"]);
  });
  it("finds the open visit again after a refresh moves its first job", () => {
    const before = groupRouteVisits([stop("a"), stop("b", { kind: "dropoff" })]);
    const after = groupRouteVisits([stop("b", { kind: "dropoff" })]);
    expect(findVisit(after, before[0].id, before[0].jobs.map(j => j.id))?.jobs.map(j => j.id)).toEqual(["b"]);
    expect(findVisit(after, null)).toBeUndefined();
  });
});

describe("Driver Studio scenes", () => {
  it("chooses a scene only from place evidence, never from the customer's name", () => {
    expect(chooseDriverScene(stop("a"))).toBe("century-park-east");
    expect(chooseDriverScene(stop("b", { address: "3545 Wilshire Blvd" }))).toBe("opus");
    expect(chooseDriverScene(stop("b2", { address: "3650 W. 6th Street, Los Angeles" }))).toBe("opus");
    expect(chooseDriverScene(stop("c", { address: "123 Main Street" }))).toBe("plain");
    expect(chooseDriverScene(stop("d", { address: "Beverly Hills, California" }))).toBe("beverly-hills");
    expect(chooseDriverScene(stop("e", { title: "Silver Lake order", address: null }))).toBe("plain");
    expect(chooseDriverScene(stop("f", { title: "Opus Dental", address: "10 Example Ave" }))).toBe("plain");
    expect(chooseDriverScene(stop("g", { address: "1 Example Blvd, West Hollywood" }))).toBe("plain");
    expect(chooseDriverScene(stop("h", { address: null, physicalEntityId: "building:century_park_east" }))).toBe("century-park-east");
  });
  it("only references committed art and labels OPUS as concept", () => {
    expect(SCENES.opus.concept).toBe(true);
    expect(SCENES.hollywood.image).toBeNull();
    expect(visitTitle({ scene: "plain", location: "Synthetic customer" })).toBe("Synthetic customer");
  });
});

describe("Driver Studio completion truth", () => {
  it("requires an authoritative eligible action before allowing HOLD", () => {
    expect(canHoldToComplete(stop("a"))).toBe(false);
    expect(canHoldToComplete(stop("a", { action: { type: "order", orderId: 42, status: "collected", eligible: true } }))).toBe(true);
    expect(canHoldToComplete(stop("a", { action: { type: "order", orderId: 42, status: "collected", eligible: false } }))).toBe(false);
    expect(canHoldToComplete(stop("a", { status: "completed", action: { type: "order", orderId: 42, status: "collected", eligible: true } }))).toBe(false);
    expect(canHoldToComplete(stop("a", { kind: "sales", action: { type: "commercial", missionId: 1 } }))).toBe(false);
  });
  it("never offers a second HOLD on a pickup the bridge already holds", () => {
    const action = { type: "external" as const, id: "x" };
    expect(canHoldToComplete(stop("a", { action, pickupBridge: bridge("ready") }))).toBe(true);
    expect(canHoldToComplete(stop("a", { action, pickupBridge: bridge("pending") }))).toBe(false);
    expect(canHoldToComplete(stop("a", { action, pickupBridge: bridge("attention") }))).toBe(false);
  });
  it("tells saved, pending, attention and synced apart; none of them claims payment", () => {
    expect(jobTruth(stop("a"), false).tone).toBe("ready");
    expect(jobTruth(stop("a"), true)).toMatchObject({ label: "SAVED", tone: "saved" });
    expect(jobTruth(stop("a", { pickupBridge: bridge("ready") }), true)).toMatchObject({ label: "SYNC PENDING", tone: "pending" });
    expect(jobTruth(stop("a", { pickupBridge: bridge("pending") }), true)).toMatchObject({ tone: "pending", detail: "Pickup saved · CleanCloud sync pending" });
    const attention = jobTruth(stop("a", { pickupBridge: bridge("attention", "Sign in again") }), true);
    expect(attention).toMatchObject({ tone: "attention", canRetrySync: true });
    expect(attention.detail).toContain("Sign in again");
    expect(jobTruth(stop("a", { pickupBridge: bridge("synced") }), true).label).toBe("CLEANCLOUD SYNCED");
    for (const s of ["ready", "pending", "attention", "synced", "held"] as const) {
      expect(JSON.stringify(jobTruth(stop("a", { pickupBridge: bridge(s) }), true))).not.toMatch(/paid|payment/i);
    }
  });
  it("does not treat locally saved state as another job's save", () => {
    expect(hasSavedJob(stop("a"), new Set(["a"]))).toBe(true);
    expect(hasSavedJob(stop("b"), new Set(["a"]))).toBe(false);
  });
});

describe("Driver Studio time", () => {
  it("parses valid times and leaves unknown times unknown", () => {
    expect(timeOfStop("12:00 PM")).toBe(720);
    expect(timeOfStop("8:30 PM")).toBe(1230);
    expect(timeOfStop("Appointment someday")).toBe(null);
    expect(minutesOfStop({ sortKey: "07:30", timeLabel: "07:30–09:00" })).toBe(450);
    expect(minutesOfStop({ sortKey: "60:00", timeLabel: "Time TBD" })).toBe(null);
    expect(minutesOfStop({ sortKey: "2026-10-27T18:00:00Z", timeLabel: "Due today" })).toBe(null);
  });
});

describe("Driver Studio stability while saving", () => {
  it("keeps a visit, its id and its job order when a saved job drops to the end of the projection", () => {
    const action = { type: "external" as const, id: "x" };
    const before = groupRouteVisits([
      stop("a", { action }),
      stop("b", { kind: "dropoff", action }),
      stop("c", { address: "3545 Wilshire Blvd", sortKey: "14:00" }),
    ]);
    // The projection moves completed work to the end.
    const after = groupRouteVisits([
      stop("b", { kind: "dropoff", action }),
      stop("c", { address: "3545 Wilshire Blvd", sortKey: "14:00" }),
      stop("a", { status: "completed", action }),
    ]);
    expect(after.map(v => v.id)).toEqual(before.map(v => v.id));
    expect(after[0].jobs.map(j => j.id)).toEqual(["a", "b"]);
  });
  it("orders visits by scheduled time and keeps untimed work after the visit it followed", () => {
    const visits = groupRouteVisits([
      stop("late", { sortKey: "16:00", address: "1 Late St" }),
      stop("task", { kind: "sales", sortKey: "70:00000001", timeLabel: "Today", address: null }),
      stop("early", { sortKey: "09:00", address: "1 Early St" }),
    ]);
    expect(visits.map(v => v.id)).toEqual(["early", "late", "task"]);
  });
});
