import { createServer } from "node:http";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { acceptClientFatalReport, registerClientFatalRoute } from "./clientFatalRoute";

const ID = "6f1e2d3c-4b5a-4698-8abc-def012345678";

describe("acceptClientFatalReport", () => {
  it("logs only the sanitized record", () => {
    const log = vi.fn();
    const status = acceptClientFatalReport(
      {
        correlationId: ID,
        name: "TypeError",
        message: "failed for +1 310 555 0199 ada@example.com",
        stack: "Bearer abc.def.ghi at /opt/app/secret.ts:1:1 smsBody: hello there",
        extra: "should be rejected",
      },
      log
    );
    expect(status).toEqual({ status: 400 });
    expect(log).not.toHaveBeenCalled();
  });

  it("accepts a strict report and redacts before logging", () => {
    const log = vi.fn();
    const status = acceptClientFatalReport(
      {
        correlationId: ID,
        name: "TypeError",
        message: "failed for +1 310 555 0199 ada@example.com",
        stack: "Bearer abc.def.ghi\n at /opt/app/index.js:1:1",
      },
      log
    );
    expect(status).toEqual({ status: 204 });
    const record = log.mock.calls[0][0] as {
      message: string;
      stack: string;
      correlationId: string;
    };
    expect(record.correlationId).toBe(ID);
    expect(record.message).not.toContain("310");
    expect(record.message).not.toContain("ada@example.com");
    expect(record.stack).not.toContain("abc.def.ghi");
    expect(JSON.stringify(record)).not.toMatch(/phone|token|body/i);
  });

  it("rejects oversized or unexpected fields", () => {
    expect(
      acceptClientFatalReport({ correlationId: ID, name: "E", message: "m", note: "x" }, () => {})
    ).toEqual({ status: 400 });
    expect(acceptClientFatalReport(null, () => {})).toEqual({ status: 400 });
    expect(
      acceptClientFatalReport(
        { correlationId: ID, name: "E", message: "m", tenantId: "other", operatorId: "other" },
        () => {}
      )
    ).toEqual({ status: 400 });
    expect(
      acceptClientFatalReport(
        { correlationId: "00000000-0000-0000-0000-000000000000", name: "E", message: "m" },
        () => {}
      )
    ).toEqual({ status: 400 });
  });

  it("redacts an unquoted message body before logging", () => {
    const log = vi.fn();
    const status = acceptClientFatalReport(
      {
        correlationId: ID,
        name: "Error",
        message: "smsBody: pick up the blue shirts",
        stack: "authorization: Basic dXNlcjpwYXNz",
      },
      log
    );
    expect(status).toEqual({ status: 204 });
    const serialized = JSON.stringify(log.mock.calls[0][0]);
    expect(serialized).not.toContain("blue shirts");
    expect(serialized).not.toContain("dXNlcjpwYXNz");
  });
});

describe("POST /api/client-fatal", () => {
  async function withServer(run: (url: string, loggedText: () => string) => Promise<void>): Promise<void> {
    const app = express();
    registerClientFatalRoute(app);
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    const logs: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };
    try {
      await run(`http://127.0.0.1:${address.port}`, () => JSON.stringify(logs));
    } finally {
      console.error = original;
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }

  it("accepts a report without echoing it and redacts the log", async () => {
    await withServer(async (url, loggedText) => {
      const response = await fetch(`${url}/api/client-fatal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          correlationId: ID,
          name: "TypeError",
          message: "failed for +13105550199 ada@example.com",
          stack: "smsBody: pick up the blue shirts",
        }),
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(response.headers.get("cache-control")).toBe("no-store");
      const text = loggedText();
      expect(text).toContain(ID);
      expect(text).not.toContain("3105550199");
      expect(text).not.toContain("ada@example.com");
      expect(text).not.toContain("blue shirts");
    });
  });

  it("refuses a fat or malformed body without echoing the payload", async () => {
    await withServer(async (url, loggedText) => {
      const marker = "SECRET_MARKER_blue_shirts_+13105550199_ada@example.com";
      const fat = await fetch(`${url}/api/client-fatal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          correlationId: ID,
          name: "E",
          message: "m",
          stack: marker + "x".repeat(9000),
        }),
      });
      expect(fat.status).toBe(400);
      expect(fat.headers.get("cache-control")).toBe("no-store");
      const fatBody = await fat.text();
      expect(JSON.parse(fatBody)).toEqual({ error: "Invalid report" });
      expect(fatBody).not.toContain("SECRET_MARKER");
      expect(fatBody).not.toContain("blue shirts");
      expect(loggedText()).not.toContain("SECRET_MARKER");

      const malformed = await fetch(`${url}/api/client-fatal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: `{"message":"${marker}"`,
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).not.toContain(marker);

      const plain = await fetch(`${url}/api/client-fatal`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: marker,
      });
      expect(plain.status).toBe(400);
      expect(await plain.text()).not.toContain(marker);
    });
  });
});
