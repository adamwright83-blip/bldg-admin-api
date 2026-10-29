import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import {
  applyObservation,
  normalizeDiscoveries,
  type CourtyardDiscoveries,
  type CourtyardObservation,
} from "@shared/courtyardDiscoveries";
import type { SilverLakeHandle } from "../silverLakeRuntime";
import { mountSpecialDelivery, type ControlMode, type SpecialDeliveryController } from "./specialDelivery";
import type { FanSetting } from "./deliveryPhysics";
import { CorrespondenceDesk, type UnfinishedDeskDraft } from "./CorrespondenceDesk";
import { pickDeskTarget } from "./deskTarget";
import { useSpecialDeliveryFlag } from "./useSpecialDeliveryFlag";
import styles from "./special-delivery.module.css";

/**
 * Rook's airmail station inside the walkable Silver Lake courtyard, and the correspondence desk beside it.
 *
 * The game is fiction and remembers only what physically happened (shared/courtyardDiscoveries.ts). The desk is the
 * real business: one actual customer situation, read from the existing Silver Lake mission, with Sable's recall of the
 * real record and Rook's draft, handed to the existing Letter Desk for anything that leaves the building. The synthetic
 * preview never writes anywhere; its desk shows a labelled fixture.
 */

const LOCAL_KEY = (tenant: string) => `silverLake.courtyard.${tenant}`;
// the course runs right to left on screen: "forward" leans toward Bella's balcony (left), "back" toward Rook (right)
const FAN_ARROWS: Record<FanSetting, string> = { up: "↑", forward: "↖", back: "↗" };
const FAN_WORDS: Record<FanSetting, string> = { up: "blowing straight up", forward: "leaning toward Bella", back: "leaning toward Rook" };

function readLocal(tenant: string): CourtyardDiscoveries {
  try {
    return normalizeDiscoveries(JSON.parse(window.localStorage.getItem(LOCAL_KEY(tenant)) ?? "null"));
  } catch {
    return normalizeDiscoveries(null);
  }
}
function writeLocal(tenant: string, state: CourtyardDiscoveries) {
  try {
    window.localStorage.setItem(LOCAL_KEY(tenant), JSON.stringify(state));
  } catch {
    /* not remembered on this device */
  }
}

export type SpecialDeliveryLayerProps = {
  runtime: SilverLakeHandle | null;
  ready: boolean;
  synthetic: boolean;
  territoryId: string;
  tenantKey: string;
  targets: CozyProjectedTarget[];
  /** customers the operator has passed on for now (their pass holds; the desk does not bring them back) */
  isPassed(customerId: string): boolean;
  /** the courtyard's one saved, unfinished draft (neighbourhood memory) */
  unfinished: UnfinishedDeskDraft;
  onSaveDraft(target: CozyProjectedTarget, draft: string): Promise<void> | void;
  /** hand one real customer and the draft to the existing Letter Desk (consent, hand-off, reported send) */
  onOpenLetterDesk(target: CozyProjectedTarget, draft: string): void;
  onEngagedChange(engaged: boolean): void;
};

