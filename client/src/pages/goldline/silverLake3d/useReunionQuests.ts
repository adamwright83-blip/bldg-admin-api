import { useCallback, useEffect, useMemo, useState } from "react";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import {
  assignReunionQuests,
  fillLine,
  hasRealDecision,
  questPhases,
  questSlotsFor,
  reunionBeats,
  type QuestAssignment,
  type QuestPhase,
  type QuestSlots,
  type QuestSpot,
  type ReunionBeat,
  type ReunionQuestTemplate,
} from "./reunionQuests";
import type { QuestItemView } from "./silverLakeRuntime";

/**
 * Reunion-quest state for one visit to the courtyard (docs/goldline/silver-lake-3d-slice/REUNION_QUESTS.md).
 *
 * Fiction progress (item found, reunion seen) and passes live here, in memory. Real decisions are read from the
 * targets the outreach hook already projects. Quests are only switched on for the synthetic preview: a pass for a
 * real customer needs a server record first, which does not exist yet.
 */

export const questGiverKey = (customerId: string) => `quest:${customerId}`;
export const questItemKey = (customerId: string) => `item:${customerId}`;
export const customerIdFromQuestKey = (key: string) =>
  key.startsWith("quest:") ? key.slice(6) : key.startsWith("item:") ? key.slice(5) : null;

export type ActiveQuest = {
  assignment: QuestAssignment;
  template: ReunionQuestTemplate;
  target: CozyProjectedTarget;
  phase: QuestPhase;
  slots: QuestSlots;
  /** the giver's line for this phase, filled */
  line: string;
};

export function useReunionQuests(enabled: boolean, targets: readonly CozyProjectedTarget[], spots: readonly QuestSpot[]) {
  const [chain, setChain] = useState<QuestAssignment[] | null>(null);
  const [passes, setPasses] = useState<ReadonlySet<string>>(() => new Set());
  const [found, setFound] = useState<ReadonlySet<string>>(() => new Set());
  const [reunited, setReunited] = useState<ReadonlySet<string>>(() => new Set());

  // the chain is assigned once per visit, from the targets as first projected
  useEffect(() => {
    if (enabled && !chain && targets.length > 0 && spots.length > 0) setChain(assignReunionQuests(targets));
  }, [enabled, chain, targets, spots]);

  const targetsById = useMemo(() => new Map(targets.map(t => [t.customerId, t])), [targets]);
  const spotsById = useMemo(() => new Map(spots.map(s => [s.id, s])), [spots]);
  const phases = useMemo(
    () => (chain ? questPhases(chain, targetsById, passes, { found, reunited }) : new Map<string, QuestPhase>()),
    [chain, targetsById, passes, found, reunited]
  );
  const byCustomer = useMemo(() => new Map((chain ?? []).map(q => [q.customerId, q])), [chain]);

  const quest = useCallback(
    (customerId: string): ActiveQuest | null => {
      const assignment = byCustomer.get(customerId);
      const target = targetsById.get(customerId);
      const phase = phases.get(customerId);
      if (!assignment || !target || !phase) return null;
      const template = assignment.template;
      const slots = questSlotsFor(template, spotsById.get(template.spotId) ?? null, target);
      const raw =
        phase === "locked"
          ? template.lines.locked
          : phase === "need"
            ? template.lines.need
            : phase === "carrying"
              ? template.lines.carrying
              : phase === "waiting"
                ? template.lines.waiting
                : template.lines.thanks;
      return { assignment, template, target, phase, slots, line: fillLine(raw, slots) ?? "" };
    },
    [byCustomer, targetsById, phases, spotsById]
  );

  /** the active quest's prop is the only one out in the world */
  const items = useMemo<QuestItemView[]>(() => {
    if (!chain) return [];
    return chain
      .filter(q => phases.get(q.customerId) === "need")
      .map(q => ({ key: questItemKey(q.customerId), kind: q.template.item.kind, spotId: q.template.spotId }));
  }, [chain, phases]);

  const pickItem = useCallback((itemKey: string) => {
    const id = customerIdFromQuestKey(itemKey);
    if (id) setFound(prev => new Set(prev).add(id));
  }, []);

  /** gives the item back: the reunion starts, and from here on the customer stands beside the giver */
  const startReunion = useCallback(
    (customerId: string): ReunionBeat[] => {
      const q = quest(customerId);
      if (!q) return [];
      setReunited(prev => new Set(prev).add(customerId));
      return reunionBeats(q.template, q.slots);
    },
    [quest]
  );

  /** the operator's explicit pass: a real decision, and nothing is sent */
  const pass = useCallback((customerId: string) => {
    setPasses(prev => new Set(prev).add(customerId));
  }, []);

  const isPassed = useCallback((customerId: string) => passes.has(customerId), [passes]);

  /** the next quest a decision just unlocked, for a one-line note */
  const activeCustomerId = useMemo(() => {
    for (const [id, phase] of phases) if (phase !== "locked" && phase !== "done") return id;
    return null;
  }, [phases]);

  return {
    on: Boolean(enabled && chain),
    chain: chain ?? [],
    phases,
    quest,
    items,
    pickItem,
    startReunion,
    pass,
    isPassed,
    activeCustomerId,
    reunited,
    decided: (t: CozyProjectedTarget) => hasRealDecision(t, passes),
  };
}
