import { useCallback, useEffect, useRef, useState } from "react";
import type { CommercialMission } from "@shared/commercialMission";
import type { CommercialMissionGameReward } from "@shared/commercialMissionGame";
import { trpc } from "@/lib/trpc";
import { RallyAudio } from "./rallyAudio";
import { RallyEngine, type RallyControlMode, type RallyPowerId, type RallyState } from "./rallyEngine";
import { RALLY_CONFIG } from "./rallyConfig";
import { RallyParticlePool } from "./rallyParticles";
import { RallyRenderer } from "./rallyRenderer";
import { RallyClipExporter } from "./rallyShare";
import { RallyMetrics } from "./rallyMetrics";
import "./rally.css";

// Keep the live arena framing stable. Speed tiers should affect the scroll,
// not zoom the entire battlefield in and out.
(RALLY_CONFIG.juice as { tierThreeZoom: number }).tierThreeZoom = 1;

type HudState = {
  status: RallyState["status"];
  message: string;
  controlMode: RallyState["controlMode"];
  sparkScore: number;
  clockheadScore: number;
  scoringMode: RallyState["scoringMode"];
  regulationRemainingMs: number;
  suddenDeath: boolean;
  influence: number;
  energy: number;
  sparkMeter: number;
  clockheadMeter: number;
  surgeReady: boolean;
  rallyCount: number;
  speedTier: 0 | 1 | 2 | 3;
  missionStatus: RallyState["mission"]["status"];
  missionDeadline: number | null;
  timeMs: number;
  reducedMotion: boolean;
  powerLoadout: RallyPowerId[];
  powerSpent: Record<RallyPowerId, boolean>;
  placingPower: RallyPowerId | null;
};

const snapshotHud = (state: RallyState): HudState => ({
  status: state.status,
  message: state.message,
  controlMode: state.controlMode,
  sparkScore: state.sparkScore,
  clockheadScore: state.clockheadScore,
  scoringMode: state.scoringMode,
  regulationRemainingMs: state.regulationRemainingMs,
  suddenDeath: state.suddenDeath,
  influence: state.influence,
  energy: state.controlMode === "duel" ? state.duel.spark.meter : state.spark.energy,
  sparkMeter: state.duel.spark.meter,
  clockheadMeter: state.duel.clockhead.meter,
  surgeReady: state.controlMode === "duel" && state.duel.spark.meter >= 100,
  rallyCount: state.excuse.rallyCount,
  speedTier: state.excuse.speedTier,
  missionStatus: state.mission.status,
  missionDeadline: state.mission.acceptDeadline,
  timeMs: state.timeMs,
  reducedMotion: state.reducedMotion,
  powerLoadout: [...state.powers.loadout],
  powerSpent: { ...state.powers.spent },
  placingPower: state.powers.placement?.power ?? null,
});

const SCORE_SLOTS = [0, 1, 2, 3, 4] as const;
const POWER_META: Record<RallyPowerId, { name: string; note: string }> = {
  redTape: { name: "RED TAPE", note: "Place a rebound ribbon" },
  hardNo: { name: "HARD NO", note: "Block one certain score" },
  deadlineStamp: { name: "DEADLINE STAMP", note: "Plant a timed launcher" },
  receipts: { name: "RECEIPTS", note: "Reveal the scroll's path" },
};

