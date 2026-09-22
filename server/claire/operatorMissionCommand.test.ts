import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WeeklyIntentDay, WeeklyIntentRecord } from "../../shared/weeklyMissionReadiness";
import {
  deriveDailyCommand,
  emptyCommandMetadata,
  type OperatorMissionMetadata,
} from "../../shared/claireWorkdayCommand";
import { applyCommandProtection, detectTimePockets } from "../missionDirector/pocketDetection";
import { selectMissionPlan } from "../missionDirector/planSelection";
import { buildCampaign } from "../missionDirector/testFixtures";
import type { RankingContext } from "../missionDirector/missionRank";
import {
  OPERATOR_MISSION_ALREADY_SPEAK,
  OPERATOR_MISSION_CLARIFY_ABSENT_SPEAK,
  OPERATOR_MISSION_CLARIFY_AMBIGUOUS_SPEAK,
  OPERATOR_MISSION_CREATED_SPEAK,
  OPERATOR_MISSION_FAILED_SPEAK,
  OPERATOR_MISSION_UPDATED_SPEAK,
  classifyOperatorMissionVoiceTurn,
  completionConditionForMission,
  executeOperatorMissionCommand,
  isIncompleteOperatorMissionPrefix,
  parseExplicitOperatorMissionCommand,
  resolveReferentialMissionCommand,
  sameOperatorMission,
  type OperatorMissionCommandDeps,
} from "./operatorMissionCommand";

const BANNED = /\b(?:locked|your week is set|week locked|week is set|done|mission completed|published|ad is live)\b/i;
const CLARIFY_BANNED = /\b(?:created|done|saved|set|updated|locked|published)\b/i;

type Row = {
  id: string;
  title: string;
  kind: "growth" | "prep" | "operations";
  status: "open" | "completed";
  businessDate: string;
  sourceText: string | null;
  commandRole: "primary" | null;
  operatorMission: OperatorMissionMetadata | null;
};

function harness(options?: {
  businessDate?: string;
  intent?: WeeklyIntentRecord | null;
  now?: Date;
  actorId?: string;
  operatorUserId?: string;
}) {
  const businessDate = options?.businessDate ?? "2026-09-22";
  const actorId = options?.actorId ?? "day-director-42";
  const operatorUserId = options?.operatorUserId ?? "adam-open-id";
  const rows: Row[] = [];
  const calls: string[] = [];
  let intent = options?.intent === undefined ? null : options.intent;
  let intentReads = 0;
  let failDesignate = false;
  let failAccept = false;
  let loadOverride: OperatorMissionCommandDeps["loadCommand"] | null = null;

  const loadFromRows: NonNullable<OperatorMissionCommandDeps["loadCommand"]> = async () =>
    deriveDailyCommand({
      businessDate,
      actorId,
      commitments: rows
        .filter(row => row.businessDate === businessDate)
        .map(row => ({
          id: row.id,
          title: row.title,
          kind: row.kind,
          status: row.status,
          sourceText: row.sourceText,
          detailState: "COMPLETE" as const,
          scheduleKind: null,
          scheduleLabel: null,
          command: {
            ...emptyCommandMetadata(),
            role: row.commandRole,
            designatedBy: row.commandRole === "primary" ? ("operator" as const) : null,
            designatedAt: row.commandRole === "primary" ? "2026-09-22T16:00:00.000Z" : null,
          },
          operatorMission: row.operatorMission,
        })),
      route: [],
      cargo: [],
      campaign: null,
      followUps: [],
    });

  const demoteOthers = (exceptId: string) => {
    for (const row of rows) {
      if (row.id === exceptId || row.commandRole !== "primary") continue;
      row.commandRole = null;
    }
  };

  const deps: OperatorMissionCommandDeps = {
    now: () => options?.now ?? new Date("2026-09-23T06:30:00.000Z"),
    listToday: async () => rows.filter(row => row.businessDate === businessDate).map(row => ({ ...row })),
    latestIntent: async () => {
      intentReads += 1;
      calls.push("read-intent");
      return intent;
    },
    acceptProposal: async input => {
      calls.push(`accept:${input.businessDate}:${input.actorId}`);
      if (failAccept) throw new Error("accept failed");
      const mission = input.proposal.operatorMission ?? null;
      const row: Row = {
        id: randomUUID(),
        title: input.proposal.title,
        kind: input.proposal.kind,
        status: "open",
        businessDate: input.proposal.targetBusinessDate ?? input.businessDate,
        sourceText: input.proposal.sourceText,
        commandRole: input.proposal.command?.role === "primary" ? "primary" : null,
        operatorMission: mission,
      };
      rows.push(row);
      if (row.commandRole === "primary") demoteOthers(row.id);
      return { id: row.id, title: row.title } as Awaited<ReturnType<NonNullable<OperatorMissionCommandDeps["acceptProposal"]>>>;
    },
    designatePrimary: async input => {
      calls.push(`designate:${input.businessDate}:${input.commitmentId}`);
      if (failDesignate) throw new Error("designate failed");
      const target = rows.find(row => row.id === input.commitmentId && row.businessDate === input.businessDate);
      if (!target) throw new Error("missing");
      demoteOthers(target.id);
      target.commandRole = "primary";
      if (target.status === "completed") throw new Error("must not complete while designating");
      return { commitmentId: target.id };
    },
    loadCommand: async query => (loadOverride ? loadOverride(query) : loadFromRows(query)),
  };

  const run = (utterance: string, sourceCommandRef = "voice:conv-1:turn:1", resolvedMissionClause?: string) =>
    executeOperatorMissionCommand(
      {
        tenantId: "tenant-1",
        operatorUserId,
        dayDirectorActorId: actorId,
        weeklyIntentOperatorId: operatorUserId,
        businessDate,
        utterance,
        sourceCommandRef,
        resolvedMissionClause,
      },
      deps
    );

  return {
    rows,
    calls,
    run,
    businessDate,
    actorId,
    get intentReads() {
      return intentReads;
    },
    setIntent(next: WeeklyIntentRecord | null) {
      intent = next;
    },
    failNextDesignate() {
      failDesignate = true;
    },
    failNextAccept() {
      failAccept = true;
    },
    overrideLoad(load: OperatorMissionCommandDeps["loadCommand"]) {
      loadOverride = load;
    },
  };
}

