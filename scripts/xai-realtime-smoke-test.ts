/**
 * One-shot xAI realtime connectivity + ZDR smoke test.
 *
 * Scope, deliberately narrow: reads XAI_API_KEY from env, opens an
 * authenticated realtime WebSocket, verifies the `x-zero-data-retention`
 * handshake header is exactly true, identifies the requested model, closes
 * the connection, and prints a SANITIZED result.
 *
 * Does NOT: create a Voice Agent, send audio, create a conversation, place
 * a call, or send any Claire/business/customer content. Connect, verify,
 * close -- that's it.
 *
 * Never prints: the API key, the Authorization header, full response
 * headers, any Claire prompt, or any business data.
 *
 * Usage (Railway-injected credential, value never seen by this session):
 *   railway run --service bldg-admin-api -- pnpm tsx scripts/xai-realtime-smoke-test.ts
 */
import "dotenv/config";
import {
  verifyXaiRealtimeConnection,
  XaiRealtimeError,
  XAI_API_KEY_MISSING,
  XAI_ZDR_NOT_VERIFIED,
} from "../server/_core/xaiRealtime";
import { ENV } from "../server/_core/env";

async function main() {
  if (!ENV.xaiApiKey) {
    console.log("xAI realtime authentication: FAIL");
    console.log(`reason: ${XAI_API_KEY_MISSING}`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await verifyXaiRealtimeConnection();
    console.log("xAI realtime authentication: PASS");
    console.log("ZDR verified: PASS");
    console.log(`model requested: ${result.requestedModel}`);
  } catch (err) {
    const code = err instanceof XaiRealtimeError ? err.code : XAI_ZDR_NOT_VERIFIED;
    console.log("xAI realtime authentication: FAIL");
    console.log(`ZDR verified: FAIL`);
    console.log(`reason: ${code}`);
    process.exitCode = 1;
  }
}

main();
