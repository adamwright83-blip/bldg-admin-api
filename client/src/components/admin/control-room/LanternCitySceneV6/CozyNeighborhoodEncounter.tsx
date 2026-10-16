import { useEffect, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  COZY_SLOT_IDS,
  COZY_SLOT_ANCHORS,
  type CozySlotId,
} from "@shared/cozyVillagerOutreach";
import {
  villagerSprite,
  type CozyProjectedTarget,
} from "@shared/cozyVillagerEvidence";
import { CozyMessageComposer } from "./CozyMessageComposer";
import styles from "./cozy-neighborhood.module.css";

/** Canonical identity id from the URL, for example `phone:3105550141`. */
function requestedCustomerId(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("customer")?.trim() ?? "";
  return value.length > 0 ? value : null;
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
    requestedCustomerId() ? null : "slot_01"
  );
  const [hoveredSlotId, setHoveredSlotId] = useState<CozySlotId | null>(null);
  const utils = trpc.useUtils();

  const missionQuery = trpc.system.goldlineWorld.cozyVillagerMission.useQuery(
    { territoryId, limit: 8 },
    { staleTime: 0, refetchOnWindowFocus: true }
  );

  const sendMutation = trpc.system.goldlineWorld.sendCozyOutreachNow.useMutation();
  const scheduleMutation = trpc.system.goldlineWorld.scheduleCozyOutreach.useMutation();

  const targets = useMemo(() => {
    return (missionQuery.data?.targets ?? []) as CozyProjectedTarget[];
  }, [missionQuery.data]);

  useEffect(() => {
    if (!requestedId) return;
    const match = targets.find((target) => target.customerId === requestedId);
    if (match) setSelectedSlotId(match.slotId);
  }, [requestedId, targets]);

  const selectedTarget = useMemo(() => {
    const bySlot = targets.find((t) => t.slotId === selectedSlotId);
    if (bySlot) return bySlot;
    if (requestedId) return null;
    return targets[0] ?? null;
  }, [targets, selectedSlotId, requestedId]);

  const selectedIndex = useMemo(() => {
    return targets.findIndex((t) => t.slotId === selectedSlotId);
  }, [targets, selectedSlotId]);

  const sentCount = useMemo(() => {
    return targets.filter((t) => t.communicationState === "send_observed").length;
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

  const handleSendNow = async (
    target: CozyProjectedTarget,
    editedText: string,
    idempotencyKey: string
  ) => {
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

  const handleScheduleSend = async (
    target: CozyProjectedTarget,
    editedText: string,
    scheduledForIso: string,
    idempotencyKey?: string
  ) => {
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

  return (
    <div className={styles.encounterContainer} data-testid="cozy-neighborhood-encounter">
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

        {/* Top Control Bar */}
        <header className={styles.topBar}>
          <div className={styles.titlePill}>
            <span className={styles.lanternIcon}>🏮</span>
            <span>
              {missionQuery.data?.territoryName ?? "Silver Lake"} • Cozy Outreach ({sentCount}/
              {targets.length} Send Observed)
            </span>
          </div>

          {missionQuery.data?.withheldReason ? (
            <p className={styles.handoffNote} data-outreach-withheld="true">
              {missionQuery.data.withheldReason}
            </p>
          ) : missionQuery.data?.emptyMeansNoLapsedCustomers ? (
            <p data-outreach-empty-verified="true">No inactive customers are in this area on the current book.</p>
          ) : null}
          {requestedId && missionQuery.isSuccess && !targets.some((target) => target.customerId === requestedId) ? (
            <p data-customer-not-in-village="true">
              {requestedId} is not a contactable customer in this village.
            </p>
          ) : null}
          <button type="button" className={styles.exitButton} onClick={onExit} aria-label="Return to Wide City">
            <span>⤾</span> Return to Wide City
          </button>
        </header>

        {/* 8 Distinct House Slots */}
        {COZY_SLOT_IDS.map((slotId) => {
          const anchor = COZY_SLOT_ANCHORS[slotId];
          const target = targets.find((t) => t.slotId === slotId);
          const isSelected = selectedSlotId === slotId;
          const isHovered = hoveredSlotId === slotId;

          if (!target) {
            // Unoccupied house slot (e.g. Slot 8 when exactly 7 customers are active)
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

          const sendObserved = target.communicationState === "send_observed";
          const sprite = villagerSprite({
            variant: target.villagerVariant,
            communicationState: target.communicationState ?? "draft_prepared",
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
              data-communication-state={target.communicationState ?? "draft_prepared"}
              data-pose={sprite.pose}
              data-transport={target.transport ?? ""}
            >
              {/* Ground Targeting Ring */}
              {isSelected && <div className={styles.selectionRing} />}

              {/* Decorative Expression Glyph Bubble */}
              {isSelected && (
                <div className={styles.glyphBubble} aria-hidden="true">
                  {sendObserved ? "✨🏮" : "❤️"}
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
                {sendObserved ? (
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

        {/* Message Composer Drawer */}
        {selectedTarget && (
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