const formatClock = (remainingMs: number) => {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

export function RallyDemo() {
  const missionIdParam = new URLSearchParams(window.location.search).get("missionId");
  const parsedMissionId = Number(missionIdParam);
  const missionId = Number.isInteger(parsedMissionId) && parsedMissionId > 0 ? parsedMissionId : null;
  const missionQuery = trpc.system.commercialMission.gameState.useQuery(
    { missionId: missionId ?? 1 },
    { enabled: missionId !== null, retry: false },
  );
  const gameStart = trpc.system.commercialMission.gameStart.useMutation();
  const gameAbandon = trpc.system.commercialMission.gameAbandon.useMutation();
  const gameComplete = trpc.system.commercialMission.gameComplete.useMutation();
  const [commercialMission, setCommercialMission] = useState<CommercialMission | null>(null);
  const [gameReward, setGameReward] = useState<CommercialMissionGameReward | null>(null);
  const [missionError, setMissionError] = useState<string | null>(null);
  const commercialMissionRef = useRef<CommercialMission | null>(null);
  const gameAttemptIdRef = useRef(crypto.randomUUID());
  const terminalReportedRef = useRef<"victory" | "defeat" | null>(null);
  const engagedRef = useRef(false);
  const reducedMotionQuery =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const engineRef = useRef<RallyEngine | null>(null);
  if (!engineRef.current) {
    const params = new URLSearchParams(window.location.search);
    const scoring = params.get("scoring");
    const controlsParam = params.get("controls");
    const controlMode: RallyControlMode = controlsParam === "flight" ? "flight" : RALLY_CONFIG.controls;
    const parsedSeed = Number(params.get("seed"));
    engineRef.current = new RallyEngine({
      reducedMotion: reducedMotionQuery,
      controlMode,
      scoringMode: scoring === "portal" ? "portal" : "buttHybrid",
      seed: Number.isFinite(parsedSeed) && parsedSeed > 0 ? parsedSeed : undefined,
    });
  }
  const metricsRef = useRef<RallyMetrics | null>(null);
  if (!metricsRef.current) {
    const params = new URLSearchParams(window.location.search);
    metricsRef.current = new RallyMetrics(
      engineRef.current.state.scoringMode,
      params.has("controls") || params.has("scoring") ? "url" : "default",
      engineRef.current.state.controlMode
    );
  }
  const rendererRef = useRef<RallyRenderer | null>(null);
  const particlesRef = useRef(new RallyParticlePool());
  const audioRef = useRef(new RallyAudio());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const arenaRef = useRef<HTMLDivElement>(null);
  const rescueButtonRef = useRef<HTMLButtonElement>(null);
  const keysRef = useRef(new Set<string>());
  const [hud, setHud] = useState(() => snapshotHud(engineRef.current!.state));
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [joystick, setJoystick] = useState({ x: 0, y: 0 });
  const [clipRequest, setClipRequest] = useState<{ tick: number; nonce: number } | null>(null);
  const [clip, setClip] = useState<{
    status: "cutting" | "ready" | "error";
    progress: number;
    blob?: Blob;
    extension?: string;
  } | null>(null);
  const clipAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    engagedRef.current = engaged;
  }, [engaged]);

  useEffect(() => {
    if (!missionQuery.data) return;
    setCommercialMission(missionQuery.data.mission);
    commercialMissionRef.current = missionQuery.data.mission;
    setGameReward(missionQuery.data.reward);
  }, [missionQuery.data]);

  const adoptMission = useCallback((mission: CommercialMission) => {
    commercialMissionRef.current = mission;
    setCommercialMission(mission);
  }, []);

  const syncHud = useCallback(() => {
    setHud(snapshotHud(engineRef.current!.state));
  }, []);

  useEffect(() => {
    const reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      engineRef.current!.setReducedMotion(reducedQuery.matches);
      particlesRef.current.setReducedMotion(reducedQuery.matches);
      syncHud();
    };
    update();
    reducedQuery.addEventListener("change", update);
    return () => reducedQuery.removeEventListener("change", update);
  }, [syncHud]);

  useEffect(() => {
    rendererRef.current = new RallyRenderer();
    let animationFrame = 0;
    let lastFrame = performance.now();
    let lastHudSync = lastFrame;
    const loop = (now: number) => {
      const frameMs = Math.min(100, now - lastFrame);
      lastFrame = now;
      const engine = engineRef.current!;
      engine.advanceFrame(frameMs);

      // Leftward strikes assign negative spin. Normalize it to the sprite sheet's
      // 0–7 frame range before rendering so the scroll never disappears while
      // its separately rendered trail remains visible.
      engine.state.excuse.spin = ((engine.state.excuse.spin % 8) + 8) % 8;

      const events = engine.consumeEvents();
      for (const event of events) {
        audioRef.current.handleEvent(event);
        particlesRef.current.handleEvent(event);
        metricsRef.current!.handleEvent(event, engine.state);
        if (
          (event.type === "gate_score_for" &&
            event.banked &&
            engine.state.scoringMode === "buttHybrid") ||
          event.type === "victory"
        ) {
          metricsRef.current!.shareOffered();
          setClipRequest({ tick: engine.state.tick, nonce: performance.now() });
        }
      }
      particlesRef.current.update(engine.hitStopMs > 0 ? 0 : frameMs);
      if (canvasRef.current) {
        rendererRef.current?.render(
          canvasRef.current,
          engine.state,
          engine.interpolationAlpha,
          particlesRef.current
        );
      }
      if (events.length > 0 || now - lastHudSync >= 100) {
        syncHud();
        lastHudSync = now;
      }
      animationFrame = requestAnimationFrame(loop);
    };
    animationFrame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationFrame);
  }, [syncHud]);

  useEffect(() => {
    if (!clipRequest) return;
    const controller = new AbortController();
    clipAbortRef.current?.abort();
    clipAbortRef.current = controller;
    setClip({ status: "cutting", progress: 0 });
    const exporter = new RallyClipExporter();
    void exporter.cut(engineRef.current!.getReplayRecord(), clipRequest.tick, {
      signal: controller.signal,
      onProgress: progress => setClip(current => current?.status === "cutting"
        ? { ...current, progress }
        : current),
    }).then(result => {
      setClip({
        status: "ready",
        progress: 1,
        blob: result.blob,
        extension: result.extension,
      });
    }).catch(error => {
      if (error instanceof DOMException && error.name === "AbortError") {
        setClip(null);
      } else {
        setClip({ status: "error", progress: 0 });
      }
    });
    return () => controller.abort();
  }, [clipRequest]);

  useEffect(() => {
    const onBeforeUnload = () => metricsRef.current?.quitIfActive();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      metricsRef.current?.quitIfActive();
    };
  }, []);

  useEffect(() => {
    if (missionId === null) return;
    const onPageHide = () => {
      const mission = commercialMissionRef.current;
      if (!engagedRef.current || mission?.status !== "game_active" || terminalReportedRef.current) return;
      gameAbandon.mutate({
        missionId,
        expectedVersion: mission.version,
        gameAttemptId: gameAttemptIdRef.current,
        reason: "quit",
        durationMs: Math.max(0, Math.round(engineRef.current?.state.timeMs ?? 0)),
        telemetry: { lifecycle: "pagehide" },
      });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [gameAbandon, missionId]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("debug") !== "1") return;
    const debugWindow = window as Window & { __boreslayRallyEngine?: RallyEngine };
    debugWindow.__boreslayRallyEngine = engineRef.current!;
    return () => { delete debugWindow.__boreslayRallyEngine; };
  }, []);

  const updateMovement = useCallback(() => {
    const keys = keysRef.current;
    engineRef.current!.setMovement(
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
        Number(keys.has("KeyA") || keys.has("ArrowLeft")),
      Number(keys.has("KeyS") || keys.has("ArrowDown")) -
        Number(keys.has("KeyW") || keys.has("ArrowUp"))
    );
  }, []);

  useEffect(() => {
    if (!engaged) return;
    const gameplayCodes = new Set([
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyF",
      "KeyJ",
      "KeyK",
      "KeyL",
      "KeyP",
      "KeyX",
      "KeyZ",
      "Space",
      "Escape",
      "Digit1",
      "Digit2",
    ]);
    const onKeyDown = (event: KeyboardEvent) => {
      if (gameplayCodes.has(event.code)) event.preventDefault();
      if (event.code === "Escape" && !event.repeat) {
        engineRef.current!.pause();
        setEngaged(false);
        syncHud();
        return;
      }
      keysRef.current.add(event.code);
      updateMovement();
      if (engineRef.current!.state.controlMode === "duel") {
        if ((event.code === "KeyW" || event.code === "ArrowUp" || event.code === "Space") && !event.repeat) {
          engineRef.current!.jump();
        }
        if ((event.code === "KeyJ" || event.code === "KeyZ") && !event.repeat) {
          engineRef.current!.duelStrike("strike");
        }
        if ((event.code === "KeyK" || event.code === "KeyX") && !event.repeat) {
          engineRef.current!.duelStrike("loft");
        }
        if ((event.code === "KeyL" || event.code === "KeyP" || event.code === "Digit1") && !event.repeat) {
          engineRef.current!.duelPower();
        }
        syncHud();
        return;
      }
      if ((event.code === "Digit1" || event.code === "Digit2") && !event.repeat) {
        engineRef.current!.beginPower(event.code === "Digit1" ? 0 : 1);
      }
      if (event.code === "KeyF") engineRef.current!.setBreath(true);
      if (event.code === "Space" && !event.repeat) engineRef.current!.dash();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysRef.current.delete(event.code);
      updateMovement();
      if (engineRef.current!.state.controlMode === "duel") return;
      if (event.code === "Digit1" || event.code === "Digit2") {
        engineRef.current!.confirmPower();
      }
      if (event.code === "KeyF") engineRef.current!.setBreath(false);
    };
    const clearInput = () => {
      keysRef.current.clear();
      engineRef.current!.setMovement(0, 0);
      engineRef.current!.setBreath(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearInput);
    document.addEventListener("visibilitychange", clearInput);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", clearInput);
      document.removeEventListener("visibilitychange", clearInput);
    };
  }, [engaged, syncHud, updateMovement]);

  useEffect(() => {
    if (hud.missionStatus === "ready") rescueButtonRef.current?.focus();
  }, [hud.missionStatus]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "BORESLAY: EXCUSE RALLY";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const begin = async () => {
    if (missionId !== null) {
      const mission = commercialMissionRef.current;
      if (!mission) return;
      setMissionError(null);
      try {
        const active = await gameStart.mutateAsync({
          missionId,
          expectedVersion: mission.version,
          gameAttemptId: gameAttemptIdRef.current,
        });
        adoptMission(active.mission);
      } catch (error) {
        setMissionError(error instanceof Error ? error.message : "The mission could not be started.");
        return;
      }
    }
    engineRef.current!.start();
    metricsRef.current!.matchStart();
    setEngaged(true);
    syncHud();
    arenaRef.current?.focus();
  };

  const restart = async () => {
    if (missionId !== null) {
      const mission = commercialMissionRef.current;
      if (!mission || mission.status !== "game_ready") return;
      gameAttemptIdRef.current = crypto.randomUUID();
      terminalReportedRef.current = null;
      setMissionError(null);
      try {
        const active = await gameStart.mutateAsync({
          missionId,
          expectedVersion: mission.version,
          gameAttemptId: gameAttemptIdRef.current,
        });
        adoptMission(active.mission);
      } catch (error) {
        setMissionError(error instanceof Error ? error.message : "The mission could not be restarted.");
        return;
      }
    }
    metricsRef.current!.rematch();
    engineRef.current!.reset();
    particlesRef.current.clear();
    engineRef.current!.start();
    metricsRef.current!.matchStart();
    setEngaged(true);
    syncHud();
    arenaRef.current?.focus();
  };

  useEffect(() => {
    if (missionId === null || terminalReportedRef.current || (hud.status !== "victory" && hud.status !== "defeat")) return;
    const mission = commercialMissionRef.current;
    if (!mission || mission.status !== "game_active") return;
    terminalReportedRef.current = hud.status;
    if (hud.status === "defeat") {
      void gameAbandon.mutateAsync({
        missionId,
        expectedVersion: mission.version,
        gameAttemptId: gameAttemptIdRef.current,
        reason: "defeat",
        durationMs: Math.max(0, Math.round(hud.timeMs)),
        telemetry: { sparkScore: hud.sparkScore, clockheadScore: hud.clockheadScore },
      }).then(state => adoptMission(state.mission)).catch(error => {
        terminalReportedRef.current = null;
        setMissionError(error instanceof Error ? error.message : "The loss could not be recorded.");
      });
      return;
    }
    const replay = JSON.parse(JSON.stringify(engineRef.current!.getReplayRecord())) as Record<string, unknown>;
    void gameComplete.mutateAsync({
      missionId,
      expectedVersion: mission.version,
      gameAttemptId: gameAttemptIdRef.current,
      telemetry: {
        sparkScore: hud.sparkScore,
        clockheadScore: hud.clockheadScore,
        durationMs: Math.max(1, Math.round(hud.timeMs)),
        replay,
      },
    }).then(result => {
      adoptMission(result.mission);
      setGameReward(result.reward);
    }).catch(error => {
      terminalReportedRef.current = null;
      setMissionError(error instanceof Error ? error.message : "The victory could not be recorded.");
    });
  }, [adoptMission, gameAbandon, gameComplete, hud.clockheadScore, hud.sparkScore, hud.status, hud.timeMs, missionId]);

  const aimAtPointer = (clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = ((clientX - bounds.left) / bounds.width) * RALLY_CONFIG.arena.width;
    const y = ((clientY - bounds.top) / bounds.height) * RALLY_CONFIG.arena.height;
    engineRef.current!.setAim(x, y);
    engineRef.current!.updatePowerAim(x, y);
  };

  const joystickMove = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const rawX = (event.clientX - bounds.left - bounds.width / 2) / (bounds.width / 2);
    const rawY = (event.clientY - bounds.top - bounds.height / 2) / (bounds.height / 2);
    const magnitude = Math.max(1, Math.hypot(rawX, rawY));
    const next = { x: rawX / magnitude, y: rawY / magnitude };
    setJoystick(next);
    engineRef.current!.setMovement(next.x, next.y);
  };

  const endJoystick = () => {
    setJoystick({ x: 0, y: 0 });
    engineRef.current!.setMovement(0, 0);
  };

  const toggleSound = async () => {
    const next = !soundEnabled;
    await audioRef.current.setEnabled(next);
    setSoundEnabled(next);
  };

  const resume = () => {
    engineRef.current!.start();
    setEngaged(true);
    syncHud();
    arenaRef.current?.focus();
  };

  const acceptRemaining =
    hud.missionDeadline === null
      ? 0
      : Math.max(0, (hud.missionDeadline - hud.timeMs) / 1000);

  const shareClip = async () => {
    if (!clip?.blob || !clip.extension) return;
    const file = new File([clip.blob], `boreslay-bash.${clip.extension}`, { type: clip.blob.type });
    const shareData = { files: [file], title: "BORESLAY", text: "BORESLAY Rally" };
    if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
      metricsRef.current!.shareAccepted();
      await navigator.share(shareData);
      return;
    }
    const url = URL.createObjectURL(clip.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    metricsRef.current!.shareAccepted();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <main className={`rally-page mode-${hud.scoringMode} controls-${hud.controlMode}${hud.reducedMotion ? " is-reduced" : ""}`}>
      <section className="rally-shell" aria-label="BORESLAY Excuse Rally">
        {missionId !== null && (
          <aside className="rally-commercial-mission" aria-live="polite">
            {missionQuery.isLoading ? (
              <strong>LOADING PERSISTED MISSION…</strong>
            ) : missionQuery.error ? (
              <strong>MISSION UNAVAILABLE · {missionQuery.error.message}</strong>
            ) : commercialMission ? (
              <>
                <span>{commercialMission.code}</span>
                <strong>{commercialMission.account.name}</strong>
                <b>${Math.round(commercialMission.opportunity.estimatedAnnualValueCents / 100).toLocaleString()} POTENTIAL ANNUAL VALUE</b>
                <small>
                  {commercialMission.account.decisionMaker.name
                    ? `${commercialMission.account.decisionMaker.name} · ${commercialMission.account.decisionMaker.title ?? "Decision-maker"}`
                    : "Decision-maker research pending"}
                  {` · OBJECTIVE: ${(missionQuery.data?.objective ?? "Complete the BORESLAY match to unlock the field mission").toUpperCase()}`}
                </small>
              </>
            ) : null}
          </aside>
        )}
        {missionError && <div className="rally-mission-error" role="alert">{missionError}</div>}
        <div
          ref={arenaRef}
          className={`rally-stage is-${hud.status} tier-${hud.speedTier}`}
          tabIndex={engaged ? 0 : -1}
          onPointerMove={event => {
            if (engaged && hud.controlMode === "flight" && event.pointerType === "mouse") {
              aimAtPointer(event.clientX, event.clientY);
            }
          }}
          onPointerDown={event => {
            if (!engaged) return;
            if (hud.controlMode === "duel") return;
            aimAtPointer(event.clientX, event.clientY);
            if (
              event.pointerType === "mouse" &&
              !engineRef.current!.state.powers.placement
            ) engineRef.current!.setBreath(true);
          }}
          onPointerUp={() => {
            if (hud.controlMode === "duel") return;
            if (!engineRef.current!.confirmPower()) engineRef.current!.setBreath(false);
          }}
          onPointerLeave={() => {
            if (hud.controlMode === "flight") engineRef.current!.setBreath(false);
          }}
          aria-label="Excuse Rally arena. Use WASD or arrow keys to move, hold F or the mouse to breathe fire, Space to dash, and Escape to pause."
        >
          <canvas ref={canvasRef} className="rally-canvas" aria-hidden="true" />

          <div className="rally-hud" aria-label="Rally status">
            <div className="rally-fighter rally-fighter--spark">
              <strong>SPARK</strong>
              <div className="rally-lives" aria-label={`${hud.sparkScore} of 5 points`}>
                {SCORE_SLOTS.map(slot => (
                  <i key={slot} className={slot < hud.sparkScore ? "is-live" : ""} aria-hidden="true">🔥</i>
                ))}
              </div>
              <div className="rally-energy" aria-label={`${Math.round(hud.energy)} percent fire energy`}>
                <span style={{ width: `${hud.energy}%` }} />
              </div>
            </div>
            <div className="rally-center-hud">
              <small>DAILY CONTRACT</small>
              <time>{hud.suddenDeath ? "SUDDEN DEATH" : formatClock(hud.regulationRemainingMs)}</time>
              <b>RALLY ×{hud.rallyCount}</b>
              <small>KINGDOM INFLUENCE</small>
              <div className="rally-influence" aria-label={`${Math.round(hud.influence)} percent Kingdom Influence`}>
                <i style={{ width: `${hud.influence}%` }} />
              </div>
            </div>
            <div className="rally-fighter rally-fighter--clock">
              <strong>CLOCKHEAD</strong>
              <div className="rally-lives" aria-label={`${hud.clockheadScore} of 5 points`}>
                {SCORE_SLOTS.map(slot => (
                  <i key={slot} className={slot < hud.clockheadScore ? "is-live" : ""} aria-hidden="true">⌛</i>
                ))}
              </div>
              {hud.controlMode === "duel" && (
                <div className="rally-energy rally-energy--clock" aria-label={`${Math.round(hud.clockheadMeter)} percent freeze meter`}>
                  <span style={{ width: `${hud.clockheadMeter}%` }} />
                </div>
              )}
            </div>
          </div>

          <button className="rally-sound" type="button" onPointerDown={event => event.stopPropagation()} onClick={toggleSound}>
            {soundEnabled ? "SOUND ON" : "SOUND OFF"}
          </button>
          {engaged && hud.controlMode === "flight" && (
            <div className="rally-power-bar" aria-label="Power loadout">
              {hud.powerLoadout.map((power, index) => (
                <button
                  key={power}
                  type="button"
                  className={hud.placingPower === power ? "is-placing" : ""}
                  disabled={hud.powerSpent[power]}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={() => {
                    engineRef.current!.beginPower(index);
                    syncHud();
                  }}
                >
                  <kbd>{index + 1}</kbd>
                  <span>{POWER_META[power].name}</span>
                  <i aria-hidden="true">●</i>
                </button>
              ))}
            </div>
          )}
          {engaged && (
            <button
              className="rally-pause"
              type="button"
              aria-label="Pause rally"
              onPointerDown={event => event.stopPropagation()}
              onClick={() => {
                engineRef.current!.pause();
                setEngaged(false);
                syncHud();
              }}
            >
              Ⅱ
            </button>
          )}

          {hud.missionStatus === "ready" && (
            <div className="rally-rescue" role="dialog" aria-modal="false" aria-labelledby="rally-rescue-title">
              <span className="rally-simulated">SIMULATED</span>
              <h2 id="rally-rescue-title">CLOSER FOUND A WAY OUT</h2>
              <p>Accept within 20s to break the freeze and return the Excuse with triple force.</p>
              <div>
                <button
                  ref={rescueButtonRef}
                  type="button"
                  onClick={() => {
                    engineRef.current!.acceptRescue();
                    syncHud();
                    arenaRef.current?.focus();
                  }}
                >
                  ACCEPT MISSION
                </button>
                <strong>{acceptRemaining.toFixed(1)}s</strong>
              </div>
            </div>
          )}

          {clip && (
            <div className="rally-share" role="status">
              {clip.status === "cutting" ? (
                <>
                  <b>CUTTING YOUR CLIP… {Math.round(clip.progress * 100)}%</b>
                  <button type="button" onClick={() => clipAbortRef.current?.abort()}>CANCEL</button>
                </>
              ) : clip.status === "ready" ? (
                <>
                  <b>Clip is created on your device. Nothing is uploaded anywhere; local-only.</b>
                  <button type="button" onClick={() => void shareClip()}>SHARE THE BASH</button>
                </>
              ) : (
                <b>CLIP UNAVAILABLE — PLAY CONTINUES</b>
              )}
            </div>
          )}

          {hud.status === "idle" && (
            <div className="rally-gate rally-intro">
              <span>DAILY CONTRACT · FIRST TO 5</span>
              <h1>EXCUSE RALLY</h1>
              <p>{hud.scoringMode === "buttHybrid" ? "Bank the Excuse off the wall and bash the target behind him." : "Keep the Excuse out of your Gate. Fire it into his."}</p>
              {hud.controlMode === "flight" && (
                <div className="rally-loadout" aria-label="Pick two powers">
                  {Object.entries(POWER_META).map(([id, meta]) => {
                    const power = id as RallyPowerId;
                    const selected = hud.powerLoadout.includes(power);
                    return (
                      <button
                        key={power}
                        type="button"
                        className={selected ? "is-selected" : ""}
                        aria-pressed={selected}
                        onClick={() => {
                          engineRef.current!.selectPower(power);
                          metricsRef.current!.powerSelected(power);
                          syncHud();
                        }}
                      >
                        <b>{meta.name}</b>
                        <span>{meta.note}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {missionId !== null && commercialMission?.status === "phone_ready" ? (
                <a href={`/driver/sales-mission/${missionId}`}>PHONE MISSION UNLOCKED · OPEN FIELD MISSION</a>
              ) : (
                <button
                  type="button"
                  onClick={() => void begin()}
                  disabled={
                    (hud.controlMode === "flight" && hud.powerLoadout.length !== RALLY_CONFIG.powers.slots) ||
                    gameStart.isPending ||
                    (missionId !== null && (!commercialMission || !["game_ready", "game_active"].includes(commercialMission.status)))
                  }
                >
                  {gameStart.isPending ? "OPENING MISSION…" : "ENTER THE RALLY"}
                </button>
              )}
              <small>{hud.controlMode === "duel" ? "A/D OR ARROWS · W JUMP · J STRIKE · K LOFT · L POWER" : "WASD / ARROWS · HOLD F / CLICK · SPACE TO DASH"}</small>
            </div>
          )}

          {hud.status === "paused" && (
            <div className="rally-gate">
              <span>THE CLOCK STOPPED</span>
              <h1>RALLY PAUSED</h1>
              <button type="button" onClick={resume}>RESUME</button>
            </div>
          )}

          {(hud.status === "victory" || hud.status === "defeat") && (
            <div className={`rally-gate rally-result is-${hud.status}`}>
              <span>{hud.status === "victory" ? "REALITY WINS" : "THE EXCUSE GOT THROUGH"}</span>
              <h1>{hud.status === "victory" ? "CLOCKHEAD SHATTERED" : "RALLY AGAIN"}</h1>
              <p>{hud.message}</p>
              {gameReward?.phoneMissionReady ? (
                <>
                  <p>+{gameReward.xpAwarded} XP · {gameReward.streakDays} DAY STREAK · PHONE MISSION UNLOCKED</p>
                  <a href={`/driver/sales-mission/${missionId}`}>OPEN FIELD MISSION</a>
                </>
              ) : hud.status === "victory" && missionId !== null ? (
                <button type="button" disabled>SECURING PHONE MISSION…</button>
              ) : (
                <button type="button" onClick={() => void restart()} disabled={gameAbandon.isPending || (missionId !== null && commercialMission?.status !== "game_ready")}>PLAY AGAIN</button>
              )}
            </div>
          )}

          {hud.controlMode === "flight" ? (
            <>
              <div
                className="rally-joystick"
                aria-hidden="true"
                onPointerDown={joystickMove}
                onPointerMove={joystickMove}
                onPointerUp={endJoystick}
                onPointerCancel={endJoystick}
              >
                <i style={{ transform: `translate(${joystick.x * 34}px, ${joystick.y * 34}px)` }} />
              </div>
              <div className="rally-touch-actions">
                <button
                  type="button"
                  onPointerDown={event => {
                    event.stopPropagation();
                    engineRef.current!.setAim(RALLY_CONFIG.clockhead.spawnX, RALLY_CONFIG.clockhead.spawnY);
                    engineRef.current!.setBreath(true);
                  }}
                  onPointerUp={() => engineRef.current!.setBreath(false)}
                  onPointerCancel={() => engineRef.current!.setBreath(false)}
                >
                  BREATH
                </button>
                <button
                  type="button"
                  onPointerDown={event => {
                    event.stopPropagation();
                    engineRef.current!.dash();
                  }}
                >
                  DASH
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rally-duel-pad rally-duel-pad--move" aria-hidden="true">
                <button
                  type="button"
                  onPointerDown={event => {
                    event.stopPropagation();
                    engineRef.current!.setMovement(-1, 0);
                  }}
                  onPointerUp={() => engineRef.current!.setMovement(0, 0)}
                  onPointerCancel={() => engineRef.current!.setMovement(0, 0)}
                >
                  ◀
                </button>
                <button
                  type="button"
                  onPointerDown={event => {
                    event.stopPropagation();
                    engineRef.current!.setMovement(1, 0);
                  }}
                  onPointerUp={() => engineRef.current!.setMovement(0, 0)}
                  onPointerCancel={() => engineRef.current!.setMovement(0, 0)}
                >
                  ▶
                </button>
              </div>
              <div className="rally-duel-pad rally-duel-pad--actions">
                <button
                  type="button"
                  className={hud.surgeReady ? "is-ready" : ""}
                  onPointerDown={event => {
                    event.stopPropagation();
                    engineRef.current!.duelPower();
                    syncHud();
                  }}
                >
                  POWER
                </button>
                <button
                  type="button"
                  onPointerDown={event => {
                    event.stopPropagation();
                    engineRef.current!.jump();
                  }}
                >
                  JUMP
                </button>
                <button
                  type="button"
                  onPointerDown={event => {
                    event.stopPropagation();
                    engineRef.current!.duelStrike("strike");
                    syncHud();
                  }}
                >
                  STRIKE
                </button>
                <button
                  type="button"
                  onPointerDown={event => {
                    event.stopPropagation();
                    engineRef.current!.duelStrike("loft");
                    syncHud();
                  }}
                >
                  LOFT
                </button>
              </div>
            </>
          )}

          <div className="rally-status" aria-live="polite">{hud.message}</div>
          {new URLSearchParams(window.location.search).get("debug") === "1" && (
            <div className="rally-debug">
              <b>LOCAL METRICS · {hud.scoringMode}</b>
              <pre>{JSON.stringify(metricsRef.current!.exportData().session, null, 2)}</pre>
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob(
                    [JSON.stringify(metricsRef.current!.exportData(), null, 2)],
                    { type: "application/json" }
                  );
                  const url = URL.createObjectURL(blob);
                  const anchor = document.createElement("a");
                  anchor.href = url;
                  anchor.download = "boreslay-rally-metrics.json";
                  anchor.click();
                  setTimeout(() => URL.revokeObjectURL(url), 0);
                }}
              >
                EXPORT JSON
              </button>
            </div>
          )}
        </div>
        <div className="rally-controls" aria-hidden="true">
          <span><b>MOVE</b> WASD / ARROWS</span>
          <span><b>{hud.controlMode === "duel" ? "JUMP" : "BREATH"}</b> {hud.controlMode === "duel" ? "W / SPACE" : "HOLD F / CLICK"}</span>
          <span><b>{hud.controlMode === "duel" ? "STRIKE" : "DASH"}</b> {hud.controlMode === "duel" ? "J / K / L" : "SPACE"}</span>
          <span><b>PAUSE</b> ESC</span>
        </div>
      </section>
    </main>
  );
}

export default RallyDemo;
