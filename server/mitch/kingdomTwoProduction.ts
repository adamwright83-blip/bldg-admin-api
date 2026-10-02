/**
 * Mitch v1 — Kingdom Two Characterization & Production Specification
 *
 * Subject: kingdom.boreslay (Kingdom Two) per docs/JOYSTICK_SYSTEM_MAP.md.
 * Playable Game: minigame.boreslay_duel (client/src/components/boreslay-rally)
 *
 * ONTOLOGY & INVARIANTS:
 * 1. kingdom.boreslay is Kingdom Two. Its 1v1 game is minigame.boreslay_duel.
 * 2. Boreslay has its own correct semantic production identity in Mitch
 *    (mitch_game_production_states). It does NOT target or mutate the
 *    kingdom-2-the-last-valet row. The stored row kingdom-2-the-last-valet
 *    belongs to legacy The Last Valet chapter content. "The Last Valet" is NOT
 *    a second semantic name for kingdom.boreslay.
 * 3. The Last Valet remains Kingdom-linked chapter content (FirstChapter.tsx).
 *    It is NOT deleted or renamed, but is NOT the Kingdom Two production subject.
 * 4. companion.rook is the first Companion (earned at Colosseum resolution),
 *    NOT Kingdom Two's identity.
 * 5. Completing a chapter, mission, or level NEVER completes a Kingdom.
 *    Clearing rooms in a chapter is play state, not business truth, and never
 *    unlocks Kingdom 3.
 * 6. IMPLEMENTED ≠ VERIFIED ≠ CREATIVE-ACCEPTED ≠ RELEASED.
 * 7. Mitch never manufactures business evidence. The authoritative real-business
 *    growth campaign binding for minigame.boreslay_duel has not been authored in code.
 *    Therefore Mitch stops at HUMAN CREATIVE DECISION REQUIRED.
 * 8. Real Kingdom Two available and verified build pointers remain null:
 *    currentAvailableBuildId = null
 *    lastVerifiedBuildId = null
 *    until an actual executor produces the Boreslay installation and an actual
 *    gameplay QA runner exercises that exact build.
 * 9. Dispatch fails closed with MissingExecutionProviderError when no autonomous
 *    coding agent provider is present.
 */
import type {
  MitchGameProductionState,
} from "../../shared/mitchContracts";
import { MitchProductionService } from "./mitchService";
import type { IMitchProductionStore } from "./mitchStore";

export type KingdomTwoCharacterization = {
  canonicalGameId: "kingdom.boreslay";
  canonicalTitle: "Boreslay";
  sequence: 2;
  storedRowId: null;
  playableMinigame: "minigame.boreslay_duel";
  playableGameLocations: {
    duelEngine: "client/src/components/boreslay-rally/rallyEngine.ts";
    rallyComponent: "client/src/components/boreslay-rally/RallyDemo.tsx";
    publicBossDemo: "client/src/components/boreslay-demo/PublicBoreslayDemo.tsx";
    marketingLanding: "client/src/components/boreslay/BsCanonicalSections.tsx";
    standaloneRoute: "/boreslay-rally";
  };
  chapterContentRelation: {
    chapterId: "the-last-valet";
    hostComponent: "client/src/pages/GoldlineChapterHost.tsx";
    status: "The Last Valet is Kingdom-linked chapter content (FirstChapter.tsx); it is NOT the storage target or production identity of kingdom.boreslay";
  };
  realCampaignBindingStatus: {
    hasAuthoredBindingInCode: false;
    reason: "No authoritative sales/growth campaign binding is currently authored for minigame.boreslay_duel. The seed row campaign the-last-valet-recurring-account-pitch belongs to chapter content.";
  };
  inventory: {
    finished: string[];
    partial: string[];
    disconnected: string[];
    merelyDemo: string[];
    genuinelyMissing: string[];
  };
};

/**
 * Returns the exact current production reality of Kingdom Two from live main.
 */
export function characterizeKingdomTwoCurrentState(): KingdomTwoCharacterization {
  return {
    canonicalGameId: "kingdom.boreslay",
    canonicalTitle: "Boreslay",
    sequence: 2,
    storedRowId: null,
    playableMinigame: "minigame.boreslay_duel",
    playableGameLocations: {
      duelEngine: "client/src/components/boreslay-rally/rallyEngine.ts",
      rallyComponent: "client/src/components/boreslay-rally/RallyDemo.tsx",
      publicBossDemo: "client/src/components/boreslay-demo/PublicBoreslayDemo.tsx",
      marketingLanding: "client/src/components/boreslay/BsCanonicalSections.tsx",
      standaloneRoute: "/boreslay-rally",
    },
    chapterContentRelation: {
      chapterId: "the-last-valet",
      hostComponent: "client/src/pages/GoldlineChapterHost.tsx",
      status:
        "The Last Valet is Kingdom-linked chapter content (FirstChapter.tsx); it is NOT the storage target or production identity of kingdom.boreslay",
    },
    realCampaignBindingStatus: {
      hasAuthoredBindingInCode: false,
      reason:
        "No authoritative sales/growth campaign binding is currently authored for minigame.boreslay_duel. The seed row campaign the-last-valet-recurring-account-pitch belongs to chapter content.",
    },
    inventory: {
      finished: [
        "Playable Boreslay Duel engine (rallyEngine.ts) with Head Ball 2-influenced 1v1 mechanics against Clockhead",
        "RallyDemo component with real-time controls, kick powers, score tracking, audio, particles, and replay",
        "Public boss demo engine (client/src/components/boreslay-demo/engine.ts)",
        "Distinct 2.5D chapter simulation engine (FirstChapter.tsx) retained as Kingdom-linked chapter content",
      ],
      partial: [
        "Chapter persistence schema written (drizzle/0067) but unapplied to live DB",
        "Chapter event binding schema written (drizzle/0068) but unapplied to live DB",
      ],
      disconnected: [
        "Boreslay Duel (minigame.boreslay_duel) is disconnected from canonical Kingdom Two progression in goldlineKingdoms",
        "No route in the canonical product world (/play, /growth/lantern-city) launches Boreslay Duel as Kingdom Two",
        "No real-business growth campaign binding exists in code connecting real driver/sales work to Boreslay Duel",
      ],
      merelyDemo: [
        "/boreslay-rally on AdminHostRouter is an unauthenticated standalone preview route",
        "/boreslay is a public landing/demo route",
      ],
      genuinelyMissing: [
        "Installation of minigame.boreslay_duel into canonical Kingdom Two progression",
        "Authoritative real-business campaign binding for kingdom.boreslay / minigame.boreslay_duel",
        "Durable Mitch production state tracking exact builds vs verified builds",
        "Independent gameplay QA verifying an exact build before advancing the verified pointer",
      ],
    },
  };
}

