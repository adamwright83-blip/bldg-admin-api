/**
 * Voice transcription helper using internal Speech-to-Text service
 *
 * Frontend implementation guide:
 * 1. Capture audio using MediaRecorder API
 * 2. Upload audio to storage (e.g., S3) to get URL
 * 3. Call transcription with the URL
 * 
 * Example usage:
 * ```tsx
 * // Frontend component
 * const transcribeMutation = trpc.voice.transcribe.useMutation({
 *   onSuccess: (data) => {
 *     console.log(data.text); // Full transcription
 *     console.log(data.language); // Detected language
 *     console.log(data.segments); // Timestamped segments
 *   }
 * });
 * 
 * // After uploading audio to storage
 * transcribeMutation.mutate({
 *   audioUrl: uploadedAudioUrl,
 *   language: 'en', // optional
 *   prompt: 'Transcribe the meeting' // optional
 * });
 * ```
 */
import { ENV } from "./env";

export type TranscribeOptions = {
  audioUrl?: string; // URL to the audio file (e.g., S3 URL)
  /** Audio already in memory (e.g. a recorded OPEN COMMS turn); skips the download. */
  audio?: { data: Buffer; mimeType: string };
  language?: string; // Optional: specify language code (e.g., "en", "es", "zh")
  prompt?: string; // Optional: custom prompt for the transcription
  mimeType?: string; // Optional trusted recorder MIME hint from the upload boundary
  fileName?: string; // Optional filename hint for providers that validate extensions
};

// Native Whisper API segment format
export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

// Native Whisper API response format
export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse; // Return native Whisper API response directly

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
};

/**
 * Transcribe audio to text using the internal Speech-to-Text service
 * 
 * @param options - Audio data and metadata
 * @returns Transcription result or error
 */
export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    // Step 1: Choose the Whisper endpoint: the configured forge proxy, else OpenAI directly.
    const service = transcriptionService();
    if (!service) {
      return {
        error: "Voice transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "Neither a valid BUILT_IN_FORGE_API_URL/KEY nor OPENAI_API_KEY is set",
      };
    }

    // Step 2: Use in-memory audio, or download it from the URL
    let audioBuffer: Buffer;
    let mimeType: string;
    if (options.audio) {
      audioBuffer = options.audio.data;
      mimeType = normalizeMimeType(options.audio.mimeType) || "audio/webm";
      if (audioBuffer.length > 16 * 1024 * 1024) {
        return { error: "Audio file exceeds maximum size limit", code: "FILE_TOO_LARGE" };
      }
    } else try {
      if (!options.audioUrl) throw new Error("No audio provided");
      const response = await fetch(options.audioUrl);
      if (!response.ok) {
        return {
          error: "Failed to download audio file",
          code: "INVALID_FORMAT",
          details: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      
      audioBuffer = Buffer.from(await response.arrayBuffer());
      mimeType = normalizeMimeType(options.mimeType) || normalizeMimeType(response.headers.get('content-type')) || 'audio/mpeg';
      
      // Check file size (16MB limit)
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        return {
          error: "Audio file exceeds maximum size limit",
          code: "FILE_TOO_LARGE",
          details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`
        };
      }
    } catch (error) {
      return {
        error: "Failed to fetch audio file",
        code: "SERVICE_ERROR",
        details: error instanceof Error ? error.message : "Unknown error"
      };
    }

    // Step 3: Create FormData for multipart upload to Whisper API
    const formData = new FormData();
    
    // Create a Blob from the buffer and append to form
    const filename = options.fileName?.trim() || `audio.${getFileExtension(mimeType)}`;
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", audioBlob, filename);
    
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    
    // Add prompt - use custom prompt if provided, otherwise generate based on language
    const prompt = options.prompt || (
      options.language 
        ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`
        : "Transcribe the user's voice to text"
    );
    formData.append("prompt", prompt);

    if (service.kind === "gemini") return transcribeWithGemini(service, audioBuffer, mimeType, prompt);

    // Step 4: Call the transcription service
    const response = await fetch(service.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${service.key}`,
        "Accept-Encoding": "identity",
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`
      };
    }

    // Step 5: Parse and return the transcription result
    const whisperResponse = await response.json() as WhisperResponse;
    
    // Validate response structure
    if (!whisperResponse.text || typeof whisperResponse.text !== 'string') {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format"
      };
    }

    return whisperResponse; // Return native Whisper API response directly

  } catch (error) {
    // Handle unexpected errors
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}

