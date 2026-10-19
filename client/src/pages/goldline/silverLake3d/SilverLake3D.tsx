import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { COZY_SLOT_IDS, VILLAGER_VARIANTS, type CozySlotId, type VillagerVariant } from "@shared/cozyVillagerOutreach";
import { villagerSprite, type CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import {
  SYNTHETIC_SILVER_LAKE_TARGETS,
  getVillagerPersonality,
  loadNeighborhoodMemory,
  saveNeighborhoodMemory,
  type NeighborhoodFeatureChoice,
} from "@shared/playableVillagers";
import { PlayableLetterDesk } from "@/components/admin/control-room/LanternCitySceneV6/PlayableLetterDesk";
import { NeighborhoodCourtyardFeature } from "@/components/admin/control-room/LanternCitySceneV6/NeighborhoodCourtyardFeature";
import { createSilverLake, type SilverLakeHandle, type VillagerView } from "./silverLakeRuntime";
import styles from "./silver-lake-3d.module.css";

/**
 * Silver Lake, walkable. The 3D courtyard replaces the painted plate as the place you visit; the
 * business behaviour is the existing one, untouched: the same mission query, the same send and
 * schedule mutations, the same Letter Desk with its consent and truthful delivery states, the same
 * neighbourhood memory. Ambient neighbours on empty doorsteps are fiction and never customers.
 *
 * The painted encounter (CozyNeighborhoodEncounter) is kept dormant at `?walk=0`.
 */

const ASSET_BASE = "/assets/goldline/silver-lake-3d/";
const TENANT_ID = "laundry_farm";

const AMBIENT_LINES: Record<VillagerVariant, string> = {
  fox: "Lovely morning for a stroll, isn't it?",
  bear: "Mind the pumpkins. They're nearly ready.",
  otter: "The fountain's extra sparkly today.",
  bunny: "Have you seen the washing line? So bright!",
  squirrel: "I'm counting acorns. I've lost count.",
  badger: "Quiet day. I like quiet days.",
  hedgehog: "The lamps come on soon. My favourite part.",
  cat: "I was napping. Carry on, adventurer.",
};

/** Clean full-body art for the 3D cards. Some 2D sprites carry a painted name along the bottom, cropped here. */
const CARD_ART: Record<VillagerVariant, { src: string; crop: number }> = {
  fox: { src: "/assets/lantern-villager-outreach/villagers/animations/fox-wave.png", crop: 0 },
  bear: { src: "/assets/lantern-villager-outreach/villagers/villager-02.png", crop: 0.13 },
  otter: { src: "/assets/lantern-villager-outreach/villagers/villager-03.png", crop: 0.13 },
  bunny: { src: "/assets/lantern-villager-outreach/villagers/animations/bunny-wave.png", crop: 0 },
  squirrel: { src: "/assets/lantern-villager-outreach/villagers/villager-05.png", crop: 0 },
  badger: { src: "/assets/lantern-villager-outreach/villagers/animations/badger-wave.png", crop: 0 },
  hedgehog: { src: "/assets/lantern-villager-outreach/villagers/villager-07.png", crop: 0 },
  cat: { src: "/assets/lantern-villager-outreach/villagers/villager-08.png", crop: 0 },
};

function param(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function isDone(t: CozyProjectedTarget) {
  return (
    t.silverLakeStatus?.message === "independently_verified_sent" ||
    t.communicationState === "send_observed" ||
    t.status === "accepted" ||
    t.status === "scheduled"
  );
}

export interface SilverLake3DProps {
  territoryId?: string;
  onExit: () => void;
}

export default function SilverLake3D({ territoryId = "silver-lake", onExit }: SilverLake3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SilverLakeHandle | null>(null);
  const [loading, setLoading] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [nearKey, setNearKey] = useState<string | null>(null);
  const [talkKey, setTalkKey] = useState<string | null>(null);
  const [featureOpen, setFeatureOpen] = useState(false);
  const requestedId = param("customer");
  const isSyntheticPreview = param("preview") === "synthetic";
  const autoOpened = useRef(false);

  // ---------------------------------------------------------------- business wiring (same rails as the painted encounter)
  const [syntheticTargets, setSyntheticTargets] = useState<CozyProjectedTarget[]>(() => [...SYNTHETIC_SILVER_LAKE_TARGETS]);
  const [neighborhoodMemory, setNeighborhoodMemory] = useState(() => loadNeighborhoodMemory(TENANT_ID));
  const utils = trpc.useUtils();
  const missionQuery = trpc.system.goldlineWorld.cozyVillagerMission.useQuery(
    { territoryId, requestedCustomerId: requestedId ?? undefined, limit: 8 },
    { staleTime: 0, refetchOnWindowFocus: true, enabled: !isSyntheticPreview }
  );
  const sendMutation = trpc.system.goldlineWorld.sendCozyOutreachNow.useMutation();
  const scheduleMutation = trpc.system.goldlineWorld.scheduleCozyOutreach.useMutation();

  const targets = useMemo(
    () => (isSyntheticPreview ? syntheticTargets : ((missionQuery.data?.targets ?? []) as CozyProjectedTarget[])),
    [isSyntheticPreview, syntheticTargets, missionQuery.data]
  );

  const refreshDurableEvidence = async () => {
    await Promise.all([
      utils.system.goldlineWorld.cozyVillagerMission.invalidate(),
      utils.system.goldlineWorld.cozyRecoveryDayLineCard.invalidate(),
      utils.system.goldlineWorld.listScheduledOutreach.invalidate(),
    ]);
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
                providerReceipt: { messageSid: `simulated:msg_${Date.now()}`, status: "dispatched", sentAt: new Date().toISOString(), evidenceName: "simulated_carrier_receipt" },
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
                scheduledDraft: { messageId: `synth_draft_${Date.now()}`, scheduledFor: scheduledForIso, timezone: "America/Los_Angeles", currentMessageBody: editedText },
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

  const handleChooseCourtyardFeature = (choice: NeighborhoodFeatureChoice) => {
    const updated = { ...neighborhoodMemory, featureChoice: choice, lastVisitedAt: new Date().toISOString() };
    setNeighborhoodMemory(updated);
    saveNeighborhoodMemory(updated, TENANT_ID);
    setFeatureOpen(false);
  };

  const handleDraftCompleted = (customerId: string, customerName: string, variant: any, action: "send" | "schedule" | "sms_opened") => {
    const currentCount = neighborhoodMemory.encounterCounts[variant] ?? 0;
    const updated = {
      ...neighborhoodMemory,
      encounterCounts: { ...neighborhoodMemory.encounterCounts, [variant]: currentCount + 1 },
      lastDraftedCustomer: { customerId, customerName, variant, completedAt: new Date().toISOString(), actionType: action },
    };
    setNeighborhoodMemory(updated);
    saveNeighborhoodMemory(updated, TENANT_ID);
  };

  const memoryNote = useMemo(() => {
    if (!neighborhoodMemory.lastDraftedCustomer) return null;
    const { customerName, actionType } = neighborhoodMemory.lastDraftedCustomer;
    if (actionType === "schedule") return `${customerName}'s letter is resting safely on the morning dispatch shelf.`;
    if (actionType === "send") return `We dispatched ${customerName}'s letter earlier!`;
    return `We prepared ${customerName}'s note for your phone.`;
  }, [neighborhoodMemory.lastDraftedCustomer]);

  // ---------------------------------------------------------------- villagers in the world
  const views = useMemo<VillagerView[]>(() => {
    const out: VillagerView[] = [];
    const used = new Set<number>();
    for (const t of targets) {
      const slot = COZY_SLOT_IDS.indexOf(t.slotId as CozySlotId);
      if (slot < 0) continue;
      used.add(slot);
      const art = CARD_ART[t.villagerVariant] ?? { src: villagerSprite({ variant: t.villagerVariant, communicationState: t.communicationState }).src, crop: 0 };
      out.push({
        key: `customer:${t.customerId}`,
        slot,
        name: t.displayName,
        status: t.communicationLabel || (isDone(t) ? "Letter on its way" : "Could use a hello"),
        sprite: art.src,
        cropBottom: art.crop,
        ambient: false,
        done: isDone(t),
      });
    }
    // empty doorsteps get a fictional neighbour so the courtyard feels lived in
    COZY_SLOT_IDS.forEach((_, slot) => {
      if (used.has(slot)) return;
      const variant = VILLAGER_VARIANTS[slot % VILLAGER_VARIANTS.length];
      const persona = getVillagerPersonality(variant);
      out.push({
        key: `ambient:${variant}`,
        slot,
        name: persona.canonicalName.split(" ")[0] || variant,
        status: "Neighbour",
        sprite: CARD_ART[variant].src,
        cropBottom: CARD_ART[variant].crop,
        ambient: true,
        done: false,
      });
    });
    return out;
  }, [targets]);

  const viewByKey = useMemo(() => new Map(views.map(v => [v.key, v])), [views]);
  const targetByKey = useMemo(() => new Map(targets.map(t => [`customer:${t.customerId}`, t])), [targets]);

  // ---------------------------------------------------------------- runtime lifecycle
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let handle: SilverLakeHandle | null = null;
    createSilverLake(host, ASSET_BASE, {
      onProgress: f => !cancelled && setLoading(f),
      onReady: () => !cancelled && setReady(true),
      onNear: key => !cancelled && setNearKey(key),
      onTalk: key => !cancelled && setTalkKey(key),
      onError: msg => !cancelled && setFailed(msg),
    })
      .then(h => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        runtimeRef.current = h;
        setReady(true);
      })
      .catch(err => !cancelled && setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      handle?.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ready) runtimeRef.current?.setVillagers(views);
  }, [ready, views]);

  useEffect(() => {
    if (ready) runtimeRef.current?.setFeature(neighborhoodMemory.featureChoice ?? null);
  }, [ready, neighborhoodMemory.featureChoice]);

  useEffect(() => {
    runtimeRef.current?.setPaused(Boolean(talkKey) || featureOpen);
  }, [talkKey, featureOpen]);

  // arriving from Home with a named customer: walk them straight to that doorstep and open the desk
  useEffect(() => {
    if (!ready || autoOpened.current || !requestedId) return;
    const key = `customer:${requestedId}`;
    if (!targetByKey.has(key)) return;
    autoOpened.current = true;
    runtimeRef.current?.focusVillager(key);
    const timer = window.setTimeout(() => setTalkKey(key), 2900);
    return () => window.clearTimeout(timer);
  }, [ready, requestedId, targetByKey]);

  const closeTalk = useCallback(() => setTalkKey(null), []);

  const talkTarget = talkKey ? targetByKey.get(talkKey) ?? null : null;
  const talkView = talkKey ? viewByKey.get(talkKey) ?? null : null;
  const nearView = nearKey ? viewByKey.get(nearKey) ?? null : null;
  const selectedIndex = talkTarget ? targets.findIndex(t => t.customerId === talkTarget.customerId) : -1;
  const reached = targets.filter(isDone).length;

  useEffect(() => {
    if (!talkKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTalk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [talkKey, closeTalk]);

  return (
    <div className={styles.root} data-testid="silver-lake-3d" data-preview-mode={isSyntheticPreview ? "synthetic" : "real"}>
      <div ref={hostRef} className={styles.stage} />

      {!ready && !failed ? (
        <div className={styles.loading}>
          <div className={styles.loadingCard}>
            <span className={styles.loadingLantern} aria-hidden>
              ✦
            </span>
            <strong>Walking into Silver Lake…</strong>
            <div className={styles.loadingBar}>
              <i style={{ width: `${Math.round(loading * 100)}%` }} />
            </div>
          </div>
        </div>
      ) : null}

      {failed ? (
        <div className={styles.loading}>
          <div className={styles.loadingCard}>
            <strong>Silver Lake could not load here.</strong>
            <p>{failed}</p>
            <a href="/growth/lantern-city?cozy=1&territory=silver-lake&walk=0">Open the painted Silver Lake instead</a>
          </div>
        </div>
      ) : null}

      <header className={styles.hud}>
        <div className={styles.titlePill}>
          <span className={styles.titleMark} aria-hidden>
            ✦
          </span>
          <div>
            <strong>Silver Lake</strong>
            <span>Lantern City · {reached} of {targets.length} neighbours reached</span>
          </div>
        </div>
        <div className={styles.hudRight}>
          <button type="button" className={styles.hudButton} onClick={() => setFeatureOpen(o => !o)}>
            {neighborhoodMemory.featureChoice ? "Courtyard" : "Place something cozy"}
          </button>
          <button type="button" className={styles.hudButton} onClick={onExit} aria-label="Back to Lantern City">
            Back to the city
          </button>
        </div>
      </header>

      {isSyntheticPreview ? <div className={styles.previewBadge}>Preview neighbours: nothing here is sent</div> : null}

      {ready && !talkKey ? (
        <div className={styles.controlsHint} aria-hidden>
          <span>WASD / arrows to walk</span>
          <span>Shift to run</span>
          <span>Space to hop</span>
          <span>Drag to look</span>
        </div>
      ) : null}

      {nearView && !talkKey ? (
        <button type="button" className={styles.talkPrompt} onClick={() => runtimeRef.current?.talkNearest()} data-testid="silver-lake-3d-talk">
          <kbd>E</kbd> {nearView.ambient ? `Say hi to ${nearView.name}` : `Visit ${nearView.name}`}
        </button>
      ) : null}

      <div className={styles.touchButtons}>
        <button type="button" onClick={() => runtimeRef.current?.jump()} aria-label="Hop">
          Hop
        </button>
      </div>

      {talkView && talkView.ambient ? (
        <div className={styles.bubbleWrap} onClick={closeTalk}>
          <div className={styles.bubble} role="dialog" aria-label={`${talkView.name} says`}>
            <img src={talkView.sprite} alt="" />
            <div>
              <strong>{talkView.name}</strong>
              <p>{AMBIENT_LINES[VILLAGER_VARIANTS[talkView.slot % VILLAGER_VARIANTS.length]]}</p>
              <button type="button" onClick={closeTalk}>
                Bye for now
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {talkTarget ? (
        <div className={styles.deskWrap}>
          <PlayableLetterDesk
            target={talkTarget}
            targetIndex={selectedIndex}
            totalTargets={targets.length}
            objectiveId={missionQuery.data?.objectiveId ?? null}
            isSending={sendMutation.isPending || scheduleMutation.isPending || false}
            isSynthetic={isSyntheticPreview}
            encounterCount={neighborhoodMemory.encounterCounts[talkTarget.villagerVariant] ?? 1}
            memoryNote={memoryNote}
            tenantId={TENANT_ID}
            onSendNow={handleSendNow}
            onScheduleSend={handleScheduleSend}
            onClose={closeTalk}
            onSelectIndex={index => {
              const t = targets[index];
              if (t) setTalkKey(`customer:${t.customerId}`);
            }}
            onDraftCompleted={handleDraftCompleted}
          />
        </div>
      ) : null}

      {featureOpen ? (
        <div className={styles.featureWrap}>
          <NeighborhoodCourtyardFeature chosenFeature={neighborhoodMemory.featureChoice} onChooseFeature={handleChooseCourtyardFeature} />
          <button type="button" className={styles.hudButton} onClick={() => setFeatureOpen(false)}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
