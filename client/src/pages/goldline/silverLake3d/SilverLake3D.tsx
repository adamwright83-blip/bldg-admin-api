import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COZY_SLOT_ANCHORS,
  COZY_SLOT_IDS,
  VILLAGER_VARIANTS,
  type CozySlotId,
  type VillagerVariant,
} from "@shared/cozyVillagerOutreach";
import {
  villagerSprite,
  type CozyProjectedTarget,
} from "@shared/cozyVillagerEvidence";
import { PlayableLetterDesk } from "@/components/admin/control-room/LanternCitySceneV6/PlayableLetterDesk";
import { CozyMessageComposer } from "@/components/admin/control-room/LanternCitySceneV6/CozyMessageComposer";
import { NeighborhoodCourtyardFeature } from "@/components/admin/control-room/LanternCitySceneV6/NeighborhoodCourtyardFeature";
import {
  createSilverLake,
  type SilverLakeHandle,
  type VillagerView,
} from "./silverLakeRuntime";
import { BusinessSwitcher } from "@/components/admin/BusinessSwitcher";
import { useSilverLakeOutreach } from "./useSilverLakeOutreach";
import styles from "./silver-lake-3d.module.css";

/**
 * Silver Lake, walkable. Every Silver Lake entry lands here (see silverLakeEntry.ts); the painted 2D encounter is
 * archived. The business behaviour is the existing one, through useSilverLakeOutreach: the same mission query, send
 * and schedule mutations, Letter Desk with its consent and truthful delivery states, and Phase 4 world memory.
 * Ambient neighbours on empty doorsteps are fiction and never customers.
 *
 * The neighbours roster is a plain list of buttons, so the courtyard is usable without WebGL, by keyboard and by
 * screen reader, and so tests can reach a villager without steering the hero.
 */

const ASSET_BASE = "/assets/goldline/silver-lake-3d/";

/** Clean full-body art for the 3D cards. Some 2D sprites carry a painted name along the bottom, cropped here. */
const CARD_ART: Record<VillagerVariant, { src: string; crop: number }> = {
  fox: {
    src: "/assets/lantern-villager-outreach/villagers/animations/fox-wave.png",
    crop: 0,
  },
  bear: {
    src: "/assets/lantern-villager-outreach/villagers/villager-02.png",
    crop: 0.13,
  },
  otter: {
    src: "/assets/lantern-villager-outreach/villagers/villager-03.png",
    crop: 0.13,
  },
  bunny: {
    src: "/assets/lantern-villager-outreach/villagers/animations/bunny-wave.png",
    crop: 0,
  },
  squirrel: {
    src: "/assets/lantern-villager-outreach/villagers/villager-05.png",
    crop: 0,
  },
  badger: {
    src: "/assets/lantern-villager-outreach/villagers/animations/badger-wave.png",
    crop: 0,
  },
  hedgehog: {
    src: "/assets/lantern-villager-outreach/villagers/villager-07.png",
    crop: 0,
  },
  cat: {
    src: "/assets/lantern-villager-outreach/villagers/villager-08.png",
    crop: 0,
  },
};

/** Fictional neighbours on empty doorsteps: one name each, never a customer. */
const AMBIENT_NAMES: Record<VillagerVariant, string> = {
  fox: "Fennel",
  bear: "Bruno",
  otter: "Oliver",
  bunny: "Bella",
  squirrel: "Sammy",
  badger: "Bramble",
  hedgehog: "Henry",
  cat: "Cleo",
};

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

function isDone(t: CozyProjectedTarget) {
  return (
    t.silverLakeStatus?.message === "independently_verified_sent" ||
    t.communicationState === "send_observed" ||
    t.status === "accepted" ||
    t.status === "scheduled"
  );
}

const customerKey = (t: CozyProjectedTarget) => `customer:${t.customerId}`;

export interface SilverLake3DProps {
  territoryId?: string;
  onExit: () => void;
}

