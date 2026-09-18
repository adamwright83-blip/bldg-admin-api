import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  canCompleteRescue,
  SPIRIT_HUMAN_RESCUE_TEMPLATE_ID,
  type SpiritHumanRescueMission,
} from "../../../../shared/spiritHumanRescue";
import { SPIRIT_HUMAN_RESCUE_ART } from "../../../../shared/spiritHumanRescueArt";
import {
  initialPressureState,
  reducePressure,
  restorePressureAcrossRefresh,
  shouldPersistPressureAnchor,
  type PressureEvent,
  type PressureState,
} from "../../../../shared/spiritHumanPressure";
import captivePng from "@/assets/spirit-human/core/captive.png";
import environmentPng from "@/assets/spirit-human/core/environment.webp";
import playerMarkPng from "@/assets/spirit-human/core/playerMark.png";
import threatPng from "@/assets/spirit-human/core/threat.png";
import "./SpiritHumanRescueMission.css";

const PRESSURE_STORAGE_PREFIX = "goldline:spirit-human-pressure:v1:";

function pressureStorageKey(missionId: string): string {
  return `${PRESSURE_STORAGE_PREFIX}${missionId}`;
}

function loadAnchor(missionId: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(pressureStorageKey(missionId));
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

function saveAnchor(missionId: string, roundAnchorMs: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(pressureStorageKey(missionId), String(roundAnchorMs));
}

function pressureReducer(state: PressureState, event: PressureEvent): PressureState {
  return reducePressure(state, event);
}

export default function SpiritHumanRescueMissionHost(props: {
  missionId: string | null;
  isDriving: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const mine = trpc.system.spiritHumanRescue.listMine.useQuery(undefined, {
    refetchOnWindowFocus: true,
  });
  const candidates = trpc.system.spiritHumanRescue.listCandidates.useQuery(undefined, {
    staleTime: 15_000,
  });
  const instantiate = trpc.system.spiritHumanRescue.instantiate.useMutation();
  const enter = trpc.system.spiritHumanRescue.enter.useMutation();
  const prepareDraft = trpc.system.spiritHumanRescue.prepareDraft.useMutation();
  const approveAndSend = trpc.system.spiritHumanRescue.approveAndSend.useMutation();
  const defer = trpc.system.spiritHumanRescue.defer.useMutation();
  const cancel = trpc.system.spiritHumanRescue.cancel.useMutation();
  const reconcileConsequences = trpc.system.spiritHumanRescue.reconcileConsequences.useMutation();

  const mission: SpiritHumanRescueMission | null = useMemo(() => {
    const rows = mine.data ?? [];
    if (props.missionId) {
      return rows.find(row => row.missionId === props.missionId) ?? rows[0] ?? null;
    }
    return (
      rows.find(row => row.lifecycle === "active" || row.lifecycle === "problem") ??
      rows.find(row => row.lifecycle === "available") ??
      rows.find(row => row.lifecycle === "completed") ??
      null
    );
  }, [mine.data, props.missionId]);

  const [draftText, setDraftText] = useState("");
  const [busy, setBusy] = useState<"draft" | "send" | "boot" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pressure, dispatchPressure] = useReducer(
    pressureReducer,
    undefined,
    () => initialPressureState(Date.now())
  );
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!mission) return;
    setDraftText(mission.draft ?? "");
    const restored = restorePressureAcrossRefresh({
      storedAnchorMs: loadAnchor(mission.missionId),
      nowMs: Date.now(),
      missionCompleted: canCompleteRescue(mission.send),
      missionId: mission.missionId,
    });
    dispatchPressure({ type: "restore", state: restored });
  }, [mission?.missionId, mission?.send.status]);

  useEffect(() => {
    if (!mission || !canCompleteRescue(mission.send)) return;
    if (mission.consequences.some(item => item.kind === "customer_ordered")) return;
    if (reconcileConsequences.isPending) return;
    void reconcileConsequences.mutateAsync().then(() => refresh()).catch(() => undefined);
    // Reconcile only from authoritative paid-order evidence; this never claims a reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission?.missionId, mission?.send.status, mission?.consequences.length]);

  useEffect(() => {
    if (!mission) return;
    if (
      !shouldPersistPressureAnchor({
        missionId: mission.missionId,
        pressureMissionId: pressure.missionId,
        completed: canCompleteRescue(mission.send),
      })
    ) {
      return;
    }
    saveAnchor(mission.missionId, pressure.roundAnchorMs);
  }, [mission, pressure.missionId, pressure.roundAnchorMs]);

  useEffect(() => {
    dispatchPressure({ type: "driving_changed", nowMs: Date.now(), driving: props.isDriving });
  }, [props.isDriving]);

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        backgroundedAt.current = Date.now();
        dispatchPressure({ type: "background", nowMs: Date.now() });
        return;
      }
      const started = backgroundedAt.current;
      backgroundedAt.current = null;
      dispatchPressure({
        type: "foreground",
        nowMs: Date.now(),
        elapsedBackgroundMs: started ? Date.now() - started : 0,
      });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (pressure.phase === "rescue" || pressure.phase === "impact") return;
    const timer = window.setInterval(() => {
      dispatchPressure({ type: "tick", nowMs: Date.now() });
    }, 100);
    return () => window.clearInterval(timer);
  }, [pressure.phase]);

  useEffect(() => {
    if (mission || busy || !candidates.data?.[0]) return;
    void ensureMission();
    // Boot a frozen target once so refresh cannot swap the customer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission, candidates.data]);

  const refresh = useCallback(async () => {
    await utils.system.spiritHumanRescue.listMine.invalidate();
  }, [utils]);

  async function ensureMission(): Promise<SpiritHumanRescueMission | null> {
    if (mission) return mission;
    const candidate = candidates.data?.[0];
    if (!candidate) return null;
    setBusy("boot");
    try {
      const created = await instantiate.mutateAsync({ snapshotCustomerId: candidate.id });
      await enter.mutateAsync({ missionId: created.missionId });
      await refresh();
      return created;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open rescue mission.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function onPrepare() {
    const current = await ensureMission();
    if (!current) return;
    dispatchPressure({ type: "player_prepare", nowMs: Date.now() });
    setBusy("draft");
    setError(null);
    try {
      const prepared = await prepareDraft.mutateAsync({
        missionId: current.missionId,
        editedDraft: draftText || undefined,
      });
      setDraftText(prepared.draft ?? "");
      dispatchPressure({ type: "draft_ready", nowMs: Date.now() });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft failed.");
      dispatchPressure({ type: "cancel", nowMs: Date.now() });
    } finally {
      setBusy(null);
    }
  }

  async function onSend() {
    if (!mission || props.isDriving) return;
    dispatchPressure({ type: "send_started", nowMs: Date.now() });
    setBusy("send");
    setError(null);
    try {
      const sent = await approveAndSend.mutateAsync({
        missionId: mission.missionId,
        operatorAuthorizedSend: true,
        editedDraft: draftText || undefined,
      });
      if (canCompleteRescue(sent.send)) {
        dispatchPressure({ type: "send_succeeded", nowMs: Date.now() });
      } else if (sent.lifecycle === "superseded") {
        setError(sent.send.failureReason ?? "This rescue is no longer needed. They are active again.");
      } else if (sent.send.status === "send_outcome_unknown") {
        setError(
          sent.send.failureReason ??
            "Send outcome is unknown. Do not retry automatically — this needs reconciliation."
        );
      } else {
        dispatchPressure({ type: "send_failed", nowMs: Date.now() });
        setError(sent.send.failureReason ?? "Send failed. The villager is still caged.");
      }
      await refresh();
    } catch (err) {
      dispatchPressure({ type: "send_failed", nowMs: Date.now() });
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onDefer() {
    if (!mission) return;
    await defer.mutateAsync({ missionId: mission.missionId });
    await refresh();
    props.onClose();
  }

  async function onCancel() {
    if (!mission) return;
    dispatchPressure({ type: "cancel", nowMs: Date.now() });
    await cancel.mutateAsync({ missionId: mission.missionId });
    await refresh();
    props.onClose();
  }

  const rescued = mission ? canCompleteRescue(mission.send) : false;
  const phase = rescued ? "rescue" : pressure.phase;
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const threatY = reducedMotion ? (phase === "impact" ? 78 : 8) : Math.round(pressure.descentProgress * 72);

  return (
    <section
      className="shr-mission"
      data-testid="spirit-human-rescue-mission"
      data-phase={phase}
      data-art={SPIRIT_HUMAN_RESCUE_ART.status}
      data-template={SPIRIT_HUMAN_RESCUE_TEMPLATE_ID}
      aria-label="Spirit Human rescue"
    >
      <img className="shr-environment" src={environmentPng} alt="" />
      <img
        className="shr-threat"
        src={threatPng}
        alt=""
        style={{ transform: `translate(-50%, ${phase === "rescue" ? -12 : threatY}%)` }}
      />
      <img className="shr-captive" src={captivePng} alt="" />
      <img className="shr-player" src={playerMarkPng} alt="" />

      <header className="shr-hud">
        <small>JOYSTICK MISSION</small>
        <b>{mission?.villager.displayName ?? "Villager"} is caged</b>
        <span>
          Spirit Human {mission?.spiritHuman.firstName ?? "—"}
          {mission?.spiritHuman.daysSinceLastOrder != null
            ? ` · ${mission.spiritHuman.daysSinceLastOrder}d quiet`
            : ""}
        </span>
        <button type="button" className="shr-close" onClick={props.onClose}>
          CLOSE
        </button>
      </header>

      {props.isDriving ? (
        <div className="shr-panel" data-testid="spirit-human-driving-safe">
          <p>Stationary required. Pressure is frozen while you are driving.</p>
          <button type="button" onClick={props.onClose}>
            BACK
          </button>
        </div>
      ) : (
        <div className="shr-panel">
          <p>
            {phase === "rescue"
              ? `${mission?.villager.displayName ?? "Villager"} is free. The message was accepted by the provider. No reply or order has been claimed.`
              : phase === "impact"
                ? "The machinery jammed. This is a game reset, not a judgment. Try again."
                : `${mission?.villager.displayName ?? "A villager"} is held. Opening comms freezes the threat immediately.`}
          </p>
          {mission?.consequences.length ? (
            <p className="shr-later">
              Later world notes:{" "}
              {mission.consequences.map(item => item.kind.replaceAll("_", " ")).join(" · ")}
            </p>
          ) : null}
          {error ? <p className="shr-error">{error}</p> : null}
          {phase !== "rescue" ? (
            <textarea
              value={draftText}
              onChange={event => setDraftText(event.target.value)}
              placeholder="Draft outreach. You can edit."
              rows={4}
              disabled={busy === "send"}
            />
          ) : null}
          <div className="shr-actions">
            {phase === "impact" ? (
              <button type="button" onClick={() => dispatchPressure({ type: "impact_ack", nowMs: Date.now() })}>
                RESET ENCOUNTER
              </button>
            ) : null}
            {phase !== "rescue" && !draftText ? (
              <button type="button" onClick={() => void onPrepare()} disabled={busy != null}>
                {busy === "draft" ? "PREPARING…" : "OPEN COMMS"}
              </button>
            ) : null}
            {phase !== "rescue" && (draftText || mission?.draft) ? (
              <>
                <button type="button" onClick={() => void onPrepare()} disabled={busy != null}>
                  REFRESH DRAFT
                </button>
                <button
                  type="button"
                  data-testid="spirit-human-send"
                  onClick={() => void onSend()}
                  disabled={busy != null || !mission}
                >
                  {busy === "send" ? "SENDING…" : "SEND APPROVED OUTREACH"}
                </button>
              </>
            ) : null}
            {phase !== "rescue" ? (
              <>
                <button type="button" onClick={() => void onDefer()} disabled={!mission}>
                  NOT NOW
                </button>
                <button type="button" onClick={() => void onCancel()} disabled={!mission}>
                  CANCEL
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
