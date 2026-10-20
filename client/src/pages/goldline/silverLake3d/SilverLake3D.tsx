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
import { customerIdFromQuestKey, questGiverKey, useReunionQuests } from "./useReunionQuests";
import type { QuestSpot, ReunionBeat } from "./reunionQuests";
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
  // the painted sheet's cat carries a stray "Bunny Bella" caption along the top, cropped into its own card
  cat: {
    src: "/assets/goldline/silver-lake-3d/cards/cat.png",
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
  const [questSpots, setQuestSpots] = useState<QuestSpot[]>([]);
  const [questTalkId, setQuestTalkId] = useState<string | null>(null);
  const [reunion, setReunion] = useState<{ customerId: string; beats: ReunionBeat[]; index: number } | null>(null);
  const [nearItem, setNearItem] = useState<{ key: string; hop: boolean } | null>(null);
  const [questNote, setQuestNote] = useState<string | null>(null);

  const o = useSilverLakeOutreach(territoryId);
  const { targets, selectedTarget, setSelectedSlotId } = o;
  // Reunion quests run in the synthetic preview only, until a pass can be recorded on the server.
  const rq = useReunionQuests(o.isSyntheticPreview && ready, targets, questSpots);

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
      // a reunion quest: the giver keeps the doorstep, and the customer only appears once reunited or decided
      const q = rq.on ? rq.quest(t.customerId) : null;
      if (q) {
        const giverArt = CARD_ART[q.template.giver.variant];
        out.push({
          key: questGiverKey(t.customerId),
          slot,
          name: q.template.giver.name,
          status:
            q.phase === "locked"
              ? "Busy"
              : q.phase === "need" || q.phase === "carrying"
                ? "Needs a hand"
                : q.phase === "waiting"
                  ? "Reunited"
                  : "All smiles",
          sprite: giverArt.src,
          cropBottom: giverArt.crop,
          ambient: true,
          done: q.phase === "done",
        });
        if (q.phase !== "done" && !rq.reunited.has(t.customerId)) continue;
      }
      out.push({
        key: customerKey(t),
        slot,
        offset: q ? 1.5 : undefined,
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
  }, [targets, rq.on, rq.quest, rq.reunited]);

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
        const questCustomer = key.startsWith("quest:") ? customerIdFromQuestKey(key) : null;
        if (questCustomer) {
          setAmbientKey(null);
          setQuestTalkId(questCustomer);
          return;
        }
        const t = targetByKeyRef.current.get(key);
        if (t) {
          setAmbientKey(null);
          setSelectedSlotIdRef.current(t.slotId as CozySlotId);
        } else setAmbientKey(key);
      },
      onNearItem: item => !cancelled && setNearItem(item),
      onPickItem: key => !cancelled && pickItemRef.current(key),
      onError: msg => !cancelled && setFailed(msg),
    })
      .then(h => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        runtimeRef.current = h;
        setQuestSpots(h.questSpots());
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
  const pickItemRef = useRef<(key: string) => void>(() => {});
  pickItemRef.current = key => {
    rq.pickItem(key);
    const id = customerIdFromQuestKey(key);
    const q = id ? rq.quest(id) : null;
    if (q) setQuestNote(`You found the ${q.template.item.name}! Bring it to ${q.template.giver.name}.`);
  };

  useEffect(() => {
    if (ready) runtimeRef.current?.setQuestItems(rq.items);
  }, [ready, rq.items]);

  useEffect(() => {
    if (!questNote) return;
    const id = window.setTimeout(() => setQuestNote(null), 6000);
    return () => window.clearTimeout(id);
  }, [questNote]);

  // a real decision on one customer opens the next giver up; say so once
  const lastActive = useRef<string | null>(null);
  useEffect(() => {
    const prev = lastActive.current;
    lastActive.current = rq.activeCustomerId;
    if (!prev || !rq.activeCustomerId || prev === rq.activeCustomerId) return;
    const next = rq.quest(rq.activeCustomerId);
    if (!next) return;
    const unlocked = `${next.template.giver.name} has a favour to ask.`;
    // keep the pass note ("Nothing was sent") when a pass is what opened the next giver
    setQuestNote(note => (note?.startsWith("You passed") ? `${note} ${unlocked}` : unlocked));
  }, [rq.activeCustomerId, rq.quest]);

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
      Boolean(selectedTarget) || Boolean(ambientKey) || Boolean(questTalkId) || Boolean(reunion)
    );
  }, [selectedTarget, ambientKey, questTalkId, reunion, ready]);

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
    setQuestTalkId(null);
    setReunion(null);
  }, [setSelectedSlotId]);

  /** "Just write to them": straight to the Letter Desk, from any quest state */
  const writeTo = useCallback(
    (customerId: string) => {
      const t = targetByKey.get(`customer:${customerId}`);
      setQuestTalkId(null);
      setReunion(null);
      if (t) openCustomer(t, false);
    },
    [targetByKey, openCustomer]
  );

  const giveItem = useCallback(
    (customerId: string) => {
      const beats = rq.startReunion(customerId);
      setQuestTalkId(null);
      setQuestNote(null);
      if (beats.length) setReunion({ customerId, beats, index: 0 });
    },
    [rq]
  );

  const passOn = useCallback(
    (customerId: string) => {
      const t = targetByKey.get(`customer:${customerId}`);
      rq.pass(customerId);
      setQuestTalkId(null);
      setReunion(null);
      if (t) setQuestNote(`You passed on ${t.displayName} for now. Nothing was sent.`);
    },
    [rq, targetByKey]
  );

  useEffect(() => {
    if (!selectedTarget && !ambientKey && !questTalkId && !reunion) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTalk();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTarget, ambientKey, questTalkId, reunion, closeTalk]);

  const ambientView = ambientKey ? (viewByKey.get(ambientKey) ?? null) : null;
  const nearView = nearKey ? (viewByKey.get(nearKey) ?? null) : null;
  const reached = targets.filter(isDone).length;
  const talking = Boolean(selectedTarget) || Boolean(ambientView) || Boolean(questTalkId) || Boolean(reunion);
  const questTalk = questTalkId ? rq.quest(questTalkId) : null;
  const nearItemQuest = nearItem ? rq.quest(customerIdFromQuestKey(nearItem.key) ?? "") : null;
  const carrying = rq.chain.map(q => rq.quest(q.customerId)).find(q => q?.phase === "carrying") ?? null;
  const reunionQuest = reunion ? rq.quest(reunion.customerId) : null;
  const reunionTarget = reunion ? targetByKey.get(`customer:${reunion.customerId}`) ?? null : null;

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

      {nearItem && nearItemQuest && !talking ? (
        <button
          type="button"
          className={styles.talkPrompt}
          onClick={() => (nearItem.hop ? runtimeRef.current?.jump() : runtimeRef.current?.pickNearestItem())}
          data-testid="silver-lake-3d-pick"
          data-hop={nearItem.hop ? "true" : "false"}
        >
          <kbd className={nearItem.hop ? styles.kbdWide : undefined}>{nearItem.hop ? "Space" : "E"}</kbd>{" "}
          {nearItem.hop
            ? `Hop up for the ${nearItemQuest.template.item.name}`
            : `Pick up the ${nearItemQuest.template.item.name}`}
        </button>
      ) : null}

      {nearView && !talking && !nearItem ? (
        <button
          type="button"
          className={styles.talkPrompt}
          onClick={() => runtimeRef.current?.talkNearest()}
          data-testid="silver-lake-3d-talk"
        >
          <kbd>E</kbd>{" "}
          {nearView.ambient && !nearView.key.startsWith("quest:")
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

      {rq.on && (questNote || carrying) && !talking ? (
        <div className={styles.questNote} role="status" data-testid="quest-note">
          {questNote ??
            (carrying ? `Carrying the ${carrying.template.item.name} for ${carrying.template.giver.name}.` : null)}
        </div>
      ) : null}

      {questTalk ? (
        <div className={styles.bubbleWrap} onClick={closeTalk}>
          <div
            className={styles.bubble}
            role="dialog"
            aria-label={`${questTalk.template.giver.name} says`}
            data-testid="quest-dialog"
            data-quest-id={questTalk.template.id}
            data-quest-phase={questTalk.phase}
            onClick={e => e.stopPropagation()}
          >
            <img src={CARD_ART[questTalk.template.giver.variant].src} alt="" />
            <div>
              <strong>{questTalk.template.giver.name}</strong>
              <p data-testid="quest-line">{questTalk.line}</p>
              <div className={styles.questButtons}>
                {questTalk.phase === "carrying" ? (
                  <button type="button" onClick={() => giveItem(questTalk.target.customerId)} data-testid="quest-give">
                    Give the {questTalk.template.item.name} to {questTalk.template.giver.name}
                  </button>
                ) : null}
                {questTalk.phase === "waiting" ? (
                  <>
                    <button type="button" onClick={() => writeTo(questTalk.target.customerId)} data-testid="quest-write">
                      Write to {questTalk.slots.customerFirst}
                    </button>
                    <button
                      type="button"
                      className={styles.questQuiet}
                      onClick={() => passOn(questTalk.target.customerId)}
                      data-testid="quest-pass"
                    >
                      Pass on {questTalk.slots.customerFirst} for now
                    </button>
                  </>
                ) : null}
                {questTalk.phase === "need" ? (
                  <button type="button" onClick={closeTalk}>
                    I'll look
                  </button>
                ) : null}
                {questTalk.phase === "locked" || questTalk.phase === "done" ? (
                  <button type="button" onClick={closeTalk}>
                    Bye for now
                  </button>
                ) : null}
                {questTalk.phase !== "waiting" && questTalk.phase !== "done" ? (
                  <button
                    type="button"
                    className={styles.questQuiet}
                    onClick={() => writeTo(questTalk.target.customerId)}
                    data-testid="quest-skip"
                  >
                    Just write to {questTalk.slots.customerFirst}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {reunion && reunionQuest && reunionTarget ? (
        <div className={styles.reunionWrap}>
          <div
            className={styles.reunion}
            role="dialog"
            aria-label={`${reunionQuest.template.giver.name} and ${reunionTarget.displayName}`}
            data-testid="reunion-vignette"
            data-quest-id={reunionQuest.template.id}
          >
            <div className={styles.reunionStage} aria-hidden>
              <figure>
                <img src={CARD_ART[reunionQuest.template.giver.variant].src} alt="" />
                <figcaption>{reunionQuest.template.giver.name}</figcaption>
              </figure>
              <span className={styles.reunionNotes}>♪ ✦ ♪</span>
              <figure className={reunion.index >= 1 ? styles.reunionArrived : styles.reunionArriving}>
                <img src={CARD_ART[reunionTarget.villagerVariant]?.src} alt="" />
                <figcaption>{reunionTarget.displayName}</figcaption>
              </figure>
            </div>
            <ol className={styles.reunionBeats}>
              {reunion.beats.slice(0, reunion.index + 1).map((b, i) => (
                <li
                  key={i}
                  data-testid="reunion-beat"
                  data-speaker={b.speaker}
                  className={b.speaker === "narrator" ? styles.reunionNarration : undefined}
                >
                  {b.speaker === "giver" ? <b>{reunionQuest.template.giver.name}: </b> : null}
                  {b.text}
                </li>
              ))}
            </ol>
            <div className={styles.questButtons}>
              {reunion.index < reunion.beats.length - 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setReunion(r => (r ? { ...r, index: r.index + 1 } : r))}
                    data-testid="reunion-next"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    className={styles.questQuiet}
                    onClick={() => writeTo(reunion.customerId)}
                    data-testid="quest-skip"
                  >
                    Just write to {reunionQuest.slots.customerFirst}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => writeTo(reunion.customerId)} data-testid="reunion-write">
                    Write to {reunionQuest.slots.customerFirst}
                  </button>
                  <button
                    type="button"
                    className={styles.questQuiet}
                    onClick={() => passOn(reunion.customerId)}
                    data-testid="reunion-pass"
                  >
                    Pass on {reunionQuest.slots.customerFirst} for now
                  </button>
                </>
              )}
            </div>
            <p className={styles.reunionFootnote}>
              The courtyard is make-believe. Your letter to {reunionTarget.displayName} stays plain and truthful.
            </p>
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