function lockedTuesday(): WeeklyIntentRecord {
  const tuesday: WeeklyIntentDay = {
    businessDate: "2026-09-22",
    weekday: "Tuesday",
    disposition: "primary",
    primary: { text: "Pitch three properties", source: "operator_stated", commitmentId: "pitch-1" },
    fixedConstraints: [],
    readinessRequirements: [],
  };
  const wednesday: WeeklyIntentDay = {
    businessDate: "2026-09-23",
    weekday: "Wednesday",
    disposition: "primary",
    primary: { text: "Walk the Louise", source: "operator_stated", commitmentId: "louise-1" },
    fixedConstraints: [],
    readinessRequirements: [],
  };
  return {
    id: "intent-locked",
    tenantId: "tenant-1",
    operatorId: "adam-open-id",
    weekStart: "2026-09-21",
    revision: 3,
    source: "operator_confirmed_proposal",
    lockedAt: "2026-09-21T15:00:00.000Z",
    days: [tuesday, wednesday],
  };
}

describe("operator mission command grammar", () => {
  const writes = [
    "Create today's mission: create and publish one static-image Instagram ad.",
    "Claire, create today's mission: create and publish one static-image Instagram ad.",
    "Make creating and publishing the Instagram ad my mission today.",
    "Set calling 10 property managers as today's mission.",
    "I want finishing the postcard considered as my mission today.",
    "Consider publishing the ad my mission today.",
    "Create a mission for today: send the postcard.",
    "Make publishing the Instagram ad today's mission.",
    "Set today's mission to visit the Louise.",
    "Consider publishing the ad today's mission.",
    "Make publishing the static Instagram ad the mission today.",
    "I want creating and publishing the Instagram ad considered as my mission today.",
  ];

  it.each(writes)("parses a write: %s", utterance => {
    expect(parseExplicitOperatorMissionCommand(utterance)?.title).toBeTruthy();
  });

  const silent = [
    "I'm working on the ad today.",
    "I have marketing to do.",
    "I have a mission today.",
    "I've got a mission today.",
    "I'm heading home to work on an ad.",
    "I'm going home to work on an ad.",
    "I'm thinking about making the ad today's mission.",
    "I want this Meta ad",
  ];

  it.each(silent)("does not parse a non-command: %s", utterance => {
    expect(parseExplicitOperatorMissionCommand(utterance)).toBeNull();
  });

  it("normalizes the acceptance title and completion condition", () => {
    const parsed = parseExplicitOperatorMissionCommand(
      "Claire, create today's mission: create and publish one static-image Instagram ad."
    );
    expect(parsed?.title).toBe("Create and publish one static-image Instagram ad");
    expect(parsed?.completionCondition).toBe("One static-image Instagram ad is published.");
    expect(completionConditionForMission("Publish the Instagram ad")).toBe("The Instagram ad is published.");
    expect(completionConditionForMission("Send the postcard")).toBe("The postcard is sent.");
    expect(completionConditionForMission("Visit the Louise")).toBe("The visit is completed.");
    expect(completionConditionForMission("Call 10 property managers")).toBe(
      "Operator reports completion of: Call 10 property managers"
    );
  });

  it("holds a weak fragment and writes only the assembled command", () => {
    const first = classifyOperatorMissionVoiceTurn({
      pendingFragment: null,
      utterance: "I want this Meta ad",
      allowFragmentWait: true,
      fragmentHolds: 0,
    });
    expect(first.kind).toBe("hold");
    expect(parseExplicitOperatorMissionCommand("I want this Meta ad")).toBeNull();
    const second = classifyOperatorMissionVoiceTurn({
      pendingFragment: "I want this Meta ad",
      utterance: "considered as my mission today.",
      allowFragmentWait: true,
      fragmentHolds: 1,
    });
    expect(second.kind).toBe("execute");
    if (second.kind !== "execute") return;
    expect(parseExplicitOperatorMissionCommand(second.assembled)?.title).toBe("This Meta ad");
    const make = classifyOperatorMissionVoiceTurn({
      pendingFragment: "Make creating and publishing the Instagram ad",
      utterance: "my mission today.",
      allowFragmentWait: false,
      fragmentHolds: 0,
    });
    expect(make.kind).toBe("execute");
  });

  it("resolves a referential command from the live work statement and does not guess", () => {
    const forms = [
      "make this a mission",
      "make that today's mission",
      "turn that into a mission",
      "make this today's mission",
      "turn this into today's mission",
      "set that as today's mission",
    ];
    for (const form of forms) {
      expect(parseExplicitOperatorMissionCommand(form)).toBeNull();
      expect(resolveReferentialMissionCommand({ assembled: form }).status).toBe("absent");
    }
    const held = resolveReferentialMissionCommand({
      assembled: "I want this Meta ad make that today's mission",
    });
    expect(held.status).toBe("resolved");
    if (held.status !== "resolved") return;
    expect(held.title).toBe("This Meta ad");
    const prior = resolveReferentialMissionCommand({
      assembled: "turn that into a mission",
      priorOperatorUtterance: "create and publish one static-image Instagram ad",
    });
    expect(prior.status).toBe("resolved");
    if (prior.status !== "resolved") return;
    expect(prior.title).toBe("Create and publish one static-image Instagram ad");
    expect(
      resolveReferentialMissionCommand({
        assembled: "make that today's mission",
        priorOperatorUtterance: "the postcard and the Instagram ad",
      }).status
    ).toBe("ambiguous");
    expect(
      resolveReferentialMissionCommand({
        assembled: "make this a mission",
        priorOperatorUtterance: "I have a mission today.",
      }).status
    ).toBe("absent");
    const classified = classifyOperatorMissionVoiceTurn({
      pendingFragment: "I want this Meta ad",
      utterance: "make that today's mission",
      allowFragmentWait: true,
      priorOperatorUtterance: "Pitch three properties",
    });
    expect(classified.kind).toBe("execute");
    if (classified.kind !== "execute") return;
    expect(classified.resolvedMissionClause).toBe("I want this Meta ad");
    const clarify = classifyOperatorMissionVoiceTurn({
      pendingFragment: null,
      utterance: "make that today's mission",
      allowFragmentWait: false,
    });
    expect(clarify.kind).toBe("clarify");
    if (clarify.kind !== "clarify") return;
    expect(clarify.speak).toBe(OPERATOR_MISSION_CLARIFY_ABSENT_SPEAK);
    expect(clarify.speak).not.toMatch(CLARIFY_BANNED);
    expect(OPERATOR_MISSION_CLARIFY_AMBIGUOUS_SPEAK).not.toMatch(CLARIFY_BANNED);
    expect(parseExplicitOperatorMissionCommand("Make publishing the Instagram ad a mission.")?.title).toBe(
      "Publish the Instagram ad"
    );
    expect(parseExplicitOperatorMissionCommand("Turn publishing the Instagram ad into a mission.")?.title).toBe(
      "Publish the Instagram ad"
    );
    const inlineReferent = resolveReferentialMissionCommand({
      assembled: "make this my mission",
      priorOperatorUtterance: "Create and publish one static-image Instagram ad.",
    });
    expect(inlineReferent.status).toBe("resolved");
    if (inlineReferent.status === "resolved") {
      expect(inlineReferent.title).toBe("Create and publish one static-image Instagram ad");
    }
    const call = resolveReferentialMissionCommand({
      assembled: "that's my mission today",
      priorOperatorUtterance: "Call Dana about The Louise.",
    });
    expect(call.status).toBe("resolved");
    if (call.status === "resolved") expect(call.title).toBe("Call Dana about The Louise");
    const drop = resolveReferentialMissionCommand({
      assembled: "make this today's mission",
      priorOperatorUtterance: "Drop the Ryan order at the dry cleaner.",
    });
    expect(drop.status).toBe("resolved");
    for (const fact of [
      "The Louise is overdue by 45 days.",
      "Ryan's order was processed incorrectly.",
      "Dana hasn't replied.",
      "John owes us $10,000.",
    ]) {
      expect(
        resolveReferentialMissionCommand({
          assembled: "make that a mission",
          priorOperatorUtterance: fact,
        }).status
      ).toBe("absent");
    }
    expect(sameOperatorMission("Publish the Instagram ad", "Publish the Instagram ad and call Dana")).toBe(false);
    expect(sameOperatorMission("Call Dana", "Call Dana and email Russell")).toBe(false);
    expect(
      sameOperatorMission("Publish the Instagram ad", "Create and publish one static-image Instagram ad")
    ).toBe(true);
  });

  it("does not treat ordinary speech as a mission prefix", () => {
    expect(isIncompleteOperatorMissionPrefix("I'm working on the ad today.")).toBe(false);
    expect(isIncompleteOperatorMissionPrefix("I have a mission today.")).toBe(false);
    for (const ordinary of [
      "I want to know my sales today.",
      "I want you to text me the schedule.",
      "I want to go home after this.",
      "Make sure I call Dana.",
      "Consider what we should do about The Louise.",
    ]) {
      expect(parseExplicitOperatorMissionCommand(ordinary)).toBeNull();
      expect(isIncompleteOperatorMissionPrefix(ordinary)).toBe(false);
      expect(
        classifyOperatorMissionVoiceTurn({
          pendingFragment: null,
          utterance: ordinary,
          allowFragmentWait: true,
        }).kind
      ).toBe("passthrough");
    }
    expect(isIncompleteOperatorMissionPrefix("I want this Meta ad")).toBe(true);
    expect(
      classifyOperatorMissionVoiceTurn({
        pendingFragment: null,
        utterance: "What's up at the Louise?",
        allowFragmentWait: true,
      }).kind
    ).toBe("passthrough");
  });
});

