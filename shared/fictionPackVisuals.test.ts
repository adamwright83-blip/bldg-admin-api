import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveRunProgress,
  type CampaignTargetEvent,
  type RunTargetSlot,
} from "./campaignRun";
import {
  allFictionPackVisualUrls,
  BIO_CONTAINMENT_PACK_ID,
  FICTION_PACK_VISUALS,
  presentCampaignRunArt,
  resolveCurrentTargetId,
  resolveDetectorVisualState,
  resolveFictionPackVisuals,
} from "./fictionPackVisuals";

const RUN = "run-visuals";
const TOTAL = 8;

const slots: RunTargetSlot[] = Array.from({ length: TOTAL }, (_, index) => ({
  campaignRunId: RUN,
  slotId: `slot-${index + 1}`,
  originalTargetId: `t${index + 1}`,
}));

function presence(eventId: string, occurredAt: string): CampaignTargetEvent {
  return {
    eventId,
    campaignRunId: RUN,
    targetId: null,
    kind: "territory_presence",
    occurredAt,
    operatorUserId: "op-1",
    provenance: "device_location",
    epistemicState: "confirmed",
    supportingPresenceEventId: null,
    replacementTargetId: null,
    lat: 34.07,
    lng: -118.4,
    accuracyMeters: 10,
    note: null,
  };
}

function eventsFor(placed: number): CampaignTargetEvent[] {
  const ping = presence("p1", "2026-09-17T17:00:00.000Z");
  const placements = Array.from({ length: placed }, (_, index) => ({
    eventId: `e${index + 1}`,
    campaignRunId: RUN,
    targetId: `t${index + 1}`,
    kind: "placement_reported" as const,
    occurredAt: `2026-09-17T17:${String(10 + index).padStart(2, "0")}:00.000Z`,
    operatorUserId: "op-1",
    provenance: "operator_reported" as const,
    epistemicState: "confirmed" as const,
    supportingPresenceEventId: "p1",
    replacementTargetId: null,
    lat: null,
    lng: null,
    accuracyMeters: null,
    note: null,
  }));
  return [ping, ...placements];
}

function progressAt(placed: number) {
  return deriveRunProgress({
    campaignRunId: RUN,
    slots,
    events: eventsFor(placed),
  });
}

function midMissionBeatIds(placed: number): string[] {
  const fraction = placed / TOTAL;
  const ids: string[] = [];
  if (fraction >= 0.25 && fraction < 1) ids.push("bc_first_sector");
  if (fraction >= 0.5 && fraction < 1) ids.push("bc_half");
  if (fraction >= 0.75 && fraction < 1) ids.push("bc_three_quarter");
  return ids;
}

const PUBLIC_ROOT = join(__dirname, "../client/public");

