/**
 * One-off diagnostic for the Sales Intel Gemini video-understanding 400.
 * Never persists anything to Sales Intel (no DB access at all) and never
 * prints GEMINI_API_KEY or any request header — only Google's own
 * status/message come back, truncated.
 *
 * Run from the SAME environment the real provider runs in — this proves
 * or disproves API-key/project/model/YouTube-input-mode issues in one
 * place, rather than guessing:
 *
 *   railway run --service bldg-admin-api npx tsx scripts/diagnoseGeminiVideoProvider.ts
 *
 * Three sequential control tests:
 *   A. Text-only generateContent  — proves key/model/endpoint/network work at all
 *   B. Google's own documented YouTube-URL example (generateContent)  — proves
 *      whether our generateContent + file_data/file_uri request shape is
 *      currently accepted for YouTube input on this model, independent of
 *      Shelby's specific video
 *   C. Shelby's approved video, through the REAL shipped provider class — run
 *      only once, only after A and B, per the decision tree this script implements
 */
import {
  GeminiVideoUnderstandingProvider,
  resolveGeminiVideoTimeoutMs,
} from "../server/salesIntel/videoUnderstanding";

const MESSAGE_MAX = 300;
const GOOGLE_DOCUMENTED_YOUTUBE_EXAMPLE = "https://www.youtube.com/watch?v=9hE5-98ZeCg";
const SHELBY_VIDEO_URL = "https://www.youtube.com/watch?v=U2w7SQ7NEUQ";

type ControlResult = {
  label: string;
  pass: boolean;
  httpStatus: number | null;
  geminiStatus: string | null;
  geminiMessage: string | null;
};

async function parseErrorBody(response: Response): Promise<{ status: string | null; message: string | null }> {
  const raw = await response.text().catch(() => "");
  if (!raw) return { status: null, message: null };
  try {
    const parsed = JSON.parse(raw) as { error?: { status?: string; message?: string } };
    return {
      status: typeof parsed.error?.status === "string" ? parsed.error.status : null,
      message:
        typeof parsed.error?.message === "string" ? parsed.error.message.slice(0, MESSAGE_MAX) : null,
    };
  } catch {
    return { status: null, message: raw.replace(/\s+/g, " ").trim().slice(0, MESSAGE_MAX) || null };
  }
}

async function rawGenerateContent(
  apiKey: string,
  model: string,
  parts: Array<{ text: string } | { file_data: { file_uri: string } }>
): Promise<ControlResult & { label: string }> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0 },
      }),
    }
  );
  if (response.ok) {
    return { label: "", pass: true, httpStatus: response.status, geminiStatus: null, geminiMessage: null };
  }
  const errorBody = await parseErrorBody(response);
  return {
    label: "",
    pass: false,
    httpStatus: response.status,
    geminiStatus: errorBody.status,
    geminiMessage: errorBody.message,
  };
}

function report(result: ControlResult): void {
  console.log(`\n${result.label}:`);
  console.log(`  ${result.pass ? "PASS" : "FAIL"}`);
  console.log(`  HTTP: ${result.httpStatus ?? "n/a"}`);
  console.log(`  GEMINI STATUS: ${result.geminiStatus ?? "n/a"}`);
  console.log(`  GEMINI MESSAGE: ${result.geminiMessage ?? "n/a"}`);
}

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey.trim()) {
    console.error("GEMINI_API_KEY is not set in this environment. Cannot run any control test.");
    process.exitCode = 1;
    return;
  }
  const model = process.env.GEMINI_VIDEO_MODEL?.trim() || "gemini-2.0-flash";
  console.log(`Model: ${model}`);
  console.log(`Resolved timeout: ${resolveGeminiVideoTimeoutMs()}ms`);

  // A. Text-only control.
  const textResult = await rawGenerateContent(apiKey, model, [
    { text: "Reply with the single word: ok" },
  ]);
  textResult.label = "TEXT CONTROL";
  report(textResult);
  if (!textResult.pass) {
    console.log(
      "\nTEXT CONTROL failed — root cause is API key / model / endpoint / project configuration, not video-specific. Stopping before video tests."
    );
    return;
  }

  // B. Google's own documented YouTube-URL example, via our current generateContent + file_data shape.
  const googleYoutubeResult = await rawGenerateContent(apiKey, model, [
    { text: "Describe this video in one sentence." },
    { file_data: { file_uri: GOOGLE_DOCUMENTED_YOUTUBE_EXAMPLE } },
  ]);
  googleYoutubeResult.label = "GOOGLE YOUTUBE CONTROL";
  report(googleYoutubeResult);
  if (!googleYoutubeResult.pass) {
    console.log(
      "\nGOOGLE YOUTUBE CONTROL failed on Google's OWN documented example video — this is not Shelby-video-specific. " +
        "Current Google docs for this exact input (YouTube URL + gemini-3.6-flash) only show the Interactions API " +
        "(POST /v1beta/interactions), not generateContent + file_data/file_uri. This result is the evidence needed " +
        "before considering that migration — do not migrate without it."
    );
    return;
  }

  // C. Shelby's video — run exactly once, through the real shipped provider class.
  const provider = new GeminiVideoUnderstandingProvider(apiKey);
  try {
    const start = Date.now();
    await provider.analyze({ canonicalUrl: SHELBY_VIDEO_URL, externalContentId: "U2w7SQ7NEUQ" });
    report({
      label: "SHELBY CONTROL",
      pass: true,
      httpStatus: 200,
      geminiStatus: null,
      geminiMessage: `Succeeded in ${Date.now() - start}ms`,
    });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    const message = error instanceof Error ? error.message : String(error);
    report({
      label: "SHELBY CONTROL",
      pass: false,
      httpStatus: null,
      geminiStatus: code,
      geminiMessage: message.slice(0, MESSAGE_MAX),
    });
  }
}

void main();
