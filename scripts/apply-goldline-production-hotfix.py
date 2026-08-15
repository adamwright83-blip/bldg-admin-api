from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"expected snippet not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))


Path("client/src/lib/browserSpeechRecognition.ts").write_text('''export type BrowserSpeechSession = {
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Best-effort browser speech transcript for mobile field use. MediaRecorder
 * remains the preserved audio source; this transcript is only operator input
 * evidence and is always shown/editable before any mission becomes active.
 */
export function startBrowserSpeechTranscript(input: {
  initialText?: string;
  onTranscript: (text: string) => void;
}): BrowserSpeechSession | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  const Recognition =
    speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  const base = input.initialText?.trim() ?? "";
  let finals = "";

  recognition.onresult = event => {
    let interim = "";
    for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const phrase = String(result?.[0]?.transcript ?? "").trim();
      if (!phrase) continue;
      if (result.isFinal) finals = `${finals} ${phrase}`.trim();
      else interim = `${interim} ${phrase}`.trim();
    }
    input.onTranscript([base, finals, interim].filter(Boolean).join(" ").trim());
  };
  // Recognition is a resilience path, not the sole recorder. A browser
  // recognition error must never abort or erase the MediaRecorder capture.
  recognition.onerror = () => {};

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    stop: () => {
      try { recognition.stop(); } catch {}
    },
    abort: () => {
      try { recognition.abort(); } catch {}
    },
  };
}
''')

replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    'import { trpc } from "@/lib/trpc";\n',
    'import { trpc } from "@/lib/trpc";\nimport { startBrowserSpeechTranscript, type BrowserSpeechSession } from "@/lib/browserSpeechRecognition";\n',
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    "  gap: OpenChannelGap;\n  isGenerating: boolean;\n",
    "  gap: OpenChannelGap;\n  shouldAutoIgnite: boolean;\n  isGenerating: boolean;\n",
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    "  mission,\n  gap,\n  isGenerating,\n",
    "  mission,\n  gap,\n  shouldAutoIgnite,\n  isGenerating,\n",
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    "  const [autoDismissed, setAutoDismissed] = useState(false);\n  const [worldIsEmpty, setWorldIsEmpty] = useState(false);\n  const recorderRef = useRef<MediaRecorder | null>(null);\n",
    "  const [autoDismissed, setAutoDismissed] = useState(false);\n  const recorderRef = useRef<MediaRecorder | null>(null);\n  const speechRef = useRef<BrowserSpeechSession | null>(null);\n",
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    '''  // Empty-world truth can land after Open Channel mounts, especially while
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
''',
    '''  // Empty-day ignition is driven by the exact same playable state that renders
  // NO ACTIVE OBJECTIVE in GoldlineGameHome. Never infer business/game truth
  // by scraping rendered DOM or test ids.
  useEffect(() => {
    if (open) {
      setAutoOpen(false);
      return;
    }
    setAutoOpen(shouldAutoIgnite);
    if (!shouldAutoIgnite) setAutoDismissed(false);
  }, [open, shouldAutoIgnite]);
''',
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    "      recorderRef.current?.stop();\n      streamRef.current?.getTracks().forEach(track => track.stop());\n      window.speechSynthesis?.cancel();\n",
    "      recorderRef.current?.stop();\n      speechRef.current?.abort();\n      speechRef.current = null;\n      streamRef.current?.getTracks().forEach(track => track.stop());\n      window.speechSynthesis?.cancel();\n",
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    "      streamRef.current = stream;\n      chunksRef.current = [];\n      const preferredMimeType = preferredRecorderMimeType();\n",
    "      streamRef.current = stream;\n      chunksRef.current = [];\n      speechRef.current?.abort();\n      speechRef.current = startBrowserSpeechTranscript({\n        initialText: transcript,\n        onTranscript: setTranscript,\n      });\n      const preferredMimeType = preferredRecorderMimeType();\n",
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    "        stream.getTracks().forEach(track => track.stop());\n        streamRef.current = null;\n        recorderRef.current = null;\n        setRecording(false);\n",
    "        speechRef.current?.stop();\n        speechRef.current = null;\n        stream.getTracks().forEach(track => track.stop());\n        streamRef.current = null;\n        recorderRef.current = null;\n        setRecording(false);\n",
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    '  function stopRecording() {\n    if (recorderRef.current?.state === "recording") recorderRef.current.stop();\n  }\n',
    '  function stopRecording() {\n    speechRef.current?.stop();\n    if (recorderRef.current?.state === "recording") recorderRef.current.stop();\n  }\n',
)
replace(
    "client/src/pages/goldline/OpenChannel.tsx",
    "  if (!effectiveOpen) {\n    if (!worldIsEmpty) return null;\n",
    "  if (!effectiveOpen) {\n    if (!shouldAutoIgnite) return null;\n",
)

replace(
    "client/src/game/GoldlineGameHome.tsx",
    '          mission={props.openChannelMission}\n          gap={openChannelGap}\n          isGenerating={Boolean(props.isGeneratingOpenChannel)}\n',
    '          mission={props.openChannelMission}\n          gap={openChannelGap}\n          shouldAutoIgnite={!action && !activeMission && !nextOrderObjective}\n          isGenerating={Boolean(props.isGeneratingOpenChannel)}\n',
)

