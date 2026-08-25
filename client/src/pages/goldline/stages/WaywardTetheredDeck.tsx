import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Shield, Sparkles } from "lucide-react";
import guardianUrl from "@/assets/goldline/heartbeat/ruinbound_shieldbearer.png";
import cacheUrl from "@/assets/goldline/heartbeat/pickup_cache_objective.png";
import { DynamicJoystick } from "../GoldlineOverworld";
import { GoldlineOverworldRuntime } from "../overworld/OverworldRuntime";
import type { DestinationStateMap, OverworldProximity } from "../overworld/types";
import { WAYWARD_APPROACH_STAGE } from "./futureStages";
import { loadWaywardProgress, saveWaywardProgress, type WaywardProgress } from "./waywardProgress";
import { WaywardGuardianEncounter } from "./waywardGuardian";
import "./wayward-tethered-deck.css";

export default function WaywardTetheredDeck({
  playerIdentity,
  fixture = false,
  onReturn,
}: {
  playerIdentity: string | null;
  fixture?: boolean;
  onReturn: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<GoldlineOverworldRuntime | null>(null);
  const guardianRef = useRef(new WaywardGuardianEncounter());
  const guardianClearedRef = useRef(false);
  const lastPlayerRef = useRef({ x: 760, y: 585 });
  const wakeTimerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [guardianCanParry, setGuardianCanParry] = useState(false);
  const [linePhase, setLinePhase] = useState<"dormant" | "waking" | "active">("dormant");
  const [proximity, setProximity] = useState<OverworldProximity>(null);
  const [message, setMessage] = useState("THE WAYWARD HAS BEEN WAITING");
  const [progress, setProgress] = useState<WaywardProgress>(() => {
    const stored = loadWaywardProgress(playerIdentity);
    if (!fixture) return stored;
    const capture = new URLSearchParams(window.location.search).get("waywardCapture");
    const base = { ...stored, unlocked: true, visited: true };
    if (capture === "guardian") return { ...base, guardianCleared: false, spanCrossed: false, tetherAwake: false };
    if (capture === "hook") return { ...base, guardianCleared: true, spanCrossed: false, tetherAwake: false };
    if (capture === "barrier") return { ...base, guardianCleared: true, spanCrossed: true, tetherAwake: false };
    if (capture === "active" || capture === "ambient") return { ...base, guardianCleared: true, spanCrossed: true, tetherAwake: true };
    return { ...base, guardianCleared: false, spanCrossed: false, tetherAwake: false };
  });
  guardianClearedRef.current = progress.guardianCleared;

  const updateProgress = useCallback((patch: Partial<WaywardProgress>) => {
    setProgress(current => {
      const next = { ...current, ...patch };
      saveWaywardProgress(playerIdentity, next);
      return next;
    });
  }, [playerIdentity]);

  const destinationStates = useMemo<DestinationStateMap>(() => ({
    "tether-guardian": progress.guardianCleared ? "completed" : "active",
    "forbidden-hull-cache": progress.cacheCollected ? "completed" : "active",
    "wayward-linehook": progress.guardianCleared ? (progress.spanCrossed ? "completed" : "active") : "locked",
    "mooring-city-barrier": progress.tetherAwake ? "completed" : progress.spanCrossed ? "active" : "locked",
  }), [progress.cacheCollected, progress.guardianCleared, progress.spanCrossed, progress.tetherAwake]);

  useEffect(() => {
    const host = hostRef.current;
    const background = WAYWARD_APPROACH_STAGE.presentation.backgroundAsset;
    if (!host || !background) return;
    let cancelled = false;
    let runtime: GoldlineOverworldRuntime | null = null;
    setReady(false);
    setLoadError(false);
    const capturePoint = fixture
      ? new URLSearchParams(window.location.search).get("waywardCapture")
      : null;
    const captureSpawn = capturePoint === "guardian"
      ? { x: 890, y: 525, surfaceId: "near-deck" }
      : capturePoint === "hook"
        ? { x: 768, y: 475, surfaceId: "near-deck" }
        : capturePoint === "ambient"
          ? { x: 1080, y: 555, surfaceId: "near-deck" }
        : capturePoint === "cache"
          ? { x: 350, y: 550, surfaceId: "left-cache-reach" }
          : capturePoint === "barrier"
            ? { x: 768, y: 275, surfaceId: "upper-tether" }
            : capturePoint === "active"
              ? { x: 768, y: 275, surfaceId: "upper-tether" }
            : null;
    void GoldlineOverworldRuntime.create({
      host,
      backgroundUrl: background,
      checkpoint: captureSpawn ? {
        mapVersion: WAYWARD_APPROACH_STAGE.map.version,
        ...captureSpawn,
        facing: "back",
        savedAt: new Date().toISOString(),
      } : null,
      map: WAYWARD_APPROACH_STAGE.map,
      destinationStates,
      presentation: {
        showDestinationMarkers: false,
        playerHeight: 160,
        cameraZoom: WAYWARD_APPROACH_STAGE.presentation.camera.zoom,
        cameraDamping: WAYWARD_APPROACH_STAGE.presentation.camera.damping,
        cameraLookAheadSeconds: WAYWARD_APPROACH_STAGE.presentation.camera.lookAheadSeconds,
        depth: WAYWARD_APPROACH_STAGE.presentation.depth,
        goldRoute: [
          { x: 760, y: 605 }, { x: 755, y: 510 }, { x: 770, y: 420 },
          { x: 760, y: 330 }, { x: 768, y: 245 },
        ],
        actors: [
          { id: "tether-guardian", imageUrl: guardianUrl, point: { x: 925, y: 505 }, presentationHeight: 150 },
          { id: "forbidden-hull-cache", imageUrl: cacheUrl, point: { x: 315, y: 545 }, presentationHeight: 90 },
          { id: "wayward-linehook", point: { x: 768, y: 442 }, presentationHeight: 54 },
          { id: "broken-span-edge", point: { x: 768, y: 445 }, presentationHeight: 80, visual: "broken-span", zOffset: -50 },
          { id: "rope-inspector", point: { x: 1000, y: 525 }, presentationHeight: 72, visual: "rope-inspector", behavior: "inspect-rope" },
          { id: "fiber-bird", point: { x: 1040, y: 510 }, presentationHeight: 34, visual: "rope-bird", behavior: "steal-fiber" },
          { id: "tether-winch-left", point: { x: 650, y: 520 }, presentationHeight: 58, visual: "tether-winch", behavior: "wake-with-tether" },
          { id: "tether-winch-right", point: { x: 880, y: 518 }, presentationHeight: 58, visual: "tether-winch", behavior: "wake-with-tether" },
          { id: "deck-brace-left", point: { x: 705, y: 350 }, presentationHeight: 66, visual: "deck-brace", behavior: "wake-with-tether" },
          { id: "deck-brace-right", point: { x: 830, y: 346 }, presentationHeight: 66, visual: "deck-brace", behavior: "wake-with-tether" },
          { id: "mooring-sail", point: { x: 820, y: 300 }, presentationHeight: 104, visual: "mooring-sail", behavior: "wake-with-tether", zOffset: -40 },
        ],
      },
      callbacks: {
        onProximityChange: value => setProximity(
          value?.destination.id === "tether-guardian" && guardianClearedRef.current
            ? null
            : value
        ),
        onCheckpoint: () => undefined,
        onFirstMove: () => updateProgress({ visited: true }),
        onTraversalComplete: id => {
          if (id === "linehook-pull") {
            updateProgress({ spanCrossed: true });
            setMessage("THE LINEHOOK BITES · THE BROKEN SPAN FALLS AWAY");
          }
        },
        onFrame: (deltaSeconds, player) => {
          lastPlayerRef.current = player;
          if (guardianClearedRef.current) return;
          const frame = guardianRef.current.update(deltaSeconds, player);
          runtimeRef.current?.setActorPresentation("tether-guardian", frame.point, frame.state);
          setGuardianCanParry(current => current === frame.canParry ? current : frame.canParry);
          if (frame.struckPlayer) {
            runtimeRef.current?.knockbackFrom(frame.point, 52);
            setMessage("BRONZE SLAM · READ THE WIND-UP AND PARRY");
          }
        },
      },
    }).then(created => {
      if (cancelled) return void created.destroy();
      runtime = created;
      runtimeRef.current = created;
      created.setActorPresentation(
        "tether-guardian",
        guardianRef.current.current().point,
        progress.guardianCleared ? "defeated" : "default"
      );
      created.setActorVisible("forbidden-hull-cache", !progress.cacheCollected);
      const initialPhase = progress.tetherAwake ? "active" : "dormant";
      setLinePhase(initialPhase);
      created.setScenePhase(initialPhase);
      setReady(true);
    }).catch(() => {
      if (!cancelled) {
        setLoadError(true);
        setMessage("THE WAYWARD FAILED TO MAKE FAST");
      }
    });
    return () => {
      cancelled = true;
      if (wakeTimerRef.current !== null) window.clearTimeout(wakeTimerRef.current);
      runtimeRef.current = null;
      if (runtime) void runtime.destroy();
    };
    // Actor visibility is updated separately; the runtime is mounted once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerIdentity, retryToken]);

  useEffect(() => runtimeRef.current?.setDestinationStates(destinationStates), [destinationStates]);
  useEffect(() => {
    guardianClearedRef.current = progress.guardianCleared;
    if (progress.guardianCleared) {
      setGuardianCanParry(false);
      runtimeRef.current?.setActorPresentation("tether-guardian", guardianRef.current.current().point, "defeated");
    }
  }, [progress.guardianCleared]);
  useEffect(() => runtimeRef.current?.setActorVisible("forbidden-hull-cache", !progress.cacheCollected), [progress.cacheCollected]);

  useEffect(() => {
    const pressed = new Set<string>();
    const update = () => {
      const x = Number(pressed.has("arrowright") || pressed.has("d")) - Number(pressed.has("arrowleft") || pressed.has("a"));
      const y = Number(pressed.has("arrowdown") || pressed.has("s")) - Number(pressed.has("arrowup") || pressed.has("w"));
      const length = Math.hypot(x, y) || 1;
      runtimeRef.current?.setInput(x / length, y / length);
    };
    const down = (event: KeyboardEvent) => { pressed.add(event.key.toLowerCase()); update(); };
    const up = (event: KeyboardEvent) => { pressed.delete(event.key.toLowerCase()); update(); };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, []);

  function act() {
    const id = proximity?.destination.id;
    if (id === "tether-guardian" && !progress.guardianCleared) {
      if (!proximity?.canAct || !guardianCanParry) {
        setMessage("HOLD · THE BRONZE SHOULDERS HAVE NOT COMMITTED");
        return;
      }
      if (guardianRef.current.parry(lastPlayerRef.current)) {
        updateProgress({ guardianCleared: true });
        runtimeRef.current?.setActorPresentation("tether-guardian", guardianRef.current.current().point, "defeated");
        navigator.vibrate?.([25, 20, 90]);
        setMessage("PARRY · BRONZE BREAKS · THE TETHER RING OPENS");
      }
      return;
    }
    const result = runtimeRef.current?.performContextAction();
    if (result === "inspected" && id === "forbidden-hull-cache" && !progress.cacheCollected) {
      updateProgress({ cacheCollected: true, relic: "tether-memory" });
      setMessage("TETHER MEMORY · FOR ONE BREATH, THE WAYWARD IS SAILING");
    } else if (result === "entered" && id === "mooring-city-barrier") {
      updateProgress({ tetherAwake: true, visited: true });
      setLinePhase("waking");
      runtimeRef.current?.setScenePhase("waking");
      setMessage("WINCHES TURN · DECK BRACES RISE · THE SAIL TAKES WIND");
      wakeTimerRef.current = window.setTimeout(() => {
        setLinePhase("active");
        runtimeRef.current?.setScenePhase("active");
        setMessage("THE SHIP MOVES · THE GOLD LINE HOLDS");
      }, 3200);
    }
  }

  return (
    <main className={`wayward-shell ${progress.tetherAwake ? "is-tether-awake" : ""}`} data-testid="wayward-stage">
      <section className="wayward-stage" aria-label="Wayward Tethered Deck">
        <div ref={hostRef} className="wayward-runtime" />
        <div className="wayward-wind" aria-hidden="true"><i /><i /><i /></div>
        <div className="wayward-vignette" aria-hidden="true" />
        <header className="wayward-objective"><small>THE WAYWARD · GOLD LINE {linePhase.toUpperCase()}</small><strong>{message}</strong></header>
        <button className="wayward-return" onClick={onReturn}>← OVERWORLD</button>
        {progress.relic ? <div className="wayward-relic"><Sparkles /> TETHER MEMORY</div> : null}
        {loadError ? <div className="wayward-load-error" role="alert"><b>THE DECK DID NOT LOAD</b><button onClick={() => setRetryToken(value => value + 1)}>RETRY APPROACH</button></div> : null}
        <DynamicJoystick disabled={!ready} onInput={(x, y) => runtimeRef.current?.setInput(x, y)} />
        {proximity ? (
          <div className={`wayward-context is-${proximity.availability}`}>
            <small>{proximity.destination.id === "mooring-city-barrier" && linePhase === "waking" ? "Winches take strain. Braces lock. Canvas catches wind." : proximity.destination.id === "mooring-city-barrier" && linePhase === "active" ? "The outer tether carries the Wayward's weight." : proximity.destination.subtitle}</small>
            <b>{proximity.destination.name}</b>
            {proximity.canAct ? <button onClick={act} disabled={proximity.availability === "completed" || (proximity.destination.id === "tether-guardian" && !guardianCanParry)}>
              {proximity.destination.id === "tether-guardian" ? <Shield /> : <ChevronRight />}
              {proximity.destination.id === "tether-guardian" ? proximity.availability === "completed" ? "PARRIED" : guardianCanParry ? "PARRY NOW" : "HOLD · WATCH THE SLAM" : proximity.destination.id === "wayward-linehook" ? "LINEHOOK" : proximity.destination.id === "mooring-city-barrier" ? linePhase === "waking" ? "TETHER WAKING" : linePhase === "active" ? "TETHER ACTIVE" : "WAKE THE LINE" : "SEARCH"}
            </button> : <span>MOVE CLOSER</span>}
          </div>
        ) : null}
      </section>
    </main>
  );
}
