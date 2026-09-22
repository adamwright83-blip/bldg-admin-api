import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import twilio from "twilio";
import { CLAIRE_CONVERSATION_RELAY_PATH } from "./conversationRelaySignature";
import {
  conversationRelayValidationUrl,
  twilioSignatureMatchesExactUrl,
  validateConversationRelayUpgrade,
} from "./conversationRelaySignature";
import { ConversationRelaySocketRuntime } from "./conversationRelayRuntime";
import { attachConversationRelayUpgrade, GOLDLINE_RELAY_UPGRADE_REJECTED } from "./conversationRelayUpgrade";
import { claireVoiceSession } from "./claireVoiceSession";
import { renderClaireOpeningVoice } from "./claireVoiceTransport";
import { preDriveConversationTwiML } from "../claireTwilio";

const AUTH = "auth_test";
const PUBLIC_BASE = "https://api.example.test";
const TOKEN = "claire-relay-token-do-not-log";
const PATH = `${CLAIRE_CONVERSATION_RELAY_PATH}?token=${encodeURIComponent(TOKEN)}`;
const WSS = `wss://api.example.test${PATH}`;
const HTTPS = `https://api.example.test${PATH}`;

function signatureFor(url: string): string {
  return twilio.getExpectedTwilioSignature(AUTH, url, {});
}

function expectGoldlineForbidden(result: {
  status: number | null;
  upgraded: boolean;
  body: string;
  headers: IncomingHttpHeaders;
}) {
  expect(result.upgraded).toBe(false);
  expect(result.status).toBe(403);
  expect(result.body).toBe(GOLDLINE_RELAY_UPGRADE_REJECTED);
  expect(result.headers["x-goldline-relay-upgrade"]).toBe(GOLDLINE_RELAY_UPGRADE_REJECTED);
  expect(result.body).not.toContain(TOKEN);
  expect(result.body).not.toContain("signature");
  expect(result.body).not.toContain("identity");
}

function runtime(runTurn = vi.fn(async () => ({ speak: "Noted.", endCall: false, listenOnly: false }))) {
  const sent: unknown[] = [];
  const session = new ConversationRelaySocketRuntime({
    identity: claireVoiceSession({
      tenantId: "tenant-1",
      operatorUserId: "adam-admin",
      conversationId: "conv-relay",
    }),
    token: TOKEN,
    send: message => sent.push(message),
    loadOpening: vi.fn(async () => ({ text: "", queued: false })),
    noteCallSid: vi.fn(async () => undefined),
    runTurn,
    markIntentionalEnd: vi.fn(async () => undefined),
  });
  return { session, sent, runTurn };
}

describe("exact wss signature validation", () => {
  it("accepts a signature for the exact wss URL and rejects that signature against https", () => {
    const signature = signatureFor(WSS);
    expect(
      twilioSignatureMatchesExactUrl({ authToken: AUTH, signature, url: WSS })
    ).toBe(true);
    expect(
      validateConversationRelayUpgrade({
        authToken: AUTH,
        signature,
        requestUrl: PATH,
        publicBaseUrl: PUBLIC_BASE,
        nodeEnv: "production",
      }).ok
    ).toBe(true);
    expect(
      twilioSignatureMatchesExactUrl({ authToken: AUTH, signature, url: HTTPS })
    ).toBe(false);
    expect(
      validateConversationRelayUpgrade({
        authToken: AUTH,
        signature: signatureFor(HTTPS),
        requestUrl: PATH,
        publicBaseUrl: PUBLIC_BASE,
        nodeEnv: "production",
      }).ok
    ).toBe(false);
  });

  it("ignores a spoofed Host and X-Forwarded-Host", () => {
    const trusted = conversationRelayValidationUrl({
      requestUrl: PATH,
      publicBaseUrl: PUBLIC_BASE,
      env: { CLAIRE_TWILIO_RELAY_PUBLIC_BASE_URL: "" },
    });
    expect(trusted).toBe(WSS);
    expect(trusted).not.toContain("evil.example");
    expect(
      validateConversationRelayUpgrade({
        authToken: AUTH,
        signature: signatureFor("wss://evil.example" + PATH),
        requestUrl: PATH,
        publicBaseUrl: PUBLIC_BASE,
        nodeEnv: "production",
        forwardedHost: "evil.example",
        host: "evil.example",
      }).ok
    ).toBe(false);
    expect(
      validateConversationRelayUpgrade({
        authToken: AUTH,
        signature: signatureFor(WSS),
        requestUrl: PATH,
        publicBaseUrl: PUBLIC_BASE,
        nodeEnv: "production",
        forwardedHost: "evil.example",
        host: "evil.example",
      }).ok
    ).toBe(true);
  });

  it("fails closed in production when X-Twilio-Signature is missing", () => {
    expect(
      validateConversationRelayUpgrade({
        authToken: AUTH,
        signature: undefined,
        requestUrl: PATH,
        publicBaseUrl: PUBLIC_BASE,
        nodeEnv: "production",
      }).ok
    ).toBe(false);
    expect(
      validateConversationRelayUpgrade({
        authToken: "",
        signature: undefined,
        requestUrl: PATH,
        publicBaseUrl: PUBLIC_BASE,
        nodeEnv: "production",
      }).ok
    ).toBe(false);
  });

  it("does not put the token-bearing URL in structured logs", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    validateConversationRelayUpgrade({
      authToken: AUTH,
      signature: "forged",
      requestUrl: PATH,
      publicBaseUrl: PUBLIC_BASE,
      nodeEnv: "production",
    });
    const logged = [...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]
      .flat()
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(WSS);
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
  });
});

