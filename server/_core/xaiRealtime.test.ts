import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the "ws" module with a controllable fake socket so tests never touch
// the real network. Each test drives the fake socket's handshake outcome by
// emitting the same events the real `ws` library emits.
class FakeWebSocket extends EventEmitter {
  public terminated = false;
  public closed = false;
  public lastUrl: string;
  public lastOptions: unknown;

  constructor(url: string, options: unknown) {
    super();
    this.lastUrl = url;
    this.lastOptions = options;
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  terminate() {
    this.terminated = true;
  }

  static instances: FakeWebSocket[] = [];
  static reset() {
    FakeWebSocket.instances = [];
  }
}

vi.mock("ws", () => ({
  default: FakeWebSocket,
}));

// Imported AFTER the mock so xaiRealtime.ts picks up the fake.
const {
  verifyXaiRealtimeConnection,
  isZdrVerified,
  XaiRealtimeError,
  XAI_API_KEY_MISSING,
  XAI_ZDR_NOT_VERIFIED,
  XAI_ZDR_HEADER,
} = await import("./xaiRealtime");

function latestSocket(): FakeWebSocket {
  const s = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (!s) throw new Error("no fake socket was constructed");
  return s;
}

describe("isZdrVerified", () => {
  it("accepts the literal string true", () => {
    expect(isZdrVerified("true")).toBe(true);
  });

  it("accepts the boolean true", () => {
    expect(isZdrVerified(true)).toBe(true);
  });

  it("accepts true nested in a case-insensitive/whitespace form", () => {
    expect(isZdrVerified(" True ")).toBe(true);
  });

  it("rejects false", () => {
    expect(isZdrVerified("false")).toBe(false);
  });

  it("rejects undefined (missing header)", () => {
    expect(isZdrVerified(undefined)).toBe(false);
  });

  it("rejects an empty array", () => {
    expect(isZdrVerified([])).toBe(false);
  });
});

describe("verifyXaiRealtimeConnection", () => {
  afterEach(() => {
    FakeWebSocket.reset();
    vi.restoreAllMocks();
  });

  it("fails safely with XAI_API_KEY_MISSING when no key is configured -- and never touches the network", async () => {
    await expect(
      verifyXaiRealtimeConnection({ apiKey: "", model: "grok-voice-latest" })
    ).rejects.toMatchObject({ code: XAI_API_KEY_MISSING });
    expect(FakeWebSocket.instances.length).toBe(0);
  });

  it("resolves when the handshake reports x-zero-data-retention: true", async () => {
    const promise = verifyXaiRealtimeConnection({
      apiKey: "sk-fake-not-real",
      model: "grok-voice-latest",
    });
    const socket = latestSocket();
    socket.emit("upgrade", { headers: { [XAI_ZDR_HEADER]: "true" } });

    const result = await promise;
    expect(result.zdrVerified).toBe(true);
    expect(result.requestedModel).toBe("grok-voice-latest");
    expect(socket.closed).toBe(true);
  });

  it("rejects with XAI_ZDR_NOT_VERIFIED when the header is false", async () => {
    const promise = verifyXaiRealtimeConnection({
      apiKey: "sk-fake-not-real",
      model: "grok-voice-latest",
    });
    const socket = latestSocket();
    socket.emit("upgrade", { headers: { [XAI_ZDR_HEADER]: "false" } });

    await expect(promise).rejects.toMatchObject({ code: XAI_ZDR_NOT_VERIFIED });
    expect(socket.terminated).toBe(true);
  });

  it("rejects with XAI_ZDR_NOT_VERIFIED when the header is missing entirely", async () => {
    const promise = verifyXaiRealtimeConnection({
      apiKey: "sk-fake-not-real",
      model: "grok-voice-latest",
    });
    const socket = latestSocket();
    socket.emit("upgrade", { headers: {} });

    await expect(promise).rejects.toMatchObject({ code: XAI_ZDR_NOT_VERIFIED });
    expect(socket.terminated).toBe(true);
  });

  it("rejects with XAI_ZDR_NOT_VERIFIED on a malformed/error handshake (non-101 unexpected-response)", async () => {
    const promise = verifyXaiRealtimeConnection({
      apiKey: "sk-fake-not-real",
      model: "grok-voice-latest",
    });
    const socket = latestSocket();
    socket.emit("unexpected-response", {}, { statusCode: 401, headers: {} });

    await expect(promise).rejects.toMatchObject({ code: XAI_ZDR_NOT_VERIFIED });
  });

  it("rejects with XAI_ZDR_NOT_VERIFIED on a raw socket error before any upgrade", async () => {
    const promise = verifyXaiRealtimeConnection({
      apiKey: "sk-fake-not-real",
      model: "grok-voice-latest",
    });
    const socket = latestSocket();
    socket.emit("error", new Error("ECONNRESET while connecting with Authorization: Bearer sk-fake-not-real"));

    await expect(promise).rejects.toMatchObject({ code: XAI_ZDR_NOT_VERIFIED });
  });

  it("never leaks the API key into the rejection, whatever the underlying error said", async () => {
    const secret = "sk-super-secret-should-never-appear";
    const promise = verifyXaiRealtimeConnection({
      apiKey: secret,
      model: "grok-voice-latest",
    });
    const socket = latestSocket();
    socket.emit("error", new Error(`boom Authorization: Bearer ${secret}`));

    let caught: unknown;
    try {
      await promise;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(XaiRealtimeError);
    const serialized = JSON.stringify(caught, Object.getOwnPropertyNames(caught as object));
    expect(String(caught)).not.toContain(secret);
    expect(serialized).not.toContain(secret);
  });

  it("passes the configured model through to the connection URL", async () => {
    const promise = verifyXaiRealtimeConnection({
      apiKey: "sk-fake-not-real",
      model: "grok-voice-custom",
    });
    const socket = latestSocket();
    expect(socket.lastUrl).toContain("model=grok-voice-custom");
    socket.emit("upgrade", { headers: { [XAI_ZDR_HEADER]: "true" } });
    await promise;
  });
});