describe("operator mission canonical write", () => {
  it("creates one growth primary for the operator-local date and speaks only after readback", async () => {
    const box = harness({ now: new Date("2026-09-23T06:30:00.000Z") });
    const intent = lockedTuesday();
    const before = structuredClone(intent);
    box.setIntent(intent);
    const result = await box.run("Claire, create today's mission: create and publish one static-image Instagram ad.");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speak).toBe(OPERATOR_MISSION_CREATED_SPEAK);
    expect(result.speak).not.toMatch(BANNED);
    expect(result.title).toBe("Create and publish one static-image Instagram ad");
    expect(result.kind).toBe("growth");
    expect(result.role).toBe("primary");
    expect(result.status).toBe("open");
    expect(result.businessDate).toBe("2026-09-22");
    expect(result.completionCondition).toBe("One static-image Instagram ad is published.");
    expect(result.verification).toBe("operator_reported");
    expect(result.opsTaskId).toBeNull();
    expect(result.actionIds).toEqual([result.dayDirectorCommitmentId]);
    expect(result.receipts.map(receipt => receipt.claimedState)).toEqual(["created"]);
    expect(result.weeklyIntentUnchanged).toBe(true);
    expect(result.weeklyIntentOverrideCode).toBe("operator_replaced_weekly_primary");
    expect(result.playableTitle).toBe(result.title);
    expect(box.rows).toHaveLength(1);
    expect(box.rows[0]).toMatchObject({
      status: "open",
      kind: "growth",
      businessDate: "2026-09-22",
      commandRole: "primary",
    });
    expect(box.rows[0]?.operatorMission).toMatchObject({
      source: "operator_explicit",
      scope: "today_only",
      verification: "operator_reported",
      weeklyIntentDisplacement: true,
      businessDate: "2026-09-22",
    });
    expect(box.calls.some(call => call.startsWith("accept:2026-09-22:day-director-42"))).toBe(true);
    expect(box.calls.some(call => call.includes("adam-open-id"))).toBe(false);
    expect(intent).toEqual(before);
    expect(intent.revision).toBe(3);
    expect(intent.days.find(day => day.businessDate === "2026-09-23")?.primary?.text).toBe("Walk the Louise");
  });

  it("retries and equivalent restatements stay one commitment", async () => {
    const box = harness();
    const first = await box.run("Claire, create today's mission: create and publish one static-image Instagram ad.");
    const second = await box.run("Claire, create today's mission: create and publish one static-image Instagram ad.");
    const third = await box.run("Make publishing the Instagram ad my mission today.");
    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;
    expect(second.speak).toBe(OPERATOR_MISSION_ALREADY_SPEAK);
    expect(second.receipts).toEqual([]);
    expect(second.actionIds).toEqual([]);
    expect(third.speak).toBe(OPERATOR_MISSION_ALREADY_SPEAK);
    expect(third.receipts).toEqual([]);
    expect(third.actionIds).toEqual([]);
    expect(second.dayDirectorCommitmentId).toBe(first.dayDirectorCommitmentId);
    expect(third.dayDirectorCommitmentId).toBe(first.dayDirectorCommitmentId);
    expect(box.rows).toHaveLength(1);
    expect(sameOperatorMission(first.title, "Publish the Instagram ad")).toBe(true);
    expect(box.rows[0]?.status).toBe("open");
  });

  it("an added action verb is a different mission and demotes the previous primary", async () => {
    const box = harness();
    const first = await box.run("Make publishing the Instagram ad my mission today.");
    const second = await box.run("Make publishing the Instagram ad and calling Dana my mission today.");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.speak).toBe(OPERATOR_MISSION_UPDATED_SPEAK);
    expect(second.title).toBe("Publish the Instagram ad and call Dana");
    expect(second.dayDirectorCommitmentId).not.toBe(first.dayDirectorCommitmentId);
    expect(second.receipts.map(receipt => receipt.claimedState)).toEqual(["updated"]);
    const previous = box.rows.find(row => row.id === first.dayDirectorCommitmentId);
    expect(previous).toMatchObject({ status: "open", commandRole: null });
    expect(box.rows.find(row => row.id === second.dayDirectorCommitmentId)?.commandRole).toBe("primary");
  });

  it("a different explicit mission replaces the primary without completing the previous one", async () => {
    const box = harness();
    const first = await box.run("Make publishing the Instagram ad my mission today.");
    const second = await box.run("Set calling 10 property managers as today's mission.");
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.speak).toBe(OPERATOR_MISSION_UPDATED_SPEAK);
    expect(second.speak).not.toMatch(BANNED);
    expect(second.dayDirectorCommitmentId).not.toBe(first.dayDirectorCommitmentId);
    expect(box.rows).toHaveLength(2);
    const previous = box.rows.find(row => row.id === first.dayDirectorCommitmentId);
    const current = box.rows.find(row => row.id === second.dayDirectorCommitmentId);
    expect(previous).toMatchObject({ status: "open", commandRole: null });
    expect(current).toMatchObject({
      status: "open",
      commandRole: "primary",
      title: "Call 10 property managers",
      kind: "growth",
    });
    expect(second.receipts.some(receipt => receipt.claimedState === "completed")).toBe(false);
  });

  it("refuses success when the write, designation, or readback fails", async () => {
    const accept = harness();
    accept.failNextAccept();
    const acceptFailed = await accept.run("Make publishing the Instagram ad my mission today.");
    expect(acceptFailed).toMatchObject({ ok: false, speak: OPERATOR_MISSION_FAILED_SPEAK });
    expect(acceptFailed.speak).not.toMatch(/\b(Created|Done|Saved|Set|Updated)\b/);

    const designate = harness();
    designate.failNextDesignate();
    const designateFailed = await designate.run("Make publishing the Instagram ad my mission today.");
    expect(designateFailed.speak).toBe(OPERATOR_MISSION_FAILED_SPEAK);

    const readback = harness();
    readback.overrideLoad(async () =>
      deriveDailyCommand({
        businessDate: "2026-09-22",
        actorId: "day-director-42",
        commitments: [],
        route: [],
        cargo: [],
        campaign: null,
        followUps: [],
      })
    );
    const unread = await readback.run("Make publishing the Instagram ad my mission today.");
    expect(unread.speak).toBe(OPERATOR_MISSION_FAILED_SPEAK);
    expect(unread.speak).not.toMatch(/Created/);
  });

  it("does not speak success when WeeklyIntent changes underfoot", async () => {
    let reads = 0;
    const result = await executeOperatorMissionCommand(
      {
        tenantId: "tenant-1",
        operatorUserId: "adam-open-id",
        dayDirectorActorId: "adam-open-id",
        businessDate: "2026-09-22",
        utterance: "Make publishing the Instagram ad my mission today.",
        sourceCommandRef: "voice:conv:turn:2",
      },
      {
        now: () => new Date("2026-09-22T17:00:00.000Z"),
        listToday: async () => [],
        latestIntent: async () => {
          reads += 1;
          const next = lockedTuesday();
          next.revision = reads === 1 ? 3 : 4;
          return next;
        },
        acceptProposal: async () => ({ id: "should-not-matter" }) as never,
        designatePrimary: async () => ({ commitmentId: "should-not-matter" }),
        loadCommand: async () => {
          throw new Error("readback must not license speech");
        },
      }
    );
    expect(result.speak).toBe(OPERATOR_MISSION_FAILED_SPEAK);
    expect(reads).toBeGreaterThan(1);
  });

  it("writes the resolved referent through the same command service", async () => {
    const box = harness();
    const intent = lockedTuesday();
    const before = structuredClone(intent);
    box.setIntent(intent);
    const missing = await box.run("make that today's mission");
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.speak).toBe(OPERATOR_MISSION_FAILED_SPEAK);
    expect(box.rows).toHaveLength(0);
    const result = await box.run(
      "I want this Meta ad make that today's mission",
      "voice:conv-1:turn:2",
      "I want this Meta ad"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.speak).toBe(OPERATOR_MISSION_CREATED_SPEAK);
    expect(result.title).toBe("This Meta ad");
    expect(result.status).toBe("open");
    expect(result.verification).toBe("operator_reported");
    expect(result.kind).toBe("growth");
    expect(result.businessDate).toBe("2026-09-22");
    expect(result.opsTaskId).toBeNull();
    expect(box.rows).toHaveLength(1);
    expect(intent).toEqual(before);
    expect(intent.days.find(day => day.businessDate === "2026-09-23")?.primary?.text).toBe("Walk the Louise");
  });

  it("does not write a non-command", async () => {
    const box = harness();
    const result = await box.run("I'm working on the ad today.");
    expect(result.ok).toBe(false);
    expect(box.rows).toHaveLength(0);
    expect(box.calls.some(call => call.startsWith("accept"))).toBe(false);
  });
});