export const KINGDOM_TWO_MILESTONE_INSTALL_DUEL = {
  milestoneKey: "k2_install_boreslay_duel_progression",
  sequence: 1,
  title: "Install Boreslay Duel into Canonical Kingdom Two Progression",
  desiredPlayerVisibleResult:
    "Player can access and play the Boreslay Duel minigame through canonical Goldline progression when Kingdom Two is active.",
  acceptanceCriteria: [
    "minigame.boreslay_duel is accessible from canonical Goldline progression",
    "Gated by authoritative kingdom.boreslay status (active)",
    "Preserves existing Boreslay Duel rally physics, Clockhead boss AI, and scoring",
    "Does not unlock Kingdom 3 from match completion",
    "Never manufactures business visits, revenue, or customer commitments",
  ],
  canonConstraints: [
    "kingdom.boreslay is Kingdom Two; minigame.boreslay_duel is that Kingdom's 1v1 game",
    "Preserve The Last Valet as Kingdom-linked chapter content without confusing it for Kingdom Two",
    "Preserve companion.rook as first Companion; do not assign Rook as Kingdom Two identity",
  ],
  relevantDependencies: [
    "client/src/components/boreslay-rally/RallyDemo.tsx",
    "client/src/components/boreslay-rally/rallyEngine.ts",
    "server/goldlineKingdoms/kingdomService.ts",
  ],
  realBusinessEvidenceConstraints: [
    "Mitch must never fabricate business evidence. A real campaign binding must be decided by human creative authority.",
  ],
  baseBranch: "main",
  requiredArtifact: "client/src/components/boreslay-rally/RallyDemo.tsx",
  requiredTests: [
    "client/src/components/boreslay-rally/rallyDuel.test.ts",
    "server/mitch/kingdomTwoProduction.test.ts",
  ],
};

/**
 * Seeds Mitch durable production state for Kingdom Two from canonical repository truth.
 *
 * INVARIANTS ENFORCED:
 * 1. Attaches to canonical gameId "kingdom.boreslay" with title "Boreslay".
 * 2. Leaves currentAvailableBuildId = null and lastVerifiedBuildId = null.
 * 3. Registers milestone with isHumanCreativeBlocker = true and blockedReason
 *    stating that the authoritative real-business binding must be decided by human
 *    creative authority (Adam).
 * 4. Mitch does NOT claim an autonomous execution or verified build has happened.
 */
export async function seedKingdomTwoProductionState(input: {
  tenantId: string;
  store: IMitchProductionStore;
  service: MitchProductionService;
}): Promise<MitchGameProductionState> {
  const characterization = characterizeKingdomTwoCurrentState();

  const state = await input.service.initializeOrLoadProductionState({
    tenantId: input.tenantId,
    canonicalGameId: characterization.canonicalGameId,
    titleOverride: characterization.canonicalTitle,
    realBusinessBindingOverride: null, // Legacy chapter campaign belongs to The Last Valet; no authored Boreslay binding exists
    coreMechanic: "1v1 Head Ball-influenced aerial soccer duel against Clockhead with powers and replay",
    companionDependency: null, // Rook is first Companion from Colosseum, not Kingdom Two identity
    requiredAssets: [
      "client/src/assets/boreslay-rally/duel-arena-background.png",
      "client/src/assets/boreslay-rally/procrastinator-v2.png",
      "client/src/assets/boreslay-rally/spark-sheet.webp",
    ],
    blockingDependencies: [
      "Authoritative real-business growth campaign binding for kingdom.boreslay",
    ],
  });

  // Register milestone 1 with explicit human creative blocker
  await input.service.registerMilestone({
    tenantId: input.tenantId,
    gameId: characterization.canonicalGameId,
    milestoneKey: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.milestoneKey,
    sequence: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.sequence,
    title: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.title,
    desiredPlayerVisibleResult: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.desiredPlayerVisibleResult,
    acceptanceCriteria: KINGDOM_TWO_MILESTONE_INSTALL_DUEL.acceptanceCriteria,
    blockedReason:
      "HUMAN CREATIVE DECISION REQUIRED: Real-business growth campaign binding for kingdom.boreslay / minigame.boreslay_duel must be decided by human creative authority (Adam).",
    isHumanCreativeBlocker: true,
  });

  return state;
}
