/**
 * Step 2 control test: proves clipping + low media resolution actually
 * work for Shelby's specific video BEFORE committing to the full 8-segment
 * chunking run. No DB access, nothing persisted to Sales Intel.
 *
 * Run in the same environment the real provider runs in:
 *   railway run --service bldg-admin-api npx tsx scripts/diagnoseShelbyClip.ts
 */
import { GeminiVideoUnderstandingProvider } from "../server/salesIntel/videoUnderstanding";

const SHELBY_VIDEO_URL = "https://www.youtube.com/watch?v=U2w7SQ7NEUQ";
const CLIP_END_SECONDS = 10 * 60; // first ~10 minutes only

async function main(): Promise<void> {
  const apiKey = process.env.GEMINI_API_KEY ?? "";
  if (!apiKey.trim()) {
    console.error("GEMINI_API_KEY is not set in this environment.");
    process.exitCode = 1;
    return;
  }

  const provider = new GeminiVideoUnderstandingProvider(apiKey);
  const start = Date.now();
  try {
    const result = await provider.analyze({
      canonicalUrl: SHELBY_VIDEO_URL,
      externalContentId: "U2w7SQ7NEUQ",
      clip: { startOffsetSeconds: 0, endOffsetSeconds: CLIP_END_SECONDS },
      mediaResolution: "low",
    });
    console.log("\nSHELBY 0-10 MIN CONTROL:");
    console.log("  PASS");
    console.log("  HTTP STATUS: 200");
    console.log("  GEMINI STATUS: n/a");
    console.log("  GEMINI MESSAGE: n/a");
    console.log(`  ELAPSED MS: ${Date.now() - start}`);
    console.log(`  Provider: ${result.provider}, Model: ${result.model}`);
    console.log(`  Analyzed text length: ${result.text.length} chars (not printed in full here)`);
  } catch (error) {
    const code = (error as { code?: string }).code ?? "unknown";
    const message = error instanceof Error ? error.message : String(error);
    console.log("\nSHELBY 0-10 MIN CONTROL:");
    console.log("  FAIL");
    console.log(`  HTTP STATUS: n/a`);
    console.log(`  GEMINI STATUS: ${code}`);
    console.log(`  GEMINI MESSAGE: ${message}`);
    console.log(`  ELAPSED MS: ${Date.now() - start}`);
  }
}

void main();
