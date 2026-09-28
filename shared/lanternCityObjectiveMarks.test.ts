import { describe, expect, it } from "vitest";
import type {
  CampaignRun,
  CampaignTarget,
  CampaignTargetEvent,
  RunTargetSlot,
} from "./campaignRun";
import { projectCurrentDayLine, type CurrentDayLine } from "./currentDayLine";
import {
  projectLanternObjectiveMarks,
  type LanternRunInput,
} from "./lanternCityObjectiveMarks";

const TENANT = "tenant-a";
const RUN = "run-1";
const CAMPAIGN = "campaign-flyers";

function run(over: Partial<CampaignRun> = {}): CampaignRun {
  return {
    campaignRunId: RUN,
    tenantId: TENANT,
    operatorUserId: "driver-1",
    campaignId: CAMPAIGN,
    campaignVersion: 1,
    fictionPackId: "bio_containment",
    fictionPackVersion: 1,
    targetSetId: "set-1",
    startedAt: "2026-09-20T16:00:00.000Z",
    status: "active",
    completedAt: null,
    ...over,
  };
}

function target(id: string, lat: number | null = 34.1, lng: number | null = -118.3): CampaignTarget {
  return {
    targetId: id,
    targetSetId: "set-1",
    label: `Building ${id}`,
    address: `${id} Real St, Los Angeles, CA`,
    lat,
    lng,
    placementPoint: "front_door_knob",
    sourceNote: "operator walked it",
    provenance: "operator_observed",
  };
}

function slot(slotId: string, originalTargetId: string, campaignRunId = RUN): RunTargetSlot {
  return { campaignRunId, slotId, originalTargetId };
}

let seq = 0;
function event(over: Partial<CampaignTargetEvent> & Pick<CampaignTargetEvent, "kind">): CampaignTargetEvent {
  seq += 1;
  return {
    eventId: `evt-${seq}`,
    campaignRunId: RUN,
    targetId: null,
    occurredAt: `2026-09-21T17:${String(seq).padStart(2, "0")}:00.000Z`,
    operatorUserId: "driver-1",
    provenance: "operator_reported",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    lat: null,
    lng: null,
    accuracyMeters: null,
    note: null,
    ...over,
  };
}

function presenceAt(lat = 34.1001, lng = -118.3001, occurredAt?: string) {
  return event({
    kind: "territory_presence",
    provenance: "device_location",
    lat,
    lng,
    accuracyMeters: 12,
    ...(occurredAt ? { occurredAt } : {}),
  });
}

function dayLine(items: Array<{ id: string; title: string; completionCondition?: string; executionType?: "mission" | "challenge" | "hybrid_objective" | null }>, rankingStatus: CurrentDayLine["rankingStatus"] = "ranked"): CurrentDayLine {
  return projectCurrentDayLine({
    businessDate: "2026-09-28",
    rankingStatus,
    rankedWorks: items.map(item => ({
      id: item.id,
      title: item.title,
      objective: "",
      completionCondition: item.completionCondition ?? "",
      ...(item.executionType !== undefined ? { executionType: item.executionType } : {}),
    })),
    designated: null,
  });
}

function entry(over: Partial<LanternRunInput> = {}): LanternRunInput {
  return {
    run: run(),
    slots: [slot("s1", "t1"), slot("s2", "t2")],
    targets: [target("t1"), target("t2", 34.2, -118.4)],
    events: [],
    ...over,
  };
}

const todayLine = () => dayLine([{ id: CAMPAIGN, title: "Hang the Silver Lake flyers", executionType: "mission" }]);

