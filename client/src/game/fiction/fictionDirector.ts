/**
 * Fiction Director — the runtime entry point for Layer 3.
 *
 * `selectFictionForMission` is the only function that decides which genre
 * episode a real action plays as. It NEVER creates, resizes, or relocates
 * the underlying `ActionGrammar` it is given — that argument comes from
 * Layer 1/2 and is treated as read-only input. Registry-evolution safety and
 * cross-reload stability both come from checking persisted storage FIRST,
 * before ever deriving a fresh assignment.
 */
import {
  deriveFictionAssignment,
  eligibleTemplates,
  stableMissionKey as buildStableMissionKey,
  type FictionTemplate,
} from "../../../../shared/fictionTemplate";
import type { ActionGrammar } from "../../../../shared/actionGrammar";
import {
  loadFictionAssignment,
  saveFictionAssignmentIfAbsent,
  type FictionAssignmentIdentity,
} from "./fictionAssignmentStorage";
import { FICTION_TEMPLATE_REGISTRY } from "./templateRegistry";

export type FictionMissionInstance = {
  stableMissionKey: string;
  template: FictionTemplate;
  grammar: ActionGrammar;
};

/**
 * Resolves the fiction for a real, grammar-eligible action.
 *
 * Returns null when nothing is eligible for this grammar, or when a persisted
 * template id no longer exists in the registry (fails safe: the real action
 * is presented without a genre episode). Sensitive conversations may bind
 * only to `humanInteractionCompatible` templates with no timer.
 */
export function selectFictionForMission(
  grammar: ActionGrammar,
  input: {
    now: Date;
    identity?: FictionAssignmentIdentity;
    registry?: readonly FictionTemplate[];
    fictionRulesVersion?: number;
  }
): FictionMissionInstance | null {
  const registry = input.registry ?? FICTION_TEMPLATE_REGISTRY;
  const rulesVersion = input.fictionRulesVersion ?? 1;
  const key = buildStableMissionKey({
    businessActionId: grammar.businessActionId,
    occurrenceId: grammar.occurrenceId,
    grammarKind: grammar.kind,
    fictionRulesVersion: rulesVersion,
  });

  // Persistence-first: an already-instantiated mission keeps its movie no
  // matter how the registry has evolved since.
  const persisted = loadFictionAssignment(key, input.identity ?? null);
  if (persisted) {
    const template = registry.find(item => item.id === persisted.templateId);
    if (!template) return null;
    return { stableMissionKey: key, template, grammar };
  }

  const assignment = deriveFictionAssignment(key, registry, grammar);
  if (!assignment) return null;
  const template = registry.find(item => item.id === assignment.templateId);
  if (!template) return null;

  saveFictionAssignmentIfAbsent(
    {
      stableMissionKey: key,
      templateId: assignment.templateId,
      rulesVersion: assignment.rulesVersion,
      instantiatedAt: input.now.toISOString(),
    },
    input.identity ?? null
  );

  return { stableMissionKey: key, template, grammar };
}

/** Exposed for Stronghold/authoring tooling that wants to preview eligible templates. */
export function eligibleFictionTemplates(
  grammar: ActionGrammar,
  registry: readonly FictionTemplate[] = FICTION_TEMPLATE_REGISTRY
): FictionTemplate[] {
  return eligibleTemplates(registry, grammar);
}