describe("relay socket runtime", () => {
  it("omits welcomeGreeting and queues the persisted opening once", async () => {
    const xml = renderClaireOpeningVoice({
      text: "Hey Adam. What's up?",
      token: TOKEN,
      publicBaseUrl: PUBLIC_BASE,
      renderGather: preDriveConversationTwiML,
      env: {
        TWILIO_ACCOUNT_SID: "AC_test",
        TWILIO_AUTH_TOKEN: AUTH,
        CLAIRE_TWILIO_FROM_NUMBER: "+13105550000",
        CLAIRE_OPERATOR_PHONE: "+13105550001",
        CLAIRE_TWILIO_CONVERSATION_RELAY: "true",
      } as NodeJS.ProcessEnv,
    });
    expect(xml).not.toContain("welcomeGreeting");
    const loadOpening = vi
      .fn()
      .mockResolvedValueOnce({ text: "Hey Adam. What's up?", queued: true })
      .mockResolvedValueOnce({ text: "Hey Adam. What's up?", queued: false });
    const sent: unknown[] = [];
    const session = new ConversationRelaySocketRuntime({
      identity: claireVoiceSession({
        tenantId: "tenant-1",
        operatorUserId: "adam-admin",
        conversationId: "conv-open",
      }),
      token: TOKEN,
      send: message => sent.push(message),
      loadOpening,
      noteCallSid: async () => undefined,
      runTurn: async () => {
        throw new Error("opening must not call the model");
      },
      markIntentionalEnd: async () => undefined,
    });
    session.accept({ type: "setup", callSid: "CA_open" });
    session.accept({ type: "setup", callSid: "CA_open" });
    await session.idle();
    expect(sent).toEqual([
      { type: "text", token: "Hey Adam. What's up?", last: true, preemptible: false },
    ]);
    expect(loadOpening).toHaveBeenCalledTimes(2);
  });

  it("treats a final Relay prompt as one semantic turn, not a Gather hold", async () => {
    const { session, sent, runTurn } = runtime();
    session.accept({ type: "prompt", voicePrompt: "still talking", last: false });
    session.accept({ type: "prompt", voicePrompt: "What's the address?", last: true });
    await session.idle();
    expect(session.partialPrompts).toBe(1);
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(runTurn.mock.calls[0]?.[0].allowFragmentWait).toBe(false);
    expect(sent).toEqual([
      { type: "text", token: "Noted.", last: true, preemptible: false },
    ]);
  });

  it("serializes two final prompts and lets interrupt bypass the in-flight turn", async () => {
    let releaseFirst: (() => void) | null = null;
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const runTurn = vi.fn(async (input: { utterance: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      order.push(input.utterance);
      if (order.length === 1) {
        await new Promise<void>(resolve => {
          releaseFirst = resolve;
        });
      }
      active -= 1;
      return { speak: input.utterance, endCall: false, listenOnly: false };
    });
    const { session, sent } = runtime(runTurn);
    session.accept({ type: "prompt", voicePrompt: "one", last: true });
    session.accept({ type: "prompt", voicePrompt: "two", last: true });
    await vi.waitFor(() => expect(order).toEqual(["one"]));
    expect(maxActive).toBe(1);
    releaseFirst?.();
    await session.idle();
    expect(order).toEqual(["one", "two"]);
    expect(maxActive).toBe(1);
    expect(sent.map(message => (message as { token?: string }).token)).toEqual(["one", "two"]);

    let releaseSlow: (() => void) | null = null;
    const slow = vi.fn(
      () =>
        new Promise<{ speak: string; endCall: false; listenOnly: false }>(resolve => {
          releaseSlow = () => resolve({ speak: "full answer", endCall: false, listenOnly: false });
        })
    );
    const interrupted = runtime(slow);
    interrupted.session.accept({ type: "prompt", voicePrompt: "hello", last: true });
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    interrupted.session.accept({
      type: "interrupt",
      utteranceUntilInterrupt: "hel",
      durationUntilInterruptMs: 40,
    });
    expect(interrupted.session.speech?.phase).toBe("interrupted");
    expect(interrupted.session.speech?.heardCompletely).toBe(false);
    releaseSlow?.();
    await interrupted.session.idle();
    expect(interrupted.sent.filter(message => (message as { type: string }).type === "text")).toEqual([]);
    interrupted.session.notePlaybackCompleted();
    expect(interrupted.session.speech?.heardCompletely).toBe(false);
    expect(interrupted.session.speech?.phase).toBe("interrupted");
  });

  it("sends intentional end without waiting for a later semantic turn", async () => {
    let release: (() => void) | null = null;
    const runTurn = vi.fn(
      () =>
        new Promise<{ speak: string; endCall: false; listenOnly: false }>(resolve => {
          release = () => resolve({ speak: "still working", endCall: false, listenOnly: false });
        })
    );
    const marked = vi.fn(async () => undefined);
    const sent: unknown[] = [];
    const session = new ConversationRelaySocketRuntime({
      identity: claireVoiceSession({
        tenantId: "tenant-1",
        operatorUserId: "adam-admin",
        conversationId: "conv-end",
      }),
      token: TOKEN,
      send: message => sent.push(message),
      loadOpening: async () => ({ text: "", queued: false }),
      noteCallSid: async () => undefined,
      runTurn,
      markIntentionalEnd: marked,
    });
    session.accept({ type: "prompt", voicePrompt: "keep going", last: true });
    session.accept({ type: "prompt", voicePrompt: "and another", last: true });
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalledTimes(1));
    session.requestIntentionalEnd();
    await vi.waitFor(() => expect(sent).toEqual([
      { type: "end", handoffData: JSON.stringify({ reason: "claire_end_call" }) },
    ]));
    expect(marked).toHaveBeenCalledTimes(1);
    release?.();
    await session.idle();
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(sent.filter(message => (message as { type: string }).type === "text")).toEqual([]);
  });
});

