import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { 
  AlertCircle,
  ArrowRight, 
  Check, 
  CheckCircle2, 
  Compass, 
  Layers,
  MapPin, 
  Mic, 
  MicOff, 
  Navigation, 
  Phone, 
  Radio, 
  ShieldCheck, 
  Sparkles, 
  Volume2, 
  VolumeX 
} from "lucide-react";
import "./claire-cockpit.css";

interface CockpitStop {
  id: string;
  name: string;
  address: string;
  distance: string;
  corridor: string;
  units: number;
  objectiveType: "commercial_drop" | "pickup" | "conquest_brief";
  primaryObjective: string;
  isRealDayLineWork: boolean;
  executionType?: string;
}

// Sandbox practice stops for driver HUD onboarding (clearly marked training)
const TRAINING_STOPS: CockpitStop[] = [
  {
    id: "train-1",
    name: "Argyle House",
    address: "1750 N Vine St, Los Angeles, CA",
    distance: "250 ft",
    corridor: "Hollywood High-Rise Corridor",
    units: 250,
    objectiveType: "commercial_drop",
    primaryObjective: "Deliver commercial linen trial packet to lobby concierge desk",
    isRealDayLineWork: false,
    executionType: "field",
  },
  {
    id: "train-2",
    name: "4455 Los Feliz Blvd",
    address: "4455 Los Feliz Blvd, Los Angeles, CA",
    distance: "0.3 mi",
    corridor: "Los Feliz Corridor",
    units: 196,
    objectiveType: "conquest_brief",
    primaryObjective: "Conduct corridor density check with on-site management",
    isRealDayLineWork: false,
    executionType: "operator",
  },
  {
    id: "train-3",
    name: "Los Feliz Towers",
    address: "4455 Los Feliz Blvd, Los Angeles, CA",
    distance: "0.5 mi",
    corridor: "Los Feliz Corridor",
    units: 196,
    objectiveType: "pickup",
    primaryObjective: "Collect resident laundry bag from designated service drop",
    isRealDayLineWork: false,
    executionType: "field",
  },
];

