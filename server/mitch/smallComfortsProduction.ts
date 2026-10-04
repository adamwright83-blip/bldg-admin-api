
import type { MitchGameProductionState, MitchWorkOrder } from "../../shared/mitchContracts";
import { MitchProductionService } from "./mitchService";
import type { IMitchProductionStore } from "./mitchStore";

export const SMALL_COMFORTS_GAME_ID = "game.small_comforts" as const;

export const SMALL_COMFORTS_PROPRIETOR_MILESTONE = {
  milestoneKey: "sc_proprietor_fun_proof",
  sequence: 1,
  title: "Prove the Lost Property proprietor is fun without NPC spectacle",
  desiredPlayerVisibleResult:
    "The player can leave the suitcase as a distinct tiny proprietor, explore the lost-property shelf, physically haul one useful object home, transform it, and see that choice alter resident life without depending on a canned guest-success animation.",
  acceptanceCriteria: [
    "A distinct proprietor avatar can walk the lost-property shelf and feels spatially separate from the furniture-placement cursor.",
    "Exactly three materially different salvage objects are discoverable in this proof: brass button, thimble, and spool.",
    "The player can carry or push only one salvage object at a time and receives clear feedback when hands are full.",
    "Returning salvage to the suitcase visibly transforms it into a fixture rather than merely incrementing inventory.",
    "At least one existing resident changes routine in response to the transformed fixture.",
    "The sealed tin can is visible as future-world mystery but is not playable in this milestone.",
    "The resulting fixture/routine state survives reload.",
    "No currency, fetch-quest ladder, extra salvage catalog, tin-can expansion, or main-branch merge is introduced merely to increase feature count.",
  ],
  canonConstraints: [
    "Small Comforts is the Lost Property Hotel fantasy: discarded human objects become architecture for tiny travelers.",
    "The proprietor must be enjoyable to control even when no guest animation is currently playing.",
    "The tin can remains a tease until the proprietor loop earns expansion.",
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
    "Capture of all three salvage interactions and carry-one rejection",
    "Capture of returning salvage home and resident reaction",
    "Capture of sealed tin-can tease",
    "Reload evidence proving persistence",
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
