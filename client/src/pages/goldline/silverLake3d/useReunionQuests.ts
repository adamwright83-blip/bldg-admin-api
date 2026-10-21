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
  questTaskList,
  reunionBeats,
  stepIdFromItemKey,
  stepItemKey,
  stepItems,
  applyStepItem,
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
export const customerIdFromQuestKey = (key: string) => {
  if (key.startsWith("quest:")) return key.slice(6);
  if (!key.startsWith("item:")) return null;
  // a step prop is `item:<customerId>#<stepId>`
  const step = stepIdFromItemKey(key);
  return step ? key.slice(5, key.length - step.length - 1) : key.slice(5);
};

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
  // how far through a linked-step quest each customer's errand is (this visit; finishing it is "item found")
  const [stepAt, setStepAt] = useState<ReadonlyMap<string, number>>(() => new Map());

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

  /** the active quest's props are the only ones out in the world */
  const items = useMemo<QuestItemView[]>(() => {
    if (!chain) return [];
    return chain
      .filter(q => phases.get(q.customerId) === "need")
      .flatMap<QuestItemView>(q =>
        q.template.steps?.length
          ? stepItems(q.template, stepAt.get(q.customerId) ?? 0).map(st => ({
              key: stepItemKey(q.customerId, st.stepId),
              kind: st.kind,
              spotId: st.spotId,
              station: st.station,
            }))
          : [{ key: questItemKey(q.customerId), kind: q.template.item.kind, spotId: q.template.spotId }]
      );
  }, [chain, phases, stepAt]);

  /**
   * Picks up (or uses) a prop. A one-find quest's item is found at once. A step quest moves one step on, or says why
   * not yet (Pip without a glove: "OW"); its last step is "item found". Returns the line to show.
   */
  const pickItem = useCallback(
    (itemKey: string): { line: string; found: boolean; stepId: string | null; ok: boolean } => {
      const id = customerIdFromQuestKey(itemKey);
      if (!id) return { line: "", found: false, stepId: null, ok: false };
      const stepId = stepIdFromItemKey(itemKey);
      const template = byCustomer.get(id)?.template;
      let line = "";
      if (stepId && template?.steps?.length) {
        const at = stepAt.get(id) ?? 0;
        const use = applyStepItem(template, at, stepId);
        if (!use.ok) return { line: use.line, found: false, stepId, ok: false };
        setStepAt(prev => new Map(prev).set(id, use.next));
        if (use.next < template.steps.length) return { line: use.line, found: false, stepId, ok: true };
        line = use.line;
      }
      setLocalFound(prev => new Set(prev).add(id));
      record(id, "item_found").catch(err => console.warn("Reunion quest progress was not saved:", err));
      return { line, found: true, stepId, ok: true };
    },
    [record, byCustomer, stepAt]
  );

  /** a step quest's numbered tasks for the quest card, or null for a one-find errand */
  const tasks = useCallback(
    (customerId: string) => {
      const q = byCustomer.get(customerId);
      const phase = phases.get(customerId);
      if (!q?.template.tasks?.length || !phase) return null;
      const at = phase === "need" ? stepAt.get(customerId) ?? 0 : (q.template.steps?.length ?? 0);
      return questTaskList(q.template, at, phase);
    },
    [byCustomer, phases, stepAt]
  );
  /** whether this visit's step quest has reached a given step (the glove is on once "glove" is done) */
  const stepDone = useCallback(
    (customerId: string, stepId: string) => {
      const q = byCustomer.get(customerId);
      const i = q?.template.steps?.findIndex(st => st.id === stepId) ?? -1;
      if (i < 0) return false;
      const phase = phases.get(customerId);
      if (phase && phase !== "need" && phase !== "locked") return true;
      return (stepAt.get(customerId) ?? 0) > i;
    },
    [byCustomer, phases, stepAt]
  );
  /** test and capture hook: jump a step quest to a step (the synthetic preview only) */
  const jumpToStep = useCallback(
    (customerId: string, at: number) => {
      if (!synthetic) return;
      setStepAt(prev => new Map(prev).set(customerId, at));
    },
    [synthetic]
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
    tasks,
    stepDone,
    jumpToStep,
    startReunion,
    pass,
    isPassed,
    activeCustomerId,
    reunited,
    decided: (t: CozyProjectedTarget) => hasRealDecision(t, passes),
  };
}
