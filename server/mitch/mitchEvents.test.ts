import { GitHubProducerExecutionProvider } from "./githubProducerExecutionProvider";
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { MitchProductionStore } from "./mitchStore";
import { MitchProductionService } from "./mitchService";
import {
  MitchGameDispatcher,
  MissingExecutionProviderError,
} from "./mitchDispatcher";
import { MitchQaService } from "./mitchQaService";
import { MitchProductionReasoningService } from "./mitchReasoningService";
import { MitchProducerCoordinator } from "./mitchProducerCoordinator";
import { MemoryMitchEventInbox } from "./mitchEventInbox";
import { MitchEventService } from "./mitchEventService";
import {
  createMitchEventIngress,
  validGithubSignature,
} from "./mitchEventIngress";
import {
  mitchEventSchema,
  parseMitchComment,
  type MitchEvent,
} from "../../shared/mitchEvents";
import type { GitHubProducerBus } from "./githubProducerBus";
const sha = "a".repeat(40),
  fixSha = "b".repeat(40);
const servers: http.Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>(resolve => server.close(() => resolve()));
});
async function fixture(provider = true, reviewerId = "chatgpt_design_review") {
  const store = new MitchProductionStore(true),
    service = new MitchProductionService(store),
    dispatcher = new MitchGameDispatcher(store);
  const comments: string[] = [];
  const wakes: any[] = [];
  const wakeProvider = {
    hasTarget: (actorId: string) => ["executor", reviewerId].includes(actorId),
    wake: async (input: any) => { wakes.push(input); },
  };
  const bus = {
    hasMarker: async (marker: string) => comments.some(c => c.includes(marker)),
    postComment: async (body: string) => {
      comments.push(body);
      return { html_url: "https://example.test/review" };
    },
    listComments: async () => [],
    readDesignReview: async () => {
      throw new Error("Normal path must not poll review comments");
    },
  };
  if (provider)
    dispatcher.registerExecutionProvider(
      new GitHubProducerExecutionProvider(bus as unknown as GitHubProducerBus, {
        id: "executor",
        name: "executor",
        leaseMs: 3600000,
        wakeProvider,
      })
    );
  const coordinator = new MitchProducerCoordinator({
    tenantId: "test",
    store,
    service,
    dispatcher,
    qa: new MitchQaService(store),
    reasoning: new MitchProductionReasoningService(store),
    bus: bus as unknown as GitHubProducerBus,
    wakeProvider,
    reviewerId,
    eventDriven: true,
  });
  const inbox = new MemoryMitchEventInbox();
  const events = new MitchEventService({
    tenantId: "test",
    gameId: "game.small_comforts",
    humanActorId: "adam",
    store,
    service,
    dispatcher,
    coordinator,
    inbox,
  });
  if (provider) await coordinator.advance();
  const order = (await store.listWorkOrders("test", "game.small_comforts"))[0];
  const implementation = (commit = sha, workOrder = order): MitchEvent =>
    mitchEventSchema.parse({
      eventId: randomUUID(),
      type: "implementation_handback",
      tenantId: "test",
      gameId: "game.small_comforts",
      milestoneId: workOrder.milestoneId,
      workOrderId: workOrder.id,
      actorId: "executor",
      handback: {
        branch: "proof",
        commitSha: commit,
        exactBuildId: commit,
        whatChanged: "Physical angle controls reflect light",
        testsActuallyRun: ["vitest: passed"],
        previewLaunchInstructions: "Open proof",
        evidence: {
          captures: ["capture"],
          sourceCompiled: true,
          unitTestsPassed: true,
          buildCommitSha: commit,
        },
      },
    });
  const review = (
    verdict: string,
    commit = sha,
    workOrder = order
  ): MitchEvent =>
    mitchEventSchema.parse({
      eventId: randomUUID(),
      type: "design_review_handback",
      tenantId: "test",
      gameId: "game.small_comforts",
      milestoneId: workOrder.milestoneId,
      workOrderId: workOrder.id,
      actorId: reviewerId,
      branch: "proof",
      commitSha: commit,
      buildId: commit,
      review: {
        verdict,
        observedBehavior: "Reflection alignment result",
        evidenceArtifact: "capture",
        recommendedNextProof: "One alignment fix",
        gameActuallyExercised: verdict === "no_blocking_issue",
        acceptancePassed: verdict === "no_blocking_issue",
      },
    });
  return {
    store,
    service,
    dispatcher,
    coordinator,
    events,
    inbox,
    order,
    comments,
    wakes,
    wakeProvider,
    reviewerId,
    implementation,
    review,
  };
}
async function ingress(f: Awaited<ReturnType<typeof fixture>>) {
  const app = createMitchEventIngress({
    events: f.events,
    repoFullName: "owner/repo",
    issueNumber: 370,
    webhookSecret: "secret",
    githubActorRules: [
      { login: "worker", appSlug: "claude", actorIds: ["executor"] },
      { login: "worker", appSlug: "chatgpt-codex-connector", actorIds: [f.reviewerId] },
      { login: "adam", actorIds: ["adam"] },
    ],
    callbackActorTokens: {
      executor: "exec-callback",
      [f.reviewerId]: "review-callback",
    },
  });
  const server = http.createServer(app);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const webhook = async (
    event: MitchEvent,
    delivery = randomUUID(),
    bodyOverride?: string,
    author = "worker",
    appSlug: string | null =
      event.actorId === "executor"
        ? "claude"
        : event.actorId === f.reviewerId
          ? "chatgpt-codex-connector"
          : null
  ) => {
    const body = JSON.stringify({
      action: "created",
      repository: { full_name: "owner/repo" },
      issue: { number: 370 },
      comment: {
        id: 12,
        user: { login: author },
        performed_via_github_app: appSlug
          ? { id: appSlug === "claude" ? 1236702 : 1144995, slug: appSlug }
          : null,
        body:
          bodyOverride ??
          "## CODEX → MITCH\n<!-- mitch-event:v1 -->\n```json\n" +
            JSON.stringify(event) +
            "\n```",
      },
    });
    return fetch(url + "/webhooks/github", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "issue_comment",
        "x-github-delivery": delivery,
        "x-hub-signature-256":
          "sha256=" + createHmac("sha256", "secret").update(body).digest("hex"),
      },
      body,
    });
  };
  return { url, webhook };
}
describe("Mitch event-driven producer", () => {
  it("wakes from signed handback immediately and dedupes concurrent delivery and event retry", async () => {
    const f = await fixture(),
      { webhook } = await ingress(f),
      event = f.implementation(),
      delivery = randomUUID();
    const responses = await Promise.all([
      webhook(event, delivery),
      webhook(event, delivery),
      webhook(event),
    ]);
    expect(responses.map(r => r.status)).toEqual([202, 202, 202]);
    expect(
      await f.store.listBuilds("test", "game.small_comforts")
    ).toHaveLength(1);
    expect(
      f.comments.filter(c =>
        c.includes("Independent design/QA review requested")
      )
    ).toHaveLength(1);
    expect(
      (await f.store.getProductionState("test", "game.small_comforts"))
        ?.lastVerifiedBuildId
    ).toBeNull();
    expect(
      f.comments.some(c =>
        c.includes("Your final action is to return a structured handback")
      )
    ).toBe(true);
    expect(f.wakes.some(w => w.actorId === "executor" && w.kind === "implementation_request")).toBe(true);
    expect(f.wakes.some(w => w.actorId === "chatgpt_design_review" && w.kind === "design_review_request")).toBe(true);
  });
  it("rejects malformed prose, wrong authors, invalid signatures and unauthorized callbacks", async () => {
    const f = await fixture(),
      { webhook, url } = await ingress(f);
    expect(
      (
        await webhook(
          f.implementation(),
          randomUUID(),
          "Claude finished; everything passed"
        )
      ).status
    ).toBe(422);
    expect(
      (await webhook(f.implementation(), randomUUID(), undefined, "stranger"))
        .status
    ).toBe(403);
    expect(
      (
        await fetch(url + "/webhooks/github", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status
    ).toBe(401);
    expect(
      (
        await fetch(url + "/callbacks/mitch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(f.implementation()),
        })
      ).status
    ).toBe(403);
    expect(
      await f.store.listBuilds("test", "game.small_comforts")
    ).toHaveLength(0);
    expect(() => parseMitchComment("## CLAUDE → MITCH\nFinished")).toThrow();
  });
  it("binds GitHub authority to the actual integration and callback token to one actor", async () => {
    const f = await fixture(),
      { webhook, url } = await ingress(f);

    expect(
      (await webhook(f.implementation(), randomUUID(), undefined, "worker", "chatgpt-codex-connector")).status
    ).toBe(403);

    expect(
      (
        await fetch(url + "/callbacks/mitch", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer exec-callback",
          },
          body: JSON.stringify(f.review("fix_needed")),
        })
      ).status
    ).toBe(403);
  });

  it("rejects wrong work order, tenant, milestone, mismatched SHA and stale review builds", async () => {
    for (const patch of [
      { workOrderId: randomUUID() },
      { tenantId: "other" },
      { milestoneId: randomUUID() },
    ]) {
      const f = await fixture();
      await expect(
        f.events.receive({ ...f.implementation(), ...patch })
      ).rejects.toThrow();
      expect(
        await f.store.listBuilds("test", "game.small_comforts")
      ).toHaveLength(0);
    }
    const f = await fixture(),
      event = f.implementation();
    if (event.type !== "implementation_handback") throw new Error();
    event.handback.exactBuildId = fixSha;
    await expect(f.events.receive(event)).rejects.toThrow("SHA");
    await f.events.receive(f.implementation());
    await expect(
      f.events.receive(f.review("no_blocking_issue", fixSha))
    ).rejects.toThrow("identity");
  });
  it("review failure immediately creates and dispatches bounded fix, whose independent retest closes the issue", async () => {
    const f = await fixture();
    await f.events.receive(f.implementation());
    await f.events.receive(f.review("fix_needed"));
    const orders = await f.store.listWorkOrders("test", "game.small_comforts");
    const fix = orders.find(o => o.id !== f.order.id)!;
    expect(fix.status).toBe("claimed");
    expect(fix.baseSha).toBe(sha);
    const issue = (await f.store.listIssues("test", "game.small_comforts"))[0];
    expect(issue.fixWorkOrderId).toBe(fix.id);
    expect(issue.status).toBe("open");
    await f.events.receive(f.implementation(fixSha, fix));
    expect((await f.store.getIssue("test", issue.id))?.status).toBe(
      "fix_submitted"
    );
    await f.events.receive(f.review("no_blocking_issue", fixSha, fix));
    expect((await f.store.getIssue("test", issue.id))?.status).toBe("closed");
    const state = await f.store.getProductionState(
      "test",
      "game.small_comforts"
    );
    expect(state?.lastVerifiedBuildId).toBe(fixSha);
    expect(state?.creativeAcceptanceState).toBe("pending");
    expect(state?.releaseState).toBe("unreleased");
  });
  it("cannot verify a build when required compile or test evidence is missing", async () => {
    const compiled = await fixture();
    const compiledEvent = compiled.implementation();
    if (compiledEvent.type !== "implementation_handback") throw new Error();
    compiledEvent.handback.evidence.sourceCompiled = false;
    await compiled.events.receive(compiledEvent);
    await expect(compiled.events.receive(compiled.review("no_blocking_issue"))).rejects.toThrow("compiled");
    expect(
      (await compiled.store.getProductionState("test", "game.small_comforts"))?.lastVerifiedBuildId
    ).toBeNull();

    const tested = await fixture();
    const testedEvent = tested.implementation();
    if (testedEvent.type !== "implementation_handback") throw new Error();
    testedEvent.handback.evidence.unitTestsPassed = false;
    await tested.events.receive(testedEvent);
    await expect(tested.events.receive(tested.review("no_blocking_issue"))).rejects.toThrow("tests");
    expect(
      (await tested.store.getProductionState("test", "game.small_comforts"))?.lastVerifiedBuildId
    ).toBeNull();
  });

  it("creative uncertainty becomes a durable human blocker and prevents further dispatch", async () => {
    const f = await fixture();
    await f.events.receive(f.implementation());
    await f.events.receive(f.review("human_play_required"));
    await f.coordinator.advance();
    const milestone = await f.store.getMilestone(
      "test",
      "game.small_comforts",
      f.order.milestoneKey
    );
    expect(milestone?.isHumanCreativeBlocker).toBe(true);
    expect(milestone?.blockedReason).toBe("HUMAN CREATIVE DECISION REQUIRED");
    expect(
      await f.store.listWorkOrders("test", "game.small_comforts")
    ).toHaveLength(1);
  });
  it("an authorized human can resolve a blocker and immediately request a fresh independent review", async () => {
    const f = await fixture();
    await f.events.receive(f.implementation());
    await f.events.receive(f.review("human_play_required"));
    await f.events.receive({
      eventId: randomUUID(),
      type: "human_decision",
      tenantId: "test",
      gameId: "game.small_comforts",
      milestoneId: f.order.milestoneId,
      workOrderId: f.order.id,
      actorId: "adam",
      buildId: sha,
      branch: "proof",
      commitSha: sha,
      decision: "resolve_blocker",
      note: "Proceed with independent hands-on review",
    });
    expect(
      f.comments.filter(c =>
        c.includes("Independent design/QA review requested")
      )
    ).toHaveLength(2);
    await f.events.receive(f.review("no_blocking_issue"));
    expect(
      (await f.store.getProductionState("test", "game.small_comforts"))
        ?.lastVerifiedBuildId
    ).toBe(sha);
  });
  it("agent failure wakes retry dispatch, while a missing provider remains fail closed", async () => {
    const f = await fixture();
    const impl = f.implementation();
    await f.events.receive({
      eventId: randomUUID(),
      type: "agent_failed",
      tenantId: impl.tenantId,
      gameId: impl.gameId,
      milestoneId: impl.milestoneId,
      workOrderId: impl.workOrderId,
      actorId: "executor",
      error: "Build failed",
    });
    expect(
      (await f.store.listWorkOrders("test", "game.small_comforts")).some(
        o => o.id !== f.order.id && o.status === "claimed"
      )
    ).toBe(true);
    const missing = await fixture(false);
    await expect(missing.coordinator.advance()).rejects.toBeInstanceOf(
      MissingExecutionProviderError
    );
  });
  it("accepts direct callback and reserves human creative authority for the allowed GitHub author", async () => {
    const f = await fixture(),
      { url, webhook } = await ingress(f);
    expect(
      (
        await fetch(url + "/callbacks/mitch", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer exec-callback",
          },
          body: JSON.stringify(f.implementation()),
        })
      ).status
    ).toBe(202);
    await f.events.receive(f.review("no_blocking_issue"));
    const decision = mitchEventSchema.parse({
      eventId: randomUUID(),
      type: "human_decision",
      tenantId: "test",
      gameId: "game.small_comforts",
      milestoneId: f.order.milestoneId,
      workOrderId: f.order.id,
      actorId: "adam",
      buildId: sha,
      branch: "proof",
      commitSha: sha,
      decision: "accept",
      note: "I played and accept this proof",
    });
    expect(
      (await webhook(decision, randomUUID(), undefined, "worker")).status
    ).toBe(403);
    expect(
      (await webhook(decision, randomUUID(), undefined, "adam")).status
    ).toBe(202);
    expect(
      (await f.store.getProductionState("test", "game.small_comforts"))
        ?.creativeAcceptanceState
    ).toBe("accepted");
  });
  it("rejects reused event and delivery IDs with changed identity", async () => {
    const f = await fixture(),
      event = f.implementation();
    await f.events.receive(event, "delivery");
    await expect(
      f.events.receive({ ...event, actorId: "other" })
    ).rejects.toThrow("different payload");
    await expect(
      f.events.receive({ ...event, eventId: randomUUID() }, "delivery")
    ).rejects.toThrow("different event");
  });
  it("persists the authenticated reviewer identity instead of rewriting provenance", async () => {
    const f = await fixture(true, "alternate_reviewer");
    await f.events.receive(f.implementation());
    await f.events.receive(f.review("no_blocking_issue"));
    const qaRuns = await f.store.listQaRuns("test", "game.small_comforts");
    expect(qaRuns.at(-1)?.testerId).toBe("alternate_reviewer");
  });

  it("supports a structured QA handback for the assigned exact build", async () => {
    const f = await fixture();
    await f.events.receive(f.implementation());
    await f.events.receive({
      ...f.review("no_blocking_issue"),
      type: "qa_handback",
    });
    expect(
      (await f.store.getProductionState("test", "game.small_comforts"))
        ?.lastVerifiedBuildId
    ).toBe(sha);
  });
  it("the real GitHub dispatch provider returns immediately with the mandatory callback brief", async () => {
    const f = await fixture();
    const comments: string[] = [];
    const bus = {
      hasMarker: async () => false,
      postComment: async (body: string) => {
        comments.push(body);
        return { html_url: "https://example.test/work-order" };
      },
      waitForHandback: async () => {
        throw new Error("Dispatch must not wait for polling");
      },
    };
    const wakes: any[] = [];
    const provider = new GitHubProducerExecutionProvider(
      bus as unknown as GitHubProducerBus,
      {
        id: "executor",
        wakeProvider: {
          hasTarget: actorId => actorId === "executor",
          wake: async input => { wakes.push(input); },
        },
      }
    );
    await provider.dispatchWorkOrder(f.order);
    expect(comments).toHaveLength(1);
    expect(comments[0]).toContain(
      "Your final action is to return a structured handback to Mitch"
    );
    expect(comments[0]).toContain('"type": "implementation_handback"');
    expect(comments[0]).toContain(f.order.milestoneId);
    expect(comments[0]).toContain(f.order.id);
    expect(wakes).toHaveLength(1);
    expect(wakes[0]).toMatchObject({
      actorId: "executor",
      kind: "implementation_request",
      workOrderId: f.order.id,
    });
  });
  it("matches GitHub's official signature test vector", () => {
    expect(
      validGithubSignature(
        Buffer.from("Hello, World!"),
        "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
        "It's a Secret to Everybody"
      )
    ).toBe(true);
  });
});
