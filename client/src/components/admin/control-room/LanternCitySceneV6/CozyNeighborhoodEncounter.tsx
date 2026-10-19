import { useEffect, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  COZY_SLOT_IDS,
  COZY_SLOT_ANCHORS,
  type CozySlotId,
  type CozyCustomerTarget,
} from "@shared/cozyVillagerOutreach";
import {
  villagerSprite,
  type CozyProjectedTarget,
} from "@shared/cozyVillagerEvidence";
import {
  SYNTHETIC_SILVER_LAKE_TARGETS,
  loadNeighborhoodMemory,
  saveNeighborhoodMemory,
  type LetterApproachId,
  type NeighborhoodFeatureChoice,
  type NeighborhoodMemoryState,
  type VillagerVariant,
} from "@shared/playableVillagers";
import { CozyMessageComposer } from "./CozyMessageComposer";
import { PlayableLetterDesk } from "./PlayableLetterDesk";
import { NeighborhoodCourtyardFeature } from "./NeighborhoodCourtyardFeature";
import styles from "./cozy-neighborhood.module.css";

/** Canonical identity id from the URL, for example `phone:3105550141`. */
function requestedCustomerId(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("customer")?.trim() ?? "";
  return value.length > 0 ? value : null;
}

function requestedPreviewMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("preview") === "synthetic";
}

function requestedComposerMode(): "playable" | "classic" {
  if (typeof window === "undefined") return "playable";
  const val = new URLSearchParams(window.location.search).get("composer");
  return val === "classic" ? "classic" : "playable";
}

interface CozyNeighborhoodEncounterProps {
  territoryId?: string;
  onExit: () => void;
  onOpenCustomer?: (phone: string) => void;
}