describe("Lantern City objective marks — today", () => {
  it("emphasizes every current slot occupant of today's single active run, and picks none", () => {
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry()] });
    expect(out.todayStatus).toBe("ok");
    expect(out.today?.campaignRunId).toBe(RUN);
    expect(out.today?.targets.map(t => t.targetId)).toEqual(["t1", "t2"]);
    expect(out.today?.targets.every(t => t.level === null)).toBe(true);
  });

  it("is null when the Day Line is unavailable or has no plan", () => {
    expect(projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: null, runs: [entry()] }).todayStatus).toBe("day_line_unavailable");
    const unavailable = dayLine([], "unavailable");
    expect(projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: unavailable, runs: [entry()] }).today).toBeNull();
    const noPlan = dayLine([{ id: CAMPAIGN, title: "diagnostic" }], "no_plan");
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: noPlan, runs: [entry()] });
    expect(out.todayStatus).toBe("no_primary");
    expect(out.today).toBeNull();
  });

  it("uses Mission Director's first item, not a later one", () => {
    const line = dayLine([
      { id: "other-campaign", title: "First", executionType: "mission" },
      { id: CAMPAIGN, title: "Second", executionType: "mission" },
    ]);
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: line, runs: [entry()] });
    expect(out.todayStatus).toBe("no_active_run");
    expect(out.today).toBeNull();
  });

  it("puts a declared remote Challenge nowhere on the map", () => {
    const line = dayLine([{ id: CAMPAIGN, title: "Write the proposal", executionType: "challenge" }]);
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: line, runs: [entry()] });
    expect(out.todayStatus).toBe("remote_objective");
    expect(out.today).toBeNull();
  });

  it("fails closed when the campaign has no active run, or more than one", () => {
    const done = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry({ run: run({ status: "complete" }) })] });
    expect(done.todayStatus).toBe("no_active_run");
    const two = projectLanternObjectiveMarks({
      tenantId: TENANT,
      dayLine: todayLine(),
      runs: [entry(), entry({ run: run({ campaignRunId: "run-2" }), slots: [slot("s1", "t1", "run-2")] })],
    });
    expect(two.todayStatus).toBe("ambiguous_runs");
    expect(two.today).toBeNull();
  });

  it("never geocodes: a run whose targets carry no coordinates shows nothing", () => {
    const out = projectLanternObjectiveMarks({
      tenantId: TENANT,
      dayLine: todayLine(),
      runs: [entry({ targets: [target("t1", null, null), target("t2", null, null)] })],
    });
    expect(out.todayStatus).toBe("no_coordinates");
    expect(out.today).toBeNull();
  });

  it("fails closed when even one current target lacks coordinates", () => {
    const out = projectLanternObjectiveMarks({
      tenantId: TENANT,
      dayLine: todayLine(),
      runs: [entry({ targets: [target("t1"), target("t2", null, null)] })],
    });
    expect(out.todayStatus).toBe("no_coordinates");
    expect(out.today).toBeNull();
  });

  it("offers Driver launch only for the signed-in operator's supported run", () => {
    const own = projectLanternObjectiveMarks({
      tenantId: TENANT,
      operatorId: "7",
      viewerOpenId: "driver-1",
      dayLine: todayLine(),
      runs: [entry()],
    });
    expect(own.today?.driverOpenable).toBe(true);

    const otherOperator = projectLanternObjectiveMarks({
      tenantId: TENANT,
      operatorId: "7",
      viewerOpenId: "driver-2",
      dayLine: todayLine(),
      runs: [entry()],
    });
    expect(otherOperator.today?.driverOpenable).toBe(false);

    const unsupportedPack = projectLanternObjectiveMarks({
      tenantId: TENANT,
      operatorId: "7",
      viewerOpenId: "driver-1",
      dayLine: todayLine(),
      runs: [entry({ run: run({ fictionPackId: null }) })],
    });
    expect(unsupportedPack.today?.driverOpenable).toBe(false);
  });
});