replace(
    "client/src/components/driver/SalesMomentum.tsx",
    'import { trpc } from "@/lib/trpc";\n',
    'import { trpc } from "@/lib/trpc";\nimport { startBrowserSpeechTranscript, type BrowserSpeechSession } from "@/lib/browserSpeechRecognition";\n',
)
replace(
    "client/src/components/driver/SalesMomentum.tsx",
    "  const recorderRef = React.useRef<MediaRecorder | null>(null);\n  const streamRef = React.useRef<MediaStream | null>(null);\n",
    "  const recorderRef = React.useRef<MediaRecorder | null>(null);\n  const speechRef = React.useRef<BrowserSpeechSession | null>(null);\n  const streamRef = React.useRef<MediaStream | null>(null);\n",
)
replace(
    "client/src/components/driver/SalesMomentum.tsx",
    "  React.useEffect(() => () => stopTracks(), [stopTracks]);\n",
    "  React.useEffect(() => () => { speechRef.current?.abort(); stopTracks(); }, [stopTracks]);\n",
)
replace(
    "client/src/components/driver/SalesMomentum.tsx",
    "      streamRef.current = stream;\n      recorderRef.current = recorder;\n      chunksRef.current = [];\n",
    "      streamRef.current = stream;\n      recorderRef.current = recorder;\n      chunksRef.current = [];\n      speechRef.current?.abort();\n      speechRef.current = startBrowserSpeechTranscript({ initialText: transcript, onTranscript: setTranscript });\n",
)
replace(
    "client/src/components/driver/SalesMomentum.tsx",
    "        setAudioDataUrl(await blobDataUrl(blob));\n        stopTracks();\n",
    "        setAudioDataUrl(await blobDataUrl(blob));\n        speechRef.current?.stop();\n        speechRef.current = null;\n        stopTracks();\n",
)
replace(
    "client/src/components/driver/SalesMomentum.tsx",
    "  function stopRecording() {\n    recorderRef.current?.stop();\n",
    "  function stopRecording() {\n    speechRef.current?.stop();\n    recorderRef.current?.stop();\n",
)

replace(
    "server/_core/voiceTranscription.ts",
    "  prompt?: string; // Optional: custom prompt for the transcription\n};\n",
    "  prompt?: string; // Optional: custom prompt for the transcription\n  mimeType?: string; // Optional trusted recorder MIME hint from the upload boundary\n  fileName?: string; // Optional filename hint for providers that validate extensions\n};\n",
)
replace(
    "server/_core/voiceTranscription.ts",
    "      mimeType = response.headers.get('content-type') || 'audio/mpeg';\n",
    "      mimeType = normalizeMimeType(options.mimeType) || normalizeMimeType(response.headers.get('content-type')) || 'audio/mpeg';\n",
)
replace(
    "server/_core/voiceTranscription.ts",
    '    const filename = `audio.${getFileExtension(mimeType)}`;\n',
    '    const filename = options.fileName?.trim() || `audio.${getFileExtension(mimeType)}`;\n',
)
replace(
    "server/_core/voiceTranscription.ts",
    "/**\n * Helper function to get file extension from MIME type\n */\nfunction getFileExtension(mimeType: string): string {\n",
    "/** Normalize signed-download content types and recorder parameter forms. */\nfunction normalizeMimeType(value: string | null | undefined): string | null {\n  const normalized = value?.split(\";\", 1)[0]?.trim().toLowerCase();\n  return normalized || null;\n}\n\n/**\n * Helper function to get file extension from MIME type\n */\nfunction getFileExtension(mimeType: string): string {\n",
)

replace(
    "server/openChannel/openChannelService.ts",
    '''          prompt:
            "Transcribe an operator's field briefing. Preserve places, people, amounts, time constraints, errands, and sales tasks accurately.",
        });
''',
    '''          prompt:
            "Transcribe an operator's field briefing. Preserve places, people, amounts, time constraints, errands, and sales tasks accurately.",
          mimeType: audio.mimeType,
          fileName: `briefing.${audioFileExtension(audio.mimeType)}`,
        });
''',
)
replace(
    "server/commercialMissions/driverSalesMotivationService.ts",
    '    const transcription = await transcribeAudio({ audioUrl: downloadable.url, language: "en", prompt: "Transcribe a driver\'s end-of-day sales journal, preserving objections and responses accurately." });\n',
    '    const transcription = await transcribeAudio({ audioUrl: downloadable.url, language: "en", prompt: "Transcribe a driver\'s end-of-day sales journal, preserving objections and responses accurately.", mimeType: audio.mimeType, fileName: `journal.${audioFileExtension(audio.mimeType)}` });\n',
)

replace(
    "e2e/goldline/realDayIgnition.spec.ts",
    '    const briefing = page.getByTestId("empty-day-briefing");\n    await expect(briefing).toBeVisible({ timeout: 10_000 });\n',
    '    const briefing = page.getByTestId("empty-day-briefing");\n    await expect(briefing).toBeVisible({ timeout: 10_000 });\n    await expect(page.getByRole("dialog", { name: "Open Channel mission briefing" })).toHaveAttribute("data-auto-ignition", "true");\n',
)
