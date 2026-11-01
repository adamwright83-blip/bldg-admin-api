import { describe, expect, it, vi } from "vitest";
import { benchReport, PLAN_SYSTEM, requestKind, runFirstReadBench } from "./bench";
import { applyJudge, checkReading, judgeClaims, JUDGE_SYSTEM, quoteIsIn, READING_SYSTEM, scoreExpectations, type Evidence, type Reading } from "./synthesis";
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
});

describe("search_corpus results", () => {
  const items = [
    { gmailResult: { thread: { threadId: "t1", messages: [{ subject: "Proposal", snippet: "Here is the proposal", sender: "me@x.com", recipients: ["dana@y.com"], viewUrl: "https://mail/1" }] } } },
    { driveResult: { title: "Plan", contentSnippet: "the plan", mimeType: "application/vnd.google-apps.document", viewUrl: "https://drive/1" } },
    { calendarResult: { title: "Walkthrough", start: { dateTime: "2026-10-01T10:00:00Z" } } },
  ];

  it("reads structured content and JSON text alike", () => {
    const fromStructured = hitsOf({ structuredContent: { items } });
    expect(fromStructured).toEqual(hitsOf({ content: [{ type: "text", text: JSON.stringify({ items }) }] }));
    expect(fromStructured.map(hit => hit.corpus)).toEqual(["gmail", "drive", "calendar"]);
  });

  it("reports a refusal as a result, with Google's message", async () => {
    const refused = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "API not enabled" }] } }), { status: 403 }));
    const search = await searchCorpus({ accessToken: "t", query: "q" }, { fetch: refused as unknown as typeof fetch });
    expect(search).toMatchObject({ ok: false, status: 403, error: "API not enabled", hits: [] });
  });
});

// ------------------------------------------------------------------ claims

const today = new Date("2026-10-31T00:00:00Z");
const item = (id: string, source: Evidence["source"], at: string | null, dated: Evidence["dated"], byOwner: boolean | null, title: string, text: string, people = ""): Evidence => ({
  id,
  source,
  at: at ? new Date(at) : null,
  dated,
  byOwner,
  title,
  people,
  text,
  ref: `${source} ${id}-original`,
  url: `https://example.com/${id}`,
});
const evidence: Evidence[] = [
  item("g1", "gmail", "2026-10-20T00:00:00Z", "activity", true, "Proposal for The Louise", "Attached is our premium residential laundry proposal for your residents.", "dana@y.com"),
  item("g2", "gmail", "2024-03-01T00:00:00Z", "activity", true, "Website quote", "Here is my quote to redesign your restaurant website."),
  item("d1", "drive", "2026-10-25T00:00:00Z", "modified", false, "Shared deck", "A deck someone shared about a product launch plan."),
  item("m1", "gmail", null, null, null, "Undated", "We are expanding the agentic software business this quarter."),
  item("d2", "drive", "2026-10-29T00:00:00Z", "modified", true, "Old venture plan", "The plan for our mobile car wash business in Pasadena."),
];
const cite = (id: string, quote: string) => ({ id, quote });
const reading: Reading = {
  priorities: [
    { title: "Premium residential accounts", aim: "build", status: "current", summary: "Selling premium laundry to buildings", people: ["Dana"], evidence: [cite("g1", "premium residential laundry proposal")] },
    { title: "Web design", aim: "build", status: "current", summary: "Website work", people: [], evidence: [cite("g2", "quote to redesign your restaurant website")] },
    { title: "Agentic software", aim: "build", status: "current", summary: "Software", people: [], evidence: [cite("m1", "expanding the agentic software business")] },
    { title: "Shared launch", aim: "change", status: "current", summary: "Launch", people: [], evidence: [cite("d1", "a product launch plan")] },
    { title: "Paraphrased", aim: "protect", status: "current", summary: "", people: [], evidence: [cite("g1", "the building signed a two year contract")] },
    { title: "Invented", aim: "protect", status: "current", summary: "", people: [], evidence: [cite("g9", "anything at all here")] },
    { title: "Car wash", aim: "build", status: "current", summary: "Edited last week", people: [], evidence: [cite("d2", "mobile car wash business in Pasadena")] },
  ],
  olderAmbitions: [{ title: "Louise", summary: "old", evidence: [cite("g1", "Proposal for The Louise")] }],
  people: [{ name: "Dana", role: "The Louise contact", evidence: [cite("g1", "Proposal for The Louise")] }],
  unsure: [],
};

