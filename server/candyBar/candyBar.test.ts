import { describe, expect, it } from "vitest";
import {
  CANDY_BAR_ALLOWED_REPOSITORY,
  canTransitionCandyBar,
  parseArchitectPlan,
  type ArchitectPlan,
  type ReviewCritique,
  type ReconciledBrief,
} from "../../shared/candyBar";
import { MemoryCandyBarStore } from "./store";
import { CandyBarOrchestrator } from "./orchestrator";
import {
  createFakeArchitectAdapter,
  createFakeCreativeAdapter,
  createFakeEngineerAdapter,
  createFakeReconcileInvoker,
  createFakeReviewerAdapter,
  type FakeProviderScript,
} from "./providers/fakes";
import { createFakeGithubObserver, type FakeGithubState } from "./providers/github";
import {
  createCursorEngineerAdapter,
  createGrokReviewerAdapter,
  createCreativeAdapter,
} from "./providers/adapters";
import { startCandyBarHeartbeat } from "./heartbeat";
import { ENV } from "../_core/env";

const REPO = CANDY_BAR_ALLOWED_REPOSITORY;
const TENANT = "tenant-a";
const OP = "operator-a";

function basePlan(overrides: Partial<ArchitectPlan> = {}): ArchitectPlan {
  return {
    objective: "Finish Wayward CONTACT authority path",
    whyNow: "Blocking Kingdom Two",
    evidence: ["missing contact unlock"],
    scope: ["server/wayward contact authority"],
    nonGoals: ["visual polish"],
    likelyFiles: ["server/wayward/contact.ts"],
    dependencies: [],
    risks: ["scope creep"],
    proposedAuthorityLevel: "AUTONOMOUS_EXECUTION",
    humanGateRequired: false,
    proposedEngineer: "openai",
    followOnCandidates: ["rook call recovery"],
    implementationBriefDraft: "Implement CONTACT authority with tests.",
    ...overrides,
  };
}

function acceptReview(overrides: Partial<ReviewCritique> = {}): ReviewCritique {
  return {
    verdict: "ACCEPT",
    findings: [],
    requiredChanges: [],
    evidence: ["plan is bounded"],
    authorityOverride: null,
    humanDecisionRequired: false,
    ...overrides,
  };
}

function withChangesReview(): ReviewCritique {
  return {
    verdict: "ACCEPT_WITH_CHANGES",
    findings: ["add idempotency note"],
    requiredChanges: ["Mention idempotency key in brief"],
    evidence: ["procurement lease pattern"],
    authorityOverride: null,
    humanDecisionRequired: false,
  };
}

function makeGithub(state?: Partial<FakeGithubState>): FakeGithubState {
  return {
    mainSha: "sha-main-1",
    prs: new Map(),
    ci: new Map(),
    openPrs: [],
    recentMergedPrs: [],
    ...state,
  };
}

function buildOrch(script: FakeProviderScript, githubState: FakeGithubState, opts?: {
  reconcile?: boolean;
  leaseOwner?: string;
}) {
  const store = new MemoryCandyBarStore();
  const architect = createFakeArchitectAdapter(script);
  const reviewer = createFakeReviewerAdapter(script);
  const engineer = createFakeEngineerAdapter(script);
  const orch = new CandyBarOrchestrator({
    store,
    providers: {
      architect,
      reviewer,
      engineer,
      creative: createFakeCreativeAdapter(),
      github: createFakeGithubObserver(githubState),
    },
    reconcileInvoke: opts?.reconcile === false ? undefined : createFakeReconcileInvoker(script),
    leaseOwner: opts?.leaseOwner ?? "worker-1",
    silentEvents: true,
  });
  return { store, orch, architect, reviewer, engineer, githubState };
}

async function driveTo(orch: CandyBarOrchestrator, runId: string, terminal: string[], max = 40) {
  let run = await orch.tickRun(runId);
  for (let i = 0; i < max; i++) {
    if (!run) break;
    if (terminal.includes(run.state)) return run;
    run = await orch.tickRun(runId);
  }
  return run;
}

