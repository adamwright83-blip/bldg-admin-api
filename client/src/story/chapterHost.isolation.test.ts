import fs from "node:fs";
import path from "node:path";
import superjson from "superjson";
import { describe, expect, it } from "vitest";
import { STORY_REQUEST_HEADER } from "@shared/story";
import { storyRequestAllowedForPath } from "../../../server/story/storyIsolation";
import { createChapterSession, type ChapterHostState } from "./chapterSession";
import { createStoryClient } from "./storyClient";

/**
 * Proves the chapter host reaches nothing but `system.story.*`.
 *
 * 1. Runtime: a whole Season 0 play (start, a loss, a retry, a win, the ending, the answer, and a quit) runs through
 *    the real story tRPC client against a recording fetch. Every request must name only story procedures, carry the
 *    story header, and pass the server's own isolation gate.
 * 2. Source: nothing under client/src/story may import the main tRPC client or open its own network path.
 */

type Recorded = { url: string; method: string; procedures: string[]; storyHeader: string | null };

const SEASON_0_CHAPTER_1 = {
  gameKey: "fixture.button",
  after: [{ key: "a1", text: "Placeholder after-line. Sed do eiusmod tempor.", still: null }],
  question: {
    key: "s0.first",
    text: "Placeholder question: left or right?",
    options: [
      { key: "left", text: "Left" },
      { key: "right", text: "Right" },
    ],
    answered: null,
  },
};

function fakeServer() {
  const requests: Recorded[] = [];
  const respond = (procedure: string, input: any): unknown => {
    switch (procedure) {
      case "system.story.tonight":
        return { enabled: true, seasonTitle: "Season 0 (placeholder)", chapterCount: 3, state: "available", daysAway: 0, chapter: null };
      case "system.story.start":
        return { chapterNumber: input.chapterNumber, gameKey: SEASON_0_CHAPTER_1.gameKey, config: { fixture: true } };
      case "system.story.finish":
        return input.outcome === "win"
          ? { advanced: true, after: SEASON_0_CHAPTER_1.after, question: SEASON_0_CHAPTER_1.question }
          : { advanced: false, after: null, question: null };
      case "system.story.answer":
        return { answered: input.optionKey };
      default:
        throw new Error(`unexpected procedure ${procedure}`);
    }
  };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input), "http://admin.test");
    const procedures = decodeURIComponent(url.pathname.replace(/^\/api\/trpc\//, "")).split(",");
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    requests.push({ url: url.pathname, method: init?.method ?? "GET", procedures, storyHeader: headers.get(STORY_REQUEST_HEADER) });
    const inputs: Record<string, unknown> =
      init?.body ? JSON.parse(String(init.body)) : JSON.parse(url.searchParams.get("input") ?? "{}");
    const body = procedures.map((procedure, i) => {
      const raw = inputs[String(i)] as { json: unknown; meta?: any } | undefined;
      const value = raw ? superjson.deserialize(raw as any) : undefined;
      return { result: { data: superjson.serialize(respond(procedure, value)) } };
    });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { requests, fetch };
}

async function settle(): Promise<void> {
  // httpBatchLink dispatches on the next tick; let every pending request resolve.
  for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

describe("chapter host isolation", () => {
  it("a full Season 0 play reaches only system.story.*, every request carrying the story header", async () => {
    const server = fakeServer();
    const client = createStoryClient({ url: "/api/trpc", fetch: server.fetch });
    const states: ChapterHostState[] = [];
    let clock = 0;
    const session = createChapterSession({ client, chapterNumber: 1, onChange: state => states.push(state), clock: () => (clock += 1000) });

    await client.tonight();
    await session.begin();
    expect(session.state()).toMatchObject({ phase: "playing", gameKey: "fixture.button", attempt: 1 });

    await session.report("lose");
    expect(session.state()).toMatchObject({ phase: "lost" });
    session.retry();
    expect(session.state()).toMatchObject({ phase: "playing", attempt: 2 });

    await session.report("win");
    expect(session.state()).toMatchObject({ phase: "ended", answered: null, question: { key: "s0.first" } });
    await session.choose("left");
    expect(session.state()).toMatchObject({ phase: "ended", answered: "left" });

    // A second play that is abandoned mid-game records a quit.
    const quitter = createChapterSession({ client, chapterNumber: 1, onChange: () => {} });
    await quitter.begin();
    await quitter.leave();
    await settle();

    const called = server.requests.flatMap(request => request.procedures);
    expect(called).toEqual([
      "system.story.tonight",
      "system.story.start",
      "system.story.finish",
      "system.story.finish",
      "system.story.answer",
      "system.story.start",
      "system.story.finish",
    ]);
    for (const request of server.requests) {
      expect(request.storyHeader, request.url).not.toBeNull();
      expect(request.procedures.every(procedure => procedure.startsWith("system.story.")), request.url).toBe(true);
      // The server's own gate would let every one of these through, and nothing else.
      expect(storyRequestAllowedForPath(request.url), request.url).toBe(true);
    }
  });

  it("a loss reports lose and never shows an ending", async () => {
    const server = fakeServer();
    const session = createChapterSession({ client: createStoryClient({ url: "/api/trpc", fetch: server.fetch }), chapterNumber: 1, onChange: () => {} });
    await session.begin();
    await session.report("lose");
    expect(session.state()).toEqual({ phase: "lost", attempt: 1 });
    expect(server.requests.at(-1)?.method).toBe("POST");
  });

  it("a failed call can be retried without leaving the host", async () => {
    let fail = true;
    const server = fakeServer();
    const flaky: typeof globalThis.fetch = async (input, init) => {
      if (fail) {
        fail = false;
        return new Response("down", { status: 503 });
      }
      return server.fetch(input, init);
    };
    const session = createChapterSession({ client: createStoryClient({ url: "/api/trpc", fetch: flaky }), chapterNumber: 1, onChange: () => {} });
    await session.begin();
    expect(session.state()).toMatchObject({ phase: "error", failed: "start" });
    await session.recover();
    expect(session.state()).toMatchObject({ phase: "playing" });
  });
});

describe("story code has no other way out", () => {
  const root = path.resolve(import.meta.dirname);
  const files = fs
    .readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter(file => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts"))
    .map(file => ({ file, source: fs.readFileSync(path.join(root, file), "utf8") }));

  it("covers the host, the session, the client and the games", () => {
    expect(files.map(f => f.file).sort()).toEqual(
      expect.arrayContaining(["ChapterHost.tsx", "chapterSession.ts", "storyClient.ts", path.join("games", "registry.ts"), path.join("games", "FixtureButtonGame.tsx")])
    );
  });

  it("never imports the main tRPC client or a second network path", () => {
    for (const { file, source } of files) {
      expect(source, file).not.toMatch(/from\s+["']@\/lib\/trpc["']/);
      expect(source, file).not.toMatch(/@trpc\/react-query/);
      expect(source, file).not.toMatch(/\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|sendBeacon/);
      if (file !== "storyClient.ts") {
        expect(source, file).not.toMatch(/@trpc\/client/);
        expect(source, file).not.toMatch(/\bfetch\s*\(/);
      }
    }
  });

  it("games import nothing but React and their own types", () => {
    for (const { file, source } of files.filter(f => f.file.startsWith("games"))) {
      const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]);
      for (const specifier of imports) expect(["react", "./types", "./FixtureButtonGame"], `${file} imports ${specifier}`).toContain(specifier);
    }
  });
});
