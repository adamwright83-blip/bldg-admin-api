import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Shield, Sparkles } from "lucide-react";
import guardianUrl from "@/assets/goldline/heartbeat/ruinbound_shieldbearer.png";
import cacheUrl from "@/assets/goldline/heartbeat/pickup_cache_objective.png";
import { DynamicJoystick } from "../GoldlineOverworld";
import { GoldlineOverworldRuntime } from "../overworld/OverworldRuntime";
import type { DestinationStateMap, OverworldProximity } from "../overworld/types";
import { WAYWARD_APPROACH_STAGE } from "./futureStages";
import { loadWaywardProgress, saveWaywardProgress, type WaywardProgress } from "./waywardProgress";
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
  const [ready, setReady] = useState(false);
  const [proximity, setProximity] = useState<OverworldProximity>(null);
  const [message, setMessage] = useState("THE WAYWARD HAS BEEN WAITING");
  const [progress, setProgress] = useState<WaywardProgress>(() => {
    const stored = loadWaywardProgress(playerIdentity);
    return fixture ? { ...stored, unlocked: true } : stored;
  });

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
    "wayward-linehook": "active",
    "mooring-city-barrier": progress.tetherAwake ? "completed" : "active",
  }), [progress.cacheCollected, progress.guardianCleared, progress.tetherAwake]);

  useEffect(() => {
    const host = hostRef.current;
    const background = WAYWARD_APPROACH_STAGE.presentation.backgroundAsset;
    if (!host || !background) return;
    let cancelled = false;
    let runtime: GoldlineOverworldRuntime | null = null;
    const capturePoint = fixture
      ? new URLSearchParams(window.location.search).get("waywardCapture")
      : null;
    const captureSpawn = capturePoint === "guardian"
      ? { x: 890, y: 525, surfaceId: "near-deck" }
      : capturePoint === "hook"
        ? { x: 768, y: 415, surfaceId: "tether-bridge" }
        : capturePoint === "cache"
          ? { x: 350, y: 550, surfaceId: "left-cache-reach" }
          : capturePoint === "barrier"
            ? { x: 768, y: 265, surfaceId: "tether-bridge" }
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
        cameraLookAheadSeconds: WAYWARD_APPROACH_STAGE.presentation.camera.lookAheadSeconds,
        depth: WAYWARD_APPROACH_STAGE.presentation.depth,
        goldRoute: [
          { x: 760, y: 605 }, { x: 755, y: 510 }, { x: 770, y: 420 },
          { x: 760, y: 330 }, { x: 768, y: 245 },
        ],
        actors: [
          { id: "tether-guardian", imageUrl: guardianUrl, point: { x: 925, y: 505 }, presentationHeight: 150 },
          { id: "forbidden-hull-cache", imageUrl: cacheUrl, point: { x: 315, y: 545 }, presentationHeight: 90 },
          { id: "wayward-linehook", point: { x: 768, y: 385 }, presentationHeight: 54 },
        ],
      },
      callbacks: {
        onProximityChange: setProximity,
        onCheckpoint: () => undefined,
        onFirstMove: () => updateProgress({ visited: true }),
        onTraversalComplete: id => {
          if (id === "linehook-pull") setMessage("THE LINEHOOK BITES · THE DECK FALLS AWAY");
        },
      },
    }).then(created => {
      if (cancelled) return void created.destroy();
      runtime = created;
      runtimeRef.current = created;
      created.setActorVisible("tether-guardian", !progress.guardianCleared);
      created.setActorVisible("forbidden-hull-cache", !progress.cacheCollected);
      setReady(true);
    });
    return () => { cancelled = true; runtimeRef.current = null; if (runtime) void runtime.destroy(); };
    // Actor visibility is updated separately; the runtime is mounted once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerIdentity]);

  useEffect(() => runtimeRef.current?.setDestinationStates(destinationStates), [destinationStates]);
  useEffect(() => runtimeRef.current?.setActorVisible("tether-guardian", !progress.guardianCleared), [progress.guardianCleared]);
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
    const result = runtimeRef.current?.performContextAction();
    if (result === "inspected" && id === "tether-guardian" && !progress.guardianCleared) {
      updateProgress({ guardianCleared: true });
      setMessage("PARRY · THE TETHER GUARDIAN COMES APART IN ROPE AND BRONZE");
    } else if (result === "inspected" && id === "forbidden-hull-cache" && !progress.cacheCollected) {
      updateProgress({ cacheCollected: true, relic: "tether-memory" });
      setMessage("TETHER MEMORY · FOR ONE BREATH, THE WAYWARD IS SAILING");
    } else if (result === "entered" && id === "mooring-city-barrier") {
      updateProgress({ tetherAwake: true, visited: true });
      setMessage("THE SHIP MOVES · BELLS ANSWER · THE OUTER TETHER HOLDS");
    }
  }

  return (
    <main className={`wayward-shell ${progress.tetherAwake ? "is-tether-awake" : ""}`} data-testid="wayward-stage">
      <section className="wayward-stage" aria-label="Wayward Tethered Deck">
        <div ref={hostRef} className="wayward-runtime" />
        <div className="wayward-wind" aria-hidden="true"><i /><i /><i /></div>
        <div className="wayward-vignette" aria-hidden="true" />
        <header className="wayward-objective"><small>THE WAYWARD · OUTER APPROACH</small><strong>{message}</strong></header>
        <button className="wayward-return" onClick={onReturn}>← OVERWORLD</button>
        {progress.relic ? <div className="wayward-relic"><Sparkles /> TETHER MEMORY</div> : null}
        <div className="wayward-life">A rope inspector measures the same tether again. The bird beside him steals another fiber.</div>
        <DynamicJoystick disabled={!ready} onInput={(x, y) => runtimeRef.current?.setInput(x, y)} />
        {proximity ? (
          <div className={`wayward-context is-${proximity.availability}`}>
            <small>{proximity.destination.subtitle}</small>
            <b>{proximity.destination.name}</b>
            {proximity.canAct ? <button onClick={act} disabled={proximity.availability === "completed"}>
              {proximity.destination.id === "tether-guardian" ? <Shield /> : <ChevronRight />}
              {proximity.destination.id === "tether-guardian" ? "PARRY" : proximity.destination.id === "wayward-linehook" ? "LINEHOOK" : proximity.destination.id === "mooring-city-barrier" ? "WAKE THE LINE" : "SEARCH"}
            </button> : <span>MOVE CLOSER</span>}
          </div>
        ) : null}
      </section>
    </main>
  );
}