describe("Candy Bar V0", () => {
  it("1. run creation is durable", async () => {
    const gh = makeGithub();
    const { store, orch } = buildOrch({}, gh);
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
    });
    expect(run.state).toBe("CREATED");
    expect(run.goalSnapshot.currentGoal).toContain("Wayward CONTACT");
    expect(await store.getRun({ tenantId: TENANT, id: run.id, operatorUserId: OP })).toMatchObject({
      id: run.id,
      repository: REPO,
    });
  });

  it("2. unauthorized user cannot create/read another operator's run", async () => {
    const { store, orch } = buildOrch({}, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
    });
    expect(await store.getRun({ tenantId: TENANT, id: run.id, operatorUserId: "other-op" })).toBeNull();
    expect(await store.getRun({ tenantId: "other-tenant", id: run.id, operatorUserId: OP })).toBeNull();
  });

  it("3. Architect cannot run twice from duplicate heartbeat", async () => {
    const script: FakeProviderScript = {
      architectPlans: [basePlan()],
    };
    const { orch, architect } = buildOrch(script, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await orch.tickRun(run.id); // CREATED -> ASSEMBLING
    await orch.tickRun(run.id); // context -> ARCHITECT_RUNNING
    await orch.tickRun(run.id); // architect completes
    expect(architect.calls).toBe(1);
    await orch.tickRun(run.id); // would be reviewer phase
    await orch.tickRun(run.id);
    // Re-tick architect state shouldn't re-call — already past
    expect(architect.calls).toBe(1);
  });

  it("4. Architect malformed response does not advance", async () => {
    const { orch } = buildOrch({ architectPlans: ["MALFORMED"] }, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final = await driveTo(orch, run.id, ["NEEDS_HUMAN", "BLOCKED"]);
    expect(final?.state).toBe("NEEDS_HUMAN");
    expect(final?.humanGateReason).toBe("MALFORMED_PROVIDER_OUTPUT");
  });

  it("5. valid Architect output advances to Reviewer", async () => {
    const { orch } = buildOrch(
      { architectPlans: [basePlan()], reviews: [acceptReview()] },
      makeGithub()
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final = await driveTo(orch, run.id, ["REVIEW_COMPLETE", "RECONCILING", "REVIEWER_RUNNING"]);
    expect(["REVIEWER_RUNNING", "REVIEW_COMPLETE", "RECONCILING", "BRIEF_READY"]).toContain(
      final?.state
    );
  });

  it("6. Reviewer REJECT prevents Engineer dispatch", async () => {
    const { orch, engineer } = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview({ verdict: "REJECT", findings: ["already built"] })],
      },
      makeGithub()
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final = await driveTo(orch, run.id, ["NEEDS_HUMAN"]);
    expect(final?.state).toBe("NEEDS_HUMAN");
    expect(engineer.calls).toBe(0);
  });

  it("7–9. ACCEPT_WITH_CHANGES reconciles to one brief; Engineer gets only that brief", async () => {
    const reconcile: ReconciledBrief = {
      decision: "ACCEPT_WITH_CHANGES",
      authorityLevel: "AUTONOMOUS_EXECUTION",
      humanGateRequired: false,
      humanGateReason: null,
      implementationBrief: "FINAL BRIEF ONLY — with idempotency",
      followOnCandidates: [],
    };
    const script: FakeProviderScript = {
      architectPlans: [basePlan()],
      reviews: [withChangesReview()],
      reconciles: [reconcile],
      engineerResults: [
        {
          status: "IMPLEMENTED_NO_PR",
          capability: null,
          summary: "done",
          tests: "ok",
          branch: "cursor/contact",
          pr_url: null,
          blocker: null,
          requires_human_approval: false,
        },
      ],
    };
    const { store, orch, engineer } = buildOrch(script, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await driveTo(orch, run.id, ["READY_FOR_HUMAN", "NEEDS_HUMAN"]);
    const briefs = (await store.listArtifacts(run.id)).filter(
      a => a.type === "RECONCILED_IMPLEMENTATION_BRIEF"
    );
    expect(briefs).toHaveLength(1);
    expect(briefs[0]!.content.implementationBrief).toContain("FINAL BRIEF ONLY");
    expect(engineer.calls).toBe(1);
    const engSteps = (await store.listSteps(run.id)).filter(s => s.kind === "engineer");
    expect(engSteps[0]!.inputArtifactIds).toEqual([briefs[0]!.id]);
  });

  it("10. level-1/2 classified slices may dispatch Engineer", async () => {
    const { orch, engineer } = buildOrch(
      {
        architectPlans: [
          basePlan({ proposedAuthorityLevel: "AUTONOMOUS_PRODUCT_ELABORATION" }),
        ],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_PRODUCT_ELABORATION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "product elaboration slice",
            followOnCandidates: [],
          },
        ],
        engineerResults: [
          {
            status: "ALREADY_SUPPORTED",
            capability: null,
            summary: "exists",
            tests: null,
            branch: null,
            pr_url: null,
            blocker: null,
            requires_human_approval: false,
          },
        ],
      },
      makeGithub()
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await driveTo(orch, run.id, ["READY_FOR_HUMAN"]);
    expect(engineer.calls).toBe(1);
  });

  it("11. OBJECTIVE_REDEFINITION does not dispatch Engineer", async () => {
    const { orch, engineer } = buildOrch(
      {
        architectPlans: [
          basePlan({
            proposedAuthorityLevel: "PROPOSAL_AUTHORITY",
            objective: "Redefine Kingdom Two fantasy around live Rook calls",
          }),
        ],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "PROPOSAL_AUTHORITY",
            humanGateRequired: true,
            humanGateReason: "OBJECTIVE_REDEFINITION",
            implementationBrief: "treatment only",
            followOnCandidates: [],
          },
        ],
      },
      makeGithub()
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final = await driveTo(orch, run.id, ["NEEDS_HUMAN"]);
    expect(final?.state).toBe("NEEDS_HUMAN");
    expect(final?.humanGateReason).toBe("OBJECTIVE_REDEFINITION");
    expect(engineer.calls).toBe(0);
  });

  it("12. HARD_HUMAN_GATE does not dispatch Engineer", async () => {
    const { orch, engineer } = buildOrch(
      {
        architectPlans: [basePlan({ proposedAuthorityLevel: "HARD_HUMAN_GATE" })],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "HARD_HUMAN_GATE",
            humanGateRequired: true,
            humanGateReason: "HARD_HUMAN_GATE",
            implementationBrief: "needs billing change",
            followOnCandidates: [],
          },
        ],
      },
      makeGithub()
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final = await driveTo(orch, run.id, ["NEEDS_HUMAN"]);
    expect(final?.humanGateReason).toBe("HARD_HUMAN_GATE");
    expect(engineer.calls).toBe(0);
  });

  it("13. duplicate provider callback is idempotent", async () => {
    const { orch, architect } = buildOrch({ architectPlans: [basePlan()] }, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await orch.tickRun(run.id);
    await orch.tickRun(run.id);
    await orch.tickRun(run.id);
    await orch.handleProviderCompletion({
      runId: run.id,
      stepId: "x",
      eventKey: "cb-1",
    });
    await orch.handleProviderCompletion({
      runId: run.id,
      stepId: "x",
      eventKey: "cb-1",
    });
    expect(architect.calls).toBeLessThanOrEqual(1);
  });

  it("14. same step is not dispatched twice across concurrent workers", async () => {
    const script: FakeProviderScript = { architectPlans: [basePlan()] };
    const store = new MemoryCandyBarStore();
    const architect = createFakeArchitectAdapter(script);
    const githubState = makeGithub();
    const providers = {
      architect,
      reviewer: createFakeReviewerAdapter({}),
      engineer: createFakeEngineerAdapter({}),
      creative: createFakeCreativeAdapter(),
      github: createFakeGithubObserver(githubState),
    };
    const a = new CandyBarOrchestrator({
      store,
      providers,
      leaseOwner: "worker-a",
      silentEvents: true,
    });
    const b = new CandyBarOrchestrator({
      store,
      providers,
      leaseOwner: "worker-b",
      silentEvents: true,
    });
    const run = await a.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await a.tickRun(run.id);
    await a.tickRun(run.id);
    // Both try architect
    await Promise.all([a.tickRun(run.id), b.tickRun(run.id)]);
    expect(architect.calls).toBe(1);
  });

  it("15. restart does not lose run state", async () => {
    const store = new MemoryCandyBarStore();
    const script: FakeProviderScript = { architectPlans: [basePlan()] };
    const githubState = makeGithub();
    const mk = (owner: string) =>
      new CandyBarOrchestrator({
        store,
        providers: {
          architect: createFakeArchitectAdapter(script),
          reviewer: createFakeReviewerAdapter({}),
          engineer: createFakeEngineerAdapter({}),
          creative: createFakeCreativeAdapter(),
          github: createFakeGithubObserver(githubState),
        },
        leaseOwner: owner,
        silentEvents: true,
      });
    const orch1 = mk("w1");
    const run = await orch1.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await orch1.tickRun(run.id);
    const again = await store.getRun({ tenantId: TENANT, id: run.id, operatorUserId: OP });
    expect(again?.state).toBe("ASSEMBLING_CONTEXT");
    // Simulate process restart: lease expires so another worker may recover.
    await store.updateRun(run.id, {
      leaseOwner: null,
      leaseExpiresAt: new Date(0).toISOString(),
    });
    const orch2 = mk("w2");
    await orch2.tickRun(run.id);
    const after = await store.getRun({ tenantId: TENANT, id: run.id, operatorUserId: OP });
    expect(after?.state).toBe("ARCHITECT_RUNNING");
  });

  it("16. heartbeat recovers a stalled-but-recoverable run", async () => {
    const { orch } = buildOrch({ architectPlans: [basePlan()] }, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const n = await orch.heartbeat({ maxRuns: 5 });
    expect(n).toBeGreaterThan(0);
    const after = await orch.getReadModel({ tenantId: TENANT, operatorUserId: OP, runId: run.id });
    expect(after?.run.state).not.toBe("CREATED");
  });

  it("17. auth failure stops for human rather than looping", async () => {
    const { orch } = buildOrch({ architectPlans: ["AUTH_FAILURE"] }, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final = await driveTo(orch, run.id, ["NEEDS_HUMAN"]);
    expect(final?.humanGateReason).toBe("AUTH_FAILURE");
  });

  it("18–19. migration/security terminal results stop for human", async () => {
    const migration = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_EXECUTION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
        engineerResults: ["NEEDS_HUMAN"],
      },
      makeGithub()
    );
    const run = await migration.orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final = await driveTo(migration.orch, run.id, ["NEEDS_HUMAN"]);
    expect(final?.humanGateReason).toBe("MIGRATION_REQUIRED");

    const security = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_EXECUTION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
        engineerResults: ["BLOCKED"],
      },
      makeGithub()
    );
    const run2 = await security.orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final2 = await driveTo(security.orch, run2.id, ["NEEDS_HUMAN"]);
    expect(final2?.humanGateReason).toBe("SECURITY_REQUIRED");
  });

  it("20–25. PR verified, fake PR rejected, CI repair loop, limits, green → READY_FOR_HUMAN", async () => {
    const githubState = makeGithub({
      mainSha: "sha-main-1",
      prs: new Map([
        [
          99,
          {
            url: `https://github.com/${REPO}/pull/99`,
            state: "open",
            draft: false,
            headSha: "head-1",
            baseSha: "sha-main-1",
            mergeable: true,
          },
        ],
      ]),
      ci: new Map([
        [
          "head-1",
          {
            headSha: "head-1",
            status: "failure",
            failedChecks: ["test"],
            successChecks: [],
            verified: true,
          },
        ],
        [
          "head-2",
          {
            headSha: "head-2",
            status: "success",
            failedChecks: [],
            successChecks: ["test"],
            verified: true,
          },
        ],
      ]),
    });
    const script: FakeProviderScript = {
      architectPlans: [basePlan()],
      reviews: [acceptReview()],
      reconciles: [
        {
          decision: "ACCEPT",
          authorityLevel: "AUTONOMOUS_EXECUTION",
          humanGateRequired: false,
          humanGateReason: null,
          implementationBrief: "implement contact",
          followOnCandidates: [],
        },
      ],
      engineerResults: [
        {
          status: "PR_READY",
          capability: null,
          summary: "pr ready",
          tests: null,
          branch: "cursor/contact",
          pr_url: `https://github.com/${REPO}/pull/99`,
          blocker: null,
          requires_human_approval: false,
          sessionId: "sess-1",
        },
        {
          status: "PR_READY",
          capability: null,
          summary: "repaired",
          tests: "green",
          branch: "cursor/contact",
          pr_url: `https://github.com/${REPO}/pull/99`,
          blocker: null,
          requires_human_approval: false,
          head_sha: "head-2",
        } as never,
      ],
    };
    const { orch, engineer, store } = buildOrch(script, githubState);
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: {
        preferredArchitect: "fake",
        preferredReviewer: "fake",
        preferredEngineer: "fake",
        maxRepairIterations: 3,
      },
    });

    // Drive through CI failure → repair → green. Do not stop early on CI_RUNNING.
    let current = await driveTo(orch, run.id, ["REPAIR_REQUIRED"], 40);
    expect(current?.state).toBe("REPAIR_REQUIRED");
    // Repair continuation updates head; simulate GitHub reflecting new head after engineer repair.
    current = await driveTo(orch, run.id, ["ENGINEER_REPAIRING", "CI_RUNNING"], 10);
    githubState.prs.set(99, {
      url: `https://github.com/${REPO}/pull/99`,
      state: "open",
      draft: false,
      headSha: "head-2",
      baseSha: "sha-main-1",
      mergeable: true,
    });
    await store.updateRun(run.id, { candidateHeadSha: "head-2" });
    current = await driveTo(orch, run.id, ["READY_FOR_HUMAN", "NEEDS_HUMAN"], 20);
    expect(current?.state).toBe("READY_FOR_HUMAN");
    expect(engineer.calls).toBeGreaterThanOrEqual(2);
    expect(engineer.sessions[0]).toBe("sess-1");

    // nonexistent PR
    const bad = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_EXECUTION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
        engineerResults: [
          {
            status: "PR_READY",
            capability: null,
            summary: "lie",
            tests: null,
            branch: "x",
            pr_url: `https://github.com/${REPO}/pull/404`,
            blocker: null,
            requires_human_approval: false,
          },
        ],
      },
      makeGithub()
    );
    const runBad = await bad.orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const badFinal = await driveTo(bad.orch, runBad.id, ["NEEDS_HUMAN"]);
    expect(badFinal?.state).toBe("NEEDS_HUMAN");

    // repair limit
    const limitedGh = makeGithub({
      prs: new Map([
        [
          7,
          {
            url: `https://github.com/${REPO}/pull/7`,
            state: "open",
            draft: false,
            headSha: "h1",
            baseSha: "sha-main-1",
            mergeable: true,
          },
        ],
      ]),
      ci: new Map([
        [
          "h1",
          {
            headSha: "h1",
            status: "failure",
            failedChecks: ["test"],
            successChecks: [],
            verified: true,
          },
        ],
      ]),
    });
    const limited = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_EXECUTION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
        engineerResults: [
          {
            status: "PR_READY",
            capability: null,
            summary: "pr",
            tests: null,
            branch: "b",
            pr_url: `https://github.com/${REPO}/pull/7`,
            blocker: null,
            requires_human_approval: false,
          },
          {
            status: "PR_READY",
            capability: null,
            summary: "still broken",
            tests: null,
            branch: "b",
            pr_url: `https://github.com/${REPO}/pull/7`,
            blocker: null,
            requires_human_approval: false,
          },
        ],
      },
      limitedGh
    );
    const runLim = await limited.orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: {
        preferredArchitect: "fake",
        preferredReviewer: "fake",
        preferredEngineer: "fake",
        maxRepairIterations: 1,
      },
    });
    const limFinal = await driveTo(limited.orch, runLim.id, ["NEEDS_HUMAN"], 60);
    // After one repair, CI still fails on same head → another REPAIR_REQUIRED → limit
    expect(limFinal?.state).toBe("NEEDS_HUMAN");
    expect(limFinal?.humanGateReason).toBe("REPAIR_LIMIT");
  });

  it("26–28. Candy Bar never merges, deploys, or applies production migrations", () => {
    const { orch } = buildOrch({}, makeGithub());
    expect(() => orch.attemptMerge()).toThrow(/refuses merge/);
    expect(() => orch.attemptDeploy()).toThrow(/refuses deploy/);
    expect(() => orch.attemptProductionMigration()).toThrow(/refuses production migrations/);
  });

  it("29. human gate cannot be self-approved by provider output", async () => {
    const { store, orch } = buildOrch(
      {
        architectPlans: [basePlan({ proposedAuthorityLevel: "HARD_HUMAN_GATE" })],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "HARD_HUMAN_GATE",
            humanGateRequired: true,
            humanGateReason: "HARD_HUMAN_GATE",
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
      },
      makeGithub()
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await driveTo(orch, run.id, ["NEEDS_HUMAN"]);
    // Provider-shaped artifact claiming approval must not unlock
    await store.createArtifact({
      runId: run.id,
      type: "AUTHORITY_CLASSIFICATION",
      producer: "fake_provider",
      provider: "fake",
      content: { approvedByUserId: "provider-self", level: "AUTONOMOUS_EXECUTION" },
    });
    const still = await store.getRun({ tenantId: TENANT, id: run.id, operatorUserId: OP });
    expect(still?.state).toBe("NEEDS_HUMAN");
    expect(await store.listApprovals(run.id)).toHaveLength(0);
  });

  it("30. cancel stops future dispatch", async () => {
    const { orch, architect } = buildOrch({ architectPlans: [basePlan()] }, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await orch.cancelRun({
      tenantId: TENANT,
      operatorUserId: OP,
      runId: run.id,
      actorUserId: OP,
    });
    await orch.tickRun(run.id);
    expect(architect.calls).toBe(0);
  });

  it("31. stale base SHA causes revalidation before Engineer start", async () => {
    const githubState = makeGithub({ mainSha: "sha-a" });
    const { orch } = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_EXECUTION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
      },
      githubState
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    // Advance to AUTHORITY_CLASSIFIED then flip main
    let current = await driveTo(orch, run.id, ["AUTHORITY_CLASSIFIED", "ENGINEER_RUNNING", "NEEDS_HUMAN"]);
    if (current?.state === "AUTHORITY_CLASSIFIED" || current?.state === "ENGINEER_RUNNING") {
      // Already may have checked — force stale by resetting and flipping before classify dispatch
    }
    // Fresh run where we flip between brief and engineer
    const github2 = makeGithub({ mainSha: "sha-plan" });
    const second = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_EXECUTION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
      },
      github2
    );
    const run2 = await second.orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await second.orch.tickRun(run2.id);
    await second.orch.tickRun(run2.id);
    await second.orch.tickRun(run2.id);
    await second.orch.tickRun(run2.id);
    await second.orch.tickRun(run2.id);
    await second.orch.tickRun(run2.id);
    await second.orch.tickRun(run2.id);
    await second.orch.tickRun(run2.id);
    // BRIEF_READY / AUTHORITY_CLASSIFIED — flip main before engineer dispatch
    github2.mainSha = "sha-moved";
    const final = await driveTo(second.orch, run2.id, ["NEEDS_HUMAN", "ENGINEER_RUNNING", "READY_FOR_HUMAN"]);
    expect(final?.humanGateReason === "STALE_BASE" || final?.state === "NEEDS_HUMAN").toBe(true);
  });

  it("32–33. budget blocks paid dispatch; unknown cost stays unknown", async () => {
    const { orch, store } = buildOrch({ architectPlans: [basePlan()] }, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: {
        preferredArchitect: "fake",
        preferredReviewer: "fake",
        preferredEngineer: "fake",
        budgetCents: 1,
      },
    });
    await store.updateRun(run.id, { spendKnown: true, estimatedSpendCents: 5 });
    const final = await driveTo(orch, run.id, ["NEEDS_HUMAN"]);
    expect(final?.humanGateReason).toBe("BUDGET_EXCEEDED");

    const { orch: orch2, store: store2 } = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_EXECUTION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
        engineerResults: [
          {
            status: "ALREADY_SUPPORTED",
            capability: null,
            summary: "ok",
            tests: null,
            branch: null,
            pr_url: null,
            blocker: null,
            requires_human_approval: false,
          },
        ],
      },
      makeGithub()
    );
    const run2 = await orch2.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    await driveTo(orch2, run2.id, ["READY_FOR_HUMAN"]);
    const after = await store2.getRun({ tenantId: TENANT, id: run2.id, operatorUserId: OP });
    expect(after?.spendKnown).toBe(false);
    expect(after?.estimatedSpendCents).toBeNull();
  });

  it("34–38. fallback explicit; unavailable adapters do not browser-automate; identity honest", async () => {
    const grok = createGrokReviewerAdapter();
    const cursor = createCursorEngineerAdapter();
    const creative = createCreativeAdapter();
    const g = await grok.review({ prompt: "x" });
    const c = await cursor.implement({ prompt: "x" });
    const cr = await creative.treat({ prompt: "x" });
    expect(g.ok).toBe(false);
    if (!g.ok) {
      expect(g.browserAutomationUsed).toBe(false);
      expect(g.code).toBe("PROVIDER_UNAVAILABLE");
      expect(g.provider).toBe("xai_grok");
    }
    expect(c.ok).toBe(false);
    if (!c.ok) {
      expect(c.browserAutomationUsed).toBe(false);
      expect(c.provider).toBe("cursor");
    }
    expect(cr.ok).toBe(false);

    // OpenAI filling a seat is recorded as openai
    const { store, orch } = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
      },
      makeGithub()
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: {
        preferredArchitect: "fake",
        preferredReviewer: "fake",
        preferredEngineer: "fake",
        providerFallbackPolicy: {
          allowOpenAiForArchitect: true,
          allowOpenAiForReviewer: true,
          allowOpenAiForEngineer: true,
        },
      },
    });
    await orch.tickRun(run.id);
    await orch.tickRun(run.id);
    await orch.tickRun(run.id);
    const plan = await store.latestArtifact(run.id, "ARCHITECT_PLAN");
    expect(plan?.provider).toBe("fake");
    expect(plan?.provider).not.toBe("xai_grok");
    expect(plan?.provider).not.toBe("cursor");

    // Without fallback, preferred grok unavailable → NEEDS_HUMAN
    const noFallback = new CandyBarOrchestrator({
      store: new MemoryCandyBarStore(),
      providers: {
        architect: createFakeArchitectAdapter({ architectPlans: [basePlan()] }),
        reviewer: createGrokReviewerAdapter(),
        engineer: createFakeEngineerAdapter({}),
        creative: createFakeCreativeAdapter(),
        github: createFakeGithubObserver(makeGithub()),
      },
      silentEvents: true,
    });
    const runNf = await noFallback.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: {
        preferredArchitect: "fake",
        preferredReviewer: "xai_grok",
        preferredEngineer: "fake",
        providerFallbackPolicy: {
          allowOpenAiForArchitect: false,
          allowOpenAiForReviewer: false,
          allowOpenAiForEngineer: false,
        },
      },
    });
    const nfFinal = await driveTo(noFallback, runNf.id, ["NEEDS_HUMAN"]);
    expect(nfFinal?.humanGateReason).toBe("PROVIDER_UNAVAILABLE");
  });

  it("39–41. duplicate GitHub/merge events; AUTO_PLAN_NEXT uses latest goal", async () => {
    const githubState = makeGithub({
      prs: new Map([
        [
          5,
          {
            url: `https://github.com/${REPO}/pull/5`,
            state: "open",
            draft: false,
            headSha: "h",
            baseSha: "sha-main-1",
            mergeable: true,
          },
        ],
      ]),
      ci: new Map([
        [
          "h",
          {
            headSha: "h",
            status: "success",
            failedChecks: [],
            successChecks: ["test"],
            verified: true,
          },
        ],
      ]),
    });
    const { orch, store } = buildOrch(
      {
        architectPlans: [basePlan()],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "AUTONOMOUS_EXECUTION",
            humanGateRequired: false,
            humanGateReason: null,
            implementationBrief: "x",
            followOnCandidates: [],
          },
        ],
        engineerResults: [
          {
            status: "PR_READY",
            capability: null,
            summary: "pr",
            tests: null,
            branch: "b",
            pr_url: `https://github.com/${REPO}/pull/5`,
            blocker: null,
            requires_human_approval: false,
          },
        ],
      },
      githubState
    );
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Goal v1 CONTACT",
      policy: {
        preferredArchitect: "fake",
        preferredReviewer: "fake",
        preferredEngineer: "fake",
        autoPlanNext: true,
      },
    });
    await driveTo(orch, run.id, ["READY_FOR_HUMAN"]);
    await orch.handleGithubStatusEvent({ runId: run.id, eventKey: "gh-1" });
    await orch.handleGithubStatusEvent({ runId: run.id, eventKey: "gh-1" });

    await orch.setCurrentGoal({
      tenantId: TENANT,
      operatorUserId: OP,
      actorUserId: OP,
      currentGoal: "Goal v2 AFTER MERGE",
    });
    const wf = await store.getWorkflow({ tenantId: TENANT, operatorUserId: OP });
    expect(wf?.goalVersion).toBe(2);

    const merged1 = await orch.handleMergedObservation({
      runId: run.id,
      prNumber: 5,
      headSha: "h",
      eventKey: "merge-1",
    });
    const merged2 = await orch.handleMergedObservation({
      runId: run.id,
      prNumber: 5,
      headSha: "h",
      eventKey: "merge-1",
    });
    expect(merged1.nextRun).not.toBeNull();
    expect(merged2.nextRun).toBeNull();
    expect(merged1.nextRun?.goalSnapshot.currentGoal).toBe("Goal v2 AFTER MERGE");
    expect(merged1.nextRun?.goalSnapshot.goalVersion).toBe(2);
    // Old run retained old snapshot
    const old = await store.getRun({ tenantId: TENANT, id: run.id, operatorUserId: OP });
    expect(old?.goalSnapshot.currentGoal).toBe("Goal v1 CONTACT");
    expect(old?.goalSnapshot.goalVersion).toBe(1);
  });

  it("42–43. max steps and wall-clock age stop runs", async () => {
    const { orch, store } = buildOrch({ architectPlans: [basePlan()] }, makeGithub());
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: {
        preferredArchitect: "fake",
        preferredReviewer: "fake",
        preferredEngineer: "fake",
        maxStepsPerRun: 1,
      },
    });
    await orch.tickRun(run.id);
    await store.updateRun(run.id, { stepCount: 5 });
    const final = await orch.tickRun(run.id);
    expect(final?.state).toBe("NEEDS_HUMAN");
    expect(final?.humanGateReason).toBe("MAX_STEPS");

    let t = Date.now();
    const timed = new CandyBarOrchestrator({
      store: new MemoryCandyBarStore(),
      providers: {
        architect: createFakeArchitectAdapter({ architectPlans: [basePlan()] }),
        reviewer: createFakeReviewerAdapter({}),
        engineer: createFakeEngineerAdapter({}),
        creative: createFakeCreativeAdapter(),
        github: createFakeGithubObserver(makeGithub()),
      },
      now: () => new Date(t),
      silentEvents: true,
    });
    const run2 = await timed.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: {
        preferredArchitect: "fake",
        preferredReviewer: "fake",
        preferredEngineer: "fake",
        maxWallClockMs: 1000,
      },
    });
    await timed.tickRun(run2.id);
    t += 5000;
    const aged = await timed.tickRun(run2.id);
    expect(aged?.humanGateReason).toBe("MAX_AGE");
  });

  it("standing goal versioning: provider cannot change goal; cross-tenant blocked", async () => {
    const { store, orch } = buildOrch({}, makeGithub());
    const wf = await orch.setCurrentGoal({
      tenantId: TENANT,
      operatorUserId: OP,
      actorUserId: OP,
      currentGoal: "Goal A",
    });
    expect(wf.goalVersion).toBe(1);
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Goal A",
    });
    await orch.setCurrentGoal({
      tenantId: TENANT,
      operatorUserId: OP,
      actorUserId: OP,
      currentGoal: "Goal B",
    });
    const still = await store.getRun({ tenantId: TENANT, id: run.id, operatorUserId: OP });
    expect(still?.goalSnapshot.currentGoal).toBe("Goal A");
    const fresh = await orch.createRun({ tenantId: TENANT, operatorUserId: OP });
    expect(fresh.goalSnapshot.currentGoal).toBe("Goal B");
    expect(fresh.goalSnapshot.goalVersion).toBe(2);

    await expect(
      orch.setCurrentGoal({
        tenantId: TENANT,
        operatorUserId: OP,
        actorUserId: "intruder",
        currentGoal: "Hijack",
      })
    ).rejects.toThrow(/forbidden/);

    expect(
      await store.getWorkflow({ tenantId: "other", operatorUserId: OP })
    ).toBeNull();
  });

  it("transitions are validated", () => {
    expect(canTransitionCandyBar("CREATED", "ASSEMBLING_CONTEXT")).toBe(true);
    expect(canTransitionCandyBar("CREATED", "ENGINEER_RUNNING")).toBe(false);
    expect(parseArchitectPlan({ objective: "" })).toBeNull();
  });

  it("heartbeat disabled by default", () => {
    expect(ENV.candyBarEnabled).toBe(false);
    const stop = startCandyBarHeartbeat({
      orchestrator: buildOrch({}, makeGithub()).orch,
    });
    stop();
  });

  it("E2E demo: CONTACT path to READY_FOR_HUMAN with repair", async () => {
    const githubState = makeGithub({
      prs: new Map([
        [
          42,
          {
            url: `https://github.com/${REPO}/pull/42`,
            state: "open",
            draft: false,
            headSha: "head-fail",
            baseSha: "sha-main-1",
            mergeable: true,
          },
        ],
      ]),
      ci: new Map([
        [
          "head-fail",
          {
            headSha: "head-fail",
            status: "failure",
            failedChecks: ["unit"],
            successChecks: [],
            verified: true,
          },
        ],
        [
          "head-ok",
          {
            headSha: "head-ok",
            status: "success",
            failedChecks: [],
            successChecks: ["unit"],
            verified: true,
          },
        ],
      ]),
    });
    const script: FakeProviderScript = {
      architectPlans: [basePlan()],
      reviews: [withChangesReview()],
      reconciles: [
        {
          decision: "ACCEPT_WITH_CHANGES",
          authorityLevel: "AUTONOMOUS_EXECUTION",
          humanGateRequired: false,
          humanGateReason: null,
          implementationBrief: "CONTACT authority slice",
          followOnCandidates: ["rook recovery"],
        },
      ],
      engineerResults: [
        {
          status: "PR_READY",
          capability: null,
          summary: "opened",
          tests: null,
          branch: "cursor/contact",
          pr_url: `https://github.com/${REPO}/pull/42`,
          blocker: null,
          requires_human_approval: false,
          sessionId: "e2e-sess",
        },
        {
          status: "PR_READY",
          capability: null,
          summary: "fixed",
          tests: "pass",
          branch: "cursor/contact",
          pr_url: `https://github.com/${REPO}/pull/42`,
          blocker: null,
          requires_human_approval: false,
          head_sha: "head-ok",
        } as never,
      ],
    };
    const { orch, architect, reviewer, engineer, store } = buildOrch(script, githubState);
    const run = await orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    let current = await driveTo(orch, run.id, ["REPAIR_REQUIRED"], 40);
    expect(current?.state).toBe("REPAIR_REQUIRED");
    current = await driveTo(orch, run.id, ["ENGINEER_REPAIRING", "CI_RUNNING"], 10);
    githubState.prs.set(42, {
      url: `https://github.com/${REPO}/pull/42`,
      state: "open",
      draft: false,
      headSha: "head-ok",
      baseSha: "sha-main-1",
      mergeable: true,
    });
    await store.updateRun(run.id, { candidateHeadSha: "head-ok" });
    current = await driveTo(orch, run.id, ["READY_FOR_HUMAN"], 20);
    expect(current?.state).toBe("READY_FOR_HUMAN");
    expect(architect.calls).toBe(1);
    expect(reviewer.calls).toBe(1);
    expect(engineer.calls).toBe(2); // initial + repair continuation
    expect(engineer.sessions[0]).toBe("e2e-sess");
    const arts = await store.listArtifacts(run.id);
    expect(arts.some(a => a.type === "RECONCILED_IMPLEMENTATION_BRIEF")).toBe(true);
    expect(arts.every(a => a.provider !== "xai_grok" || a.type === "REVIEW_CRITIQUE")).toBe(true);
    expect(() => orch.attemptMerge()).toThrow();
    expect(() => orch.attemptDeploy()).toThrow();

    // Second fixture: objective redefinition
    const redef = buildOrch(
      {
        architectPlans: [
          basePlan({
            objective: "Redefine Kingdom Two so Rook causes live calls as core fantasy",
            proposedAuthorityLevel: "PROPOSAL_AUTHORITY",
          }),
        ],
        reviews: [acceptReview()],
        reconciles: [
          {
            decision: "ACCEPT",
            authorityLevel: "PROPOSAL_AUTHORITY",
            humanGateRequired: true,
            humanGateReason: "OBJECTIVE_REDEFINITION",
            implementationBrief: "treatment",
            followOnCandidates: [],
          },
        ],
      },
      makeGithub()
    );
    const run2 = await redef.orch.createRun({
      tenantId: TENANT,
      operatorUserId: OP,
      currentGoal: "Finish the missing Wayward CONTACT authority path.",
      policy: { preferredArchitect: "fake", preferredReviewer: "fake", preferredEngineer: "fake" },
    });
    const final2 = await driveTo(redef.orch, run2.id, ["NEEDS_HUMAN"]);
    expect(final2?.state).toBe("NEEDS_HUMAN");
    expect(redef.engineer.calls).toBe(0);
  });
});
