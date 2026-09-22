import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { ENV } from "../../_core/env";
import { CLAIRE_CONVERSATION_RELAY_PATH } from "./conversationRelaySignature";
import {
  ConversationRelayFrameDecoder,
  encodeServerCloseFrame,
  encodeServerTextFrame,
  websocketAcceptValue,
} from "./conversationRelayFrames";
import {
  ConversationRelaySocketRuntime,
  type RelaySemanticTurnInput,
  type RelaySemanticTurnResult,
  type RelayWireMessage,
} from "./conversationRelayRuntime";
import { validateConversationRelayUpgrade } from "./conversationRelaySignature";
import type { ConversationRelayInbound } from "./conversationRelaySession";
import { claireVoiceSession } from "./claireVoiceSession";

export type RelayUpgradeAuthorization =
  | {
      ok: true;
      token: string;
      conversationId: string;
      tenantId: string;
      operatorUserId: string;
    }
  | { ok: false };

export type ConversationRelayUpgradeDeps = {
  authorize?: (token: string) => Promise<RelayUpgradeAuthorization>;
  runTurn?: (input: RelaySemanticTurnInput) => Promise<RelaySemanticTurnResult>;
  loadOpening?: (conversationId: string) => Promise<{ text: string; queued: boolean }>;
  noteCallSid?: (conversationId: string, callSid: string) => Promise<void>;
  markIntentionalEnd?: (conversationId: string) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  publicBaseUrl?: string;
  authToken?: string;
  nodeEnv?: string;
};

function requestPath(url: string | undefined): string {
  const raw = url ?? "/";
  return (raw.split("?")[0] ?? raw) || "/";
}

function queryToken(url: string | undefined): string {
  const raw = url ?? "/";
  const query = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  return new URLSearchParams(query.startsWith("?") ? query.slice(1) : query).get("token")?.trim() ?? "";
}

function logRelay(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.info("[Claire] conversation relay", { event, ...fields });
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const body = reason;
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Forbidden"}\r\n` +
      "Content-Type: text/plain\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "Connection: close\r\n\r\n" +
      body
  );
  socket.destroy();
}

async function defaultAuthorize(token: string): Promise<RelayUpgradeAuthorization> {
  const { authorizePersistedClaireRelayCall } = await import("../claireTwilio");
  return authorizePersistedClaireRelayCall(token);
}

async function defaultRunTurn(input: RelaySemanticTurnInput): Promise<RelaySemanticTurnResult> {
  const { runRelayAuthoritativeTurn } = await import("../claireTwilio");
  const result = await runRelayAuthoritativeTurn(input);
  return { speak: result.speak, endCall: result.endCall, listenOnly: result.listenOnly };
}

async function defaultLoadOpening(conversationId: string): Promise<{ text: string; queued: boolean }> {
  const { queueRelayOpeningOnce } = await import("../claireTwilio");
  return queueRelayOpeningOnce(conversationId);
}

async function defaultNoteCallSid(conversationId: string, callSid: string): Promise<void> {
  const { noteRelayCallSid } = await import("../claireTwilio");
  await noteRelayCallSid(conversationId, callSid);
}

async function defaultMarkIntentionalEnd(conversationId: string): Promise<void> {
  const { markRelayIntentionalEnd } = await import("../claireTwilio");
  await markRelayIntentionalEnd(conversationId);
}

function parseInbound(payload: string): ConversationRelayInbound | { type: "close" } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { type: "error", description: "invalid json" };
  }
  if (!parsed || typeof parsed !== "object") return null;
  const message = parsed as Record<string, unknown>;
  const type = message.type;
  if (type === "setup") {
    return { type: "setup", callSid: typeof message.callSid === "string" ? message.callSid : null };
  }
  if (type === "prompt") {
    return {
      type: "prompt",
      voicePrompt: typeof message.voicePrompt === "string" ? message.voicePrompt : "",
      last: typeof message.last === "boolean" ? message.last : undefined,
    };
  }
  if (type === "interrupt") {
    return {
      type: "interrupt",
      utteranceUntilInterrupt:
        typeof message.utteranceUntilInterrupt === "string" ? message.utteranceUntilInterrupt : null,
      durationUntilInterruptMs:
        typeof message.durationUntilInterruptMs === "number" ? message.durationUntilInterruptMs : undefined,
    };
  }
  if (type === "dtmf") {
    return { type: "dtmf", digit: typeof message.digit === "string" ? message.digit : "" };
  }
  if (type === "error") {
    return {
      type: "error",
      description: typeof message.description === "string" ? message.description : "",
    };
  }
  return null;
}