describe("Lantern City objective marks — evidence", () => {
  it("territory presence is an area mark at the observed point and never marks a building", () => {
    const p = presenceAt(34.1003, -118.3004);
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry({ events: [p] })] });
    expect(out.presence).toEqual([
      expect.objectContaining({ eventId: p.eventId, latitude: 34.1003, longitude: -118.3004, accuracyMeters: 12 }),
    ]);
    expect(out.targets).toEqual([]);
    expect(out.today?.targets.every(t => t.level === null)).toBe(true);
  });

  it("presence without device_location provenance or confirmation is not drawn", () => {
    const asserted = event({ kind: "territory_presence", provenance: "operator_reported", lat: 34.1, lng: -118.3 });
    const unsure = event({ kind: "territory_presence", provenance: "device_location", epistemicState: "inferred", lat: 34.1, lng: -118.3 });
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry({ events: [asserted, unsure] })] });
    expect(out.presence).toEqual([]);
  });

  it("a placement names its target: that target becomes reported", () => {
    const placement = event({ kind: "placement_reported", targetId: "t1" });
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry({ events: [placement] })] });
    expect(out.targets).toEqual([
      expect.objectContaining({ targetId: "t1", level: "reported", evidence: [expect.objectContaining({ eventId: placement.eventId })] }),
    ]);
    expect(out.today?.targets.find(t => t.targetId === "t1")?.level).toBe("reported");
    expect(out.today?.targets.find(t => t.targetId === "t2")?.level).toBeNull();
  });

  it("a placement plus a photo on the same target is evidenced", () => {
    const placement = event({ kind: "placement_reported", targetId: "t2" });
    const photo = event({ kind: "supporting_photo", targetId: "t2" });
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry({ events: [placement, photo] })] });
    expect(out.targets.map(t => [t.targetId, t.level])).toEqual([["t2", "evidenced"]]);
  });

  it("completed comes from that slot's own qualified state, with the presence event in its receipt", () => {
    const p = presenceAt();
    const placement = event({ kind: "placement_reported", targetId: "t1", supportingPresenceEventId: p.eventId });
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry({ events: [p, placement] })] });
    const t1 = out.targets.find(t => t.targetId === "t1");
    expect(t1?.level).toBe("completed");
    expect(t1?.evidence.map(e => e.eventId).sort()).toEqual([p.eventId, placement.eventId].sort());
    expect(out.targets.find(t => t.targetId === "t2")).toBeUndefined();
  });

  it("whole-run completion never marks a target that has no evidence of its own", () => {
    const p = presenceAt();
    const placement = event({ kind: "placement_reported", targetId: "t1", supportingPresenceEventId: p.eventId });
    const out = projectLanternObjectiveMarks({
      tenantId: TENANT,
      dayLine: null,
      runs: [entry({ run: run({ status: "complete" }), events: [p, placement] })],
    });
    expect(out.targets.map(t => t.targetId)).toEqual(["t1"]);
  });

  it("a replaced target never lights; its replacement carries the slot", () => {
    const replaced = event({ kind: "target_replaced", targetId: "t1", replacementTargetId: "t3" });
    const oldPlacement = event({ kind: "placement_reported", targetId: "t1" });
    const newPlacement = event({ kind: "placement_reported", targetId: "t3" });
    const out = projectLanternObjectiveMarks({
      tenantId: TENANT,
      dayLine: todayLine(),
      runs: [entry({ targets: [target("t1"), target("t2"), target("t3", 34.3, -118.5)], events: [replaced, oldPlacement, newPlacement] })],
    });
    expect(out.targets.map(t => t.targetId)).toEqual(["t3"]);
    // Ordered by slot: slot s1 now holds t3, slot s2 still holds t2.
    expect(out.today?.targets.map(t => t.targetId)).toEqual(["t3", "t2"]);
  });

  it("unconfirmed evidence changes nothing", () => {
    const placement = event({ kind: "placement_reported", targetId: "t1", epistemicState: "unknown" });
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry({ events: [placement] })] });
    expect(out.targets).toEqual([]);
  });
});

describe("Lantern City objective marks — isolation and reload", () => {
  it("a run from another tenant contributes nothing", () => {
    const foreign = entry({
      run: run({ tenantId: "tenant-b" }),
      events: [presenceAt(), event({ kind: "placement_reported", targetId: "t1" })],
    });
    const out = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [foreign] });
    expect(out.presence).toEqual([]);
    expect(out.targets).toEqual([]);
    expect(out.todayStatus).toBe("no_active_run");
  });

  it("the same records always rebuild the same marks, whatever order they arrive in", () => {
    const p = presenceAt();
    const events = [
      p,
      event({ kind: "placement_reported", targetId: "t1", supportingPresenceEventId: p.eventId }),
      event({ kind: "placement_reported", targetId: "t2" }),
      event({ kind: "supporting_photo", targetId: "t2" }),
    ];
    const a = projectLanternObjectiveMarks({ tenantId: TENANT, dayLine: todayLine(), runs: [entry({ events })] });
    const b = projectLanternObjectiveMarks({
      tenantId: TENANT,
      dayLine: todayLine(),
      runs: [entry({ events: [...events].reverse(), slots: [slot("s2", "t2"), slot("s1", "t1")], targets: [target("t2", 34.2, -118.4), target("t1")] })],
    });
    expect(b).toEqual(a);
  });

  it("no v1 level reads as a customer, account or revenue outcome", () => {
    const levels = new Set(["reported", "evidenced", "completed"]);
    const p = presenceAt();
    const out = projectLanternObjectiveMarks({
      tenantId: TENANT,
      dayLine: todayLine(),
      runs: [entry({ events: [p, event({ kind: "placement_reported", targetId: "t1", supportingPresenceEventId: p.eventId })] })],
    });
    for (const mark of out.targets) expect(levels.has(mark.level)).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/revenue|won|customer|paid/i);
  });
});
