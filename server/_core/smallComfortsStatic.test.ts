import express from "express";
import http from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerSmallComforts, resolveSmallComfortsDir, SMALL_COMFORTS_CSP } from "./smallComfortsStatic";

describe("Small Comforts static route", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use((_req, res, next) => { res.setHeader("X-Frame-Options", "DENY"); next(); });
    registerSmallComforts(app);
    app.use("*", (_req, res) => { res.send("app shell"); });
    server = app.listen(0);
    await new Promise(r => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(() => { server.close(); });

  it("finds the canonical build", () => {
    expect(resolveSmallComfortsDir()).toMatch(/preview[\\/]small-comforts$/);
  });

  it("serves the chapters with the scoped policy, framable by this origin only", async () => {
    for (const page of ["/small-comforts/", "/small-comforts/ch3.html"]) {
      const res = await fetch(base + page);
      expect(res.status).toBe(200);
      expect(await res.text()).not.toBe("app shell");
      expect(res.headers.get("content-security-policy")).toBe(SMALL_COMFORTS_CSP);
      expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    }
    expect(SMALL_COMFORTS_CSP).toContain("frame-ancestors 'self'");
  });

  it("keeps agent notes and missing files out of the app shell", async () => {
    for (const page of ["/small-comforts/STORY.md", "/small-comforts/reference/x.jpg", "/small-comforts/nope.html"]) {
      expect((await fetch(base + page)).status).toBe(404);
    }
  });
});
