export type BrowserSpeechSession = {
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
