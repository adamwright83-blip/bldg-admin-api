import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { benchReport, coverageOf, DISCOVER_SYSTEM, outcomeOf, PLAN_SYSTEM, requestKind, runFirstReadBench } from "./bench";
import {
  applyJudge,
  checkClaims,
  checkOpening,
  GRADE_SYSTEM,
  gradeScore,
  judgeClaims,
  judgePrompt,
  JUDGE_SYSTEM,
  quoteIsIn,
  READING_SYSTEM,
  readingSchema,
  type Evidence,
  type Reading,
} from "./synthesis";
import { hitsOf, searchCorpus, workspaceSearchFetch, WORKSPACE_MCP_URL } from "./workspaceSearch";

const ok = () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200 });
const rpc = (method: string, name?: string) => ({ method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: name ? { name, arguments: {} } : {} }) });

describe("workspaceSearchFetch", () => {
  it("lets only the handshake, tools/list and search_corpus through", async () => {
    const base = vi.fn(async () => ok());
    const guarded = workspaceSearchFetch(base as unknown as typeof fetch);
    await guarded(WORKSPACE_MCP_URL, rpc("initialize"));
    await guarded(WORKSPACE_MCP_URL, rpc("tools/list"));
    await guarded(WORKSPACE_MCP_URL, rpc("tools/call", "search_corpus"));
    expect(base).toHaveBeenCalledTimes(3);
    await expect(guarded(WORKSPACE_MCP_URL, rpc("tools/call", "create_draft"))).rejects.toThrow(/Refused/);
    await expect(guarded("https://gmailmcp.googleapis.com/mcp/v1", rpc("tools/call", "search_corpus"))).rejects.toThrow(/Refused/);
    await expect(guarded(WORKSPACE_MCP_URL, { method: "POST", body: "not json" })).rejects.toThrow(/Refused/);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it("reads structured and text results alike, and reports a refusal as a result", async () => {
    const items = [{ driveResult: { title: "Plan", contentSnippet: "the plan", viewUrl: "https://drive/1" } }];
    expect(hitsOf({ structuredContent: { items } })).toEqual(hitsOf({ content: [{ type: "text", text: JSON.stringify({ items }) }] }));
    const refused = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "API not enabled" }] } }), { status: 403 }));
    expect(await searchCorpus({ accessToken: "t", query: "q" }, { fetch: refused as unknown as typeof fetch })).toMatchObject({ ok: false, status: 403, error: "API not enabled" });
  });
});

// ------------------------------------------------------------------ claims

