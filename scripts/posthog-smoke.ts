/**
 * Local proof for the PostHog wiring.
 *
 * Without POSTHOG_PROJECT_TOKEN this script only checks that the server client
 * and log emitter stay inert. It does not claim that production received an event.
 *
 * With POSTHOG_PROJECT_TOKEN it captures one server event and one log, then flushes.
 * With ANTHROPIC_API_KEY as well, it also makes one short Anthropic text call and
 * records that generation. Do not print the token or the prompt.
 */
import { emitServerLog, shutdownServerTelemetry } from "../server/_core/posthogLogs";
import { getServerPosthog } from "../server/_core/posthogServer";

const token = process.env.POSTHOG_PROJECT_TOKEN?.trim() || "";
const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim() || "";

if (!token) {
  const client = getServerPosthog();
  emitServerLog("info", "posthog smoke without token");
  console.log(
    JSON.stringify({
      posthogConfigured: false,
      serverClient: client,
      missing: ["POSTHOG_PROJECT_TOKEN", "VITE_POSTHOG_KEY"],
      anthropicConfigured: Boolean(anthropicKey),
      note: "No event, log, or generation was sent. Set the Railway and Vercel variables, then run this script again.",
    })
  );
  process.exit(0);
}

const client = getServerPosthog();
if (!client) {
  console.error("POSTHOG_PROJECT_TOKEN is set but the server client did not construct.");
  process.exit(1);
}

client.capture({
  distinctId: "posthog-smoke",
  event: "posthog_smoke_server",
  properties: { source: "scripts/posthog-smoke.ts" },
});
emitServerLog("info", "posthog smoke log", { source: "scripts/posthog-smoke.ts" });

if (anthropicKey) {
  const { invokeTextLLM } = await import("../server/_core/llm");
  const text = await invokeTextLLM({
    tenantId: "posthog-smoke",
    maxTokens: 32,
    messages: [{ role: "user", content: "Reply with the single word pong." }],
  });
  console.log(JSON.stringify({ anthropicCalled: true, replyLength: text.length }));
} else {
  console.log(JSON.stringify({ anthropicCalled: false, missing: ["ANTHROPIC_API_KEY"] }));
}

await shutdownServerTelemetry();
console.log(JSON.stringify({ flushed: true, event: "posthog_smoke_server" }));
