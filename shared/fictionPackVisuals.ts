/**
 * Fiction Pack visual mapping — mobile/driver presentation only.
 *
 * Campaign Runs own truth (`shared/campaignRun.ts`). Fiction Packs own
 * interpretation (`shared/fictionPack.ts`). This file owns which approved
 * artwork dramatizes that already-derived state. It cannot mark a node
 * complete, invent a current target, or show a victory scene.
 *
 * Desktop/admin surfaces are out of scope. Unknown packs resolve to null
 * so existing missions keep their current art.
 */
import type { CampaignRunStatus, SlotProgress } from "./campaignRun";

export const BIO_CONTAINMENT_PACK_ID = "bio_containment";

const BIO_CONTAINMENT_ASSET_ROOT =
  "/assets/goldline/missions/bio-containment";

export type DetectorVisualState = "offline" | "active" | "online";

export type FictionPackVisuals = {
  missionHero: string;
  fieldBackground: string;
  missionIcon: string;
  antagonistComms: string;
  completionScene: string;
  detectorStates: {
    offline: string;
    active: string;
    online: string;
  };
};

/**
 * Central registry. Future packs add a keyed entry here rather than
 * scattering filenames through components.
 */
export const FICTION_PACK_VISUALS = {
  bio_containment: {
    missionHero: `${BIO_CONTAINMENT_ASSET_ROOT}/bio-containment-mission-hero.png`,
    fieldBackground: `${BIO_CONTAINMENT_ASSET_ROOT}/bio-containment-field-bg.png`,
    missionIcon: `${BIO_CONTAINMENT_ASSET_ROOT}/bio-containment-mission-icon.png`,
    antagonistComms: `${BIO_CONTAINMENT_ASSET_ROOT}/clockhead-field-comms.png`,
    completionScene: `${BIO_CONTAINMENT_ASSET_ROOT}/bio-containment-grid-complete.png`,
    detectorStates: {
      offline: `${BIO_CONTAINMENT_ASSET_ROOT}/detector-node-offline.png`,
      active: `${BIO_CONTAINMENT_ASSET_ROOT}/detector-node-active.png`,
      online: `${BIO_CONTAINMENT_ASSET_ROOT}/detector-node-online.png`,
    },
  },
} as const satisfies Record<string, FictionPackVisuals>;

export type RegisteredFictionPackId = keyof typeof FICTION_PACK_VISUALS;

export function resolveFictionPackVisuals(
  packId: string | null | undefined
): FictionPackVisuals | null {
  if (packId == null) return null;
  return packId in FICTION_PACK_VISUALS
    ? FICTION_PACK_VISUALS[packId as RegisteredFictionPackId]
    : null;
}

/**
 * The first unqualified slot is the current target. Qualified slots are
 * completed detectors. Tapping never enters this function — only derived
 * SlotProgress does.
 */
export function resolveCurrentTargetId(
  slots: readonly Pick<SlotProgress, "currentTargetId" | "qualified">[]
): string | null {
  return slots.find(slot => !slot.qualified)?.currentTargetId ?? null;
}

export function resolveDetectorVisualState(
  slot: Pick<SlotProgress, "currentTargetId" | "qualified">,
  currentTargetId: string | null
): DetectorVisualState {
  if (slot.qualified) return "online";
  if (currentTargetId != null && slot.currentTargetId === currentTargetId) {
    return "active";
  }
  return "offline";
}

/**
 * UI surfaces for the mobile mission. These name where the operator is
 * looking, not a second mission-status vocabulary. Authoritative run
 * status remains `CampaignRunStatus` plus derived `RunProgress`.
 */
export type CampaignRunVisualSurface =
  | "selector"
  | "briefing"
  | "field"
  | "antagonist_comms"
  | "complete";

export type CampaignRunVisualInput = {
  fictionPackId: string | null;
  runStatus: CampaignRunStatus;
  progressComplete: boolean;
  slots: readonly Pick<SlotProgress, "slotId" | "currentTargetId" | "qualified">[];
  /**
   * Mid-mission pack beats already reached (fraction < 1). Empty unless
   * the projection actually emitted them from campaign truth.
   */
  midMissionBeatIds: readonly string[];
  /**
   * True only while the existing mission logic is showing a Clockhead
   * communication. The art file is never used as a standing overlay.
   */
  antagonistCommsActive: boolean;
  /**
   * Operator has opened the field from briefing. Does not change
   * completion; it only chooses hero vs field while the run is still
   * incomplete with zero qualified nodes.
   */
  fieldEntered: boolean;
  surface: CampaignRunVisualSurface;
};

