import { describe, expect, it } from "vitest";
import type { DayPlanStop } from "../goldlineDayPlanModel";
import {
  canHoldToComplete, chooseDriverScene, groupRouteVisits, hasSavedJob, timeOfStop,
} from "./driverStudioModel";

const stop = (id: string, overrides: Partial<DayPlanStop> = {}): DayPlanStop => ({
  id,
  kind: "pickup",
  title: "Synthetic customer",
  source: "cleancloud",
  sourceLabel: "CleanCloud",
  timeLabel: "11:15 AM",
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

describe("Driver Studio safety and grouping", () => {
  it("groups two jobs at the same address and adjacent time into one visit", () => {
    const s = groupRouteVisits([
      stop("a"),
      stop("b", { kind: "dropoff", timeLabel: "11:17 AM" }),
      stop("c", { kind: "dropoff", timeLabel: "8:30 PM" }),
    ]);
    expect(s).toHaveLength(2);
    expect(s[0].jobs.map(j => j.id)).toEqual(["a", "b"]);
    expect(s[1].jobs.map(j => j.id)).toEqual(["c"]);
  });
  it("never groups different physical destinations", () => {
    expect(groupRouteVisits([stop("a"),stop("b",{address:"3545 Wilshire Blvd"})])).toHaveLength(2);
  });
  it("does not surface processing and cancelled movement cards", () => {
    expect(groupRouteVisits([stop("a",{kind:"processing"}),stop("b",{status:"cancelled"})])).toEqual([]);
  });
  it("chooses a scene only from explicit supplied evidence", () => {
    expect(chooseDriverScene(stop("a"))).toBe("century-park-east");
    expect(chooseDriverScene(stop("b",{title:"OPUS gym towels",address:"3545 Wilshire Blvd"}))).toBe("opus");
    expect(chooseDriverScene(stop("c",{title:"New customer",address:"123 Main Street"}))).toBe("plain");
    expect(chooseDriverScene(stop("d",{title:"Dog daycare",address:"Beverly Hills, California"}))).toBe("beverly-hills");
    expect(chooseDriverScene(stop("e",{title:"Silver Lake order",address:null}))).toBe("silver-lake");
  });
  it("requires an authoritative eligible action before allowing HOLD", () => {
    expect(canHoldToComplete(stop("a"))).toBe(false);
    expect(canHoldToComplete(stop("a",{action:{type:"order",orderId:42,status:"collected",eligible:true}}))).toBe(true);
    expect(canHoldToComplete(stop("a",{action:{type:"order",orderId:42,status:"collected",eligible:false}}))).toBe(false);
    expect(canHoldToComplete(stop("a",{status:"completed",action:{type:"order",orderId:42,status:"collected",eligible:true}}))).toBe(false);
  });
  it("does not treat locally saved state as authoritatively paid", () => {
    expect(hasSavedJob(stop("a"),new Set(["a"]))).toBe(true);
    expect(hasSavedJob(stop("b"),new Set(["a"]))).toBe(false);
  });
  it("parses valid times and leaves unknown times unknown", () => {
    expect(timeOfStop("12:00 PM")).toBe(720);
    expect(timeOfStop("8:30 PM")).toBe(1230);
    expect(timeOfStop("Appointment someday")).toBe(null);
  });
});
