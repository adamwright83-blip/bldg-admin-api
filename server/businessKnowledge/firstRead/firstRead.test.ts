import { describe, expect, it, vi } from "vitest";
import { scoreExpectations, verifyReading, type Evidence, type Reading } from "./synthesis";
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
    const fromText = hitsOf({ content: [{ type: "text", text: JSON.stringify({ items }) }] });
    expect(fromStructured).toEqual(fromText);
    expect(fromStructured.map(hit => hit.corpus)).toEqual(["gmail", "drive", "calendar"]);
    expect(fromStructured[0]).toMatchObject({ title: "Proposal", detail: "me@x.com → dana@y.com", url: "https://mail/1" });
  });

  it("reports a refusal as a result, with Google's message", async () => {
    const refused = vi.fn(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: "API not enabled" }] } }), { status: 403 })
    );
    const search = await searchCorpus({ accessToken: "t", query: "q" }, { fetch: refused as unknown as typeof fetch });
    expect(search).toMatchObject({ ok: false, status: 403, error: "API not enabled", hits: [] });
  });
});

describe("verifyReading", () => {
  const today = new Date("2026-10-31T00:00:00Z");
  const evidence: Evidence[] = [
    { id: "g1", source: "gmail", at: new Date("2026-10-20T00:00:00Z"), title: "Proposal", people: "", text: "" },
    { id: "g2", source: "gmail", at: new Date("2024-03-01T00:00:00Z"), title: "Old site", people: "", text: "" },
    { id: "m1", source: "gmail", at: null, title: "Undated", people: "", text: "" },
  ];
  const reading: Reading = {
    priorities: [
      { title: "Premium accounts", aim: "build", status: "current", summary: "", people: [], evidence: ["g1"] },
      { title: "Web work", aim: "build", status: "current", summary: "", people: [], evidence: ["g2"] },
      { title: "Search-only", aim: "change", status: "current", summary: "", people: [], evidence: ["m1"] },
      { title: "Invented", aim: "protect", status: "current", summary: "", people: [], evidence: ["g9"] },
    ],
    olderAmbitions: [],
    people: [{ name: "Ghost", role: "", evidence: [] }],
    unsure: [],
  };

  it("strikes uncited claims and checks every 'current' against its evidence's dates", () => {
    const verified = verifyReading(reading, evidence, today);
    expect(verified.reading.priorities.map(p => p.title)).toEqual(["Premium accounts", "Web work", "Search-only"]);
    expect(verified.struck).toEqual(["Invented", "Ghost"]);
    expect(verified.staleCurrent).toEqual(["Web work"]);
    expect(verified.undatedCurrent).toEqual(["Search-only"]);
    expect(verified.citations).toEqual({ total: 4, valid: 3 });
  });

  it("scores private expectations by name and alias", () => {
    const score = scoreExpectations([verifyReading(reading, evidence, today).reading], { mention: ["premium accounts|Premium", "Nobody"], notCurrent: ["Web work"] });
    expect(score).toEqual({ found: ["premium accounts|Premium"], missed: ["Nobody"], wronglyCurrent: ["Web work"] });
  });
});