const today = new Date("2026-10-31T00:00:00Z");
const item = (id: string, source: Evidence["source"], at: string, byOwner: boolean, title: string, text: string, people = ""): Evidence => ({
  id,
  source,
  at: new Date(at),
  dated: source === "gmail" ? "activity" : "modified",
  byOwner,
  title,
  people,
  text,
  ref: `${source} ${id}-original`,
  url: `https://example.com/${id}`,
});
const evidence: Evidence[] = [
  item("g1", "gmail", "2026-10-20T00:00:00Z", true, "Proposal for Harbor Lofts", "Attached is our premium residential laundry proposal for your residents.", "from Owner <owner@x.com> to Jordan Reyes <jordan@harborlofts.example>"),
  item("g2", "gmail", "2024-03-01T00:00:00Z", true, "Website quote", "Here is my quote to redesign your restaurant website.", "from Owner <owner@x.com> to Chef <chef@x.com>"),
  item("g3", "gmail", "2026-09-17T00:00:00Z", true, "Stolen register", "Someone broke into our laundromat last night and stole the register.", "from Owner <owner@x.com> to Cents Support <help@cents.example>"),
  item("g4", "gmail", "2025-01-10T00:00:00Z", true, "Dryer down", "Dryer number four is broken again and customers are complaining.", "from Owner <owner@x.com> to Sam <sam@x.com>"),
  item("d1", "drive", "2026-10-29T00:00:00Z", true, "JOYSTICK plan (doc)", "Make real business activity playable: the business is the game.", "owned by owner@x.com; last edited by owner@x.com"),
  item("d2", "drive", "2023-05-01T00:00:00Z", true, "Car wash plan (doc)", "The plan for our mobile car wash business in Pasadena.", "owned by owner@x.com; last edited by owner@x.com"),
];
const claim = (kind: Reading["claims"][number]["kind"], statement: string, status: Reading["claims"][number]["status"], ...cites: Array<[string, string]>): Reading["claims"][number] => ({
  kind,
  statement,
  status,
  partOf: "",
  people: [],
  evidence: cites.map(([id, quote]) => ({ id, quote })),
});
const reading: Reading = {
  claims: [
    claim("business", "Selling premium residential laundry to Harbor Lofts", "active", ["g1", "premium residential laundry proposal"]),
    claim("business", "Web design for restaurants", "active", ["g2", "quote to redesign your restaurant website"]),
    claim("project", "Building JOYSTICK, which makes business activity playable", "active", ["d1", "Make real business activity playable"]),
    claim("project", "Mobile car wash in Pasadena", "ended", ["d2", "mobile car wash business in Pasadena"]),
    claim("event", "The laundromat was broken into and its register stolen (Sept 2026)", "happened", ["g3", "broke into our laundromat last night"]),
    claim("problem", "Replacing the stolen register", "unresolved", ["g3", "broke into our laundromat last night"]),
    claim("problem", "Broken dryer and complaints", "unresolved", ["g4", "Dryer number four is broken again"]),
    claim("relationship", "Jordan Reyes, contact at Harbor Lofts", "n/a", ["g1", "to Jordan Reyes jordan harborlofts example"]),
    claim("project", "JOYSTICK is what the laundry proposal is for", "active", ["d1", "Make real business activity playable"], ["g1", "premium residential laundry proposal"]),
    claim("business", "Invented", "active", ["g9", "anything at all here"]),
    claim("business", "Paraphrased", "active", ["g1", "the building signed a two year contract"]),
    { ...claim("fiction", "A courier character in the game", "n/a", ["d1", "Make real business activity playable"]), partOf: "JOYSTICK" },
    claim("fiction", "A character with no project", "n/a", ["d1", "Make real business activity playable"]),
  ],
  opening: [],
};

describe("the reading schema Gemini is sent", () => {
  it("bounds no list Gemini refuses to bound, and still keeps only 30 claims", () => {
    const json = z.toJSONSchema(readingSchema, { io: "input" }) as { properties: { claims: { maxItems?: number } } };
    expect(json.properties.claims.maxItems).toBeUndefined();
    const many = { claims: Array.from({ length: 40 }, () => ({ kind: "event", statement: "s", status: "happened", partOf: "", people: [], evidence: [{ id: "g1", quote: "q" }] })), opening: [] };
    expect(readingSchema.parse(many).claims).toHaveLength(30);
  });
});

