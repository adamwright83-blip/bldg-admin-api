import { useEffect, useRef, useState } from "react";
import { Check, Mic, PenLine, RotateCcw, Square, X } from "lucide-react";
import {
  CUSTODY_LOCATIONS,
  type CustodyLocationKey,
} from "@shared/custodyLocations";
import { trpc } from "@/lib/trpc";
import {
  parseCargoTranscript,
  type CargoVoiceFields,
} from "@shared/goldlineCargoVoice";

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

type Mode = "idle" | "listening" | "interpreting" | "manual" | "proposal";
type Proposal = CargoVoiceFields & {
  transcript: string;
  matchState: "unlinked" | "matched" | "ambiguous";
  matchedOrderId: number | null;
  candidates: Array<{
    orderId: number;
    customerDisplayName: string;
    address: string;
    serviceType: "wash_fold" | "dry_cleaning";
    status: string;
  }>;
  confirmationRequired: true;
};

export function VehicleCargoCapture({
  fixture = false,
  onFixtureConfirmed,
  targetLocation = "vehicle",
  manualAddRequest = null,
  onManualAddRequestConsumed,
}: {
  fixture?: boolean;
  onFixtureConfirmed?: (
    proposal: Proposal,
    location: CustodyLocationKey
  ) => void;
  targetLocation?: CustodyLocationKey;
  manualAddRequest?: CustodyLocationKey | null;
  onManualAddRequestConsumed?: () => void;
}) {
  const utils = trpc.useUtils();
  const propose = trpc.system.goldlineCargo.propose.useMutation();
  const confirm = trpc.system.goldlineCargo.confirm.useMutation();
  const [mode, setMode] = useState<Mode>("idle");
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopTracks = () => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };
  useEffect(() => () => stopTracks(), []);
  useEffect(() => {
    if (!manualAddRequest) return;
    setError(null);
    setMode("manual");
    onManualAddRequestConsumed?.();
  }, [manualAddRequest, onManualAddRequestConsumed]);
  useEffect(() => {
    if (mode !== "listening") return;
    const timer = window.setInterval(
      () => setSeconds(value => value + 1),
      1000
    );
    return () => window.clearInterval(timer);
  }, [mode]);

  async function interpret(input: {
    transcript?: string;
    audioDataUrl?: string;
  }) {
    setMode("interpreting");
    setError(null);
    try {
      if (fixture && input.transcript) {
        const fields = parseCargoTranscript(input.transcript);
        setProposal({
          ...fields,
          transcript: input.transcript,
          matchState: "unlinked",
          matchedOrderId: null,
          candidates: [],
          confirmationRequired: true,
        });
        setSelectedOrderId(null);
        setMode("proposal");
        return;
      }
      const next = await propose.mutateAsync(input);
      setProposal(next);
      setTranscript(next.transcript);
      setSelectedOrderId(next.matchedOrderId);
      setMode("proposal");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Goldline could not interpret that cargo."
      );
      setMode("idle");
    }
  }

  async function startRecording() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Voice recording is not supported here. Use Add item instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      setSeconds(0);
      setError(null);
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(chunksRef.current, {
            type: recorder.mimeType || "audio/webm",
          });
          if (!blob.size)
            throw new Error(
              "No speech was captured. Try again or add the item manually."
            );
          await interpret({ audioDataUrl: await blobDataUrl(blob) });
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The recording could not be read."
          );
          setMode("idle");
        } finally {
          stopTracks();
        }
      };
      recorder.start(400);
      setMode("listening");
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission was denied. Use Add item or allow microphone access."
          : "The microphone could not start. Use Add item instead."
      );
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    setMode("interpreting");
  }

  function cancel() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    stopTracks();
    setProposal(null);
    setTranscript("");
    setError(null);
    setMode("idle");
  }

  async function addToVehicle() {
    if (!proposal) return;
    setError(null);
    try {
      if (fixture) {
        onFixtureConfirmed?.(proposal, targetLocation);
        setMode("idle");
        setProposal(null);
        setTranscript("");
        return;
      }
      const processingState =
        targetLocation === "home_closet"
          ? "processed"
          : proposal.processingState;
      await confirm.mutateAsync({
        requestId: crypto.randomUUID(),
        transcript: proposal.transcript,
        fields: {
          customerDisplayName: proposal.customerDisplayName,
          itemDescription: proposal.itemDescription,
          quantity: proposal.quantity,
          serviceType: proposal.serviceType,
          vehicleAction: proposal.vehicleAction,
          vehicleState: "IN_VEHICLE",
          processingState,
          location: targetLocation,
          notes: proposal.notes,
        },
        custodyLocation: targetLocation,
        selectedOrderId,
        confirmed: true,
      });
      await utils.system.goldlineCargo.state.invalidate();
      setMode("idle");
      setProposal(null);
      setTranscript("");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Cargo was not changed."
      );
    }
  }

  if (mode === "listening")
    return (
      <section className="gdp-cargo-capture is-listening" aria-live="polite">
        <div className="gdp-listening-orb">
          <Mic />
          <i />
          <i />
          <i />
        </div>
        <div>
          <strong>LISTENING…</strong>
          <span>0:{String(seconds).padStart(2, "0")}</span>
        </div>
        <button type="button" onClick={stopRecording}>
          <Square /> STOP
        </button>
        <button
          type="button"
          className="gdp-capture-cancel"
          onClick={cancel}
          aria-label="Cancel recording"
        >
          <X />
        </button>
      </section>
    );

  if (mode === "interpreting")
    return (
      <section className="gdp-cargo-capture is-interpreting" aria-live="polite">
        <Mic />
        <div>
          <strong>INTERPRETING…</strong>
          <span>Building a cargo proposal. Nothing has changed yet.</span>
        </div>
      </section>
    );

  if (mode === "manual")
    return (
      <form
        className="gdp-cargo-manual"
        onSubmit={event => {
          event.preventDefault();
          void interpret({ transcript });
        }}
      >
        <label>
          WHAT IS IN {CUSTODY_LOCATIONS[targetLocation].label.toUpperCase()}?
          <textarea
            autoFocus
            value={transcript}
            onChange={event => setTranscript(event.target.value)}
            placeholder={
              targetLocation === "home_closet"
                ? "Arlene’s processed dry cleaning — out of town"
                : "Yazi’s two pairs of pants for dry cleaning"
            }
          />
        </label>
        <div>
          <button type="button" onClick={cancel}>
            CANCEL
          </button>
          <button type="submit" disabled={!transcript.trim()}>
            REVIEW ITEM <Check />
          </button>
        </div>
      </form>
    );

  if (mode === "proposal" && proposal)
    return (
      <section
        className="gdp-cargo-proposal"
        aria-label="Structured proposed cargo action"
      >
        <header>
          <span>PROPOSED ACTION</span>
          <strong>CONFIRM {CUSTODY_LOCATIONS[targetLocation].shortLabel} TRUTH</strong>
        </header>
        <blockquote>“{proposal.transcript}”</blockquote>
        <div className="gdp-proposal-fields">
          <label>
            NAME
            <input
              value={proposal.customerDisplayName}
              onChange={event =>
                setProposal({
                  ...proposal,
                  customerDisplayName: event.target.value,
                })
              }
            />
          </label>
          <label>
            QUANTITY
            <input
              inputMode="numeric"
              value={proposal.quantity ?? ""}
              onChange={event =>
                setProposal({
                  ...proposal,
                  quantity: event.target.value
                    ? Number(event.target.value)
                    : null,
                })
              }
            />
          </label>
          <label className="is-wide">
            ITEM
            <input
              value={proposal.itemDescription}
              onChange={event =>
                setProposal({
                  ...proposal,
                  itemDescription: event.target.value,
                })
              }
            />
          </label>
          <label>
            SERVICE
            <select
              value={proposal.serviceType ?? ""}
              onChange={event =>
                setProposal({
                  ...proposal,
                  serviceType: (event.target.value ||
                    null) as typeof proposal.serviceType,
                })
              }
            >
              <option value="">UNKNOWN</option>
              <option value="dry_cleaning">DRY CLEANING</option>
              <option value="wash_fold">WASH & FOLD</option>
            </select>
          </label>
          <label>
            STATE
            <select
              value={proposal.processingState}
              onChange={event =>
                setProposal({
                  ...proposal,
                  processingState: event.target
                    .value as typeof proposal.processingState,
                })
              }
            >
              <option value="unknown">UNKNOWN</option>
              <option value="unprocessed">UNPROCESSED</option>
              <option value="processed">PROCESSED</option>
            </select>
          </label>
        </div>
        {proposal.matchState === "ambiguous" ? (
          <fieldset>
            <legend>WHICH ORDER?</legend>
            {proposal.candidates.map(candidate => (
              <label key={candidate.orderId}>
                <input
                  type="radio"
                  name="order"
                  checked={selectedOrderId === candidate.orderId}
                  onChange={() => setSelectedOrderId(candidate.orderId)}
                />
                {candidate.customerDisplayName}
                <small>{candidate.address}</small>
              </label>
            ))}
          </fieldset>
        ) : null}
        <p className={`gdp-link-state is-${proposal.matchState}`}>
          {proposal.matchState === "matched"
            ? `LINKED TO ORDER #${proposal.matchedOrderId}`
            : proposal.matchState === "ambiguous"
              ? "CHOOSE AN AUTHORITATIVE ORDER"
              : "UNLINKED FIELD CARGO · CUSTOMER/ORDER NOT LINKED YET"}
        </p>
        {error ? (
          <p role="alert" className="gdp-capture-error">
            {error}
          </p>
        ) : null}
        <footer>
          <button type="button" onClick={cancel}>
            CANCEL
          </button>
          <button type="button" onClick={() => setMode("manual")}>
            <PenLine /> EDIT
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={
              confirm.isPending ||
              (proposal.matchState === "ambiguous" && !selectedOrderId)
            }
            onClick={addToVehicle}
          >
            {proposal.vehicleAction === "remove"
              ? `REMOVE FROM ${CUSTODY_LOCATIONS[targetLocation].shortLabel.toUpperCase()}`
              : `ADD TO ${CUSTODY_LOCATIONS[targetLocation].shortLabel.toUpperCase()}`}
          </button>
        </footer>
      </section>
    );

  return (
    <div className="gdp-cargo-actions">
      <button type="button" className="gdp-voice-add" onClick={startRecording}>
        <span>
          <Mic />
        </span>
        <strong>ADD BY VOICE</strong>
        <small>Speak cargo truth</small>
      </button>
      <button
        type="button"
        className="gdp-manual-add"
        onClick={() => setMode("manual")}
      >
        <PenLine />
        <span>
          <strong>ADD ITEM</strong>
          <small>Type it instead</small>
        </span>
      </button>
      {error ? (
        <p role="alert" className="gdp-capture-error">
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            <RotateCcw />
          </button>
        </p>
      ) : null}
    </div>
  );
}
