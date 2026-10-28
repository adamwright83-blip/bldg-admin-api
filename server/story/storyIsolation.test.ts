import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { STORY_REQUEST_HEADER } from "../../shared/story";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { assertStoryRequestAllowed, isStoryRequest, storyRequestAllowedForPath, storyRequestGate, trpcProcedurePaths } from "./storyIsolation";

/**
 * Story gameplay must never reach the business. These tests prove the server refuses a story request everywhere but
 * system.story.*, at both layers, and that ordinary requests are untouched.
 */

function runGate(url: string, headers: Record<string, string | undefined>) {
  const next = vi.fn();
  const res = { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(b: unknown) { this.body = b; return this; } };
  storyRequestGate()({ originalUrl: url, url, headers } as never, res as never, next);
  return { passed: next.mock.calls.length === 1, status: res.statusCode, body: res.body };
}

const STORY = { [STORY_REQUEST_HEADER]: "1" };

describe("story isolation: Express gate (before every route)", () => {
  it("lets ordinary requests through untouched, whatever the path", () => {
    for (const url of ["/api/trpc/admin.searchOrdersForReceipt", "/api/agent/s2s/run-tool", "/api/intake/from-bldg", "/api/trpc/system.story.tonight", "/"]) {
      expect(runGate(url, {}).passed).toBe(true);
    }
  });

  it("lets a story request reach system.story procedures, singly or batched", () => {
    expect(runGate("/api/trpc/system.story.tonight", STORY).passed).toBe(true);
    expect(runGate("/api/trpc/system.story.start,system.story.tonight?batch=1&input=%7B%7D", STORY).passed).toBe(true);
  });

  it("refuses a story request to any business procedure, REST endpoint, webhook or page", () => {
    for (const url of [
      "/api/trpc/admin.searchOrdersForReceipt",
      "/api/trpc/system.towerDesk.read",
      "/api/trpc/system.storyteller.x",
      "/api/trpc/system.story",
      "/api/trpc/system.story.",
      "/api/agent/s2s/run-tool",
      "/api/intake/from-bldg",
      "/api/twilio/sms",
      "/api/trpc",
      "/api/trpc/",
      "/",
    ]) {
      const r = runGate(url, STORY);
      expect({ url, passed: r.passed, status: r.status }).toEqual({ url, passed: false, status: 403 });
    }
  });

  it("refuses a batch that smuggles one business procedure among story ones", () => {
    expect(runGate("/api/trpc/system.story.tonight,admin.countUnreadLeads", STORY).passed).toBe(false);
    expect(runGate("/api/trpc/system.story.tonight%2Cadmin.countUnreadLeads", STORY).passed).toBe(false);
  });

  it("refuses encoded and traversal tricks", () => {
    expect(runGate("/api/trpc/system.story.tonight/../admin.countUnreadLeads", STORY).passed).toBe(false);
    expect(runGate("/api/trpc/system.story..admin", STORY).passed).toBe(false);
    expect(runGate("/api/trpc/%E0%A4%A", STORY).passed).toBe(false);
    expect(runGate("/api/trpc/system%2Estory%2Etonight%2Fx", STORY).passed).toBe(false);
  });

  it("treats the header as present whatever its value", () => {
    for (const value of ["", "0", "false", "anything"]) {
      expect(runGate("/api/trpc/admin.countUnreadLeads", { [STORY_REQUEST_HEADER]: value }).passed).toBe(false);
    }
  });

  it("parses tRPC paths conservatively", () => {
    expect(trpcProcedurePaths("/api/trpc/a.b,c.d")).toEqual(["a.b", "c.d"]);
    expect(trpcProcedurePaths("/api/other")).toBeNull();
    expect(trpcProcedurePaths("/api/trpc/a/b")).toBeNull();
    expect(storyRequestAllowedForPath("/api/trpc/system.story.answer")).toBe(true);
    expect(isStoryRequest(undefined)).toBe(false);
    expect(isStoryRequest({})).toBe(false);
  });
});