export default function SpecialDeliveryLayer(props: SpecialDeliveryLayerProps) {
  const { runtime, ready, synthetic, territoryId, tenantKey } = props;
  const { on: enabled, memory: serverMemory } = useSpecialDeliveryFlag(territoryId, ready);
  const record = trpc.system.goldlineWorld.recordSpecialDelivery.useMutation();

  const [memory, setMemory] = useState<CourtyardDiscoveries>(() => (synthetic ? readLocal(`preview.${tenantKey}`) : readLocal(tenantKey)));
  const memoryRef = useRef(memory);
  memoryRef.current = memory;
  useEffect(() => {
    if (synthetic || !serverMemory) return;
    const m = normalizeDiscoveries(serverMemory);
    setMemory(m);
    writeLocal(tenantKey, m);
  }, [serverMemory, synthetic, tenantKey]);

  const controllerRef = useRef<SpecialDeliveryController | null>(null);
  const [mounted, setMounted] = useState(false);
  const [near, setNear] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [showcase, setShowcase] = useState(false);
  const [fan, setFan] = useState<{ setting: FanSetting; unlocked: boolean } | null>(null);
  const [envelopeVisible, setEnvelopeVisible] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [offer, setOffer] = useState(false);
  const [controlMode, setControlMode] = useState<ControlMode>(() => {
    try {
      return window.localStorage.getItem("silverLake.airmail.controls") === "toggle" ? "toggle" : "hold";
    } catch {
      return "hold";
    }
  });
  const visitStartedAt = useRef(Date.now());
  const onEngagedChange = props.onEngagedChange;
  // the page's own panels step aside while you are at the station, and for the one establishing look at the course
  useEffect(() => {
    onEngagedChange(engaged || showcase);
  }, [engaged, showcase, onEngagedChange]);

  const observe = useCallback(
    (obs: CourtyardObservation) => {
      const next = applyObservation(memoryRef.current, obs, new Date().toISOString());
      memoryRef.current = next;
      setMemory(next);
      writeLocal(synthetic ? `preview.${tenantKey}` : tenantKey, next);
      // the synthetic preview is isolated: it never writes the real courtyard's memory
      if (!synthetic) record.mutate({ territoryId, observation: obs });
    },
    [record, synthetic, tenantKey, territoryId]
  );
  const observeRef = useRef(observe);
  observeRef.current = observe;

  // mount the game once the courtyard is up and the flag is on. Its code is part of the Silver Lake 3D page (itself
  // lazy, and the only place three.js may load); none of it runs while the flag is off
  useEffect(() => {
    if (!ready || !runtime || !enabled) return;
    let cancelled = false;
    let controller: SpecialDeliveryController | null = null;
    void (async () => {
      const deepLinked = new URLSearchParams(window.location.search).has("customer");
      controller = await mountSpecialDelivery(runtime, {
        memory: memoryRef.current,
        visitStartedAt: visitStartedAt.current,
        arriveFacingStation: !deepLinked && !memoryRef.current.beats.intro_seen,
        callbacks: {
          onObserve: obs => observeRef.current(obs),
          onNearStation: v => !cancelled && setNear(v),
          onEngaged: v => {
            if (cancelled) return;
            setEngaged(v);
            if (v) setShowcase(false);
            if (!v) setOffer(false);
          },
          onShowcase: v => !cancelled && setShowcase(v),
          onFan: v => !cancelled && setFan(v),
          onEnvelope: v => !cancelled && setEnvelopeVisible(v),
          onOpenEnvelope: () => !cancelled && setOffer(true),
        },
      });
      if (cancelled) {
        controller.dispose();
        return;
      }
      controllerRef.current = controller;
      setMounted(true);
    })();
    return () => {
      cancelled = true;
      controller?.dispose();
      controllerRef.current = null;
      setMounted(false);
    };
    // the game reads memory through the ref; remounting on every remembered event would restart it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, runtime, enabled]);

  useEffect(() => {
    controllerRef.current?.setMemory(memory);
  }, [memory, mounted]);
  useEffect(() => {
    controllerRef.current?.setControlMode(controlMode);
    try {
      window.localStorage.setItem("silverLake.airmail.controls", controlMode);
    } catch {
      /* per device */
    }
  }, [controlMode, mounted]);

  // the desk has something only when there is a real situation (or, in the preview, the labelled fixture)
  const { isPassed, unfinished } = props;
  const deskTarget = useMemo(
    () => pickDeskTarget(props.targets.filter(t => !isPassed(t.customerId)), unfinished),
    [props.targets, isPassed, unfinished]
  );
  const notNowKey = `silverLake.desk.notNow.${tenantKey}`;
  const [notNowUntil, setNotNowUntil] = useState<number>(() => {
    try {
      return Number(window.localStorage.getItem(notNowKey) ?? 0);
    } catch {
      return 0;
    }
  });
  const hasDesk = (synthetic || Boolean(deskTarget)) && Date.now() > notNowUntil;
  useEffect(() => {
    controllerRef.current?.setEnvelope(hasDesk ? "waiting" : "none");
  }, [hasDesk, mounted]);

  if (!enabled || !mounted) return null;

  return (
    <>
      {!engaged && near ? (
        <button type="button" className={styles.stationPrompt} onClick={() => controllerRef.current?.enter()} data-testid="airmail-enter">
          <kbd>E</kbd> Rook's Airmail
        </button>
      ) : null}
      {!engaged && !near ? (
        <button type="button" className={styles.stationPill} onClick={() => controllerRef.current?.enter()} data-testid="airmail-open" aria-label="Go to Rook's Airmail">
          ✉ Rook's Airmail
        </button>
      ) : null}
      {engaged ? (
        <div className={styles.hud} data-testid="airmail-hud">
          <button type="button" className={styles.hudButton} onClick={() => controllerRef.current?.exit()} data-testid="airmail-exit">
            ← Courtyard
          </button>
          <button
            type="button"
            className={styles.hudButton}
            aria-pressed={controlMode === "toggle"}
            onClick={() => setControlMode(m => (m === "hold" ? "toggle" : "hold"))}
            data-testid="airmail-controls"
            title={controlMode === "hold" ? "Wings open while you hold. Switch to tap on, tap off." : "Tap to open the wings, tap again to fold them."}
          >
            Wings: {controlMode === "hold" ? "hold" : "tap"}
          </button>
          {fan ? (
            <button
              type="button"
              className={styles.hudButton}
              onClick={() => controllerRef.current?.turnFan()}
              aria-label={`Turn the fan. Now ${FAN_WORDS[fan.setting]}${fan.unlocked ? "" : "; it turns after your first delivery"}.`}
              title={fan.unlocked ? `Now ${FAN_WORDS[fan.setting]}` : "It turns after your first delivery"}
              data-testid="airmail-fan"
            >
              Fan {FAN_ARROWS[fan.setting]}
            </button>
          ) : null}
          {envelopeVisible ? (
            <button type="button" className={styles.envelopeChip} onClick={() => setOffer(true)} data-testid="airmail-envelope">
              ✉ Your business
            </button>
          ) : null}
        </div>
      ) : null}
      {engaged && offer && !deskOpen ? (
        <div className={styles.offer} role="dialog" aria-label="Rook has something for you">
          <p>
            <b>Rook:</b> I've got something for you, if you want to look.
          </p>
          <div className={styles.offerButtons}>
            <button
              type="button"
              onClick={() => {
                setDeskOpen(true);
                setOffer(false);
              }}
              data-testid="airmail-take-a-look"
            >
              Take a look
            </button>
            <button type="button" className={styles.quiet} onClick={() => setOffer(false)} data-testid="airmail-keep-playing">
              Keep playing
            </button>
          </div>
        </div>
      ) : null}
      {deskOpen ? (
        <CorrespondenceDesk
          synthetic={synthetic}
          territoryId={territoryId}
          target={deskTarget}
          unfinished={unfinished}
          onSaveDraft={props.onSaveDraft}
          onClose={() => setDeskOpen(false)}
          onNotNow={() => {
            // set aside until tomorrow on this device; nothing about the customer is recorded
            const until = new Date();
            until.setHours(24, 0, 0, 0);
            setNotNowUntil(until.getTime());
            try {
              window.localStorage.setItem(notNowKey, String(until.getTime()));
            } catch {
              /* per device */
            }
            setDeskOpen(false);
          }}
          onOpenLetterDesk={(t, draft) => {
            setDeskOpen(false);
            controllerRef.current?.exit();
            props.onOpenLetterDesk(t, draft);
          }}
        />
      ) : null}
    </>
  );
}