/**
 * Attaches the Conversation Relay handshake to the process's existing HTTP
 * server. Unrelated upgrade paths are left untouched. There is no second port.
 */
export function attachConversationRelayUpgrade(server: Server, deps: ConversationRelayUpgradeDeps = {}): void {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (requestPath(req.url) !== CLAIRE_CONVERSATION_RELAY_PATH) return;
    void acceptConversationRelayUpgrade(req, socket, head, deps).catch(error => {
      const message = error instanceof Error ? error.message : "upgrade_failed";
      logRelay("upgrade_failed", {
        reason: message.includes("?") || message.includes("wss://") ? "upgrade_failed" : message.slice(0, 120),
        path: CLAIRE_CONVERSATION_RELAY_PATH,
      });
      if (!socket.destroyed) rejectUpgrade(socket, 403, "Forbidden");
    });
  });
}

async function acceptConversationRelayUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  deps: ConversationRelayUpgradeDeps
): Promise<void> {
  const env = deps.env ?? process.env;
  const nodeEnv = deps.nodeEnv ?? env.NODE_ENV ?? "development";
  const authToken = deps.authToken ?? env.TWILIO_AUTH_TOKEN?.trim() ?? "";
  const publicBaseUrl = (deps.publicBaseUrl ?? ENV.adminBaseUrl).replace(/\/$/, "");
  const signature = req.headers["x-twilio-signature"];
  const validation = validateConversationRelayUpgrade({
    authToken,
    signature,
    requestUrl: req.url ?? "/",
    publicBaseUrl,
    nodeEnv,
    env,
    forwardedHost: req.headers["x-forwarded-host"],
    host: req.headers.host,
  });
  if (!validation.ok) {
    logRelay("upgrade_rejected", { reason: "signature", path: CLAIRE_CONVERSATION_RELAY_PATH });
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  const token = queryToken(req.url);
  const authorize = deps.authorize ?? defaultAuthorize;
  const authorized = await authorize(token);
  if (!authorized.ok) {
    logRelay("upgrade_rejected", { reason: "identity", path: CLAIRE_CONVERSATION_RELAY_PATH });
    rejectUpgrade(socket, 403, "Forbidden");
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (typeof key !== "string" || !key.trim()) {
    logRelay("upgrade_rejected", { reason: "websocket_key", path: CLAIRE_CONVERSATION_RELAY_PATH });
    rejectUpgrade(socket, 400, "Bad Request");
    return;
  }

  const accept = websocketAcceptValue(key.trim());
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const send = (message: RelayWireMessage) => {
    if (socket.destroyed) return;
    socket.write(encodeServerTextFrame(JSON.stringify(message)));
  };
  const runtime = new ConversationRelaySocketRuntime({
    identity: claireVoiceSession({
      tenantId: authorized.tenantId,
      operatorUserId: authorized.operatorUserId,
      conversationId: authorized.conversationId,
    }),
    token: authorized.token,
    send,
    loadOpening: () => (deps.loadOpening ?? defaultLoadOpening)(authorized.conversationId),
    noteCallSid: callSid => (deps.noteCallSid ?? defaultNoteCallSid)(authorized.conversationId, callSid),
    runTurn: input => (deps.runTurn ?? defaultRunTurn)(input),
    markIntentionalEnd: () => (deps.markIntentionalEnd ?? defaultMarkIntentionalEnd)(authorized.conversationId),
  });

  const decoder = new ConversationRelayFrameDecoder();
  const take = (chunk: Buffer) => {
    for (const frame of decoder.push(chunk)) {
      if (frame.opcode === 0x8) {
        runtime.accept({ type: "close" });
        socket.end(encodeServerCloseFrame());
        return;
      }
      if (frame.opcode === 0x9) {
        const pong = Buffer.from([0x8a, frame.payload.length]);
        socket.write(Buffer.concat([pong, frame.payload]));
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      const inbound = parseInbound(frame.payload.toString("utf8"));
      if (!inbound || inbound.type === "close") {
        runtime.accept({ type: "error", description: "unsupported message" });
        continue;
      }
      runtime.accept(inbound);
    }
  };
  if (head.length) take(head);
  socket.on("data", take);
  socket.on("close", () => runtime.accept({ type: "close" }));
  socket.on("error", () => runtime.accept({ type: "error", description: "socket error" }));
  logRelay("upgrade_accepted", {
    path: CLAIRE_CONVERSATION_RELAY_PATH,
    conversationId: authorized.conversationId,
  });
}