describe("operator mission director and playable projection", () => {
  it("keeps an unready explicit mission as today's primary and does not select another campaign", () => {
    const quote = "Make publishing the static Instagram ad today's mission";
    const command = deriveDailyCommand({
      businessDate: "2026-09-22",
      actorId: "day-director-42",
      commitments: [
        {
          id: "ad-1",
          title: "Publish the static Instagram ad",
          kind: "growth",
          status: "open",
          sourceText: quote,
          detailState: "COMPLETE",
          scheduleKind: null,
          scheduleLabel: null,
          command: {
            ...emptyCommandMetadata(),
            role: "primary",
            designatedBy: "operator",
            designatedAt: "2026-09-22T16:00:00.000Z",
          },
          operatorMission: {
            version: 1,
            source: "operator_explicit",
            scope: "today_only",
            completionCondition: "The static Instagram ad is published.",
            verification: "operator_reported",
            operatorMissionKey: "om:ad",
            requestedAt: "2026-09-22T16:00:00.000Z",
            weeklyIntentDisplacement: true,
            sourceCommandRef: "voice:conv:turn:1",
            evidenceQuote: quote,
            businessDate: "2026-09-22",
          },
        },
      ],
      route: [],
      cargo: [],
      campaign: null,
      followUps: [],
    });
    expect(command.primary?.title).toBe("Publish the static Instagram ad");
    expect(command.constraints.protectDiscretionary).toBe(true);
    expect(command.explicitOperatorMission?.verification).toBe("operator_reported");
    const pockets = detectTimePockets({
      timeline: [
        { id: "p1", title: "Pickup", scheduledAt: "2026-09-22T15:00:00.000Z", kind: "pickup" },
        { id: "d1", title: "Delivery", scheduledAt: "2026-09-22T17:00:00.000Z", kind: "delivery" },
      ],
    });
    const protectedPockets = applyCommandProtection(pockets, command.constraints.protectDiscretionary);
    expect(protectedPockets[0]?.usableMinutes).toBe(0);
    const campaign = buildCampaign({
      campaignId: "local-digital-footprint-post",
      title: "Local digital footprint",
      pocketMinutesMin: 10,
      fallbackVariant: {
        title: "Short footprint note",
        completionCondition: "A short note is written.",
        pocketMinutesMin: 10,
      },
    });
    const ranking: RankingContext = { businessDate: "2026-09-22", macroGoal: null, openTasks: [] };
    const blocked = selectMissionPlan({
      eligible: [campaign],
      pockets: protectedPockets,
      libraryTotalCount: 1,
      libraryEnabledCount: 1,
      rankingContext: ranking,
    });
    const open = selectMissionPlan({
      eligible: [campaign],
      pockets,
      libraryTotalCount: 1,
      libraryEnabledCount: 1,
      rankingContext: ranking,
    });
    expect(blocked.status).toBe("no_plan");
    expect(open.status).toBe("planned");
    if (open.status === "planned") {
      expect(open.primary.campaignId).toBe("local-digital-footprint-post");
    }
    expect(command.primary?.title).not.toBe("Local digital footprint");
    expect(command.constraints.fingerprint).toContain("day-director:ad-1");
  });

  it("stays a Day Director adapter and does not grow a second mission system", () => {
    const source = readFileSync(new URL("./operatorMissionCommand.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/completeDayDirectorCommitment|saveWeeklyIntent|narrator|opsTasks|local-digital-footprint|runClaireBrainTurn|ExecutiveActionGrant/);
    const missionDirector = readFileSync(new URL("../missionDirector/missionDirectorService.ts", import.meta.url), "utf8");
    const compute = missionDirector.slice(
      missionDirector.indexOf("export async function computeMissionPlan"),
      missionDirector.indexOf("const activeRuns")
    );
    expect(compute).toMatch(/explicitOperatorMissionDisplacement/);
    expect(compute).toMatch(/applyWeeklyIntentToCommand/);
    expect(compute).not.toMatch(/saveWeeklyIntent|projectRecurrenceForDate/);
    const voice = readFileSync(new URL("./claireTwilio.ts", import.meta.url), "utf8");
    expect(voice.indexOf("executeOperatorMissionCommand")).toBeGreaterThan(0);
    expect(voice.indexOf("executeOperatorMissionCommand")).toBeLessThan(voice.indexOf("result = await runClaireTurn("));
    expect(voice).toMatch(/function startVoiceTurn[\s\S]*runAuthoritativeClaireVoiceTurn/);
    expect(voice).toMatch(/function runRelayAuthoritativeTurn[\s\S]*runAuthoritativeClaireVoiceTurn/);
    expect(source).not.toMatch(/from ["'][^"']*brain\//);
  });
});