describe("existing HTTP server upgrade", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        server =>
          new Promise<void>(resolve => {
            server.closeAllConnections();
            server.close(() => resolve());
            server.unref();
            setTimeout(resolve, 50).unref();
          })
      )
    );
  });

  function listen(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
    const server = createServer();
    servers.push(server);
    return new Promise(resolve => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("no port");
        resolve({ server, port: address.port });
      });
    });
  }

  function rawUpgrade(
    port: number,
    path: string,
    headers: Record<string, string> = {},
    options: { websocketKey?: boolean } = {}
  ): Promise<{ status: number | null; upgraded: boolean; body: string; headers: IncomingHttpHeaders }> {
    const requestHeaders: Record<string, string> = {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      ...headers,
    };
    if (options.websocketKey !== false && !requestHeaders["Sec-WebSocket-Key"]) {
      requestHeaders["Sec-WebSocket-Key"] = "dGhlIHNhbXBsZSBub25jZQ==";
    }
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        host: "127.0.0.1",
        port,
        path,
        headers: requestHeaders,
      });
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ status: null, upgraded: false, body: "", headers: {} });
      }, 800);
      req.on("upgrade", (res: IncomingMessage, socket: Duplex) => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ status: 101, upgraded: true, body: "", headers: res.headers });
      });
      req.on("response", (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          clearTimeout(timer);
          resolve({
            status: res.statusCode ?? 0,
            upgraded: false,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
          });
        });
      });
      req.on("error", error => {
        clearTimeout(timer);
        reject(error);
      });
      req.end();
    });
  }

  it("accepts the relay upgrade on this server and leaves other upgrade paths alone", async () => {
    const { server, port } = await listen();
    let otherHits = 0;
    server.on("upgrade", (req, socket) => {
      if (!req.url?.startsWith("/other")) return;
      otherHits += 1;
      socket.write("HTTP/1.1 404 Nope\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });
    attachConversationRelayUpgrade(server, {
      publicBaseUrl: PUBLIC_BASE,
      authToken: AUTH,
      nodeEnv: "production",
      authorize: async () => ({
        ok: true,
        token: TOKEN,
        conversationId: "conv-socket",
        tenantId: "tenant-1",
        operatorUserId: "adam-admin",
      }),
      loadOpening: async () => ({ text: "Hey Adam. What's up?", queued: true }),
      runTurn: async () => ({ speak: "nope", endCall: false, listenOnly: false }),
      noteCallSid: async () => undefined,
      markIntentionalEnd: async () => undefined,
    });

    const other = await rawUpgrade(port, "/other");
    expect(other.status).toBe(404);
    expect(other.upgraded).toBe(false);
    expect(otherHits).toBe(1);

    const missing = await rawUpgrade(port, PATH);
    expectGoldlineForbidden(missing);

    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const accepted = await rawUpgrade(port, PATH, {
      "X-Twilio-Signature": signatureFor(WSS),
      Host: "evil.example",
      "X-Forwarded-Host": "evil.example",
    });
    expect(accepted.upgraded).toBe(true);
    const logged = info.mock.calls
      .flat()
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");
    expect(logged).not.toContain(TOKEN);
    info.mockRestore();
  });

  it("queues the persisted opening once on the accepted socket", async () => {
    const { server, port } = await listen();
    let openings = 0;
    attachConversationRelayUpgrade(server, {
      publicBaseUrl: PUBLIC_BASE,
      authToken: AUTH,
      nodeEnv: "production",
      authorize: async () => ({
        ok: true,
        token: TOKEN,
        conversationId: "conv-socket",
        tenantId: "tenant-1",
        operatorUserId: "adam-admin",
      }),
      loadOpening: async () => {
        openings += 1;
        return {
          text: "Hey Adam. What's up?",
          queued: openings === 1,
        };
      },
      runTurn: async () => {
        throw new Error("opening must not call the model");
      },
      noteCallSid: async () => undefined,
      markIntentionalEnd: async () => undefined,
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}${PATH}`, {
      headers: { "X-Twilio-Signature": signatureFor(WSS) },
    } as unknown as string[]);
    const messages: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("opening socket timed out")), 2000);
      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "setup", callSid: "CA_socket", typeName: "setup" }));
        ws.send(JSON.stringify({ type: "setup", callSid: "CA_socket" }));
      });
      ws.addEventListener("message", event => {
        messages.push(String(event.data));
        if (messages.length === 1) {
          setTimeout(() => {
            clearTimeout(timer);
            resolve();
          }, 80);
        }
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("opening socket failed"));
      });
    });
    ws.close();
    expect(messages).toEqual([
      JSON.stringify({
        type: "text",
        token: "Hey Adam. What's up?",
        last: true,
        preemptible: false,
      }),
    ]);
  });

  it("rejects a valid Twilio signature when the persisted Claire identity does not agree", async () => {
    const { server, port } = await listen();
    attachConversationRelayUpgrade(server, {
      publicBaseUrl: PUBLIC_BASE,
      authToken: AUTH,
      nodeEnv: "production",
      authorize: async () => ({ ok: false }),
    });
    const rejected = await rawUpgrade(port, PATH, {
      "X-Twilio-Signature": signatureFor(WSS),
    });
    expectGoldlineForbidden(rejected);
  });

  it("answers a missing websocket key with 400 and without the Goldline 403 marker", async () => {
    const { server, port } = await listen();
    attachConversationRelayUpgrade(server, {
      publicBaseUrl: PUBLIC_BASE,
      authToken: AUTH,
      nodeEnv: "production",
      authorize: async () => ({
        ok: true,
        token: TOKEN,
        conversationId: "conv-socket",
        tenantId: "tenant-1",
        operatorUserId: "adam-admin",
      }),
    });
    const rejected = await rawUpgrade(
      port,
      PATH,
      { "X-Twilio-Signature": signatureFor(WSS) },
      { websocketKey: false }
    );
    expect(rejected.upgraded).toBe(false);
    expect(rejected.status).toBe(400);
    expect(rejected.body).toBe("Bad Request");
    expect(rejected.headers["x-goldline-relay-upgrade"]).toBeUndefined();
  });

  it("is mounted on the existing application server", () => {
    const index = readFileSync(new URL("../../_core/index.ts", import.meta.url), "utf8");
    expect(index).toContain("const server = createServer(app);");
    expect(index).toContain("attachConversationRelayUpgrade(server);");
    expect(index.match(/createServer\(app\)/g)).toHaveLength(1);
    expect(index).not.toContain("CLAIRE_TWILIO_RELAY_PORT");
  });
});
