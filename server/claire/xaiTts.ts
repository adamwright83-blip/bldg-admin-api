import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { Request, Response } from "express";
import { ENV } from "../_core/env";

/**
 * Claire xAI TTS transport.
 *
 * Claire's words still come from the existing Anthropic-backed Claire runtime.
 * This module only turns already-approved spoken text into telephony audio.
 *
 * Twilio fetches <Play> media with a GET, so the text is carried in a
 * short-lived encrypted token rather than a query string or durable file.
 */
export const CLAIRE_XAI_TTS_PATH = "/api/claire/voice/xai";
export const CLAIRE_XAI_TTS_DEFAULT_VOICE = "eve";

const XAI_TTS_URL = "https://api.x.ai/v1/tts";
const TOKEN_VERSION = "v1";
const TOKEN_TTL_MS = 2 * 60 * 1_000;
const MAX_TOKEN_AGE_MS = 10 * 60 * 1_000;
const MAX_SPEECH_CHARS = 6_000;
const XAI_TIMEOUT_MS = 10_000;

type SpeechPayload = {
  text: string;
  exp: number;
};

type FetchLike = typeof fetch;

function encryptionKey(secret: string): Buffer {
  return createHash("sha256")
    .update(`claire-xai-tts:${secret}`, "utf8")
    .digest();
}

function assertSpeechText(text: string): string {
  const value = text.trim();
  if (!value) throw new Error("CLAIRE_XAI_TTS_EMPTY_TEXT");
  if (value.length > MAX_SPEECH_CHARS) {
    throw new Error("CLAIRE_XAI_TTS_TEXT_TOO_LONG");
  }
  return value;
}

export function isClaireXaiTtsEnabled(): boolean {
  return Boolean(
    ENV.claireXaiTtsEnabled &&
      ENV.xaiApiKey &&
      ENV.cookieSecret
  );
}

export function issueClaireXaiSpeechToken(
  text: string,
  options: {
    secret?: string;
    nowMs?: number;
    ttlMs?: number;
  } = {}
): string {
  const secret = options.secret ?? ENV.cookieSecret;
  if (!secret) throw new Error("CLAIRE_XAI_TTS_TOKEN_SECRET_MISSING");

  const nowMs = options.nowMs ?? Date.now();
  const ttlMs = options.ttlMs ?? TOKEN_TTL_MS;
  const payload: SpeechPayload = {
    text: assertSpeechText(text),
    exp: nowMs + ttlMs,
  };

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function verifyClaireXaiSpeechToken(
  token: string,
  options: {
    secret?: string;
    nowMs?: number;
  } = {}
): SpeechPayload {
  const secret = options.secret ?? ENV.cookieSecret;
  if (!secret) throw new Error("CLAIRE_XAI_TTS_TOKEN_SECRET_MISSING");

  const [version, ivText, tagText, encryptedText, ...extra] = token.split(".");
  if (
    version !== TOKEN_VERSION ||
    !ivText ||
    !tagText ||
    !encryptedText ||
    extra.length
  ) {
    throw new Error("CLAIRE_XAI_TTS_TOKEN_INVALID");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(secret),
      Buffer.from(ivText, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(decrypted) as Partial<SpeechPayload>;
    const nowMs = options.nowMs ?? Date.now();

    if (
      typeof parsed.text !== "string" ||
      !parsed.text.trim() ||
      parsed.text.length > MAX_SPEECH_CHARS ||
      typeof parsed.exp !== "number" ||
      !Number.isFinite(parsed.exp) ||
      parsed.exp < nowMs ||
      parsed.exp > nowMs + MAX_TOKEN_AGE_MS
    ) {
      throw new Error("invalid");
    }

    return { text: parsed.text, exp: parsed.exp };
  } catch {
    throw new Error("CLAIRE_XAI_TTS_TOKEN_INVALID");
  }
}

export function claireXaiSpeechUrl(
  text: string,
  baseUrl = ENV.adminBaseUrl
): string {
  const token = issueClaireXaiSpeechToken(text);
  return `${baseUrl.replace(/\/$/, "")}${CLAIRE_XAI_TTS_PATH}?token=${encodeURIComponent(token)}`;
}

export async function synthesizeClaireXaiSpeech(
  text: string,
  options: {
    apiKey?: string;
    voiceId?: string;
    fetchImpl?: FetchLike;
  } = {}
): Promise<Buffer> {
  const apiKey = options.apiKey ?? ENV.xaiApiKey;
  if (!apiKey) throw new Error("CLAIRE_XAI_TTS_API_KEY_MISSING");

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), XAI_TIMEOUT_MS);

  try {
    const response = await fetchImpl(XAI_TTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: assertSpeechText(text),
        voice_id:
          options.voiceId ??
          ENV.claireXaiTtsVoiceId ??
          CLAIRE_XAI_TTS_DEFAULT_VOICE,
        language: "en",
        output_format: {
          codec: "mulaw",
          sample_rate: 8000,
        },
        speed: 0.95,
        optimize_streaming_latency: 1,
        text_normalization: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`CLAIRE_XAI_TTS_UPSTREAM_${response.status}`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) throw new Error("CLAIRE_XAI_TTS_EMPTY_AUDIO");
    return audio;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleClaireXaiTtsRequest(
  req: Request,
  res: Response
): Promise<void> {
  if (!isClaireXaiTtsEnabled()) {
    res.status(404).end();
    return;
  }

  try {
    const token = String(req.query.token ?? "");
    const { text } = verifyClaireXaiSpeechToken(token);
    const audio = await synthesizeClaireXaiSpeech(text);

    // xAI returns G.711 mu-law at 8 kHz; Twilio's <Play> accepts audio/ulaw.
    res.status(200);
    res.setHeader("Content-Type", "audio/ulaw");
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Content-Length", String(audio.length));
    res.end(audio);
  } catch (error) {
    console.warn("[Claire] xAI TTS request failed", {
      reason: error instanceof Error ? error.message : "CLAIRE_XAI_TTS_FAILED",
    });
    res.status(502).end();
  }
}
