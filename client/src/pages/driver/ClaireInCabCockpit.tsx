import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { 
  ArrowRight, 
  Check, 
  CheckCircle2, 
  Compass, 
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
  gateCode: string;
  contactPerson: string;
  contactPhone: string;
  historicalTip: string;
}

const INITIAL_STOPS: CockpitStop[] = [
  {
    id: "stop-1",
    name: "Argyle House",
    address: "1750 N Vine St, Los Angeles, CA",
    distance: "250 ft",
    corridor: "Hollywood High-Rise Corridor",
    units: 250,
    objectiveType: "commercial_drop",
    primaryObjective: "Drop commercial linen trial packet with concierge Hector",
    gateCode: "#4092",
    contactPerson: "Hector (Front Desk)",
    contactPhone: "+1 (323) 555-0182",
    historicalTip: "Concierge accepts packages between 7 AM and 8 PM at lobby desk.",
  },
  {
    id: "stop-2",
    name: "4455 Los Feliz Blvd",
    address: "4455 Los Feliz Blvd, Los Angeles, CA",
    distance: "0.3 mi",
    corridor: "Los Feliz Corridor",
    units: 196,
    objectiveType: "conquest_brief",
    primaryObjective: "Follow up with property manager Elena on corridor route density",
    gateCode: "*1024",
    contactPerson: "Elena Vance (General Manager)",
    contactPhone: "+1 (323) 555-0144",
    historicalTip: "High corridor density asset. Neighbor to won account.",
  },
  {
    id: "stop-3",
    name: "Los Feliz Towers",
    address: "4455 Los Feliz Blvd, Los Angeles, CA",
    distance: "0.5 mi",
    corridor: "Los Feliz Corridor",
    units: 196,
    objectiveType: "pickup",
    primaryObjective: "Collect 2 garment bags for resident Sarah Miller (Unit 802)",
    gateCode: "Call Box #802",
    contactPerson: "Sarah Miller",
    contactPhone: "+1 (323) 555-0199",
    historicalTip: "Elevator B goes directly to 8th floor penthouse.",
  },
  {
    id: "stop-4",
    name: "Lugo's Lavanderia",
    address: "Process Facility, Silver Lake",
    distance: "1.4 mi",
    corridor: "Processing Hub",
    units: 0,
    objectiveType: "commercial_drop",
    primaryObjective: "Transfer commercial bags into express sanitize cycle",
    gateCode: "Bay 3",
    contactPerson: "Marco",
    contactPhone: "+1 (323) 555-0112",
    historicalTip: "Dock open until 6 PM.",
  },
];

