import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  COZY_SLOT_IDS,
  COZY_SLOT_ANCHORS,
  type CozyCustomerTarget,
  type CozySlotId,
} from "@shared/cozyVillagerOutreach";
import { CozyMessageComposer } from "./CozyMessageComposer";
import styles from "./cozy-neighborhood.module.css";

interface CozyNeighborhoodEncounterProps {
  territoryId?: string;
  onExit: () => void;
  onOpenCustomer?: (phone: string) => void;
}

export function CozyNeighborhoodEncounter({
  territoryId = "silver-lake",
  onExit,
}: CozyNeighborhoodEncounterProps) {
  const [selectedSlotId, setSelectedSlotId] = useState<CozySlotId | null>("slot_01");
  const [hoveredSlotId, setHoveredSlotId] = useState<CozySlotId | null>(null);
  const [localTargets, setLocalTargets] = useState<Record<string, CozyCustomerTarget>>({});

  const missionQuery = trpc.system.goldlineWorld.cozyVillagerMission.useQuery(
    { territoryId, limit: 8 },
    { staleTime: 60000, refetchOnWindowFocus: false }
  );

  const sendMutation = trpc.system.goldlineWorld.sendCozyOutreachSms.useMutation();

  // Merge server query with local optimistic state
  const targets = useMemo(() => {
    const list = missionQuery.data?.targets ?? [];
    return list.map((t) => localTargets[t.customerId] ?? t);
  }, [missionQuery.data, localTargets]);

  const selectedTarget = useMemo(() => {
    return targets.find((t) => t.slotId === selectedSlotId) ?? targets[0] ?? null;
  }, [targets, selectedSlotId]);

  const selectedIndex = useMemo(() => {
    return targets.findIndex((t) => t.slotId === selectedSlotId);
  }, [targets, selectedSlotId]);

  const sentCount = useMemo(() => {
    return targets.filter((t) => t.status === "accepted" || !!t.providerReceipt).length;
  }, [targets]);

  const handleSelectSlot = (slotId: CozySlotId) => {
    setSelectedSlotId(slotId);
  };

  const handleSelectIndex = (index: number) => {
    if (index >= 0 && index < targets.length) {
      setSelectedSlotId(targets[index].slotId);
    }
  };

  const handleAuthorizedSend = async (
    target: CozyCustomerTarget,
    editedText: string,
    idempotencyKey: string
  ) => {
    try {
      const result = await sendMutation.mutateAsync({
        customerId: target.customerId,
        recipientPhone: target.phone ?? "",
        messageBody: editedText,
        idempotencyKey,
        slotId: target.slotId,
        territoryId,
      });

      // Update truthful state with provider receipt
      const updated: CozyCustomerTarget = {
        ...target,
        status: "accepted",
        providerReceipt: {
          messageSid: result.providerMessageId ?? "SM_verified",
          status: result.providerStatus ?? "queued",
          sentAt: result.timestamp,
          evidenceName: result.evidenceName,
        },
      };

      setLocalTargets((prev) => ({
        ...prev,
        [target.customerId]: updated,
      }));

      // Auto-advance to next unsent customer after 1.5 seconds of joyful acknowledgment
      setTimeout(() => {
        const nextIndex = targets.findIndex(
          (t, idx) => idx > selectedIndex && t.status !== "accepted"
        );
        if (nextIndex !== -1) {
          setSelectedSlotId(targets[nextIndex].slotId);
        }
      }, 1500);
    } catch (err: any) {
      alert(`Send could not be authorized: ${err.message}`);
    }
  };

  // Helper to determine exact sprite frame for each villager
  const getVillagerSpriteSrc = (target: CozyCustomerTarget, isSelected: boolean, isHovered: boolean) => {
    const isAccepted = target.status === "accepted" || !!target.providerReceipt;
    const v = target.villagerVariant;

    if (v === "fox") {
      if (isAccepted) return "/assets/lantern-villager-outreach/villagers/animations/fox-acknowledged.png";
      if (isSelected) return "/assets/lantern-villager-outreach/villagers/animations/fox-wave.png";
      if (isHovered) return "/assets/lantern-villager-outreach/villagers/animations/fox-selected.png";
      return "/assets/lantern-villager-outreach/villagers/villager-01.png";
    }

    if (v === "bunny") {
      if (isAccepted) return "/assets/lantern-villager-outreach/villagers/animations/bunny-acknowledged.png";
      if (isSelected) return "/assets/lantern-villager-outreach/villagers/animations/bunny-wave.png";
      if (isHovered) return "/assets/lantern-villager-outreach/villagers/animations/bunny-selected.png";
      return "/assets/lantern-villager-outreach/villagers/villager-04.png";
    }

    if (v === "badger") {
      if (isAccepted) return "/assets/lantern-villager-outreach/villagers/animations/badger-acknowledged.png";
      if (isSelected) return "/assets/lantern-villager-outreach/villagers/animations/badger-wave.png";
      if (isHovered) return "/assets/lantern-villager-outreach/villagers/animations/badger-selected.png";
      return "/assets/lantern-villager-outreach/villagers/villager-06.png";
    }

    // Default static sprites for remaining slots
    const fallbackMap: Record<string, string> = {
      bear: "/assets/lantern-villager-outreach/villagers/villager-02.png",
      otter: "/assets/lantern-villager-outreach/villagers/villager-03.png",
      squirrel: "/assets/lantern-villager-outreach/villagers/villager-05.png",
      hedgehog: "/assets/lantern-villager-outreach/villagers/villager-07.png",
      cat: "/assets/lantern-villager-outreach/villagers/villager-08.png",
    };

    return fallbackMap[v] ?? "/assets/lantern-villager-outreach/villagers/villager-01.png";
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
              {targets.length} Contacted)
            </span>
          </div>

          <button type="button" className={styles.exitButton} onClick={onExit} aria-label="Return to City">
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

          const isAccepted = target.status === "accepted" || !!target.providerReceipt;
          const spriteSrc = getVillagerSpriteSrc(target, isSelected, isHovered);

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
            >
              {/* Ground Targeting Ring */}
              {isSelected && <div className={styles.selectionRing} />}

              {/* Decorative Expression Glyph Bubble */}
              {isSelected && (
                <div className={styles.glyphBubble} aria-hidden="true">
                  {isAccepted ? "✨🏮" : "❤️"}
                </div>
              )}

              {/* Villager Animated Sprite */}
              <img
                src={spriteSrc}
                alt={target.displayName}
                className={styles.villagerSprite}
              />

              {/* Floating Name Tag */}
              <div className={styles.villagerTag}>
                <span>{target.displayName.split(" ")[0]}</span>
                {isAccepted ? (
                  <span className={styles.statusIconSent}>✓ Sent</span>
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
            isSending={sendMutation.isPending}
            onSend={handleAuthorizedSend}
            onClose={() => setSelectedSlotId(null)}
            onSelectIndex={handleSelectIndex}
          />
        )}
      </div>
    </div>
  );
}
