
import { describe, expect, it, vi } from "vitest";
import { GitHubProducerBus } from "./githubProducerBus";
import { handbackMarker } from "../../shared/mitchProducerBus";

describe("GitHubProducerBus", () => {
  it("parses a structured Claude handback from the canonical issue thread", async () => {
    const workOrderId = "11111111-1111-4111-8111-111111111111";
    const marker = handbackMarker(workOrderId);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            id: 42,
            html_url: "https://github.com/example/repo/issues/1#issuecomment-42",
            created_at: "2026-10-04T16:00:00Z",
            body: [
              "## CLAUDE → MITCH",
              "<!-- " + marker + " -->",
              "~~~json",
              JSON.stringify({
                branch: "feat/test",
                commitSha: "abcdef1234567890",
                whatChanged: "The proprietor can walk the shelf.",
                testsActuallyRun: ["pnpm vitest run proprietor.test.ts"],
                testsNotRun: [],
                previewLaunchInstructions: "Open /?spike=1",
                evidence: { captures: ["capture.png"] },
                knownLimitations: "No phone pass yet"
              }),
              "~~~"
            ].join("\n")
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const bus = new GitHubProducerBus({
      token: "test-token",
      repoFullName: "example/repo",
      issueNumber: 1,
    });

    const result = await bus.waitForHandback({
      workOrderId,
      pollMs: 1,
      timeoutMs: 50,
    });

    expect(result.payload.branch).toBe("feat/test");
    expect(result.payload.commitSha).toBe("abcdef1234567890");
    expect(result.payload.exactBuildId).toBeUndefined();
    expect(result.comment.id).toBe(42);

    vi.unstubAllGlobals();
  });

  it("checks the real GitHub branch ref against the exact returned SHA", async () => {
    const sha = "a".repeat(40);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ object: { type: "commit", sha } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const bus = new GitHubProducerBus({ token: "test", repoFullName: "owner/repo", issueNumber: 370 });
      await bus.verifyImplementationIdentity("codex/proof", sha);
      expect(fetchMock.mock.calls[0][0]).toContain("/git/ref/heads/codex/proof");
      await expect(bus.verifyImplementationIdentity("codex/proof", "b".repeat(40))).rejects.toThrow("exact returned commit");
    } finally { vi.unstubAllGlobals(); }
  });

  it("fails closed without producer-bus credentials", () => {
    expect(
      () =>
        new GitHubProducerBus({
          token: "",
          repoFullName: "example/repo",
          issueNumber: 1,
        })
    ).toThrow(/MITCH_GITHUB_TOKEN/);
  });
});
