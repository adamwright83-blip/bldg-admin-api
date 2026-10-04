
import type { MitchGameProductionState, MitchWorkOrder } from "../../shared/mitchContracts";
import { MitchProductionService } from "./mitchService";
import type { IMitchProductionStore } from "./mitchStore";

export const SMALL_COMFORTS_GAME_ID = "game.small_comforts" as const;

export const SMALL_COMFORTS_PROPRIETOR_MILESTONE = {
  milestoneKey: "sc_proprietor_fun_proof",
  sequence: 1,
  title: "Prove physically manipulating the brass button into a signal mirror is fun",
  desiredPlayerVisibleResult:
    "The proprietor hauls the oversized brass button home; the player positions and angles it against the suitcase lining/window to catch passing train light, producing an immediate visible signal before the Conductor reacts.",
  acceptanceCriteria: [
    "One object only: the oversized brass button becomes a signal mirror through direct player manipulation.",
    "The player physically hauls the button home, then controls its position and angle against the suitcase lining/window.",
    "Wrong alignment is visibly understandable and nonpunitive.",
    "Correct alignment catches passing train light and creates a visible aha in the same frame.",
    "The Conductor reacts only after the player's successful physical alignment.",
    "No timed tinker sequence, automatic installation, generic crafting menu, or progress bar substitutes for manipulation.",
    "No tin can, currency, new objects, routine expansion, or merge.",
  ],
  canonConstraints: [
    "Small Comforts is the Lost Property Hotel fantasy: found human objects become architecture for tiny travelers.",
    "The unresolved prototype question is whether playing the proprietor and discovering a physical property is fun.",
    "Keep the proof to one brass button; do not expand resident routines before this agency question is tested.",
    "IMPLEMENTED, VERIFIED, CREATIVE-ACCEPTED, and RELEASED remain separate states.",
    "Adam retains final creative acceptance authority.",
  ],
  relevantDependencies: [
    "client/src/components/admin/control-room/SmallComforts/game/game.ts",
    "client/src/components/admin/control-room/SmallComforts/game/shelf.ts",
    "client/src/components/admin/control-room/SmallComforts/game/forage.ts",
    "client/src/components/admin/control-room/SmallComforts/game/fixtures.ts",
    "client/src/components/admin/control-room/SmallComforts/logic/foraging.ts",
  ],
  requiredTests: [
    "client/src/components/admin/control-room/SmallComforts/logic/foraging.test.ts",
    "client/src/components/admin/control-room/SmallComforts/logic/episode.test.ts",
    "pnpm check",
  ],
  requiredEvidence: [
    "Exact branch and commit SHA",
    "Playable preview/build identity or exact launch instructions",
    "Capture of proprietor walking the shelf",
    "Capture of physically hauling the brass button home",
    "Capture of visible wrong alignment and player-controlled position/angle",
    "Capture of same-frame reflected train light payoff, followed by the Conductor reaction",
    "Touch/landscape sanity result if practical",
    "Known UX/fun risks",
  ],
  defaultBaseBranch: "feat/small-comforts-proprietor-spike",
  defaultBaseSha: "f4d2f81036fdc1b348bd679fb58eb63059efde42",
} as const;

export async function seedSmallComfortsProducerWork(input: {
  tenantId: string;
  store: IMitchProductionStore;
  service: MitchProductionService;
  baseBranch?: string;
  baseSha?: string;
}): Promise<{ state: MitchGameProductionState; workOrder: MitchWorkOrder | null }> {
  const state = await input.service.initializeOrLoadProductionState({
    tenantId: input.tenantId,
    canonicalGameId: SMALL_COMFORTS_GAME_ID,
    titleOverride: "Small Comforts",
    realBusinessBindingOverride: null,
    coreMechanic:
      "Tiny Lost Property proprietor explores discarded human objects, improvises architecture, and changes resident life through physical salvage choices.",
    companionDependency: null,
    requiredAssets: [],
    blockingDependencies: [],
  });

  let milestone = await input.store.getMilestone(
    input.tenantId,
    SMALL_COMFORTS_GAME_ID,
    SMALL_COMFORTS_PROPRIETOR_MILESTONE.milestoneKey
  );
  if (!milestone) {
    milestone = await input.service.registerMilestone({
      tenantId: input.tenantId,
      gameId: SMALL_COMFORTS_GAME_ID,
      milestoneKey: SMALL_COMFORTS_PROPRIETOR_MILESTONE.milestoneKey,
      sequence: SMALL_COMFORTS_PROPRIETOR_MILESTONE.sequence,
      title: SMALL_COMFORTS_PROPRIETOR_MILESTONE.title,
      desiredPlayerVisibleResult: SMALL_COMFORTS_PROPRIETOR_MILESTONE.desiredPlayerVisibleResult,
      acceptanceCriteria: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.acceptanceCriteria],
    });
  }

  const orders = await input.store.listWorkOrders(input.tenantId, SMALL_COMFORTS_GAME_ID);
  const existing = orders
    .filter(order => order.milestoneKey === SMALL_COMFORTS_PROPRIETOR_MILESTONE.milestoneKey)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  if (existing) return { state, workOrder: existing };

  const workOrder = await input.service.createWorkOrder({
    tenantId: input.tenantId,
    gameId: SMALL_COMFORTS_GAME_ID,
    milestoneKey: SMALL_COMFORTS_PROPRIETOR_MILESTONE.milestoneKey,
    title: "Produce playable proprietor proof and evidence package",
    desiredPlayerVisibleResult: SMALL_COMFORTS_PROPRIETOR_MILESTONE.desiredPlayerVisibleResult,
    acceptanceCriteria: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.acceptanceCriteria],
    canonConstraints: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.canonConstraints],
    relevantDependencies: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.relevantDependencies],
    realBusinessEvidenceConstraints: [
      "This milestone is game-development work only; never manufacture or mutate real customer, revenue, or territory evidence.",
    ],
    baseBranch: input.baseBranch ?? SMALL_COMFORTS_PROPRIETOR_MILESTONE.defaultBaseBranch,
    baseSha: input.baseSha ?? SMALL_COMFORTS_PROPRIETOR_MILESTONE.defaultBaseSha,
    requiredArtifact: "client/src/components/admin/control-room/SmallComforts/game/game.ts",
    requiredTests: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.requiredTests],
    requiredEvidence: [...SMALL_COMFORTS_PROPRIETOR_MILESTONE.requiredEvidence],
  });

  return { state, workOrder };
}
