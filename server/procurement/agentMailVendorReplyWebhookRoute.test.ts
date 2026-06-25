import type express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerAgentMailVendorReplyWebhookRoutes } from "./agentMailVendorReplyWebhookRoute";

const ORIGINAL_SECRET = process.env.AGENTMAIL_VENDOR_WEBHOOK_SECRET;

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.AGENTMAIL_VENDOR_WEBHOOK_SECRET;
  else process.env.AGENTMAIL_VENDOR_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

function makeFakeApp() {
  const handlers = new Map<string, express.RequestHandler>();
  const app = {
    post: (path: string, ...middlewareAndHandler: express.RequestHandler[]) => {
      handlers.set(path, middlewareAndHandler[middlewareAndHandler.length - 1]);
    },
  };
  return { app: app as unknown as express.Express, handlers };
}

function makeReqRes(body: unknown, headers: Record<string, string> = {}) {
  const req = { body, headers } as unknown as express.Request;
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status } as unknown as express.Response;
  return { req, res, status, json };
}

function makeStoreStub(overrides?: Record<string, unknown>) {
  return {
    getAttemptByProviderAttemptId: vi.fn().mockResolvedValue(null),
    recordReplyAndTerms: vi.fn(),
    ...overrides,
  };
}

describe("AgentMail vendor reply webhook route", () => {
  it("is namespaced under /api/webhooks/agentmail/, distinct from admin-guarded routes", async () => {
    const { app, handlers } = makeFakeApp();
    registerAgentMailVendorReplyWebhookRoutes(app, { store: makeStoreStub() as never });
    expect(handlers.has("/api/webhooks/agentmail/vendor-replies")).toBe(true);
  });

  it("returns 401 when the secret header is missing, and never touches the store", async () => {
    delete process.env.AGENTMAIL_VENDOR_WEBHOOK_SECRET;
    const store = makeStoreStub();
    const { app, handlers } = makeFakeApp();
    registerAgentMailVendorReplyWebhookRoutes(app, { store: store as never });
    const { req, res, status, json } = makeReqRes(Buffer.from("{}"), {});
    await handlers.get("/api/webhooks/agentmail/vendor-replies")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ status: "unauthorized" });
    expect(store.getAttemptByProviderAttemptId).not.toHaveBeenCalled();
  });

  it("returns 401 with an invalid secret header", async () => {
    process.env.AGENTMAIL_VENDOR_WEBHOOK_SECRET = "correct-secret";
    const store = makeStoreStub();
    const { app, handlers } = makeFakeApp();
    registerAgentMailVendorReplyWebhookRoutes(app, { store: store as never });
    const { req, res, status } = makeReqRes(Buffer.from("{}"), { "x-agentmail-vendor-webhook-secret": "wrong" });
    await handlers.get("/api/webhooks/agentmail/vendor-replies")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(401);
  });

  it("returns 200 with an unmatched status for a valid-secret, unmatched payload", async () => {
    process.env.AGENTMAIL_VENDOR_WEBHOOK_SECRET = "correct-secret";
    const store = makeStoreStub();
    const { app, handlers } = makeFakeApp();
    registerAgentMailVendorReplyWebhookRoutes(app, { store: store as never });
    const body = Buffer.from(JSON.stringify({
      type: "event", eventType: "message.received", eventId: "evt_1",
      message: { extractedText: "hi", inReplyTo: "msg_unknown" },
    }));
    const { req, res, status, json } = makeReqRes(body, { "x-agentmail-vendor-webhook-secret": "correct-secret" });
    await handlers.get("/api/webhooks/agentmail/vendor-replies")!(req, res, vi.fn());
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ status: "unmatched" });
  });

  it("never returns the raw inbound message body or secret in its response", async () => {
    process.env.AGENTMAIL_VENDOR_WEBHOOK_SECRET = "correct-secret";
    const store = makeStoreStub();
    const { app, handlers } = makeFakeApp();
    registerAgentMailVendorReplyWebhookRoutes(app, { store: store as never });
    const body = Buffer.from(JSON.stringify({
      type: "event", eventType: "message.received", eventId: "evt_1",
      message: { extractedText: "secret vendor pricing details here", inReplyTo: "msg_unknown" },
    }));
    const { req, res, json } = makeReqRes(body, { "x-agentmail-vendor-webhook-secret": "correct-secret" });
    await handlers.get("/api/webhooks/agentmail/vendor-replies")!(req, res, vi.fn());
    const responseBody = JSON.stringify(json.mock.calls[0][0]);
    expect(responseBody).not.toContain("secret vendor pricing details here");
    expect(responseBody).not.toContain("correct-secret");
  });
});

describe("Slice 74f webhook route safety", () => {
  it("the route module never imports the AgentMail outbound send adapter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "agentMailVendorReplyWebhookRoute.ts"), "utf8",
    );
    expect(source).not.toMatch(/sendVendorEmailViaAgentMail|agentMailVendorEmailProvider/);
  });

  it("the webhook processing module never imports the AgentMail outbound send adapter", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(__dirname, "agentMailVendorReplyWebhook.ts"), "utf8",
    );
    expect(source).not.toMatch(/sendVendorEmailViaAgentMail|agentMailVendorEmailProvider|AgentMailClient/);
  });
});
