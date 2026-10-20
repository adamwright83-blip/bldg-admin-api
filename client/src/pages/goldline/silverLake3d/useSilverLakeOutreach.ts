import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CozySlotId } from "@shared/cozyVillagerOutreach";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import {
  SYNTHETIC_SILVER_LAKE_TARGETS,
  loadNeighborhoodMemory,
  saveNeighborhoodMemory,
  type LetterApproachId,
  type NeighborhoodFeatureChoice,
  type NeighborhoodMemoryState,
  type VillagerVariant,
} from "@shared/playableVillagers";
import { SILVER_LAKE_MESSAGE_LABELS } from "@shared/silverLakeOutreachStatus";

/**
 * Silver Lake's business rails, for the walkable 3D courtyard. This is the same wiring the archived 2D encounter
 * (LanternCitySceneV6/CozyNeighborhoodEncounter.tsx) used, unchanged in behaviour: the cozyVillagerMission query, the
 * send and schedule mutations, the Phase 4 server-backed neighbourhood memory (feature placement, villager
 * interactions, unfinished drafts) with its local fallback, and the isolated synthetic preview that never mutates.
 */

export type DraftAction =
  | "draft_prepared"
  | "scheduled"
  | "compose_handoff_opened"
  | "operator_reported_sent"
  | "independently_verified_sent";

const TENANT_ID = "laundry_farm";