describe("checkReading", () => {
  const claims = checkReading(reading, evidence, today);
  const verdict = (label: string, kind = "priority") => claims.find(c => c.label === label && c.kind === kind)?.verdict;

  it("establishes current only on the owner's own recent act, with a real quote", () => {
    expect(verdict("Premium residential accounts")).toBe("established_current");
  });

  it("never lets a stale, undated, or someone-else's item stand as current", () => {
    expect(verdict("Web design")).toBe("supported_past");
    expect(claims.find(c => c.label === "Web design")!.reasons[0]).toMatch(/latest support is 2024-03-01/);
    expect(verdict("Agentic software")).toBe("uncertain");
    expect(verdict("Shared launch")).toBe("uncertain");
  });

  it("never treats a recent edit to a file as proof its work is active", () => {
    expect(verdict("Car wash")).toBe("uncertain");
    expect(claims.find(c => c.label === "Car wash")!.reasons[0]).toMatch(/file edits/);
  });

  it("keeps the original source of every citation", () => {
    expect(claims.find(c => c.label === "Premium residential accounts")!.citations[0]).toMatchObject({ ref: "gmail g1-original", url: "https://example.com/g1", activity: true });
  });

  it("strikes quotes that aren't in the evidence and ids that don't exist", () => {
    expect(verdict("Paraphrased")).toBe("unsupported");
    expect(verdict("Invented")).toBe("unsupported");
  });

  it("doesn't let a recent own act be filed away as past", () => {
    expect(verdict("Louise", "older")).toBe("uncertain");
    expect(verdict("Dana", "person")).toBe("supported");
  });

  it("refuses quotes too short to prove anything", () => {
    expect(quoteIsIn("Louise", evidence[0])).toBe(false);
    expect(quoteIsIn("PROPOSAL for the   Louise!", evidence[0])).toBe(true);
  });

  it("lets the judge lower a verdict, never raise one", () => {
    const judged = applyJudge(claims, [
      { n: 0, supports: "yes", presentActivity: "unknown", contradiction: "" },
      { n: 1, supports: "yes", presentActivity: "yes", contradiction: "" },
      { n: 2, supports: "no", presentActivity: "no", contradiction: "" },
      { n: 3, supports: "yes", presentActivity: "yes", contradiction: "the launch was cancelled" },
    ]);
    expect(judged.slice(0, 4).map(c => c.verdict)).toEqual(["uncertain", "supported_past", "unsupported", "contradicted"]);
    expect(judged[1].reasons.join(" ")).not.toMatch(/not verified/);
  });

  it("fails closed: a failed judge, or a claim it skipped, establishes nothing", async () => {
    const failing = vi.fn(async () => new Response("overloaded", { status: 503 }));
    const failed = await judgeClaims({ apiKey: "k", model: "m", fetch: failing as unknown as typeof fetch }, claims, evidence, today);
    expect(failed.call?.error).toMatch(/503/);
    expect(failed.claims.some(c => c.verdict === "established_current")).toBe(false);
    expect(failed.claims.find(c => c.label === "Premium residential accounts")!.reasons.at(-1)).toMatch(/not verified: the judge failed/);
    // the judge answered, but said nothing about claim 0
    const skipped = applyJudge(claims, [{ n: 1, supports: "yes", presentActivity: "yes", contradiction: "" }]);
    expect(skipped[0].verdict).toBe("uncertain");
    expect(skipped[0].reasons.at(-1)).toMatch(/gave no verdict/);
  });

  it("reports unconfirmed guesses apart, never as ground truth", () => {
    const score = scoreExpectations(claims, { unconfirmed: [{ name: "Web design", guess: "past" }] });
    expect(score.unconfirmed).toEqual([{ name: "Web design", guess: "past", found: true, calledCurrent: false }]);
    expect(score.pastFound).toEqual([]);
  });

  it("scores the owner's AI Overview results by status", () => {
    const score = scoreExpectations(claims, { current: ["Premium residential", "Agentic software", "Nothing"], past: ["Web design"], people: ["Dana", "Russell"] });
    expect(score.currentFound).toEqual(["Premium residential"]);
    expect(score.currentWrongStatus).toEqual(["Agentic software"]);
    expect(score.currentMissed).toEqual(["Nothing"]);
    expect(score.pastFound).toEqual(["Web design"]);
    expect(score.pastWronglyCurrent).toEqual([]);
    expect(score.peopleMissed).toEqual(["Russell"]);
  });
});