describe("checkClaims", () => {
  const claims = checkClaims(reading, evidence, today);
  const verdict = (statement: string) => claims.find(c => c.statement === statement)!.verdict;
  const reasons = (statement: string) => claims.find(c => c.statement === statement)!.reasons.join("; ");

  it("calls a business active only on the owner's own recent dated act", () => {
    expect(verdict("Selling premium residential laundry to Harbor Lofts")).toBe("active");
  });

  it("keeps an old business's status unknown, with when it was last seen, never 'ended'", () => {
    expect(verdict("Web design for restaurants")).toBe("status_unknown");
    expect(reasons("Web design for restaurants")).toMatch(/last seen 2024-03-01/);
  });

  it("treats the owner's own recent documents as work on a project, never as proof it is operating", () => {
    expect(verdict("Building JOYSTICK, which makes business activity playable")).toBe("in_progress");
    expect(reasons("Building JOYSTICK, which makes business activity playable")).toMatch(/recent work on it .* not that it is operating/);
  });

  it("files fiction under the project it belongs to, and won't state fiction without one", () => {
    expect(claims.find(c => c.statement === "A courier character in the game")).toMatchObject({ verdict: "fiction", partOf: "JOYSTICK" });
    expect(verdict("A character with no project")).toBe("uncertain");
  });

  it("lets mail corroborate files: a project cited with the owner's recent mail can be active", () => {
    const linked = claims.find(c => c.statement === "JOYSTICK is what the laundry proposal is for")!;
    expect(linked).toMatchObject({ verdict: "active", crossSource: true });
  });

  it("states 'ended' only as claimed, for the judge to confirm", () => {
    expect(verdict("Mobile car wash in Pasadena")).toBe("ended");
  });

  it("tells a dated event from a current, unresolved problem", () => {
    expect(verdict("The laundromat was broken into and its register stolen (Sept 2026)")).toBe("happened");
    expect(verdict("Replacing the stolen register")).toBe("open_problem");
    expect(verdict("Broken dryer and complaints")).toBe("happened");
    expect(reasons("Broken dryer and complaints")).toMatch(/still unresolved isn't shown/);
  });

  it("accepts a relationship shown by the message headers", () => {
    expect(verdict("Jordan Reyes, contact at Harbor Lofts")).toBe("relationship");
  });

  it("strikes ids that don't exist and quotes that aren't there, and refuses too-short quotes", () => {
    expect(verdict("Invented")).toBe("unsupported");
    expect(verdict("Paraphrased")).toBe("unsupported");
    expect(quoteIsIn("Lofts", evidence[0])).toBe(false);
  });

  it("keeps each citation's original source", () => {
    expect(claims[0].citations[0]).toMatchObject({ ref: "gmail g1-original", url: "https://example.com/g1", activity: true });
  });

  it("shows the judge each cited item's real sender and recipients", () => {
    expect(judgePrompt([claims[7]], evidence, today)).toMatch(/from Owner <owner@x\.com> to Jordan Reyes <jordan@harborlofts\.example>/);
  });

  it("lets the judge lower, never raise, and keeps unknown status unknown", () => {
    const yes = { supports: "yes" as const, statusShown: "yes" as const, contradiction: "" };
    const judged = applyJudge(claims, [
      { n: 0, ...yes, statusShown: "unknown" },
      { n: 1, ...yes },
      { n: 3, ...yes, statusShown: "no" },
      { n: 4, ...yes },
      { n: 5, ...yes, statusShown: "no" },
      { n: 7, ...yes },
      { n: 8, ...yes, supports: "no" },
    ]);
    expect(judged.map(c => c.verdict).slice(0, 9)).toEqual([
      "status_unknown", // active, but the items don't show it is operating now
      "status_unknown", // stays: the judge can't raise it
      "uncertain", // in progress: no verdict, so not verified
      "status_unknown", // ended, but the items don't say so
      "happened",
      "happened", // open problem: still unresolved isn't shown
      "happened", // no verdict: a dated event needs none
      "relationship",
      "unsupported",
    ]);
  });

  it("keeps an opening sentence only on stated claims the judge found it faithful to", () => {
    const opening = [
      { sentence: "You're pitching premium laundry to Harbor Lofts.", claims: [0] },
      { sentence: "And you still do restaurant web design.", claims: [1] },
      { sentence: "JOYSTICK is the laundry business's app.", claims: [0, 2] },
      { sentence: "You're building JOYSTICK.", claims: [2] },
    ];
    const kept = checkOpening(opening, claims, new Map([
      [0, { faithful: "yes" as const, why: "" }],
      [1, { faithful: "yes" as const, why: "" }],
      [2, { faithful: "no" as const, why: "links two businesses the claims don't link" }],
    ]));
    expect(kept.map(s => s.kept)).toEqual([true, false, false, false]);
    expect(kept[1].why).toMatch(/not stated/);
    expect(kept[2].why).toMatch(/links two businesses/);
    expect(kept[3].why).toMatch(/no verdict/);
    expect(checkOpening(opening, claims, null).some(s => s.kept)).toBe(false);
  });

  it("fails closed: a failed judge states nothing that needs it", async () => {
    const failing = vi.fn(async () => new Response("overloaded", { status: 503 }));
    const failed = await judgeClaims({ apiKey: "k", model: "m", fetch: failing as unknown as typeof fetch }, claims, evidence, today);
    expect(failed.call?.error).toMatch(/503/);
    const after = (statement: string) => failed.claims.find(c => c.statement === statement)!;
    expect(after("Selling premium residential laundry to Harbor Lofts").verdict).toBe("uncertain");
    expect(after("Selling premium residential laundry to Harbor Lofts").reasons.at(-1)).toMatch(/not verified: the judge failed/);
    expect(after("Jordan Reyes, contact at Harbor Lofts").verdict).toBe("uncertain");
    expect(after("The laundromat was broken into and its register stolen (Sept 2026)").verdict).toBe("happened");
  });

  it("scores only confirmed findings", () => {
    const score = gradeScore(
      [
        { id: "G1", found: "yes", claims: [0], statusRight: "yes", note: "" },
        { id: "G2", found: "partly", claims: [7], statusRight: "no", note: "" },
        { id: "U1", found: "yes", claims: [1], statusRight: "yes", note: "" },
      ],
      { findings: [{ id: "G1", from: "gmail", statement: "", expected: "active" }, { id: "G2", from: "gmail", statement: "", expected: "relationship" }, { id: "U1", from: "gmail", statement: "", expected: "past", unconfirmed: true }] }
    );
    expect(score).toEqual({ recall: 0.75, statusRight: 0.5, confirmed: 2 });
  });
});

describe("coverage", () => {
  const answer = (question: "gmail" | "drive" | "combined", sources: Array<"gmail" | "drive">, verifiedMs = 1000) => ({
    question,
    evidence: sources.map((source, i) => ({ ...evidence[0], id: `${source}${i}`, source })),
    claims: [],
    opening: [],
    draftMs: 900,
    verifiedMs,
  });

  it("never counts a combined answer built from one source as covering both", () => {
    expect(coverageOf({ answers: [answer("combined", ["gmail", "drive"])] })).toEqual({ gmail: true, drive: true });
    expect(outcomeOf({ answers: [answer("combined", ["gmail"])] })).toBe("partial");
    expect(outcomeOf({ answers: [answer("gmail", ["gmail"])] })).toBe("partial");
    expect(outcomeOf({ answers: [answer("gmail", ["gmail"]), answer("drive", ["drive"], 0)] })).toBe("partial");
    expect(outcomeOf({ answers: [] })).toBe("failed");
  });
});

// ------------------------------------------------------------------ the benchmark, against a fake Google and Gemini

const OWNER = "owner@example.com";
const DOC = "application/vnd.google-apps.document";
const b64 = (text: string) => Buffer.from(text).toString("base64url");

function fakeWorld(now: Date) {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const message = (id: string, format: "metadata" | "full") => ({
    id,
    threadId: `t-${id}`,
    internalDate: String(now.getTime() - 10 * 86_400_000),
    labelIds: ["SENT"],
    snippet: "Proposal attached",
    payload: {
      mimeType: format === "full" ? "text/plain" : "multipart/alternative",
      headers: [
        { name: "From", value: `Owner <${OWNER}>` },
        { name: "To", value: "Jordan <jordan@harborlofts.example>" },
        { name: "Subject", value: `Proposal ${id}` },
      ],
      ...(format === "full" ? { body: { data: b64("Attached is our premium residential laundry proposal for your residents.") } } : {}),
    },
  });
  let listed = 0;
  return vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host === "oauth2.googleapis.com") return json({ access_token: "fresh", expires_in: 3600 });
    if (url.host === "generativelanguage.googleapis.com") {
      const body = JSON.parse(String(init?.body)) as { systemInstruction: { parts: Array<{ text: string }> }; contents: Array<{ parts: Array<{ text: string }> }> };
      const system = body.systemInstruction.parts[0].text;
      const prompt = body.contents[0].parts[0].text;
      const firstId = /\[(g1|d1)\]/.exec(prompt)?.[1] ?? "g1";
      const value =
        system === DISCOVER_SYSTEM
          ? { undertakings: [{ name: "Acme Laundry", category: "business", partOf: "", clue: "proposal" }], read: ["f1"], gmail: [{ query: "in:sent Harbor Lofts", why: "the pitch" }] }
          : system === PLAN_SYSTEM
          ? { gmail: [{ query: "in:sent Harbor Lofts", why: "the proposal" }], drive: [{ terms: ["Moonlight"], why: "the product" }] }
          : system === JUDGE_SYSTEM
            ? { verdicts: [0, 1].map(n => ({ n, supports: "yes", statusShown: "yes", contradiction: "" })), sentences: [{ n: 0, faithful: "yes", why: "" }] }
            : system === GRADE_SYSTEM
              ? { findings: [{ id: "G2", found: "yes", claims: [0], statusRight: "yes", note: "named" }] }
              : system === READING_SYSTEM
                ? {
                    claims: [
                      { kind: "business", statement: "Selling premium residential laundry to Harbor Lofts", status: "active", partOf: "", people: ["Jordan"], evidence: [{ id: firstId, quote: "premium residential laundry proposal" }] },
                      { kind: "relationship", statement: "Jordan, contact at Harbor Lofts", status: "n/a", partOf: "", people: ["Jordan"], evidence: [{ id: "g1", quote: "to Jordan jordan harborlofts example" }] },
                    ],
                    opening: [{ sentence: "You're pitching premium laundry to Harbor Lofts.", claims: [0] }],
                  }
                : {};
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 }, modelVersion: "gemini-fake" });
    }
    if (url.host === "gmail.googleapis.com") {
      if (url.pathname.endsWith("/messages")) {
        listed += 1;
        return json({ messages: [{ id: `m${listed}a` }, { id: `m${listed}b` }], resultSizeEstimate: 2 });
      }
      const id = decodeURIComponent(url.pathname.split("/").pop()!);
      return json(message(id, url.searchParams.get("format") === "metadata" ? "metadata" : "full"));
    }
    if (url.pathname.endsWith("/export")) return new Response("Moonlight: premium residential laundry proposal plan.", { status: 200 });
    if (url.pathname.endsWith("/drive/v3/files")) {
      return json({ files: [{ id: "f1", name: "Moonlight plan", mimeType: DOC, modifiedTime: now.toISOString(), webViewLink: "https://docs.example/f1", owners: [{ emailAddress: OWNER }], lastModifyingUser: { emailAddress: OWNER } }] });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("runFirstReadBench", () => {
  it("times every variant, reads only a small sample, and grades by meaning after the clock", async () => {
    const now = new Date("2026-10-31T12:00:00Z");
    const fake = fakeWorld(now);
    const result = await runFirstReadBench({
      google: {
        accessToken: "old",
        refreshToken: "refresh",
        accessExpiresAt: now,
        grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/drive.readonly"],
        ownerEmail: OWNER,
        onRefreshed: async () => undefined,
      },
      variants: ["fast:separate", "fast:combined", "agent:separate", "agent:combined", "discover:combined"],
      runs: 1,
      geminiKey: "key",
      model: "gemini-3.8-flash",
      thinking: "low",
      centsPerMillion: { input: 75, output: 375 },
      expect: { findings: [{ id: "G2", from: "gmail", statement: "Jordan at Harbor Lofts", expected: "relationship" }] },
      fetch: fake as unknown as typeof fetch,
      env: { JOYSTICK_GOOGLE_CLIENT_ID: "id", JOYSTICK_GOOGLE_CLIENT_SECRET: "secret" } as NodeJS.ProcessEnv,
      now: () => now,
    });
    const by = (variant: string) => result.runs.find(run => run.variant === variant)!;

    // fast: one recent Sent search and three older samples; agent adds the one search Gemini chose
    expect(by("fast:separate").requests.gmail_search).toBe(4);
    expect(by("fast:separate").requests.drive_search).toBe(1);
    expect(by("agent:combined").requests.gmail_search).toBe(5);
    expect(by("agent:combined").requests.drive_search).toBe(2);
    // separate answers twice; combined once, over both sources
    expect(by("fast:separate").answers.map(a => a.question).sort()).toEqual(["drive", "gmail"]);
    expect(by("fast:combined").answers.map(a => a.question)).toEqual(["combined"]);
    expect(by("agent:combined").calls.map(c => c.purpose).sort()).toEqual(["judge", "plan", "reading:combined"]);
    // discover: an inventory (4 Sent searches, 3 Drive listings by type), then the one search it chose
    expect(by("discover:combined").requests.gmail_search).toBe(5);
    expect(by("discover:combined").requests.drive_search).toBe(3);
    expect(by("discover:combined").discovery?.undertakings[0].name).toBe("Acme Laundry");
    expect(by("discover:combined").calls.map(c => c.purpose).sort()).toEqual(["discover", "judge", "reading:combined"]);
    // the thinking level reaches Gemini
    const geminiBodies = fake.mock.calls.filter(([input]) => String(input).includes("generativelanguage")).map(([, init]) => JSON.parse(String(init?.body)));
    expect(geminiBodies.some(b => b.generationConfig.thinkingConfig?.thinkingLevel === "low")).toBe(true);

    for (const run of result.runs) {
      expect(run.firstVerifiedMs).toBeGreaterThan(0);
      expect(run.allVerifiedMs).toBeGreaterThanOrEqual(run.firstVerifiedMs);
      expect(run.grading?.recall).toBe(1);
      expect(run.answers.flatMap(a => a.claims).some(c => c.verdict === "relationship")).toBe(true);
    }
    // Drive alone shows the owner working on something, never that it is operating; mail can
    const driveOnly = by("fast:separate").answers.find(a => a.question === "drive")!.claims[0];
    expect(driveOnly.verdict).toBe("in_progress");
    expect(by("fast:combined").answers[0].opening[0]).toMatchObject({ kept: true });

    const report = benchReport(result);
    expect(report).toMatch(/\[gmail message m1a, thread t-m1a\]\(https:\/\/mail\.google\.com\/mail\/u\/owner%40example\.com\/#all\/t-m1a\)/);
    expect(report).toMatch(/Your AI Overviews, finding by finding/);
    // nothing but reads and one token refresh went to Google
    for (const [input, init] of fake.mock.calls) {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("generativelanguage")) continue;
      expect((init?.method ?? "GET") === "GET" || requestKind(href) === "token").toBe(true);
    }
  });
});

describe("the reveal speaks as the established Claire", () => {
  it("takes her personality lock and core canon from the runtime compiler, not a separate persona", async () => {
    const { claireCharacterSection } = await import("./reveal");
    const { CLAIRE_PERSONALITY_LOCK } = await import("../../claire/character/personalityLock");
    const section = claireCharacterSection();
    expect(section).toContain(CLAIRE_PERSONALITY_LOCK);
    expect(section).toMatch(/Claire is British/);
    expect(section).toMatch(/field-intelligence \/ operations partner/);
    expect(section).not.toMatch(/\bassistant\b/i);
    // nothing tier-gated reaches a first meeting
    expect(section).not.toMatch(/father/i);
  });

  it("strikes lines that show the trick or turn her into a product, and leaves ordinary verbs alone", async () => {
    const { NOT_CLAIRE, TRICK } = await import("./reveal");
    expect(TRICK.test("I read your emails last night")).toBe(true);
    expect(TRICK.test("Those reposts about seed rounds say plenty")).toBe(true);
    expect(TRICK.test("You'll drive Bellaire harder than Westheimer")).toBe(false);
    expect(TRICK.test("Luis takes the foreman post in March")).toBe(false);
    expect(TRICK.test("I saw your inbox")).toBe(true);
    expect(TRICK.test("twenty-one, as of October")).toBe(false);
    expect(NOT_CLAIRE.test("I'm Claire, your assistant")).toBe(true);
    expect(NOT_CLAIRE.test("an assistant who already understands the business")).toBe(true);
    expect(NOT_CLAIRE.test("I think I found it.")).toBe(false);
  });
});

describe("money, debt and personal claims never go beyond the source", () => {
  const gemini = (reply: unknown) => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 }));
    return { apiKey: "k", model: "m", fetch: fetch as unknown as typeof globalThis.fetch };
  };
  const margin: Evidence = { id: "d7", source: "drive", at: new Date("2026-10-29"), dated: "modified", byOwner: true, title: "Weekly numbers", people: "owned by owner", text: "Fluff and fold brought in $2,000; it covers my payroll but not gas or processing.", ref: "d7", url: null };
  const significance = {
    objectives: [{ statement: "Grow Acme Laundry to 50 customers", level: "intermediate" as const, basis: "stated" as const, evidence: ["d7"], confidence: "strong" as const, caveat: "fuel and processing are unpaid" }],
    activities: [],
    relationships: [{ from: "Acme Laundry", to: "Moonlight", relation: "test bed", basis: "verified" as const, evidence: ["d7"], caveat: "" }],
    keyResult: { result: "Customers toward 50", why: "volume", lastKnownValue: "21", asOf: "2026-10-29", basis: "stated" as const, evidence: ["d7"] },
    thread: { statement: "", provesTo: "", basis: "inferred" as const, evidence: [] },
    businessIsTheEnd: false,
    unknowns: [],
  };

  it("strikes a sensitive word the source never uses, and leaves ordinary words alone", async () => {
    const { unbackedSensitive } = await import("./reveal");
    expect(unbackedSensitive("covering wages while fuel and processing remain unpaid", margin.text)).toEqual(["unpaid"]);
    expect(unbackedSensitive("We should look at what broke the intake rhythm", margin.text)).toEqual([]);
    expect(unbackedSensitive("Twenty-one customers, as of October", margin.text)).toEqual([]);
    expect(unbackedSensitive("She owes the commissary", "I owe the commissary for October")).toEqual([]);
    expect(unbackedSensitive("He's losing money on the shop", "the shop runs near break-even")).toEqual(["losing money"]);
  });

  it("checks conclusions against the source excerpts and makes an escalation unsayable", async () => {
    const { groundSignificance, sourceText } = await import("./significance");
    expect(sourceText(["d7"], { claims: [], publicFindings: [], evidence: [margin] })).toMatch(/covers my payroll but not gas/);
    const grounded = await groundSignificance(
      gemini({ items: [
        { id: "O0", supported: "yes", statedOutright: "yes", escalates: "yes", why: "the source says not covered, not unpaid" },
        { id: "R0", supported: "partly", statedOutright: "no", escalates: "no", why: "read across items" },
        { id: "K", supported: "yes", statedOutright: "yes", escalates: "no", why: "" },
      ] }),
      significance,
      { claims: [], publicFindings: [], evidence: [margin] }
    );
    expect(grounded.grounding.O0).toMatchObject({ ok: false });
    expect(grounded.significance.objectives[0].confidence).toBe("weak");
    expect(grounded.significance.relationships[0].basis).toBe("inferred");
    expect(grounded.grounding.K.ok).toBe(true);
  });

  it("fails closed: if the source check fails, nothing from the significance model is sayable", async () => {
    const { groundSignificance } = await import("./significance");
    const failing = vi.fn(async () => new Response("overloaded", { status: 503 }));
    const grounded = await groundSignificance({ apiKey: "k", model: "m", fetch: failing as unknown as typeof fetch }, significance, { claims: [], publicFindings: [], evidence: [margin] });
    expect(Object.values(grounded.grounding).every(g => !g.ok)).toBe(true);
    expect(grounded.significance.relationships[0].basis).toBe("none_found");
  });
});

describe("the sensitive guard is about people, not business vocabulary", () => {
  it("lets 'diagnose a bottleneck' through and still stops a medical claim", async () => {
    const { unbackedSensitive } = await import("./significance");
    expect(unbackedSensitive("show investors the software can diagnose a real business bottleneck", "Claire investigates concrete problems")).toEqual([]);
    expect(unbackedSensitive("She was diagnosed with something in March", "March schedule")).toEqual(["diagnosed with"]);
  });
});