function param(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function useSilverLakeOutreach(territoryId: string) {
  const requestedId = (param("customer") ?? "").trim() || null;
  const showDevControls = useMemo(() => {
    if (typeof window === "undefined") return false;
    const p = new URLSearchParams(window.location.search);
    return p.has("dev") || p.has("preview") || p.has("composer") || p.has("debug");
  }, []);
  const [experienceMode, setExperienceMode] = useState<"playable" | "classic">(() => (param("composer") === "classic" ? "classic" : "playable"));
  const [isSyntheticPreview, setIsSyntheticPreview] = useState<boolean>(() => param("preview") === "synthetic");
  const [syntheticTargets, setSyntheticTargets] = useState<CozyProjectedTarget[]>(() => [...SYNTHETIC_SILVER_LAKE_TARGETS]);
  const [neighborhoodMemory, setNeighborhoodMemory] = useState<NeighborhoodMemoryState>(() => loadNeighborhoodMemory(TENANT_ID));
  const [selectedSlotId, setSelectedSlotId] = useState<CozySlotId | null>(null);

  const utils = trpc.useUtils();
  // the synthetic preview is isolated: it neither reads nor writes the real neighbourhood memory
  const memoryQuery = trpc.system.goldlineWorld.getNeighborhoodMemory.useQuery({ territoryId }, { staleTime: 5000, refetchOnWindowFocus: true, enabled: !isSyntheticPreview });
  const saveFeatureMutation = trpc.system.goldlineWorld.saveNeighborhoodFeature.useMutation();
  const recordInteractionMutation = trpc.system.goldlineWorld.recordVillagerInteraction.useMutation();
  const saveDraftMutation = trpc.system.goldlineWorld.saveUnfinishedLetterDraft.useMutation();

  useEffect(() => {
    if (memoryQuery.data && !isSyntheticPreview) {
      setNeighborhoodMemory(memoryQuery.data as NeighborhoodMemoryState);
      saveNeighborhoodMemory(memoryQuery.data as NeighborhoodMemoryState, TENANT_ID);
    }
  }, [memoryQuery.data, isSyntheticPreview]);

  const missionQuery = trpc.system.goldlineWorld.cozyVillagerMission.useQuery(
    { territoryId, requestedCustomerId: requestedId ?? undefined, limit: 8 },
    { staleTime: 0, refetchOnWindowFocus: true }
  );
  const sendMutation = trpc.system.goldlineWorld.sendCozyOutreachNow.useMutation();
  // The operator's explicit, append-only decision that this business focuses on this neighbourhood.
  const focusMutation = trpc.system.persistentOperator.decideOperatingMandate.useMutation();
  const [focusError, setFocusError] = useState<string | null>(null);
  const scheduleMutation = trpc.system.goldlineWorld.scheduleCozyOutreach.useMutation();

  const targets = useMemo(
    () => (isSyntheticPreview ? syntheticTargets : ((missionQuery.data?.targets ?? []) as CozyProjectedTarget[])),
    [isSyntheticPreview, syntheticTargets, missionQuery.data]
  );

  const selectedTarget = useMemo(() => (selectedSlotId ? targets.find(t => t.slotId === selectedSlotId) ?? null : null), [targets, selectedSlotId]);
  const selectedIndex = useMemo(() => targets.findIndex(t => t.slotId === selectedSlotId), [targets, selectedSlotId]);

  const refreshDurableEvidence = async () => {
    await Promise.all([
      utils.system.goldlineWorld.cozyVillagerMission.invalidate(),
      utils.system.goldlineWorld.cozyRecoveryDayLineCard.invalidate(),
      utils.system.goldlineWorld.listScheduledOutreach.invalidate(),
    ]);
  };

  const confirmFocus = async () => {
    setFocusError(null);
    const area = territoryId.replace(/-/g, " ");
    try {
      await focusMutation.mutateAsync({
        kind: "focus",
        action: "confirm",
        area,
        statement: `Recover lapsed customers in ${area.replace(/\b\w/g, c => c.toUpperCase())}`,
      });
      await refreshDurableEvidence();
    } catch (err) {
      setFocusError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSelectIndex = (index: number) => {
    if (index >= 0 && index < targets.length) setSelectedSlotId(targets[index].slotId);
  };

  const handleSendNow = async (target: CozyProjectedTarget, editedText: string, idempotencyKey: string) => {
    if (isSyntheticPreview) {
      setSyntheticTargets(prev =>
        prev.map(t =>
          t.customerId === target.customerId
            ? {
                ...t,
                status: "accepted" as const,
                communicationState: "send_observed",
                transport: "simulated",
                suggestedMessage: editedText,
                providerReceipt: {
                  messageSid: `simulated:msg_${Date.now()}`,
                  status: "dispatched",
                  sentAt: new Date().toISOString(),
                  evidenceName: "simulated_carrier_receipt",
                },
              }
            : t
        )
      );
      return;
    }
    try {
      await sendMutation.mutateAsync({
        customerId: target.customerId,
        messageBody: editedText,
        expectedPhone: target.phone ?? undefined,
        slotId: target.slotId,
        territoryId,
        idempotencyKey,
      });
      await refreshDurableEvidence();
    } catch (err) {
      alert(`Send could not be authorized: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleScheduleSend = async (target: CozyProjectedTarget, editedText: string, scheduledForIso: string, idempotencyKey?: string) => {
    if (isSyntheticPreview) {
      setSyntheticTargets(prev =>
        prev.map(t =>
          t.customerId === target.customerId
            ? {
                ...t,
                status: "scheduled" as const,
                communicationState: "scheduled",
                suggestedMessage: editedText,
                scheduledDraft: {
                  messageId: `synth_draft_${Date.now()}`,
                  scheduledFor: scheduledForIso,
                  timezone: "America/Los_Angeles",
                  currentMessageBody: editedText,
                },
              }
            : t
        )
      );
      return;
    }
    try {
      await scheduleMutation.mutateAsync({
        customerId: target.customerId,
        messageBody: editedText,
        scheduledFor: scheduledForIso,
        timezone: "America/Los_Angeles",
        expectedPhone: target.phone ?? undefined,
        slotId: target.slotId,
        territoryId,
        idempotencyKey,
      });
      await refreshDurableEvidence();
    } catch (err) {
      alert(`Schedule could not be committed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleChooseCourtyardFeature = async (choice: NeighborhoodFeatureChoice) => {
    const updated: NeighborhoodMemoryState = {
      ...neighborhoodMemory,
      featureChoice: choice,
      courtyardPlacedAt: new Date().toISOString(),
      lastVisitedAt: new Date().toISOString(),
    };
    setNeighborhoodMemory(updated);
    saveNeighborhoodMemory(updated, TENANT_ID);
    if (!isSyntheticPreview) {
      try {
        await saveFeatureMutation.mutateAsync({ territoryId, featureChoice: choice });
        await memoryQuery.refetch();
      } catch (err) {
        console.warn("Could not persist courtyard feature to server:", err);
      }
    }
  };

  const handleDraftCompleted = async (customerId: string, customerName: string, variant: VillagerVariant, action: DraftAction) => {
    // The synthetic preview has no server to project a phone hand-off, so it records it on the preview target itself
    // (never a send). Reunion quests read this as the operator's decision on that neighbour.
    if (isSyntheticPreview && (action === "compose_handoff_opened" || action === "operator_reported_sent")) {
      setSyntheticTargets(prev =>
        prev.map(t =>
          t.customerId === customerId
            ? { ...t, silverLakeStatus: { ...t.silverLakeStatus, message: action, label: SILVER_LAKE_MESSAGE_LABELS[action] } }
            : t
        )
      );
    }
    const currentCount = neighborhoodMemory.encounterCounts[variant] ?? 0;
    const updated: NeighborhoodMemoryState = {
      ...neighborhoodMemory,
      encounterCounts: { ...neighborhoodMemory.encounterCounts, [variant]: currentCount + 1 },
      lastDraftedCustomer: { customerId, customerName, variant, completedAt: new Date().toISOString(), actionType: action },
      unfinishedActivity: null,
    };
    setNeighborhoodMemory(updated);
    saveNeighborhoodMemory(updated, TENANT_ID);
    if (!isSyntheticPreview) {
      try {
        await recordInteractionMutation.mutateAsync({ territoryId, villagerVariant: variant, customerId, customerName, actionType: action });
        await memoryQuery.refetch();
      } catch (err) {
        console.warn("Could not persist villager interaction to server:", err);
      }
    }
  };

  const handleSaveUnfinishedDraft = async (draft: {
    customerId: string;
    customerName: string;
    villagerVariant: VillagerVariant;
    letterApproach: LetterApproachId;
    draftBody: string;
  }) => {
    const updated: NeighborhoodMemoryState = {
      ...neighborhoodMemory,
      unfinishedActivity: {
        customerId: draft.customerId,
        customerName: draft.customerName,
        villagerVariant: draft.villagerVariant,
        selectedApproach: draft.letterApproach,
        draftBody: draft.draftBody,
        updatedAt: new Date().toISOString(),
      },
    };
    setNeighborhoodMemory(updated);
    saveNeighborhoodMemory(updated, TENANT_ID);
    if (!isSyntheticPreview) {
      try {
        await saveDraftMutation.mutateAsync({
          territoryId,
          customerId: draft.customerId,
          customerName: draft.customerName,
          villagerVariant: draft.villagerVariant,
          selectedApproach: draft.letterApproach,
          draftBody: draft.draftBody,
        });
      } catch (err) {
        console.warn("Could not persist unfinished draft to server:", err);
      }
    }
  };

  const memoryNote = useMemo(() => {
    if (!neighborhoodMemory.lastDraftedCustomer) return null;
    const { customerName, actionType } = neighborhoodMemory.lastDraftedCustomer;
    if (actionType === "scheduled") return `${customerName}'s letter is resting safely on the morning dispatch shelf.`;
    if (actionType === "independently_verified_sent") return `We verified ${customerName}'s letter was delivered!`;
    if (actionType === "operator_reported_sent") return `You reported sending ${customerName}'s note from your phone.`;
    if (actionType === "compose_handoff_opened") return `We opened ${customerName}'s note in Google Messages on your handset.`;
    return `We prepared ${customerName}'s note for your phone.`;
  }, [neighborhoodMemory.lastDraftedCustomer]);

  return {
    tenantId: TENANT_ID,
    requestedId,
    showDevControls,
    experienceMode,
    setExperienceMode,
    isSyntheticPreview,
    setIsSyntheticPreview,
    targets,
    loading: !isSyntheticPreview && missionQuery.isLoading,
    loadFailed: !isSyntheticPreview && missionQuery.isError,
    /** the server withheld the list (e.g. the recovery objective could not be read): never present that as "nobody" */
    withheldReason: (!isSyntheticPreview && (missionQuery.data as { withheldReason?: string | null } | undefined)?.withheldReason) || null,
    emptyMeansNoLapsed: isSyntheticPreview || (missionQuery.data as { emptyMeansNoLapsedCustomers?: boolean } | undefined)?.emptyMeansNoLapsedCustomers === true,
    /** the selected business has no neighbourhood focus yet; the operator can confirm one */
    focusMissing: !isSyntheticPreview && (missionQuery.data as { focusMissing?: boolean } | undefined)?.focusMissing === true,
    confirmFocus,
    confirmingFocus: focusMutation.isPending,
    focusError,
    objectiveId: (missionQuery.data?.objectiveId ?? null) as string | null,
    isSending: sendMutation.isPending || scheduleMutation.isPending,
    neighborhoodMemory,
    memoryNote,
    selectedSlotId,
    setSelectedSlotId,
    selectedTarget,
    selectedIndex,
    handleSelectIndex,
    handleSendNow,
    handleScheduleSend,
    handleChooseCourtyardFeature,
    handleDraftCompleted,
    handleSaveUnfinishedDraft,
  };
}