export type CampaignRunPresentedNode = {
  slotId: string;
  targetId: string;
  state: DetectorVisualState;
  src: string;
};

export type CampaignRunPresentedArt = {
  packId: string;
  visuals: FictionPackVisuals;
  scene: Exclude<CampaignRunVisualSurface, "selector">;
  sceneSrc: string;
  missionIcon: string;
  nodes: CampaignRunPresentedNode[];
  currentTargetId: string | null;
  preloadSrcs: string[];
};

function resolveScene(
  input: CampaignRunVisualInput
): Exclude<CampaignRunVisualSurface, "selector"> {
  if (input.progressComplete) return "complete";
  if (input.surface === "complete") {
    return input.fieldEntered || input.slots.some(slot => slot.qualified)
      ? "field"
      : "briefing";
  }
  if (
    input.antagonistCommsActive &&
    input.midMissionBeatIds.length > 0 &&
    (input.surface === "antagonist_comms" || input.surface === "field")
  ) {
    return "antagonist_comms";
  }
  if (input.surface === "briefing") {
    if (input.fieldEntered || input.slots.some(slot => slot.qualified)) {
      return "field";
    }
    return "briefing";
  }
  if (input.surface === "field" || input.surface === "antagonist_comms") {
    return "field";
  }
  if (input.fieldEntered || input.slots.some(slot => slot.qualified)) {
    return "field";
  }
  return "briefing";
}

function sceneSrcFor(
  visuals: FictionPackVisuals,
  scene: Exclude<CampaignRunVisualSurface, "selector">
): string {
  if (scene === "complete") return visuals.completionScene;
  if (scene === "antagonist_comms") return visuals.antagonistComms;
  if (scene === "field") return visuals.fieldBackground;
  return visuals.missionHero;
}

function preloadSrcsFor(
  visuals: FictionPackVisuals,
  scene: Exclude<CampaignRunVisualSurface, "selector">,
  progressComplete: boolean,
  qualifiedCount: number,
  total: number
): string[] {
  const srcs: string[] = [];
  if (scene === "briefing") srcs.push(visuals.fieldBackground);
  if (scene === "field" || scene === "antagonist_comms") {
    srcs.push(visuals.fieldBackground);
    if (!progressComplete && total > 0 && qualifiedCount / total >= 0.75) {
      srcs.push(visuals.completionScene);
    }
  }
  return srcs;
}

/**
 * Maps authoritative campaign-run state onto approved BIO CONTAINMENT art.
 * Returns null for any pack that has no visual mapping, so other missions
 * keep their existing treatment.
 */
export function presentCampaignRunArt(
  input: CampaignRunVisualInput
): CampaignRunPresentedArt | null {
  const visuals = resolveFictionPackVisuals(input.fictionPackId);
  if (!visuals || input.fictionPackId == null) return null;
  if (input.surface === "selector") {
    return {
      packId: input.fictionPackId,
      visuals,
      scene: "briefing",
      sceneSrc: visuals.missionHero,
      missionIcon: visuals.missionIcon,
      nodes: [],
      currentTargetId: resolveCurrentTargetId(input.slots),
      preloadSrcs: [],
    };
  }

  const scene = resolveScene(input);
  const currentTargetId = input.progressComplete
    ? null
    : resolveCurrentTargetId(input.slots);
  const nodes = input.slots.map(slot => {
    const state = resolveDetectorVisualState(slot, currentTargetId);
    return {
      slotId: slot.slotId,
      targetId: slot.currentTargetId,
      state,
      src: visuals.detectorStates[state],
    };
  });
  const qualifiedCount = input.slots.filter(slot => slot.qualified).length;

  return {
    packId: input.fictionPackId,
    visuals,
    scene,
    sceneSrc: sceneSrcFor(visuals, scene),
    missionIcon: visuals.missionIcon,
    nodes,
    currentTargetId,
    preloadSrcs: preloadSrcsFor(
      visuals,
      scene,
      input.progressComplete,
      qualifiedCount,
      input.slots.length
    ),
  };
}

export function allFictionPackVisualUrls(): string[] {
  return Object.values(FICTION_PACK_VISUALS).flatMap(visuals => [
    visuals.missionHero,
    visuals.fieldBackground,
    visuals.missionIcon,
    visuals.antagonistComms,
    visuals.completionScene,
    visuals.detectorStates.offline,
    visuals.detectorStates.active,
    visuals.detectorStates.online,
  ]);
}
