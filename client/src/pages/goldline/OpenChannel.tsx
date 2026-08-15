import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  MapPin,
  Mic,
  Plus,
  Radio,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import type {
  OpenChannelEditableTask,
  OpenChannelMission,
  OpenChannelTaskCategory,
} from "../../../../server/openChannel/openChannelTypes";
import type { OpenChannelGap } from "../driver/goldlineDriverModel";
import "./open-channel.css";

export type OpenChannelGenerateInput = {
  transcript?: string;
  audioDataUrl?: string;
  availableMinutes: number | null;
  nextCommitmentAt: string | null;
};

type OpenChannelProps = {
  open: boolean;
  mission: OpenChannelMission | null | undefined;
  gap: OpenChannelGap;
  isGenerating: boolean;
  isApproving: boolean;
  onClose: () => void;
  onGenerate: (input: OpenChannelGenerateInput) => Promise<void>;
  onApprove: (input: {
    missionId: string;
    title: string;
    tasks: OpenChannelEditableTask[];
  }) => Promise<void>;
};

const CATEGORIES: OpenChannelTaskCategory[] = [
  "food",
  "sales",
  "operations",
  "personal",
  "finance",
  "travel",
  "other",
];

const OPERATOR_OPENING =
  "The Line is quiet. Brief me on today and tomorrow: duties, promises, pickups, dropoffs, sales targets, deadlines, constraints, and goals. Say everything that matters. I’ll turn only what you tell me into a draft mission for you to review before anything becomes active.";

type DraftTask = OpenChannelEditableTask & { clientKey: string };

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Could not read recording"));
    reader.readAsDataURL(blob);
  });
}

function preferredRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ].find(mimeType => MediaRecorder.isTypeSupported(mimeType));
}

