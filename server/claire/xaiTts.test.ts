import { describe, expect, it, vi } from "vitest";

vi.mock("../_core/env", () => ({
  ENV: {
    adminBaseUrl: "https://api.example.test",
    cookieSecret: "unit-test-secret",
    xaiApiKey: "xai-test-key",
    claireXaiTtsEnabled: true,
    claireXaiTtsVoiceId: "eve",
  },
}));

import {
  CLAIRE_XAI_TTS_PATH,
  claireXaiSpeechUrl,
  isClaireXaiTtsEnabled,
  issueClaireXaiSpeechToken,
  synthesizeClaireXaiSpeech,
  verifyClaireXaiSpeechToken,
} from "./xaiTts";

describe("Claire xAI TTS", () => {
  it("keeps spoken text out of the media URL and round-trips a short-lived encrypted token", () => {
    const nowMs = 1_800_000_000_000;
    const text = "Adam. Claire here. The Louise is next.";
    const token = issueClaireXaiSpeechToken(text, {
      secret: "secret",
      nowMs,
      ttlMs: 60_000,
    });

    expect(token).not.toContain("Claire");
    expect(token).not.toContain("Louise");
    expect(
      verifyClaireXaiSpeechToken(token, {
        secret: "secret",
        nowMs: nowMs + 30_000,
      })
    ).toEqual({
      text,
      exp: nowMs + 60_000,
    });
  });

  it("rejects expired or tampered media tokens", () => {
    const nowMs = 1_800_000_000_000;
    const token = issueClaireXaiSpeechToken("Hello.", {
      secret: "secret",
      nowMs,
      ttlMs: 1_000,
    });

    expect(() =>
      verifyClaireXaiSpeechToken(token, {
        secret: "secret",
        nowMs: nowMs + 2_000,
      })
    ).toThrow("CLAIRE_XAI_TTS_TOKEN_INVALID");

    expect(() =>
      verifyClaireXaiSpeechToken(`${token}x`, {
        secret: "secret",
        nowMs,
      })
    ).toThrow("CLAIRE_XAI_TTS_TOKEN_INVALID");
  });

  it("builds an opaque Twilio media URL on the Claire backend", () => {
    const url = claireXaiSpeechUrl(
      "A private business answer.",
      "https://api.example.test/"
    );
    expect(url).toContain(`https://api.example.test${CLAIRE_XAI_TTS_PATH}?token=`);
    expect(url).not.toContain("private");
    expect(url).not.toContain("business");
  });

  it("requests Eve as 8 kHz mu-law telephony audio without changing Claire's text", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body).toMatchObject({
        text: "Use the verified answer exactly.",
        voice_id: "eve",
        language: "en",
        output_format: {
          codec: "mulaw",
          sample_rate: 8000,
        },
        speed: 0.95,
        optimize_streaming_latency: 1,
        text_normalization: true,
      });
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer xai-test-key"
      );
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "audio/basic" },
      });
    });

    const audio = await synthesizeClaireXaiSpeech(
      "Use the verified answer exactly.",
      { fetchImpl: fetchImpl as typeof fetch }
    );

    expect([...audio]).toEqual([1, 2, 3]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("is enabled only when the feature flag, API key, and token secret are present", () => {
    expect(isClaireXaiTtsEnabled()).toBe(true);
  });
});
