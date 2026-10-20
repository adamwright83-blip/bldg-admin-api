import { useCallback, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import { projectReunionProgress, type ReunionEventKind } from "@shared/silverLakeReunionEvents";
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
 * Reunion-quest state for the courtyard (docs/goldline/silver-lake-3d-slice/REUNION_QUESTS.md).
 *
 * Real decisions are read from the targets the outreach hook already projects. Fiction progress (item found, reunion
 * seen) and explicit passes are append-only server events for real customers; the synthetic preview keeps them in
 * memory and never writes. A pass for a real customer only counts once the server has recorded it.
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

const union = (a: ReadonlySet<string>, b: ReadonlySet<string>) => (b.size ? new Set([...a, ...b]) : a);

export function useReunionQuests(input: {
  enabled: boolean;
  synthetic: boolean;
  territoryId: string;
  targets: readonly CozyProjectedTarget[];
  spots: readonly QuestSpot[];
}) {
  const { enabled, synthetic, territoryId, targets, spots } = input;
  const [chain, setChain] = useState<QuestAssignment[] | null>(null);
  // this visit's own progress; for real customers the server's events are merged in below
  const [localPasses, setLocalPasses] = useState<ReadonlySet<string>>(() => new Set());
  const [localFound, setLocalFound] = useState<ReadonlySet<string>>(() => new Set());
  const [localReunited, setLocalReunited] = useState<ReadonlySet<string>>(() => new Set());

  const eventsQuery = trpc.system.goldlineWorld.reunionQuestEvents.useQuery(
    { territoryId },
    { enabled: enabled && !synthetic, staleTime: 5000, refetchOnWindowFocus: false }
  );
  const recordEvent = trpc.system.goldlineWorld.recordReunionQuestEvent.useMutation();
  const server = useMemo(
    () => (synthetic ? null : projectReunionProgress(eventsQuery.data?.events ?? [])),
    [synthetic, eventsQuery.data]
  );
  const passes = useMemo(() => union(server?.passes ?? new Set(), localPasses), [server, localPasses]);
  const found = useMemo(() => union(server?.found ?? new Set(), localFound), [server, localFound]);
  const reunited = useMemo(() => union(server?.reunited ?? new Set(), localReunited), [server, localReunited]);
  const progressReady = synthetic || eventsQuery.isSuccess || eventsQuery.isError;

  // the chain is assigned once per visit, from the targets as first projected; saved progress keeps its errand
  useEffect(() => {
    if (enabled && progressReady && !chain && targets.length > 0 && spots.length > 0)
      setChain(assignReunionQuests(targets, passes, undefined, server?.templateByCustomer));
  }, [enabled, progressReady, chain, targets, spots, passes, server]);

  const record = useCallback(
    (customerId: string, kind: ReunionEventKind) => {
      const templateId = chain?.find(q => q.customerId === customerId)?.template.id;
      if (synthetic || !templateId) return Promise.resolve();
      return recordEvent.mutateAsync({ territoryId, customerId, templateId, kind }).then(() => undefined);
    },
    [chain, synthetic, recordEvent, territoryId]
  );

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

  const pickItem = useCallback(
    (itemKey: string) => {
      const id = customerIdFromQuestKey(itemKey);
      if (!id) return;
      setLocalFound(prev => new Set(prev).add(id));
      record(id, "item_found").catch(err => console.warn("Reunion quest progress was not saved:", err));
    },
    [record]
  );

  /** gives the item back: the reunion starts, and from here on the customer stands beside the giver */
  const startReunion = useCallback(
    (customerId: string): ReunionBeat[] => {
      const q = quest(customerId);
      if (!q) return [];
      setLocalReunited(prev => new Set(prev).add(customerId));
      record(customerId, "reunited").catch(err => console.warn("Reunion quest progress was not saved:", err));
      return reunionBeats(q.template, q.slots);
    },
    [quest, record]
  );

  /**
   * The operator's explicit pass: a real decision, and nothing is sent. For a real customer it counts only after the
   * server has recorded it; a failure throws and nothing changes.
   */
  const pass = useCallback(
    async (customerId: string) => {
      await record(customerId, "passed");
      setLocalPasses(prev => new Set(prev).add(customerId));
    },
    [record]
  );

  const isPassed = useCallback((customerId: string) => passes.has(customerId), [passes]);

  /** the next quest a decision just unlocked, for a one-line note */
  const activeCustomerId = useMemo(() => {
    for (const [id, phase] of phases) if (phase !== "locked" && phase !== "done") return id;
    return null;
  }, [phases]);

  return {
    on: Boolean(enabled && chain),
    passing: recordEvent.isPending,
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