export default function ClaireInCabCockpit() {
  const urlParams = new URLSearchParams(window.location.search);
  const requestedTenant = urlParams.get("tenant") || undefined;

  // Server-authorized tenant resolution: prevents cosmetic mislabeling
  const tenantResolution = trpc.system.franchise.resolveTenant.useQuery(
    requestedTenant ? { targetTenantId: requestedTenant } : undefined,
    { retry: false }
  );

  const effectiveTenantId = tenantResolution.data?.resolvedTenantId || (requestedTenant === "default" ? "default" : undefined);
  const targetTenantId = effectiveTenantId && effectiveTenantId !== "default" ? effectiveTenantId : undefined;
  const effectiveTenantDisplay = effectiveTenantId || "default";

  // Clean invalid or unauthorized URL parameter if server rejected it
  useEffect(() => {
    if (tenantResolution.isError && requestedTenant) {
      const url = new URL(window.location.href);
      url.searchParams.delete("tenant");
      window.history.replaceState({}, "", url.toString());
    }
  }, [tenantResolution.isError, requestedTenant]);

  // CANONICAL JOYSTICK DAY LINE QUERY (system.currentDayLine backed by Mission Director)
  const currentDayLine = trpc.system.currentDayLine.today.useQuery(
    targetTenantId ? { targetTenantId } : undefined,
    { refetchInterval: 15_000, retry: false }
  );

  const cargoState = trpc.system.goldlineCargo.state.useQuery(undefined, {
    refetchInterval: 15_000,
    retry: false,
  });

  // AUTHORITATIVE PERSISTENT OPERATOR FIELD COMPLETION MUTATION
  const bridgeDriverAction = trpc.system.persistentOperator.bridgeDriverAction.useMutation();

  const [trainingMode, setTrainingMode] = useState(false);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [completedObjectives, setCompletedObjectives] = useState<string[]>([]);
  const [isPersisting, setIsPersisting] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);

  // Derive stops from canonical Day Line items and designated work
  const dayLineItems = currentDayLine.data?.items ?? [];
  const designated = currentDayLine.data?.designated;
  const allDayLineWork = designated ? [designated, ...dayLineItems] : dayLineItems;
  const hasRealDayLineWork = allDayLineWork.length > 0;

  const realStops: CockpitStop[] = allDayLineWork.map((item, idx) => ({
    id: item.id,
    name: item.title,
    address: "Active Corridor Route Stop",
    distance: `${(idx + 1) * 0.4} mi`,
    corridor: "Canonical Day Line",
    units: 0,
    objectiveType: item.executionType === "operator" ? "conquest_brief" : "commercial_drop",
    primaryObjective: item.objective || item.title,
    isRealDayLineWork: true,
    executionType: item.executionType,
  }));

  const activeStops = hasRealDayLineWork && !trainingMode ? realStops : TRAINING_STOPS;
  const currentStop = activeStops[currentStopIndex] || activeStops[0];

  // Synthesize Web Audio chime for acoustic HUD alerts
  const playTacticalChime = (type: "radar" | "success" | "alert") => {
    if (isMuted) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (type === "success") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.45);
      } else {
        osc.type = "sine";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
      }
    } catch {}
  };

  const speakAsClaire = (text: string) => {
    if (isMuted) return;
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.02;

      const voices = window.speechSynthesis.getVoices();
      const selectedVoice =
        voices.find(
          (v) =>
            v.lang.startsWith("en") &&
            (v.name.includes("Samantha") ||
              v.name.includes("Victoria") ||
              v.name.includes("Karen") ||
              v.name.includes("Google US English") ||
              v.name.includes("Natural"))
        ) || voices.find((v) => v.lang.startsWith("en"));

      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    }
  };

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onresult = (event: any) => {
        const lastResultIndex = event.results.length - 1;
        const text = event.results[lastResultIndex][0].transcript.trim().toLowerCase();
        console.log("[InCabSpeech] Driver said:", text);

        if (
          text.includes("dropped") ||
          text.includes("delivered") ||
          text.includes("complete") ||
          text.includes("done") ||
          text.includes("picked up")
        ) {
          handleCompleteObjective();
        } else if (text.includes("brief") || text.includes("repeat") || text.includes("what")) {
          speakAsClaire(
            `At ${currentStop.name}. Directive: ${currentStop.primaryObjective}.`
          );
        } else if (text.includes("next stop") || text.includes("skip")) {
          handleNextStop();
        } else {
          speakAsClaire(`I heard: "${text}". No matching Day Line command found.`);
        }
      };

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onerror = () => setIsListening(false);

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
    };
  }, [currentStopIndex, currentStop, activeStops, trainingMode]);

  const toggleMic = () => {
    if (!recognitionRef.current) {
      alert("Speech recognition is not supported in this browser. You can click action buttons directly.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
        playTacticalChime("radar");
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Authoritative Day Line objective completion via bridgeDriverAction
  const handleCompleteObjective = async () => {
    const stopToComplete = currentStop;
    playTacticalChime("success");

    if (stopToComplete.isRealDayLineWork) {
      setIsPersisting(true);
      try {
        const result = await bridgeDriverAction.mutateAsync({
          targetTenantId,
          objectiveId: stopToComplete.id,
          evidenceReference: `voice_incab_receipt_${Date.now()}`,
          sourceSystem: "driver_cockpit_hud",
          explanation: `Driver confirmed completion via in-cab HUD: ${stopToComplete.name}`,
        });

        if (result.bridged) {
          setCompletedObjectives((prev) => [...prev, stopToComplete.id]);
          setLastReceipt(`Durable receipt confirmed for: ${stopToComplete.name}`);

          const nextIndex = (currentStopIndex + 1) % activeStops.length;
          const nextStop = activeStops[nextIndex];

          speakAsClaire(
            `Objective completed and verified on Day Line for ${stopToComplete.name}. Next objective: ${nextStop.name}.`
          );

          setTimeout(() => {
            setCurrentStopIndex(nextIndex);
          }, 1200);
        } else {
          speakAsClaire(`Day Line action not bridged: ${result.reason}. Task remains pending.`);
        }
      } catch (err) {
        console.error("Failed to bridge driver action:", err);
        speakAsClaire("Mutation error on Day Line bridge. Objective not marked complete.");
      } finally {
        setIsPersisting(false);
      }
    } else {
      // Training Mode Simulator: Honest vocalization of simulation
      setCompletedObjectives((prev) => [...prev, stopToComplete.id]);
      const nextIndex = (currentStopIndex + 1) % activeStops.length;
      const nextStop = activeStops[nextIndex];

      speakAsClaire(
        `Training simulation step completed for ${stopToComplete.name}. Note: Demo mode active, not logged to production ledger.`
      );

      setTimeout(() => {
        setCurrentStopIndex(nextIndex);
      }, 1200);
    }
  };

  const handleNextStop = () => {
    playTacticalChime("radar");
    const nextIndex = (currentStopIndex + 1) % activeStops.length;
    const nextStop = activeStops[nextIndex];
    setCurrentStopIndex(nextIndex);
    speakAsClaire(`Focus switched to stop ${nextIndex + 1}: ${nextStop.name}. Distance ${nextStop.distance}.`);
  };

  return (
    <div className="claire-cockpit-page">
      {/* Top Bar */}
      <div className="cockpit-top-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="cockpit-status-tag">
            <span className="cockpit-live-indicator" /> Claire Cockpit HUD · Tenant: {effectiveTenantDisplay}
          </span>
          {(!hasRealDayLineWork || trainingMode) && (
            <span style={{ fontSize: "0.75rem", background: "rgba(245, 158, 11, 0.2)", color: "#f59e0b", padding: "4px 8px", borderRadius: 4, fontWeight: 700, border: "1px solid rgba(245, 158, 11, 0.4)" }}>
              TRAINING SIMULATOR MODE
            </span>
          )}
          {lastReceipt && (
            <span style={{ fontSize: "0.8rem", color: "#4ade80", fontWeight: 600 }}>
              ✓ {lastReceipt}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {hasRealDayLineWork && (
            <button
              className="btn-tactical"
              style={{ fontSize: "0.75rem", padding: "6px 12px" }}
              onClick={() => setTrainingMode(!trainingMode)}
            >
              {trainingMode ? "Switch to Real Day Line" : "Switch to Training Simulator"}
            </button>
          )}
          <Link href={`/war-room?tenant=${effectiveTenantDisplay}`} className="btn-tactical" style={{ padding: "6px 12px", fontSize: "0.75rem" }}>
            <Compass size={14} /> War Room
          </Link>
          <button
            className="btn-tactical"
            style={{ padding: "6px 12px" }}
            onClick={() => setIsMuted(!isMuted)}
            title={isMuted ? "Unmute Claire" : "Mute Claire"}
          >
            {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
      </div>

      {/* Main Cockpit Layout */}
      <div className="cockpit-main-layout">
        {/* Left Col: Target Focus & Spatial Radar */}
        <div className="cockpit-target-card">
          <div className="cockpit-stop-header">
            <div>
              <span className="cockpit-sequence-pill">
                Stop {currentStopIndex + 1} of {activeStops.length} · {currentStop.isRealDayLineWork ? "Authoritative Mission Director Day Line" : "Training Practice"}
              </span>
              <h1 className="cockpit-stop-title">{currentStop.name}</h1>
              <div className="cockpit-stop-address">
                <MapPin size={16} color="#94a3b8" /> {currentStop.address}
              </div>
            </div>

            <div className="cockpit-radar-distance">
              <span className="dist-num">{currentStop.distance}</span>
              <span className="dist-unit">Proximity Radar</span>
            </div>
          </div>

          {/* Tactical Directive Panel */}
          <div className="cockpit-objective-box">
            <div className="cockpit-objective-label">
              <Sparkles size={16} color="#fbbf24" /> Primary Mission Directive ({currentStop.executionType ?? "field"})
            </div>
            <div className="cockpit-objective-text">
              {currentStop.primaryObjective}
            </div>
          </div>

          {/* Action Zone: Giant Touch Targets for In-Cab Operation */}
          <div className="cockpit-action-row">
            <button
              className="btn-cockpit-primary"
              onClick={handleCompleteObjective}
              disabled={isPersisting}
            >
              <CheckCircle2 size={24} />
              {isPersisting
                ? "Bridging to Day Line..."
                : currentStop.isRealDayLineWork
                  ? "Confirm & Bridge Day Line Action"
                  : "Complete Practice Stop [Simulator]"}
            </button>

            <button className="btn-cockpit-nav" onClick={handleNextStop}>
              <Navigation size={22} />
              <span>Next Stop</span>
            </button>
          </div>
        </div>

        {/* Right Col: Claire Autonomous Copilot & Route Sequence */}
        <div className="cockpit-copilot-rail">
          {/* Claire Audio Visualizer Medallion */}
          <div className="claire-avatar-container">
            <img
              src="/assets/sovereign/claire-cockpit-avatar.jpg"
              alt="Claire In-Cab Voice Copilot"
              className={`claire-avatar-img ${isSpeaking ? "is-speaking" : ""}`}
            />
            <div>
              <span className="claire-title">Claire In-Cab Voice Copilot</span>
              <span className="claire-status-text">
                {isSpeaking
                  ? "Speaking voice directive..."
                  : isListening
                    ? "Listening for driver voice commands..."
                    : "Hands-free voice recognition idle"}
              </span>
            </div>

            <button
              className={`btn-cockpit-mic ${isListening ? "active" : ""}`}
              onClick={toggleMic}
              title={isListening ? "Pause Voice Recognition" : "Activate Hands-Free Voice Control"}
            >
              {isListening ? <Mic size={22} /> : <MicOff size={22} />}
            </button>
          </div>

          {/* Route Sequence Queue */}
          <div className="cockpit-queue-card">
            <div className="cockpit-queue-header">
              <Radio size={16} color="#38bdf8" /> Mission Director Sequence Queue
            </div>

            <div className="cockpit-queue-list">
              {activeStops.map((stop, idx) => {
                const isCurrent = idx === currentStopIndex;
                const isDone = completedObjectives.includes(stop.id);

                return (
                  <div
                    key={stop.id}
                    className={`queue-item ${isCurrent ? "current" : ""} ${isDone ? "done" : ""}`}
                    onClick={() => setCurrentStopIndex(idx)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span className="queue-item-seq">{idx + 1}</span>
                      <div>
                        <div className="queue-item-title">{stop.name}</div>
                        <div className="queue-item-sub">{stop.corridor} · {stop.distance}</div>
                      </div>
                    </div>
                    {isDone ? (
                      <span style={{ color: "#4ade80", fontSize: "0.75rem", fontWeight: 700 }}>
                        ✓ DONE
                      </span>
                    ) : isCurrent ? (
                      <span style={{ color: "#fbbf24", fontSize: "0.75rem", fontWeight: 700 }}>
                        ACTIVE
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