export default function ClaireInCabCockpit() {
  const [stops, setStops] = useState<CockpitStop[]>(INITIAL_STOPS);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechTranscript, setSpeechTranscript] = useState(
    "Claire active. Approaching Argyle House in 250 feet. Objective: drop commercial trial with Hector."
  );
  const [completedObjectives, setCompletedObjectives] = useState<string[]>([]);
  const [audioMuted, setAudioMuted] = useState(false);

  const recognitionRef = useRef<any>(null);
  const currentStop = stops[currentStopIndex] || stops[0];

  // Tactical Web Audio chime generator
  const playTacticalChime = (kind: "success" | "radar" | "voice") => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      if (kind === "success") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (kind === "radar") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch {
      // AudioContext policy fallback
    }
  };

  // Claire Voice Speech Synthesizer
  const speakAsClaire = (text: string) => {
    setSpeechTranscript(text);
    if (audioMuted) return;

    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.05;
      utterance.pitch = 1.02;

      // Prefer a natural English female voice
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
            `At ${currentStop.name}. Objective: ${currentStop.primaryObjective}. Concierge contact is ${currentStop.contactPerson}.`
          );
        } else if (text.includes("next stop") || text.includes("skip")) {
          handleNextStop();
        } else {
          speakAsClaire(`Acknowledged: "${text}". Logged on today's Day Line.`);
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
  }, [currentStopIndex, currentStop]);

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

  const handleCompleteObjective = () => {
    playTacticalChime("success");
    const completedName = currentStop.name;
    setCompletedObjectives((prev) => [...prev, currentStop.id]);

    const nextIndex = (currentStopIndex + 1) % stops.length;
    const nextStop = stops[nextIndex];

    speakAsClaire(
      `Custody confirmed at ${completedName}. Objective written to ledger. Next stop: ${nextStop.name}, ${nextStop.distance}.`
    );

    setTimeout(() => {
      setCurrentStopIndex(nextIndex);
    }, 1200);
  };

  const handleNextStop = () => {
    playTacticalChime("radar");
    const nextIndex = (currentStopIndex + 1) % stops.length;
    const nextStop = stops[nextIndex];
    setCurrentStopIndex(nextIndex);
    speakAsClaire(`Switching focus to stop ${nextIndex + 1}: ${nextStop.name}. Distance ${nextStop.distance}.`);
  };

  return (
    <div className="claire-cockpit-page">
      {/* Top Bar */}
      <div className="cockpit-top-bar">
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span className="cockpit-status-tag">
            <span className="cockpit-live-indicator" /> Claire Cockpit HUD · Live
          </span>
          <span style={{ fontSize: "0.85rem", color: "#64748b" }}>
            Corridor Route Velocity: <strong>7.4 stops/hr</strong>
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={() => setAudioMuted(!audioMuted)}
            style={{
              background: "none",
              border: "none",
              color: audioMuted ? "#ef4444" : "#94a3b8",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.8rem",
            }}
          >
            {audioMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            {audioMuted ? "MUTED" : "VOICE ON"}
          </button>
          <Link href="/war-room" className="btn-tactical" style={{ padding: "6px 12px", fontSize: "0.75rem" }}>
            <Compass size={14} /> War Room
          </Link>
          <Link href="/franchise" className="btn-tactical" style={{ padding: "6px 12px", fontSize: "0.75rem" }}>
            Franchise Engine
          </Link>
        </div>
      </div>

      {/* Main Cockpit Layout */}
      <div className="cockpit-main-layout">
        {/* Left Stage: Claire Voice Medallion */}
        <div className="claire-voice-stage">
          <div className="avatar-container">
            <div className={`avatar-ring-pulse ${isSpeaking ? "speaking" : ""}`} />
            <img
              src="/assets/sovereign/claire-cockpit-avatar.jpg"
              alt="Claire In-Cab Voice Operator"
              className={`avatar-img ${isSpeaking ? "speaking" : ""}`}
            />
          </div>

          <div className="claire-voice-transcript">
            <span className="transcript-speaker">
              {isSpeaking ? "CLAIRE (SPEAKING)" : isListening ? "LISTENING FOR DRIVER..." : "CLAIRE (IDLE / ARMED)"}
            </span>
            <span className="transcript-text">{speechTranscript}</span>
          </div>

          <div style={{ width: "100%", textAlign: "center", marginBottom: 12 }}>
            <span style={{ fontSize: "0.7rem", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Hands-Free Vocal Directives
            </span>
          </div>

          <div className="voice-command-hints">
            <span
              className="command-hint-pill"
              onClick={() => speakAsClaire(`At ${currentStop.name}. ${currentStop.primaryObjective}.`)}
            >
              "Claire, brief me"
            </span>
            <span className="command-hint-pill" onClick={handleCompleteObjective}>
              "Dropped sample with Hector"
            </span>
            <span className="command-hint-pill" onClick={handleCompleteObjective}>
              "Picked up Sarah's bags"
            </span>
            <span className="command-hint-pill" onClick={handleNextStop}>
              "Next stop"
            </span>
          </div>
        </div>

        {/* Right Stage: Spatial Proximity & Stop Radar */}
        <div className="spatial-route-stage">
          <div className="current-stop-card">
            <div className="stop-radar-header">
              <div>
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    color: "#f59e0b",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Target Corridor Stop #{currentStopIndex + 1} of {stops.length}
                </span>
                <h1 className="stop-building-title">{currentStop.name}</h1>
                <p className="stop-address">
                  <MapPin size={15} color="#38bdf8" /> {currentStop.address}
                </p>
              </div>

              <span className="stop-distance-badge">{currentStop.distance}</span>
            </div>

            {/* Objective Banner */}
            <div className="objective-banner">
              <span className="objective-label">Authoritative Day Line Objective</span>
              <p className="objective-text">{currentStop.primaryObjective}</p>
            </div>

            {/* Stop Intel Grid */}
            <div className="stop-intel-grid">
              <div className="intel-box">
                <span className="intel-title">Access Gate Code</span>
                <span className="intel-val">{currentStop.gateCode}</span>
              </div>
              <div className="intel-box">
                <span className="intel-title">On-Site Contact</span>
                <span className="intel-val">{currentStop.contactPerson}</span>
              </div>
              <div className="intel-box">
                <span className="intel-title">Asset Scale</span>
                <span className="intel-val">{currentStop.units} Residential Units</span>
              </div>
              <div className="intel-box">
                <span className="intel-title">Learned Corridor Tip</span>
                <span className="intel-val" style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
                  {currentStop.historicalTip}
                </span>
              </div>
            </div>

            {/* Action Bar */}
            <div className="cockpit-actions-row">
              <button className="btn-complete-obj" onClick={handleCompleteObjective}>
                <ShieldCheck size={20} /> Verify & Complete Objective
              </button>

              <button className={`btn-mic-toggle ${isListening ? "active" : ""}`} onClick={toggleMic}>
                {isListening ? <MicOff size={18} /> : <Mic size={18} />}
                {isListening ? "Listening" : "Voice Mic"}
              </button>
            </div>
          </div>

          {/* Upcoming Corridor Stops Queue */}
          <div className="upcoming-queue-card">
            <div className="queue-title">
              <span>Day Line Sequence Queue</span>
              <span>{stops.length - currentStopIndex - 1} stops remaining</span>
            </div>

            <div className="queue-items">
              {stops.map((stop, idx) => {
                const isCurrent = idx === currentStopIndex;
                const isDone = completedObjectives.includes(stop.id);

                return (
                  <div
                    key={stop.id}
                    className="queue-row"
                    style={{
                      opacity: isCurrent ? 1 : isDone ? 0.4 : 0.8,
                      borderLeft: isCurrent ? "3px solid #f59e0b" : "1px solid rgba(255, 255, 255, 0.04)",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      setCurrentStopIndex(idx);
                      playTacticalChime("radar");
                    }}
                  >
                    <div>
                      <div className="queue-row-name">
                        {isDone && <Check size={12} color="#4ade80" style={{ display: "inline", marginRight: 4 }} />}
                        {stop.name}
                      </div>
                      <div className="queue-row-corridor">{stop.primaryObjective}</div>
                    </div>
                    <span className="queue-row-dist">{isDone ? "VERIFIED" : stop.distance}</span>
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