// ------------------------------------------------------------------ the benchmark, against a fake Google

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
        { name: "To", value: "Dana <dana@thelouise.example>" },
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
      const body = JSON.parse(String(init?.body)) as { systemInstruction: { parts: Array<{ text: string }> } };
      const system = body.systemInstruction.parts[0].text;
      const value =
        system === PLAN_SYSTEM
          ? { gmail: [{ query: "in:sent Louise", why: "the proposal" }], drive: [{ terms: ["Goldline"], why: "the product" }] }
          : system === JUDGE_SYSTEM
            ? { verdicts: [{ n: 0, supports: "yes", presentActivity: "yes", contradiction: "" }] }
            : system === READING_SYSTEM
              ? {
                  priorities: [{ title: "Premium residential accounts", aim: "build", status: "current", summary: "Selling to The Louise", people: ["Dana"], evidence: [{ id: JSON.stringify(body).includes("[d1]") ? "d1" : "g1", quote: "premium residential laundry proposal" }] }],
                  olderAmbitions: [],
                  people: [],
                  unsure: [],
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
    if (url.pathname.endsWith("/export")) return new Response("Goldline: premium residential laundry proposal plan.", { status: 200 });
    if (url.pathname.endsWith("/drive/v3/files")) {
      return json({ files: [{ id: "f1", name: "Goldline plan", mimeType: DOC, modifiedTime: now.toISOString(), webViewLink: "https://docs.example/f1", owners: [{ emailAddress: OWNER }], lastModifyingUser: { emailAddress: OWNER } }] });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("runFirstReadBench", () => {
  it("the fast strategy reads a small sample; the survey reads two years; the agent searches what Gemini chose", async () => {
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
      strategies: ["fast", "agent", "survey"],
      geminiKey: "key",
      model: "gemini-2.5-flash",
      centsPerMillion: { input: 30, output: 250 },
      expect: { current: ["Premium residential"] },
      fetch: fake as unknown as typeof fetch,
      env: { JOYSTICK_GOOGLE_CLIENT_ID: "id", JOYSTICK_GOOGLE_CLIENT_SECRET: "secret" } as NodeJS.ProcessEnv,
      now: () => now,
    });
    const [fast, agent, survey] = result.runs;

    // fast: one recent Sent search and three older samples, never the 24 monthly windows
    expect(fast.requests.gmail_search).toBe(4);
    expect(fast.requests.drive_search).toBe(1);
    // agent: the same four, plus the one Gmail search and one Drive search Gemini chose
    expect(agent.requests.gmail_search).toBe(5);
    expect(agent.requests.drive_search).toBe(2);
    expect(agent.plan?.gmail[0].query).toBe("in:sent Louise");
    expect(agent.calls.map(call => call.purpose).sort()).toEqual(["judge", "judge", "plan", "reading", "reading"]);
    // survey: one recent search and 24 monthly windows
    expect(survey.requests.gmail_search).toBe(25);
    expect(survey.requests.gmail_search! + (survey.requests.gmail_header ?? 0)).toBeGreaterThan(fast.requests.gmail_search! + (fast.requests.gmail_header ?? 0));

    for (const run of result.runs) {
      expect(run.firstResultMs).toBeGreaterThan(0);
      expect(run.claims.gmail[0].verdict).toBe("established_current");
      // Drive dates are edits, not activity: a Drive-only claim can't be established as current
      expect(run.claims.drive[0].verdict).toBe("uncertain");
      expect(run.expectations?.currentFound).toEqual(["Premium residential"]);
    }
    // the private report links every citation to its original message or file
    const report = benchReport(result);
    expect(report).toMatch(/\[gmail message m1a, thread t-m1a\]\(https:\/\/mail\.google\.com\/mail\/u\/owner%40example\.com\/#all\/t-m1a\)/);
    expect(report).toMatch(/\[drive file f1\]\(https:\/\/docs\.example\/f1\)/);
    // nothing but reads and one token refresh went to Google
    for (const [input, init] of fake.mock.calls) {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (href.includes("generativelanguage")) continue;
      expect((init?.method ?? "GET") === "GET" || requestKind(href) === "token").toBe(true);
    }
  });
});