export function CozyNeighborhoodEncounter({
  territoryId = "silver-lake",
  onExit,
}: CozyNeighborhoodEncounterProps) {
  const requestedId = requestedCustomerId();
  const [selectedSlotId, setSelectedSlotId] = useState<CozySlotId | null>(() =>
    requestedCustomerId() ? null : null
  );
  const [hoveredSlotId, setHoveredSlotId] = useState<CozySlotId | null>(null);

  // Tenant ID for Silver Lake recovery is strictly Laundry Farm
  const tenantId = "laundry_farm";

  // Development mode vs Production player experience
  const showDevControls = useMemo(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return (
      params.has("dev") ||
      params.has("preview") ||
      params.has("composer") ||
      params.has("debug")
    );
  }, []);

  // Experience Mode: Playable Letter Desk (New Phase 3) vs Classic Composer (Old Phase 1)
  const [experienceMode, setExperienceMode] = useState<"playable" | "classic">(() =>
    requestedComposerMode()
  );

  // Data Source: Real mission query vs Isolated synthetic preview
  const [isSyntheticPreview, setIsSyntheticPreview] = useState<boolean>(() =>
    requestedPreviewMode()
  );

  // Synthetic local targets state for safe simulation without mutations
  const [syntheticTargets, setSyntheticTargets] = useState<CozyProjectedTarget[]>(() => [
    ...SYNTHETIC_SILVER_LAKE_TARGETS,
  ]);

  // Persistent Neighborhood Memory & Consequences (tenant scoped to prevent leakage)
  const [neighborhoodMemory, setNeighborhoodMemory] = useState<NeighborhoodMemoryState>(() =>
    loadNeighborhoodMemory(tenantId)
  );

  const utils = trpc.useUtils();

  const memoryQuery = trpc.system.goldlineWorld.getNeighborhoodMemory.useQuery(
    { territoryId },
    { staleTime: 5000, refetchOnWindowFocus: true }
  );

  const saveFeatureMutation = trpc.system.goldlineWorld.saveNeighborhoodFeature.useMutation();
  const recordInteractionMutation = trpc.system.goldlineWorld.recordVillagerInteraction.useMutation();
  const saveDraftMutation = trpc.system.goldlineWorld.saveUnfinishedLetterDraft.useMutation();

  useEffect(() => {
    if (memoryQuery.data) {
      setNeighborhoodMemory(memoryQuery.data as NeighborhoodMemoryState);
      saveNeighborhoodMemory(memoryQuery.data as NeighborhoodMemoryState, tenantId);
    }
  }, [memoryQuery.data, tenantId]);

  const missionQuery = trpc.system.goldlineWorld.cozyVillagerMission.useQuery(
    { territoryId, requestedCustomerId: requestedId ?? undefined, limit: 8 },
    { staleTime: 0, refetchOnWindowFocus: true }
  );

  const sendMutation = trpc.system.goldlineWorld.sendCozyOutreachNow.useMutation();
  const scheduleMutation = trpc.system.goldlineWorld.scheduleCozyOutreach.useMutation();

  // Determine active targets based on data source
  const targets = useMemo(() => {
    if (isSyntheticPreview) {
      return syntheticTargets;
    }
    return (missionQuery.data?.targets ?? []) as CozyProjectedTarget[];
  }, [isSyntheticPreview, syntheticTargets, missionQuery.data]);

  useEffect(() => {
    if (!requestedId) return;
    const match = targets.find((target) => target.customerId === requestedId);
    if (match) setSelectedSlotId(match.slotId);
  }, [requestedId, targets]);

  const selectedTarget = useMemo(() => {
    if (!selectedSlotId) return null;
    return targets.find((t) => t.slotId === selectedSlotId) ?? null;
  }, [targets, selectedSlotId]);

  const selectedIndex = useMemo(() => {
    return targets.findIndex((t) => t.slotId === selectedSlotId);
  }, [targets, selectedSlotId]);

  const sentCount = useMemo(() => {
    return targets.filter(
      (t) =>
        t.silverLakeStatus?.message === "independently_verified_sent" ||
        t.communicationState === "send_observed" ||
        t.status === "accepted"
    ).length;
  }, [targets]);

  const refreshDurableEvidence = async () => {
    await Promise.all([
      utils.system.goldlineWorld.cozyVillagerMission.invalidate(),
      utils.system.goldlineWorld.cozyRecoveryDayLineCard.invalidate(),
      utils.system.goldlineWorld.listScheduledOutreach.invalidate(),
    ]);
  };

  const handleSelectSlot = (slotId: CozySlotId) => {
    setSelectedSlotId(slotId);
  };

  const handleSelectIndex = (index: number) => {
    if (index >= 0 && index < targets.length) {
      setSelectedSlotId(targets[index].slotId);
    }
  };

  // Immediate send action
  const handleSendNow = async (
    target: CozyProjectedTarget,
    editedText: string,
    idempotencyKey: string
  ) => {
    if (isSyntheticPreview) {
      // Safe synthetic state transition
      setSyntheticTargets((prev) =>
        prev.map((t) =>
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
    } catch (err: any) {
      alert(`Send could not be authorized: ${err.message}`);
    }
  };

  // Schedule send action
  const handleScheduleSend = async (
    target: CozyProjectedTarget,
    editedText: string,
    scheduledForIso: string,
    idempotencyKey?: string
  ) => {
    if (isSyntheticPreview) {
      // Safe synthetic state transition
      setSyntheticTargets((prev) =>
        prev.map((t) =>
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
    } catch (err: any) {
      alert(`Schedule could not be committed: ${err.message}`);
    }
  };

  // Neighborhood Consequence: Courtyard Feature Placement
  const handleChooseCourtyardFeature = async (choice: NeighborhoodFeatureChoice) => {
    const updated: NeighborhoodMemoryState = {
      ...neighborhoodMemory,
      featureChoice: choice,
      courtyardPlacedAt: new Date().toISOString(),
      lastVisitedAt: new Date().toISOString(),
    };
    setNeighborhoodMemory(updated);
    saveNeighborhoodMemory(updated, tenantId);
    if (!isSyntheticPreview) {
      try {
        await saveFeatureMutation.mutateAsync({
          territoryId,
          featureChoice: choice,
        });
        await memoryQuery.refetch();
      } catch (err) {
        console.warn("Could not persist courtyard feature to server:", err);
      }
    }
  };

  // Memory update when an outreach draft is completed
  const handleDraftCompleted = async (
    customerId: string,
    customerName: string,
    variant: any,
    action:
      | "draft_prepared"
      | "scheduled"
      | "compose_handoff_opened"
      | "operator_reported_sent"
      | "independently_verified_sent"
  ) => {
    const currentCount = neighborhoodMemory.encounterCounts[variant] ?? 0;
    const updated: NeighborhoodMemoryState = {
      ...neighborhoodMemory,
      encounterCounts: {
        ...neighborhoodMemory.encounterCounts,
        [variant]: currentCount + 1,
      },
      lastDraftedCustomer: {
        customerId,
        customerName,
        variant,
        completedAt: new Date().toISOString(),
        actionType: action,
      },
      unfinishedActivity: null,
    };
    setNeighborhoodMemory(updated);
    saveNeighborhoodMemory(updated, tenantId);
    if (!isSyntheticPreview) {
      try {
        await recordInteractionMutation.mutateAsync({
          territoryId,
          villagerVariant: variant,
          customerId,
          customerName,
          actionType: action,
        });
        await memoryQuery.refetch();
      } catch (err) {
        console.warn("Could not persist villager interaction to server:", err);
      }
    }
  };

  // Memory update when in-progress letter is edited
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
    saveNeighborhoodMemory(updated, tenantId);
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

  // Memory note generation for repeat interactions
  const memoryNote = useMemo(() => {
    if (!neighborhoodMemory.lastDraftedCustomer) return null;
    const { customerName, actionType } = neighborhoodMemory.lastDraftedCustomer;
    if (actionType === "scheduled") {
      return `${customerName}'s letter is resting safely on the morning dispatch shelf.`;
    }
    if (actionType === "independently_verified_sent") {
      return `We verified ${customerName}'s letter was delivered!`;
    }
    if (actionType === "operator_reported_sent") {
      return `You reported sending ${customerName}'s note from your phone.`;
    }
    if (actionType === "compose_handoff_opened") {
      return `We opened ${customerName}'s note in Google Messages on your handset.`;
    }
    return `We prepared ${customerName}'s note for your phone.`;
  }, [neighborhoodMemory.lastDraftedCustomer]);

  return (
    <div
      className={styles.encounterContainer}
      data-testid="cozy-neighborhood-encounter"
      data-experience-mode={experienceMode}
      data-preview-mode={isSyntheticPreview ? "synthetic" : "real"}
    >
      <div className={styles.viewportFrame}>
        {/* Clean Environment Plate (ASSET 02) */}
        <img
          src="/assets/lantern-villager-outreach/environment/lantern-neighborhood-environment.png"
          alt="Lantern City Cozy Neighborhood"
          className={styles.environmentPlate}
        />

        {/* 4-Sided Cloud Border Overlays (ASSET 03) */}
        <img
          src="/assets/lantern-villager-outreach/clouds/cloud-edge-top.png"
          alt=""
          className={styles.cloudEdgeTop}
        />
        <img
          src="/assets/lantern-villager-outreach/clouds/cloud-edge-bottom.png"
          alt=""
          className={styles.cloudEdgeBottom}
        />
        <img
          src="/assets/lantern-villager-outreach/clouds/cloud-edge-left.png"
          alt=""
          className={styles.cloudEdgeLeft}
        />
        <img
          src="/assets/lantern-villager-outreach/clouds/cloud-edge-right.png"
          alt=""
          className={styles.cloudEdgeRight}
        />
        <img
          src="/assets/lantern-villager-outreach/clouds/cloud-corners.png"
          alt=""
          className={styles.cloudCorners}
        />

        {/* Top Control & Development Comparison Bar */}
        <header className={styles.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div className={styles.titlePill}>
              <span className={styles.lanternIcon}>🏮</span>
              <span>
                {missionQuery.data?.territoryName ?? "Silver Lake"} • Cozy Outreach ({sentCount}/
                {targets.length} Send Observed)
              </span>
            </div>

            {/* Dev-only controls: hidden in clean production player experience */}
            {showDevControls && (
              <>
                {/* Comparison Mode Toggle: Version B (Playable Letter Desk) vs Version A (Classic Drawer) */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "rgba(30, 24, 20, 0.85)",
                    border: "1px solid rgba(220, 185, 140, 0.35)",
                    borderRadius: 9999,
                    padding: "3px 4px",
                    gap: 4,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
                  }}
                  data-testid="experience-mode-selector"
                >
                  <button
                    type="button"
                    style={{
                      background:
                        experienceMode === "playable"
                          ? "linear-gradient(180deg, #f7b733 0%, #ea9a1b 100%)"
                          : "transparent",
                      color: experienceMode === "playable" ? "#3b2203" : "#d1ba9f",
                      border: "none",
                      borderRadius: 9999,
                      padding: "4px 10px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => setExperienceMode("playable")}
                    data-testid="mode-playable-button"
                  >
                    ✍️ Playable Letter Desk (Phase 3)
                  </button>
                  <button
                    type="button"
                    style={{
                      background:
                        experienceMode === "classic"
                          ? "linear-gradient(180deg, #f7b733 0%, #ea9a1b 100%)"
                          : "transparent",
                      color: experienceMode === "classic" ? "#3b2203" : "#d1ba9f",
                      border: "none",
                      borderRadius: 9999,
                      padding: "4px 10px",
                      fontSize: 11.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => setExperienceMode("classic")}
                    data-testid="mode-classic-button"
                  >
                    📄 Classic Composer (Phase 1)
                  </button>
                </div>

                {/* Synthetic Preview vs Real Data Toggle */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: "rgba(30, 24, 20, 0.85)",
                    border: "1px solid rgba(220, 185, 140, 0.35)",
                    borderRadius: 9999,
                    padding: "3px 4px",
                    gap: 4,
                  }}
                  data-testid="data-mode-selector"
                >
                  <button
                    type="button"
                    style={{
                      background: !isSyntheticPreview ? "#3e6b48" : "transparent",
                      color: !isSyntheticPreview ? "#e8f7ec" : "#d1ba9f",
                      border: "none",
                      borderRadius: 9999,
                      padding: "4px 9px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                    onClick={() => setIsSyntheticPreview(false)}
                    data-testid="data-real-button"
                  >
                    Real Mission Data
                  </button>
                  <button
                    type="button"
                    style={{
                      background: isSyntheticPreview ? "#7a4282" : "transparent",
                      color: isSyntheticPreview ? "#faedfc" : "#d1ba9f",
                      border: "none",
                      borderRadius: 9999,
                      padding: "4px 9px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                    onClick={() => setIsSyntheticPreview(true)}
                    data-testid="data-synthetic-button"
                  >
                    🧪 Synthetic Preview
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Withheld or Empty State Feedback */}
          {missionQuery.data?.withheldReason && !isSyntheticPreview ? (
            <p className={styles.handoffNote} data-outreach-withheld="true">
              {missionQuery.data.withheldReason}
            </p>
          ) : missionQuery.data?.emptyMeansNoLapsedCustomers && !isSyntheticPreview ? (
            <p data-outreach-empty-verified="true">No inactive customers are in this area on the current book.</p>
          ) : null}
          {requestedId &&
          !isSyntheticPreview &&
          missionQuery.isSuccess &&
          !targets.some((target) => target.customerId === requestedId) ? (
            <p data-customer-not-in-village="true">
              {requestedId} is not a contactable customer in this village.
            </p>
          ) : null}

          <button
            type="button"
            className={styles.exitButton}
            onClick={onExit}
            aria-label="Return to Wide City"
          >
            <span>⤾</span> Return to Wide City
          </button>
        </header>

        {/* Reason to Return: Persistent Neighborhood Feature in Courtyard */}
        <NeighborhoodCourtyardFeature
          chosenFeature={neighborhoodMemory.featureChoice}
          onChooseFeature={handleChooseCourtyardFeature}
        />

        {/* 8 Distinct House Slots */}
        {COZY_SLOT_IDS.map((slotId) => {
          const anchor = COZY_SLOT_ANCHORS[slotId];
          const target = targets.find((t) => t.slotId === slotId);
          const isSelected = selectedSlotId === slotId;
          const isHovered = hoveredSlotId === slotId;

          if (!target) {
            // Unoccupied house slot
            return (
              <div
                key={slotId}
                className={styles.emptySlotIndicator}
                style={{
                  left: `${anchor.x * 100}%`,
                  top: `${anchor.y * 100}%`,
                  zIndex: anchor.zIndex,
                }}
              >
                {anchor.houseTitle} · Resting
              </div>
            );
          }

          const sendObserved =
            target.communicationState === "send_observed" || target.status === "accepted";
          const sprite = villagerSprite({
            variant: target.villagerVariant,
            communicationState: target.communicationState ?? (target.status === "accepted" ? "send_observed" : "draft_prepared"),
            selected: isSelected,
            hovered: isHovered,
          });

          return (
            <div
              key={slotId}
              className={`${styles.villagerSlot} ${isSelected ? styles.villagerSlotSelected : ""}`}
              style={{
                left: `${anchor.x * 100}%`,
                top: `${anchor.y * 100}%`,
                zIndex: anchor.zIndex,
              }}
              onClick={() => handleSelectSlot(slotId)}
              onMouseEnter={() => setHoveredSlotId(slotId)}
              onMouseLeave={() => setHoveredSlotId(null)}
              role="button"
              tabIndex={0}
              aria-label={`Select ${target.displayName}`}
              data-customer-id={target.customerId}
              data-house-title={anchor.houseTitle}
              data-communication-state={target.communicationState ?? (target.status === "accepted" ? "send_observed" : "draft_prepared")}
              data-pose={sprite.pose}
              data-transport={target.transport ?? ""}
            >
              {/* Ground Targeting Ring */}
              {isSelected && <div className={styles.selectionRing} />}

              {/* Decorative Expression Glyph Bubble */}
              {isSelected && (
                <div className={styles.glyphBubble} aria-hidden="true">
                  {sendObserved ? "✨🏮" : target.villagerVariant === "badger" ? "👓" : "❤️"}
                </div>
              )}

              {/* Villager Animated Sprite */}
              <img
                src={sprite.src}
                alt={target.displayName}
                className={styles.villagerSprite}
              />

              {/* Floating Name Tag */}
              <div className={styles.villagerTag}>
                <span>{target.displayName.split(" ")[0]}</span>
                {target.silverLakeStatus?.message === "independently_verified_sent" ? (
                  <span className={styles.statusIconSent}>
                    ✓ Verified sent
                  </span>
                ) : target.silverLakeStatus?.message === "operator_reported_sent" ? (
                  <span className={styles.statusIconSent}>
                    📱 Operator reported
                  </span>
                ) : target.silverLakeStatus?.message === "compose_handoff_opened" ? (
                  <span className={styles.statusIconScheduled}>
                    📱 Messages opened
                  </span>
                ) : target.silverLakeStatus?.message === "due_operator_action" ? (
                  <span className={styles.statusIconScheduled}>
                    ⚠️ Action due
                  </span>
                ) : target.silverLakeStatus?.message === "scheduled" ? (
                  <span className={styles.statusIconScheduled}>
                    ⏰ Scheduled
                  </span>
                ) : target.silverLakeStatus?.message === "awaiting_sender" ? (
                  <span className={styles.statusIconScheduled}>
                    📱 Handset
                  </span>
                ) : sendObserved ? (
                  <span className={styles.statusIconSent}>
                    {target.transport === "simulated" ? "Simulated send" : "Send observed"}
                  </span>
                ) : target.communicationLabel ? (
                  <span style={{ opacity: 0.85 }}>· {target.communicationLabel}</span>
                ) : (
                  <span style={{ opacity: 0.7 }}>· {target.daysSinceLastOrder}d</span>
                )}
              </div>
            </div>
          );
        })}

        {/* Selected Customer Experience: Version B (Playable Letter Desk) OR Version A (Classic Drawer) */}
        {selectedTarget && experienceMode === "playable" && (
          <PlayableLetterDesk
            target={selectedTarget}
            targetIndex={selectedIndex}
            totalTargets={targets.length}
            objectiveId={missionQuery.data?.objectiveId ?? null}
            isSending={sendMutation.isPending || scheduleMutation.isPending || false}
            isSynthetic={isSyntheticPreview}
            encounterCount={neighborhoodMemory.encounterCounts[selectedTarget.villagerVariant] ?? 1}
            memoryNote={memoryNote}
            neighborhoodMemory={neighborhoodMemory}
            tenantId={tenantId}
            onSendNow={handleSendNow}
            onScheduleSend={handleScheduleSend}
            onClose={() => setSelectedSlotId(null)}
            onSelectIndex={handleSelectIndex}
            onDraftCompleted={handleDraftCompleted}
            onSaveUnfinishedDraft={handleSaveUnfinishedDraft}
          />
        )}

        {selectedTarget && experienceMode === "classic" && (
          <CozyMessageComposer
            target={selectedTarget}
            targetIndex={selectedIndex}
            totalTargets={targets.length}
            objectiveId={missionQuery.data?.objectiveId ?? null}
            isSending={sendMutation.isPending || scheduleMutation.isPending || false}
            onSendNow={handleSendNow}
            onScheduleSend={handleScheduleSend}
            onClose={() => setSelectedSlotId(null)}
            onSelectIndex={handleSelectIndex}
          />
        )}
      </div>
    </div>
  );
}