type TranscriptionService = { kind: "whisper" | "gemini"; url: string; key: string };

/** Which provider transcribeAudio will use right now, for honest transcript provenance. */
export function activeTranscriptionProvider(): { provider: "whisper" | "gemini"; providerVersion: string } | null {
  const service = transcriptionService();
  if (!service) return null;
  return service.kind === "gemini"
    ? { provider: "gemini", providerVersion: process.env.CLAIRE_TRANSCRIPTION_GEMINI_MODEL?.trim() || "gemini-flash-latest" }
    : { provider: "whisper", providerVersion: "whisper-1" };
}

/** Forge Whisper proxy when validly configured, else Gemini, else OpenAI Whisper. */
function transcriptionService(): TranscriptionService | null {
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    try {
      const base = new URL(ENV.forgeApiUrl.endsWith("/") ? ENV.forgeApiUrl : `${ENV.forgeApiUrl}/`);
      if (base.protocol === "https:" || base.protocol === "http:")
        return { kind: "whisper", url: new URL("v1/audio/transcriptions", base).toString(), key: ENV.forgeApiKey };
    } catch {
      // Not a URL: fall through to the direct provider.
    }
  }
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    const model = process.env.CLAIRE_TRANSCRIPTION_GEMINI_MODEL?.trim() || "gemini-flash-latest";
    return { kind: "gemini", url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, key: geminiKey };
  }
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  return openAiKey ? { kind: "whisper", url: "https://api.openai.com/v1/audio/transcriptions", key: openAiKey } : null;
}

async function transcribeWithGemini(
  service: TranscriptionService,
  audio: Buffer,
  mimeType: string,
  prompt: string
): Promise<TranscriptionResponse | TranscriptionError> {
  const response = await fetch(service.url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": service.key },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: `${prompt}\nTranscribe the audio verbatim. Return only the words spoken, nothing else. If there is no speech, return an empty string.` },
            { inline_data: { mime_type: mimeType, data: audio.toString("base64") } },
          ],
        },
      ],
      generationConfig: { temperature: 0 },
    }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return { error: "Transcription service request failed", code: "TRANSCRIPTION_FAILED", details: `${response.status}: ${errorText.slice(0, 300)}` };
  }
  const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = (body.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("").trim().replace(/^"|"$/g, "");
  if (!text) return { error: "No speech recognized", code: "TRANSCRIPTION_FAILED" };
  return { task: "transcribe", language: "en", duration: 0, text, segments: [] };
}

/** Normalize signed-download content types and recorder parameter forms. */
function normalizeMimeType(value: string | null | undefined): string | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  return normalized || null;
}

/**
 * Helper function to get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
  };
  
  return mimeToExt[mimeType] || 'audio';
}

/**
 * Helper function to get full language name from ISO code
 */
function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'nl': 'Dutch',
    'pl': 'Polish',
    'tr': 'Turkish',
    'sv': 'Swedish',
    'da': 'Danish',
    'no': 'Norwegian',
    'fi': 'Finnish',
  };
  
  return langMap[langCode] || langCode;
}

/**
 * Example tRPC procedure implementation:
 * 
 * ```ts
 * // In server/routers.ts
 * import { transcribeAudio } from "./_core/voiceTranscription";
 * 
 * export const voiceRouter = router({
 *   transcribe: protectedProcedure
 *     .input(z.object({
 *       audioUrl: z.string(),
 *       language: z.string().optional(),
 *       prompt: z.string().optional(),
 *     }))
 *     .mutation(async ({ input, ctx }) => {
 *       const result = await transcribeAudio(input);
 *       
 *       // Check if it's an error
 *       if ('error' in result) {
 *         throw new TRPCError({
 *           code: 'BAD_REQUEST',
 *           message: result.error,
 *           cause: result,
 *         });
 *       }
 *       
 *       // Optionally save transcription to database
 *       await db.insert(transcriptions).values({
 *         userId: ctx.user.id,
 *         text: result.text,
 *         duration: result.duration,
 *         language: result.language,
 *         audioUrl: input.audioUrl,
 *         createdAt: new Date(),
 *       });
 *       
 *       return result;
 *     }),
 * });
 * ```
 */