describe("BIO CONTAINMENT visual mapping", () => {
  it("resolves the mission icon for bio_containment and nothing else", () => {
    expect(resolveFictionPackVisuals("bio_containment")?.missionIcon).toBe(
      FICTION_PACK_VISUALS.bio_containment.missionIcon
    );
    expect(resolveFictionPackVisuals("bio_containment")?.missionIcon).toContain(
      "bio-containment-mission-icon.png"
    );
    expect(resolveFictionPackVisuals("plain_operation")).toBeNull();
    expect(resolveFictionPackVisuals("neutralize-v1")).toBeNull();
    expect(resolveFictionPackVisuals(null)).toBeNull();
  });

  it("opening/brief state resolves the hero image", () => {
    const progress = progressAt(0);
    const art = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: progress.complete,
      slots: progress.slots,
      midMissionBeatIds: [],
      antagonistCommsActive: false,
      fieldEntered: false,
      surface: "briefing",
    });
    expect(art?.scene).toBe("briefing");
    expect(art?.sceneSrc).toContain("bio-containment-mission-hero.png");
  });

  it("active field state resolves the field background", () => {
    const progress = progressAt(1);
    const art = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: progress.complete,
      slots: progress.slots,
      midMissionBeatIds: [],
      antagonistCommsActive: false,
      fieldEntered: true,
      surface: "field",
    });
    expect(art?.scene).toBe("field");
    expect(art?.sceneSrc).toContain("bio-containment-field-bg.png");
  });

  it("unfinished node resolves detector-node-offline", () => {
    const progress = progressAt(1);
    const current = resolveCurrentTargetId(progress.slots);
    const unfinished = progress.slots.find(
      slot => !slot.qualified && slot.currentTargetId !== current
    );
    expect(unfinished).toBeTruthy();
    expect(resolveDetectorVisualState(unfinished!, current)).toBe("offline");
    const art = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: false,
      slots: progress.slots,
      midMissionBeatIds: [],
      antagonistCommsActive: false,
      fieldEntered: true,
      surface: "field",
    });
    expect(
      art?.nodes.find(node => node.targetId === unfinished!.currentTargetId)?.src
    ).toContain("detector-node-offline.png");
  });

  it("current target resolves detector-node-active", () => {
    const progress = progressAt(1);
    const current = resolveCurrentTargetId(progress.slots);
    expect(current).toBe("t2");
    expect(
      resolveDetectorVisualState(
        progress.slots.find(slot => slot.currentTargetId === current)!,
        current
      )
    ).toBe("active");
    const art = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: false,
      slots: progress.slots,
      midMissionBeatIds: [],
      antagonistCommsActive: false,
      fieldEntered: true,
      surface: "field",
    });
    expect(art?.nodes.find(node => node.targetId === current)?.src).toContain(
      "detector-node-active.png"
    );
  });

  it("completed node resolves detector-node-online", () => {
    const progress = progressAt(1);
    const completed = progress.slots.find(slot => slot.qualified)!;
    expect(completed.currentTargetId).toBe("t1");
    expect(resolveDetectorVisualState(completed, "t2")).toBe("online");
    const art = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: false,
      slots: progress.slots,
      midMissionBeatIds: [],
      antagonistCommsActive: false,
      fieldEntered: true,
      surface: "field",
    });
    expect(
      art?.nodes.find(node => node.targetId === completed.currentTargetId)?.src
    ).toContain("detector-node-online.png");
  });

  it("Clockhead communication resolves clockhead-field-comms only when that state is active", () => {
    const progress = progressAt(2);
    const beats = midMissionBeatIds(2);
    expect(beats.length).toBeGreaterThan(0);

    const comms = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: false,
      slots: progress.slots,
      midMissionBeatIds: beats,
      antagonistCommsActive: true,
      fieldEntered: true,
      surface: "antagonist_comms",
    });
    expect(comms?.scene).toBe("antagonist_comms");
    expect(comms?.sceneSrc).toContain("clockhead-field-comms.png");

    const ordinaryField = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: false,
      slots: progress.slots,
      midMissionBeatIds: beats,
      antagonistCommsActive: false,
      fieldEntered: true,
      surface: "field",
    });
    expect(ordinaryField?.scene).toBe("field");
    expect(ordinaryField?.sceneSrc).not.toContain("clockhead-field-comms.png");
    expect(ordinaryField?.sceneSrc).toContain("bio-containment-field-bg.png");
  });

  it("completed mission resolves bio-containment-grid-complete", () => {
    const progress = progressAt(TOTAL);
    expect(progress.complete).toBe(true);
    const art = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "complete",
      progressComplete: progress.complete,
      slots: progress.slots,
      midMissionBeatIds: [],
      antagonistCommsActive: false,
      fieldEntered: true,
      surface: "complete",
    });
    expect(art?.scene).toBe("complete");
    expect(art?.sceneSrc).toContain("bio-containment-grid-complete.png");
  });

  it("completion art cannot render from an uncompleted mission state", () => {
    const progress = progressAt(3);
    expect(progress.complete).toBe(false);
    const art = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: false,
      slots: progress.slots,
      midMissionBeatIds: midMissionBeatIds(3),
      antagonistCommsActive: true,
      fieldEntered: true,
      surface: "complete",
    });
    expect(art?.scene).not.toBe("complete");
    expect(art?.sceneSrc).not.toContain("bio-containment-grid-complete.png");
  });

  it("switching node state updates the resolved asset without any reload", () => {
    const before = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: false,
      slots: progressAt(0).slots,
      midMissionBeatIds: [],
      antagonistCommsActive: false,
      fieldEntered: true,
      surface: "field",
    });
    const after = presentCampaignRunArt({
      fictionPackId: BIO_CONTAINMENT_PACK_ID,
      runStatus: "active",
      progressComplete: false,
      slots: progressAt(1).slots,
      midMissionBeatIds: [],
      antagonistCommsActive: false,
      fieldEntered: true,
      surface: "field",
    });
    expect(before?.nodes[0]?.src).toContain("detector-node-active.png");
    expect(after?.nodes[0]?.src).toContain("detector-node-online.png");
    expect(after?.nodes[1]?.src).toContain("detector-node-active.png");
    expect(before?.sceneSrc).toContain("bio-containment-field-bg.png");
    expect(after?.sceneSrc).toContain("bio-containment-field-bg.png");
  });

  it("unknown/non-bio-containment missions retain their existing behavior", () => {
    const progress = progressAt(TOTAL);
    expect(
      presentCampaignRunArt({
        fictionPackId: "plain_operation",
        runStatus: "complete",
        progressComplete: true,
        slots: progress.slots,
        midMissionBeatIds: [],
        antagonistCommsActive: false,
        fieldEntered: true,
        surface: "complete",
      })
    ).toBeNull();
    expect(
      presentCampaignRunArt({
        fictionPackId: "colosseum",
        runStatus: "active",
        progressComplete: false,
        slots: progress.slots,
        midMissionBeatIds: [],
        antagonistCommsActive: false,
        fieldEntered: false,
        surface: "briefing",
      })
    ).toBeNull();
  });

  it("every mapped URL exists on disk as the approved PNG", () => {
    const urls = allFictionPackVisualUrls();
    expect(urls).toHaveLength(8);
    for (const url of urls) {
      expect(url.endsWith(".png")).toBe(true);
      expect(url.includes(".webp")).toBe(false);
      const diskPath = join(PUBLIC_ROOT, url.replace(/^\//, ""));
      expect(existsSync(diskPath), diskPath).toBe(true);
    }
  });

  it("does not invent a current target or online node from a tap-shaped request", () => {
    const progress = progressAt(0);
    const tapped = progress.slots[3];
    expect(resolveDetectorVisualState(tapped, resolveCurrentTargetId(progress.slots))).toBe(
      "offline"
    );
    expect(tapped.qualified).toBe(false);
  });
});