describe("story isolation: tRPC base procedure (every procedure in the app)", () => {
  const businessAction = vi.fn(async () => "business ran");
  const storyAction = vi.fn(async () => "story ran");
  const appLike = router({
    admin: router({ sendSomething: publicProcedure.query(businessAction) }),
    secured: router({ thing: protectedProcedure.query(businessAction) }),
    system: router({
      story: router({ ping: publicProcedure.query(storyAction) }),
      towerDesk: router({ read: publicProcedure.query(businessAction) }),
    }),
  });
  const caller = (headers?: Record<string, string>) =>
    appLike.createCaller({ req: headers ? { headers } : undefined, res: undefined, user: null, tenantId: "t1" } as never);

  it("refuses a story request to a business procedure before it runs, on every attempt", async () => {
    businessAction.mockClear();
    for (let attempt = 0; attempt < 3; attempt++) {
      await expect(caller(STORY).admin.sendSomething()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(STORY).system.towerDesk.read()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(caller(STORY).secured.thing()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(businessAction).not.toHaveBeenCalled();
  });

  it("lets a story request reach system.story", async () => {
    await expect(caller(STORY).system.story.ping()).resolves.toBe("story ran");
  });

  it("leaves ordinary requests and in-process callers exactly as before", async () => {
    businessAction.mockClear();
    await expect(caller({}).admin.sendSomething()).resolves.toBe("business ran");
    await expect(caller().admin.sendSomething()).resolves.toBe("business ran");
    expect(businessAction).toHaveBeenCalledTimes(2);
  });

  it("the assertion itself refuses every non-story path", () => {
    expect(() => assertStoryRequestAllowed({ headers: STORY }, "admin.x")).toThrow();
    expect(() => assertStoryRequestAllowed({ headers: STORY }, "system.story")).toThrow();
    expect(() => assertStoryRequestAllowed({ headers: STORY }, "system.story.ok")).not.toThrow();
    expect(() => assertStoryRequestAllowed({ headers: {} }, "admin.x")).not.toThrow();
    expect(() => assertStoryRequestAllowed(undefined, "admin.x")).not.toThrow();
  });
});

describe("story isolation: the story code cannot reach the business", () => {
  // Every module server/story may import. Anything that can send, schedule, sync or change business data is absent.
  const ALLOWED = new Set([
    "drizzle-orm",
    "zod",
    "express",
    "@trpc/server",
    "../../drizzle/schema",
    "../../shared/story",
    "../db",
    "../_core/trpc",
    "../agents/persistentOperator/identity",
    "../dashboardZoned",
    "./storyEngine",
    "./storyFlag",
    "./storyService",
    "./storyStore",
  ]);
  const dir = new URL("./", import.meta.url);
  const sources = readdirSync(dir).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("has the expected source files", () => {
    expect(sources.sort()).toEqual(["storyEngine.ts", "storyFlag.ts", "storyIsolation.ts", "storyRouter.ts", "storyService.ts", "storyStore.ts"]);
  });

  it("imports only from the allowlist", () => {
    for (const file of sources) {
      const text = readFileSync(new URL(file, dir), "utf8");
      const specifiers = [...text.matchAll(/^\s*import\s[^"']*["']([^"']+)["']/gm)].map(m => m[1]!);
      for (const s of specifiers) {
        expect({ file, import: s, allowed: s.startsWith("node:") || ALLOWED.has(s) }).toEqual({ file, import: s, allowed: true });
      }
      expect(text).not.toMatch(/\bimport\(/);
      expect(text).not.toMatch(/\brequire\(/);
    }
  });

  it("the store touches only story tables", () => {
    const text = readFileSync(new URL("storyStore.ts", dir), "utf8");
    const fromSchema = text.match(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/\.\.\/drizzle\/schema"/);
    const names = (fromSchema?.[1] ?? "").split(",").map(s => s.trim()).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^story[A-Z]/);
  });
});