export default function SilverLake3D({
  territoryId = "silver-lake",
  onExit,
}: SilverLake3DProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<SilverLakeHandle | null>(null);
  const [loading, setLoading] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [nearKey, setNearKey] = useState<string | null>(null);
  const [ambientKey, setAmbientKey] = useState<string | null>(null);
  const deepLinked = useRef(false);

  const o = useSilverLakeOutreach(territoryId);
  const { targets, selectedTarget, setSelectedSlotId } = o;

  // ---------------------------------------------------------------- villagers in the world
  const views = useMemo<VillagerView[]>(() => {
    const out: VillagerView[] = [];
    const used = new Set<number>();
    for (const t of targets) {
      const slot = COZY_SLOT_IDS.indexOf(t.slotId as CozySlotId);
      if (slot < 0) continue;
      used.add(slot);
      const art = CARD_ART[t.villagerVariant] ?? {
        src: villagerSprite({
          variant: t.villagerVariant,
          communicationState: t.communicationState,
        }).src,
        crop: 0,
      };
      out.push({
        key: customerKey(t),
        slot,
        name: t.displayName,
        status:
          t.communicationLabel ||
          (isDone(t) ? "Letter on its way" : "Could use a hello"),
        sprite: art.src,
        cropBottom: art.crop,
        ambient: false,
        done: isDone(t),
      });
    }
    COZY_SLOT_IDS.forEach((_, slot) => {
      if (used.has(slot)) return;
      const variant = VILLAGER_VARIANTS[slot % VILLAGER_VARIANTS.length];
      out.push({
        key: `ambient:${variant}`,
        slot,
        name: AMBIENT_NAMES[variant],
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
  const targetByKey = useMemo(
    () => new Map(targets.map(t => [customerKey(t), t])),
    [targets]
  );

  const openCustomer = useCallback(
    (t: CozyProjectedTarget, walk: boolean) => {
      if (walk) runtimeRef.current?.focusVillager(customerKey(t));
      setAmbientKey(null);
      setSelectedSlotId(t.slotId as CozySlotId);
    },
    [setSelectedSlotId]
  );

  // ---------------------------------------------------------------- runtime lifecycle
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let handle: SilverLakeHandle | null = null;
    createSilverLake(host, ASSET_BASE, {
      onProgress: f => !cancelled && setLoading(f),
      onNear: key => !cancelled && setNearKey(key),
      onTalk: key => {
        if (cancelled) return;
        const t = targetByKeyRef.current.get(key);
        if (t) {
          setAmbientKey(null);
          setSelectedSlotIdRef.current(t.slotId as CozySlotId);
        } else setAmbientKey(key);
      },
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
      .catch(
        err =>
          !cancelled &&
          setFailed(err instanceof Error ? err.message : String(err))
      );
    return () => {
      cancelled = true;
      handle?.dispose();
      runtimeRef.current = null;
    };
  }, []);
  const targetByKeyRef = useRef(targetByKey);
  targetByKeyRef.current = targetByKey;
  const setSelectedSlotIdRef = useRef(setSelectedSlotId);
  setSelectedSlotIdRef.current = setSelectedSlotId;

  useEffect(() => {
    if (ready) runtimeRef.current?.setVillagers(views);
  }, [ready, views]);

  useEffect(() => {
    if (ready)
      runtimeRef.current?.setFeature(
        o.neighborhoodMemory.featureChoice ?? null
      );
  }, [ready, o.neighborhoodMemory.featureChoice]);

  useEffect(() => {
    runtimeRef.current?.setPaused(
      Boolean(selectedTarget) || Boolean(ambientKey)
    );
  }, [selectedTarget, ambientKey, ready]);

  // a deep link with a named customer (Home, the Day Line, the outbox) opens that neighbour's desk straight away
  useEffect(() => {
    if (deepLinked.current || !o.requestedId) return;
    const t = targetByKey.get(`customer:${o.requestedId}`);
    if (!t) return;
    deepLinked.current = true;
    openCustomer(t, false);
  }, [o.requestedId, targetByKey, openCustomer]);
  useEffect(() => {
    if (ready && o.requestedId && targetByKey.has(`customer:${o.requestedId}`))
      runtimeRef.current?.focusVillager(`customer:${o.requestedId}`);
  }, [ready, o.requestedId, targetByKey]);

  const closeTalk = useCallback(() => {
    setSelectedSlotId(null);
    setAmbientKey(null);
  }, [setSelectedSlotId]);

  useEffect(() => {
    if (!selectedTarget && !ambientKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTalk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTarget, ambientKey, closeTalk]);

  const ambientView = ambientKey ? (viewByKey.get(ambientKey) ?? null) : null;
  const nearView = nearKey ? (viewByKey.get(nearKey) ?? null) : null;
  const reached = targets.filter(isDone).length;
  const talking = Boolean(selectedTarget) || Boolean(ambientView);

  return (
    <div
      className={styles.root}
      data-testid="silver-lake-3d"
      data-preview-mode={o.isSyntheticPreview ? "synthetic" : "real"}
      data-territory={territoryId}
    >
      <div ref={hostRef} className={styles.stage} />

      {!ready && !failed ? (
        <div className={styles.loading} aria-hidden>
          <div className={styles.loadingCard}>
            <span className={styles.loadingLantern}>✦</span>
            <strong>Walking into Silver Lake…</strong>
            <div className={styles.loadingBar}>
              <i style={{ width: `${Math.round(loading * 100)}%` }} />
            </div>
          </div>
        </div>
      ) : null}

      {failed ? (
        <div
          className={styles.failNote}
          role="status"
          data-testid="silver-lake-3d-unavailable"
        >
          The 3D courtyard could not start on this device. Your neighbours are
          still listed below.
        </div>
      ) : null}

      <header className={styles.hud}>
        <div className={styles.hudLeft}>
          <div className={styles.titlePill}>
            <span className={styles.titleMark} aria-hidden>
              ✦
            </span>
            <div>
              <strong>Silver Lake</strong>
              <span>
                Lantern City · {reached} of {targets.length} neighbours reached
              </span>
            </div>
          </div>
          {o.showDevControls ? (
            <div
              className={styles.modeSelector}
              data-testid="experience-mode-selector"
            >
              <button
                type="button"
                data-testid="mode-playable-button"
                aria-pressed={o.experienceMode === "playable"}
                onClick={() => o.setExperienceMode("playable")}
              >
                Letter Desk
              </button>
              <button
                type="button"
                data-testid="mode-classic-button"
                aria-pressed={o.experienceMode === "classic"}
                onClick={() => o.setExperienceMode("classic")}
              >
                Classic
              </button>
            </div>
          ) : null}
        </div>
        <div className={styles.hudRight}>
          <button type="button" className={styles.hudButton} onClick={onExit}>
            Return to City
          </button>
        </div>
      </header>

      {o.isSyntheticPreview ? (
        <div className={styles.previewBadge}>
          Preview neighbours: nothing here is sent
        </div>
      ) : null}

      <nav
        className={styles.roster}
        aria-label="Silver Lake neighbours"
        data-testid="silver-lake-roster"
      >
        <strong className={styles.rosterTitle}>Neighbours</strong>
        {o.loadFailed ? (
          <p
            className={styles.rosterEmpty}
            data-testid="silver-lake-villagers-unavailable"
          >
            Your neighbours could not load right now. Nothing has been sent.
          </p>
        ) : null}
        {targets.length === 0 && !o.loading && !o.loadFailed && o.withheldReason ? (
          <p className={styles.rosterEmpty} data-testid="silver-lake-villagers-withheld" data-outreach-withheld="true">
            {o.withheldReason}
          </p>
        ) : null}
        {targets.length === 0 && !o.loading && !o.loadFailed && o.focusMissing ? (
          // The business shown is the one selected; nothing switches on its own. Choosing the focus is the operator's call.
          <div className={styles.focusChoice} data-testid="silver-lake-focus-missing">
            <BusinessSwitcher />
            <button
              type="button"
              className={styles.focusButton}
              disabled={o.confirmingFocus}
              onClick={() => void o.confirmFocus()}
              data-testid="silver-lake-confirm-focus"
            >
              {o.confirmingFocus ? "Setting focus…" : "Focus this business on Silver Lake"}
            </button>
            {o.focusError ? <p role="alert" className={styles.rosterEmpty}>{o.focusError}</p> : null}
          </div>
        ) : null}
        {targets.length === 0 && !o.loading && !o.loadFailed && !o.withheldReason ? (
          <p className={styles.rosterEmpty} data-testid="silver-lake-no-villagers">
            {o.emptyMeansNoLapsed ? "No one to reconnect with here today. Explore freely." : "No neighbours are listed here right now."}
          </p>
        ) : null}
        {targets.map(t => {
          const slot = t.slotId as CozySlotId;
          return (
            <button
              key={t.customerId}
              type="button"
              className={`${styles.rosterItem} ${selectedTarget?.customerId === t.customerId ? styles.rosterItemActive : ""}`}
              data-testid="silver-lake-villager"
              data-customer-id={t.customerId}
              data-slot-id={slot}
              data-house-title={COZY_SLOT_ANCHORS[slot]?.houseTitle ?? ""}
              data-communication-state={t.communicationState}
              data-pose={t.pose}
              aria-label={`Visit ${t.displayName}`}
              onClick={() => openCustomer(t, true)}
            >
              <img src={CARD_ART[t.villagerVariant]?.src} alt="" />
              <span>
                <b>{t.displayName}</b>
                <small>{t.communicationLabel}</small>
              </span>
            </button>
          );
        })}
      </nav>

      {ready && !talking ? (
        <div className={styles.controlsHint} aria-hidden>
          <span>WASD / arrows to walk</span>
          <span>Shift to run</span>
          <span>Space to hop</span>
          <span>Drag to look</span>
        </div>
      ) : null}

      {nearView && !talking ? (
        <button
          type="button"
          className={styles.talkPrompt}
          onClick={() => runtimeRef.current?.talkNearest()}
          data-testid="silver-lake-3d-talk"
        >
          <kbd>E</kbd>{" "}
          {nearView.ambient
            ? `Say hi to ${nearView.name}`
            : `Talk to ${nearView.name}`}
        </button>
      ) : null}

      <div className={styles.touchButtons}>
        <button type="button" onClick={() => runtimeRef.current?.jump()}>
          Hop
        </button>
      </div>

      <div
        className={styles.courtyardWidget}
        data-testid="silver-lake-courtyard-widget"
      >
        <NeighborhoodCourtyardFeature
          chosenFeature={o.neighborhoodMemory.featureChoice}
          onChooseFeature={o.handleChooseCourtyardFeature}
        />
      </div>

      {ambientView ? (
        <div className={styles.bubbleWrap} onClick={closeTalk}>
          <div
            className={styles.bubble}
            role="dialog"
            aria-label={`${ambientView.name} says`}
          >
            <img src={ambientView.sprite} alt="" />
            <div>
              <strong>{ambientView.name}</strong>
              <p>
                {
                  AMBIENT_LINES[
                    VILLAGER_VARIANTS[
                      ambientView.slot % VILLAGER_VARIANTS.length
                    ]
                  ]
                }
              </p>
              <button type="button" onClick={closeTalk}>
                Bye for now
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedTarget && o.experienceMode === "playable" ? (
        <div className={styles.deskWrap}>
          <PlayableLetterDesk
            target={selectedTarget}
            targetIndex={o.selectedIndex}
            totalTargets={targets.length}
            objectiveId={o.objectiveId}
            isSending={o.isSending}
            isSynthetic={o.isSyntheticPreview}
            encounterCount={
              o.neighborhoodMemory.encounterCounts[
                selectedTarget.villagerVariant
              ] ?? 1
            }
            memoryNote={o.memoryNote}
            neighborhoodMemory={o.neighborhoodMemory}
            tenantId={o.tenantId}
            onSendNow={o.handleSendNow}
            onScheduleSend={o.handleScheduleSend}
            onClose={closeTalk}
            onSelectIndex={o.handleSelectIndex}
            onDraftCompleted={o.handleDraftCompleted}
            onSaveUnfinishedDraft={o.handleSaveUnfinishedDraft}
          />
        </div>
      ) : null}

      {selectedTarget && o.experienceMode === "classic" ? (
        <div className={styles.deskWrap}>
          <CozyMessageComposer
            target={selectedTarget}
            targetIndex={o.selectedIndex}
            totalTargets={targets.length}
            objectiveId={o.objectiveId}
            isSending={o.isSending}
            onSendNow={o.handleSendNow}
            onScheduleSend={o.handleScheduleSend}
            onClose={closeTalk}
            onSelectIndex={o.handleSelectIndex}
          />
        </div>
      ) : null}
    </div>
  );
}