function speakAsOperator(text: string) {
  if (!("speechSynthesis" in window) || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  utterance.voice =
    voices.find(
      voice =>
        voice.lang.toLowerCase().startsWith("en-gb") &&
        /female|serena|kate|susan|samantha|victoria|fiona/i.test(voice.name)
    ) ??
    voices.find(voice => voice.lang.toLowerCase().startsWith("en-gb")) ??
    null;
  utterance.lang = "en-GB";
  utterance.rate = 0.96;
  utterance.pitch = 1.02;
  window.speechSynthesis.speak(utterance);
}

function emptyTask(): DraftTask {
  return {
    clientKey: crypto.randomUUID(),
    title: "New board step",
    detail: "Describe exactly what done means.",
    estimatedMinutes: 20,
    category: "other",
    navigationQuery: null,
  };
}

export default function OpenChannel({
  open,
  mission,
  gap,
  isGenerating,
  isApproving,
  onClose,
  onGenerate,
  onApprove,
}: OpenChannelProps) {
  const utils = trpc.useUtils();
  const completeTask = trpc.system.openChannel.completeTask.useMutation();
  const [transcript, setTranscript] = useState("");
  const [audioDataUrl, setAudioDataUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [autoOpen, setAutoOpen] = useState(false);
  const [autoDismissed, setAutoDismissed] = useState(false);
  const [worldIsEmpty, setWorldIsEmpty] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const announcedRef = useRef(false);

  // Empty-world truth can land after Open Channel mounts, especially while
  // the Pixi world and authoritative queries settle. The previous one-frame
  // DOM check raced that render and could leave the real Android experience
  // in the exact dead state this feature exists to eliminate. Observe the
  // live world marker instead: whenever Goldline truthfully renders
  // `no-active-objective`, the briefing becomes the next action. This empty-
  // day ignition intentionally does not depend on the time-gap heuristic —
  // an operator with zero loaded work still needs a way to tell Goldline what
  // today/tomorrow actually contain. Nothing becomes authoritative until the
  // existing Open Channel draft is explicitly approved.
  useEffect(() => {
    if (open) {
      setAutoOpen(false);
      return;
    }

    let frame = 0;
    let settled = false;
    const syncWorldTruth = () => {
      if (settled) return;
      const empty = Boolean(
        document.querySelector('[data-testid="no-active-objective"]')
      );
      setWorldIsEmpty(empty);
      setAutoOpen(empty);
      if (!empty) setAutoDismissed(false);
    };

    syncWorldTruth();
    frame = requestAnimationFrame(syncWorldTruth);
    const observer = new MutationObserver(syncWorldTruth);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-testid"],
    });

    return () => {
      settled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [open, mission?.id, mission?.status, mission?.tasks]);

  const effectiveOpen = open || (autoOpen && !autoDismissed);

  function closeChannel() {
    setAutoDismissed(true);
    setAutoOpen(false);
    onClose();
  }

  function reopenChannel() {
    setAutoDismissed(false);
    setAutoOpen(true);
  }

  useEffect(() => {
    if (!effectiveOpen) {
      announcedRef.current = false;
      window.speechSynthesis?.cancel();
      return;
    }
    if (!announcedRef.current) {
      announcedRef.current = true;
      speakAsOperator(mission?.operatorBriefing ?? OPERATOR_OPENING);
    }
  }, [mission?.operatorBriefing, effectiveOpen]);

  useEffect(() => {
    if (!mission) return;
    setTitle(mission.title);
    setTasks(
      mission.tasks.map(task => ({
        clientKey: task.id,
        title: task.title,
        detail: task.detail,
        estimatedMinutes: task.estimatedMinutes,
        category: task.category,
        navigationQuery: task.navigationQuery,
      }))
    );
  }, [mission?.id, mission?.status]);

  useEffect(
    () => () => {
      recorderRef.current?.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      window.speechSynthesis?.cancel();
    },
    []
  );

  async function startRecording() {
    setRecordingError(null);
    setAudioDataUrl(null);
    if (!navigator.mediaDevices?.getUserMedia || !("MediaRecorder" in window)) {
      setRecordingError(
        "Voice recording is unavailable in this browser. Type the briefing below."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const preferredMimeType = preferredRecorderMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type:
            recorder.mimeType ||
            preferredMimeType ||
            chunksRef.current[0]?.type ||
            "audio/webm",
        });
        void blobDataUrl(blob)
          .then(setAudioDataUrl)
          .catch(() =>
            setRecordingError(
              "The recording could not be prepared. Please type the briefing."
            )
          );
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        recorderRef.current = null;
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
    } catch (error) {
      setRecordingError(
        error instanceof Error
          ? `Microphone unavailable: ${error.message}`
          : "Microphone permission was not granted."
      );
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function updateTask(index: number, patch: Partial<OpenChannelEditableTask>) {
    setTasks(current =>
      current.map((task, taskIndex) =>
        taskIndex === index ? { ...task, ...patch } : task
      )
    );
  }

  function moveTask(index: number, direction: -1 | 1) {
    setTasks(current => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  async function completeCurrentTask(missionId: string, taskId: string) {
    setTaskError(null);
    try {
      await completeTask.mutateAsync({
        missionId,
        taskId,
        requestId: crypto.randomUUID(),
      });
      await Promise.all([
        utils.system.openChannel.current.invalidate(),
        utils.system.openChannel.progress.invalidate(),
      ]);
    } catch (error) {
      setTaskError(
        error instanceof Error
          ? error.message
          : "Could not save this objective. Try again."
      );
    }
  }

  const draft = mission?.status === "draft" ? mission : null;
  const active = mission?.status === "active" ? mission : null;
  const firstPendingTask = active?.tasks.find(task => task.status === "pending") ?? null;
  const totalMinutes = tasks.reduce(
    (sum, task) => sum + task.estimatedMinutes,
    0
  );

  if (!effectiveOpen) {
    if (!worldIsEmpty) return null;
    return (
      <button
        type="button"
        data-testid="open-channel-ignition-cta"
        onClick={reopenChannel}
        style={{
          position: "absolute",
          zIndex: 48,
          left: "50%",
          bottom: "118px",
          width: "min(86vw, 430px)",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          minHeight: "68px",
          padding: "12px 18px",
          border: "1px solid rgba(99, 232, 255, .7)",
          borderRadius: "16px",
          background: "rgba(4, 22, 31, .94)",
          color: "white",
          boxShadow: "0 12px 40px rgba(0,0,0,.45)",
          fontSize: "16px",
          fontWeight: 800,
          textAlign: "left",
        }}
      >
        <Radio />
        <span style={{ display: "grid", gap: "3px" }}>
          <b style={{ fontSize: "18px" }}>
            {firstPendingTask ? firstPendingTask.title : "BRIEF THE LINE"}
          </b>
          <small style={{ fontSize: "14px", opacity: 0.8 }}>
            {firstPendingTask
              ? "CURRENT REAL OBJECTIVE · TAP TO CONTINUE"
              : "NO WORK LOADED · TELL GOLDLINE WHAT TODAY ACTUALLY CONTAINS"}
          </small>
        </span>
      </button>
    );
  }

  return (
    <div
      className="open-channel-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Open Channel mission briefing"
      data-auto-ignition={autoOpen && !open ? "true" : "false"}
    >
      <div className="open-channel-scene">
        <div className="open-channel-scene-art" aria-hidden="true" />
        <div className="open-channel-scanlines" aria-hidden="true" />
        <button
          className="open-channel-close"
          type="button"
          onClick={closeChannel}
          aria-label="Close Open Channel"
        >
          <X />
        </button>

        <header className="open-channel-header">
          <span><Radio /></span>
          <div>
            <small>GOLDLINE FIELD COMMS</small>
            <h2>{!mission ? "BRIEF THE LINE" : "OPEN CHANNEL"}</h2>
          </div>
          <em>LIVE</em>
        </header>

        <section className="open-channel-dialogue" aria-live="polite">
          <small>TRAILBLAZER · FIELD OPERATOR</small>
          <p>{mission?.operatorBriefing ?? OPERATOR_OPENING}</p>
          <button
            type="button"
            onClick={() => speakAsOperator(mission?.operatorBriefing ?? OPERATOR_OPENING)}
          >
            <Volume2 /> PLAY OPERATOR VOICE
          </button>
        </section>

        <div className="open-channel-window">
          <span>{gap.label}</span>
          <strong>
            {gap.nextCommitmentAt
              ? `NEXT FIXED COMMITMENT ${new Date(gap.nextCommitmentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : "NO VERIFIED END TIME — YOUR BRIEFING SETS THE BOUNDARY"}
          </strong>
        </div>

        {!mission ? (
          <section className="open-channel-console" data-testid="empty-day-briefing">
            <div className="open-channel-capture">
              <button
                type="button"
                className={recording ? "is-recording" : audioDataUrl ? "is-ready" : ""}
                onClick={recording ? stopRecording : startRecording}
                disabled={isGenerating}
              >
                {recording ? <Square /> : audioDataUrl ? <Check /> : <Mic />}
                <span>
                  <b>
                    {recording
                      ? "STOP BRIEFING"
                      : audioDataUrl
                        ? "VOICE BRIEFING CAPTURED"
                        : "BRIEF ME"}
                  </b>
                  <small>
                    {recording
                      ? "Today, tomorrow, duties, promises, goals, constraints — say it all"
                      : "Tap once and tell Goldline what is actually happening"}
                  </small>
                </span>
              </button>
              {recordingError ? <p className="open-channel-error">{recordingError}</p> : null}
            </div>
            <label className="open-channel-transcript">
              <span>TYPE, CORRECT, OR ADD CONTEXT</span>
              <textarea
                value={transcript}
                onChange={event => setTranscript(event.target.value)}
                rows={6}
                placeholder="Today I have two pickups, a dropoff, I need to visit apartment buildings, call Russell back, and tomorrow I need to follow up with…"
              />
            </label>
            <button
              type="button"
              className="open-channel-primary"
              disabled={recording || isGenerating || (!audioDataUrl && transcript.trim().length < 20)}
              onClick={() => void onGenerate({
                transcript: transcript.trim() || undefined,
                audioDataUrl: audioDataUrl ?? undefined,
                availableMinutes: gap.availableMinutes,
                nextCommitmentAt: gap.nextCommitmentAt,
              })}
            >
              {isGenerating ? (
                <><Loader2 className="spin" /> BUILDING YOUR REAL DAY…</>
              ) : (
                <><Sparkles /> TURN THIS INTO A DRAFT MISSION</>
              )}
            </button>
          </section>
        ) : null}

        {draft ? (
          <section className="open-channel-console is-plan">
            <div className="open-channel-plan-heading">
              <div>
                <small>DRAFT MISSION · NOTHING IS ACTIVE UNTIL YOU APPROVE IT</small>
                <input value={title} onChange={event => setTitle(event.target.value)} aria-label="Mission title" />
              </div>
              <strong>{totalMinutes} MIN</strong>
            </div>
            <div className="open-channel-task-editor">
              {tasks.map((task, index) => (
                <article key={task.clientKey}>
                  <span className="open-channel-step-number">{index + 1}</span>
                  <div>
                    <input
                      value={task.title}
                      onChange={event => updateTask(index, { title: event.target.value })}
                      aria-label={`Step ${index + 1} title`}
                    />
                    <textarea
                      value={task.detail}
                      onChange={event => updateTask(index, { detail: event.target.value })}
                      rows={2}
                      aria-label={`Step ${index + 1} details`}
                    />
                    <div className="open-channel-task-fields">
                      <label>
                        <span>MIN</span>
                        <input
                          type="number"
                          min={5}
                          max={240}
                          value={task.estimatedMinutes}
                          onChange={event => updateTask(index, { estimatedMinutes: Math.max(5, Number(event.target.value) || 5) })}
                        />
                      </label>
                      <label>
                        <span>TYPE</span>
                        <select
                          value={task.category}
                          onChange={event => updateTask(index, { category: event.target.value as OpenChannelTaskCategory })}
                        >
                          {CATEGORIES.map(category => <option key={category}>{category}</option>)}
                        </select>
                      </label>
                      <label className="is-map">
                        <span>MAP SEARCH</span>
                        <input
                          value={task.navigationQuery ?? ""}
                          onChange={event => updateTask(index, { navigationQuery: event.target.value || null })}
                          placeholder="Optional"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="open-channel-task-controls">
                    <button type="button" onClick={() => moveTask(index, -1)} disabled={index === 0} aria-label={`Move step ${index + 1} up`}><ChevronUp /></button>
                    <button type="button" onClick={() => moveTask(index, 1)} disabled={index === tasks.length - 1} aria-label={`Move step ${index + 1} down`}><ChevronDown /></button>
                    <button
                      type="button"
                      onClick={() => setTasks(current => current.filter((_, taskIndex) => taskIndex !== index))}
                      disabled={tasks.length === 1}
                      aria-label={`Remove step ${index + 1}`}
                    ><Trash2 /></button>
                  </div>
                </article>
              ))}
            </div>
            <button type="button" className="open-channel-add" onClick={() => setTasks(current => [...current, emptyTask()])} disabled={tasks.length >= 10}>
              <Plus /> ADD BOARD SPACE
            </button>
            <button
              type="button"
              className="open-channel-primary"
              disabled={isApproving || !title.trim() || tasks.some(task => !task.title.trim() || !task.detail.trim())}
              onClick={() => void onApprove({
                missionId: draft.id,
                title: title.trim(),
                tasks: tasks.map(({ clientKey: _clientKey, ...task }) => task),
              })}
            >
              {isApproving ? (
                <><Loader2 className="spin" /> DEPLOYING MISSION…</>
              ) : (
                <><Check /> CONFIRM THIS IS MY DAY</>
              )}
            </button>
            <p className="open-channel-source">
              Generated from your briefing · {draft.generationSource === "anthropic_structured" ? "AI structured plan" : "reliable fallback plan"}
            </p>
          </section>
        ) : null}

        {active ? (
          <section className="open-channel-console is-active" data-testid="open-channel-active-mission">
            <div className="open-channel-plan-heading">
              <div><small>MISSION ACTIVE</small><h3>{active.title}</h3></div>
              <strong>{active.tasks.filter(task => task.status === "completed").length}/{active.tasks.length}</strong>
            </div>

            {firstPendingTask ? (
              <section className="open-channel-dialogue" data-testid="open-channel-current-objective">
                <small>CURRENT REAL OBJECTIVE · STEP {firstPendingTask.position + 1}</small>
                <p><strong>{firstPendingTask.title}</strong></p>
                <p>{firstPendingTask.detail}</p>
                {firstPendingTask.navigationQuery ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(firstPendingTask.navigationQuery)}`}
                    target="_blank"
                    rel="noreferrer"
                  ><MapPin /> OPEN MAP SEARCH</a>
                ) : null}
                <button
                  type="button"
                  className="open-channel-primary"
                  disabled={completeTask.isPending}
                  onClick={() => void completeCurrentTask(active.id, firstPendingTask.id)}
                >
                  {completeTask.isPending ? (
                    <><Loader2 className="spin" /> SAVING REAL RESULT…</>
                  ) : (
                    <><Check /> I DID THIS — ADVANCE</>
                  )}
                </button>
                {taskError ? <p className="open-channel-error">{taskError}</p> : null}
              </section>
            ) : (
              <section className="open-channel-dialogue" role="status">
                <small>MISSION BOARD CLEAR</small>
                <p>Every approved objective in this briefing is complete.</p>
              </section>
            )}

            <ol className="open-channel-active-tasks">
              {active.tasks.map(task => (
                <li key={task.id} className={task.status === "completed" ? "is-complete" : ""}>
                  <span>{task.status === "completed" ? <Check /> : task.position + 1}</span>
                  <div>
                    <b>{task.title}</b>
                    <small>{task.estimatedMinutes} MIN · {task.category.toUpperCase()}</small>
                  </div>
                  {task.navigationQuery ? (
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(task.navigationQuery)}`}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Find ${task.title} on map`}
                    ><MapPin /></a>
                  ) : null}
                </li>
              ))}
            </ol>
            <button type="button" className="open-channel-add" onClick={closeChannel}>
              RETURN TO WORLD
            </button>
          </section>
        ) : null}
      </div>
    </div>
  );
}
