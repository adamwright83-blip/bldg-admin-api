import { describe, expect, it, vi } from "vitest";
import type { BriefingItem, ParsedBriefing } from "../briefing/briefingTypes";
import { commitBriefing, speakBriefingCommit } from "../briefing/briefingCommit";
import { acceptRewrittenTitle, gateDayLineTitle } from "../briefing/dayLineTitleGate";
import { enforceTitleContract } from "../briefing/titleContract";
import { validateWorkLedgerPlan, type WorkLedgerPlanInput } from "../workLedger/workLedgerPlanner";
import { dedupeStopsByBuilding, normalizeAddressKey } from "./buildingDedupe";
import { isTestFixtureTitle } from "./testDataGuard";
import { isWeekendBusinessDate, looksLikeSalesFollowUp, mayRaiseOverdueSalesFollowUp } from "./weekendQuietRule";
import {
  agendaQuestion,
  applyOpenItemDecision,
  collapseOpenCommitments,
  interpretOpenItemReply,
  type OpenItemDeps,
} from "./openItemLifecycle";
import { followUpKind, sameFollowUpKind } from "../../domains/commercial/followUpIdempotency";
import {
  projectDriverDayLineForCall,
  speakDriverDayLineCall,
  type DriverDayLineCallFacts,
  type DriverDayLineStopFact,
} from "../showrunner/driverDayLineCall";
import { showrunnerOpening, type ShowrunnerBriefing } from "../showrunner/showrunnerBriefing";
import { runShowrunnerTurn, type ShowrunnerCallState } from "../showrunner/showrunnerTurn";
import type { FieldTodayProjection } from "../../field/types";

// What production actually stored (day_director_commitments, tenant default, actor 1).
const JUNK = {
  streets: {
    id: "1019eee6-e53e-4a59-919e-32e08f5c77f3",
    title: "Figure out how to get out in streets",
    quote: "I have to figure out how to get out in the streets and hand printouts out to people and basically hype our fluff",
  },
  fold: {
    id: "5442b244-5668-4763-b348-b981c240f76a",
    title: "Fold service in person to people and try",
    quote: "fold service in person to people and try to find interested people that'll become customers",
  },
  page: {
    id: "7f913f53-d73a-4d6b-b388-b78719ba78d4",
    title: "Before I leave work, I have to create new page for Laundry Farm",
    quote: "before I leave work, I have to create a new page for our Laundry Farm landing page website.",
  },
};

function item(over: Partial<BriefingItem> & Pick<BriefingItem, "title" | "quote">): BriefingItem {
  return {
    kind: "new_work",
    businessDate: "2026-10-19",
    timing: { kind: "none" },
    quantity: null,
    people: [],
    place: null,
    needs: null,
    existing: null,
    ...over,
  };
}

function ledgerFixture() {
  const rows = new Map<string, any>();
  const accept = vi.fn(async (input: any) => {
    const row = {
      id: `row-${rows.size + 1}`,
      tenantId: input.tenantId,
      actorId: input.actorId,
      businessDate: input.businessDate,
      title: input.proposal.title,
      status: "open",
      metadataJson: { command: input.proposal.command, ...(input.proposal.executionType ? { executionType: input.proposal.executionType } : {}) },
    };
    rows.set(row.id, row);
    return { stored: row, created: true };
  });
  const readCanonical = vi.fn(async ({ commitmentId }: any) => rows.get(commitmentId) ?? null);
  return { rows, accept, ports: { accept: accept as never, readCanonical: readCanonical as never } };
}

const scope = { tenantId: "default", dayDirectorActorId: "1", operatorUserId: "adam", conversationKey: "oct20" };
const parsed = (items: BriefingItem[]): ParsedBriefing => ({ items, context: [], questions: [], unparsed: [], source: "model" });

describe("1. title gate: a raw utterance fragment never becomes a Day Line row", () => {
  it("refuses the two chopped fragments that reached production on 2026-10-19", () => {
    for (const junk of [JUNK.streets, JUNK.fold]) {
      const verdict = gateDayLineTitle({ title: junk.title, quote: junk.quote });
      expect(verdict.verdict).toBe("needs_rewrite");
      if (verdict.verdict !== "commit") expect(verdict.question).toMatch(/What should the Day Line say\?$/);
    }
  });

  it("deletes the lead-in from 'Before I leave work, I have to …' and keeps the task", () => {
    const verdict = gateDayLineTitle({ title: JUNK.page.title, quote: JUNK.page.quote });
    expect(verdict).toMatchObject({ verdict: "commit", title: "Create new page for Laundry Farm", changed: true });
  });

  it("rejects pronoun/conjunction openers and one-word fragments", () => {
    expect(gateDayLineTitle({ title: "And", quote: "and" }).verdict).not.toBe("commit");
    expect(gateDayLineTitle({ title: "So the thing is", quote: "so the thing is the page" }).verdict).not.toBe("commit");
    expect(gateDayLineTitle({ title: "Laundry stuff", quote: "laundry stuff" }).verdict).not.toBe("commit");
  });

  it("leaves real titles alone, including a short verb + named object", () => {
    for (const title of ["Call Dana", "Call Dana to resolve the overdue Louise follow-up", "Pick up from KITH TREATS at 10", "Build Laundry Farm landing page to match Instagram ad"]) {
      expect(gateDayLineTitle({ title, quote: title })).toMatchObject({ verdict: "commit", title, changed: false });
    }
  });

  it("a model rewrite is accepted only when every content word is the operator's own", () => {
    expect(acceptRewrittenTitle("Hand printouts out to people in the streets", JUNK.streets.quote)).toBe("Hand printouts out to people in the streets");
    expect(acceptRewrittenTitle("Print flyers for Echo Park residents", JUNK.streets.quote)).toBeNull();
    expect(acceptRewrittenTitle("And then try", JUNK.fold.quote)).toBeNull();
  });

  it("commitBriefing replays the three production utterances: no junk row, one question, the operator's words kept", async () => {
    const f = ledgerFixture();
    const result = await commitBriefing(
      parsed([
        item({ title: JUNK.streets.title, quote: JUNK.streets.quote }),
        item({ title: JUNK.fold.title, quote: JUNK.fold.quote }),
        item({ title: JUNK.page.title, quote: JUNK.page.quote, businessDate: "2026-10-15" }),
      ]),
      scope,
      { ...f.ports, rewriteTitle: null }
    );
    // Only the lead-in one is written, with the lead-in deleted and the full sentence kept as the objective.
    expect(f.accept).toHaveBeenCalledTimes(1);
    const written = f.accept.mock.calls[0]![0] as any;
    expect(written.proposal.title).toBe("Create new page for Laundry Farm");
    expect(written.proposal.sourceText).toBe(JUNK.page.quote);
    expect([...f.rows.values()].map(row => row.title)).toEqual(["Create new page for Laundry Farm"]);
    // The two fragments are unsaved, flagged, and spoken as a question, never as "Done".
    expect(result.needsClarification).toHaveLength(2);
    const speech = speakBriefingCommit(result, "2026-10-20");
    expect(speech).toContain("What should the Day Line say?");
    expect(speech).toContain("I'll ask about the others after.");
    expect(speech).not.toMatch(/Figure out how to get out in streets|Fold service in person/);
  });

  it("a grounded model rewrite is committed; a hallucinated one falls back to the question", async () => {
    const good = ledgerFixture();
    const ok = await commitBriefing(parsed([item({ title: JUNK.streets.title, quote: JUNK.streets.quote })]), scope, {
      ...good.ports,
      rewriteTitle: async () => "Hand printouts out to people in the streets",
    });
    expect(ok.needsClarification).toHaveLength(0);
    expect([...good.rows.values()].map(row => row.title)).toEqual(["Hand printouts out to people in the streets"]);
    expect((good.accept.mock.calls[0]![0] as any).proposal.sourceText).toBe(JUNK.streets.quote);

    const bad = ledgerFixture();
    const refused = await commitBriefing(parsed([item({ title: JUNK.streets.title, quote: JUNK.streets.quote })]), scope, {
      ...bad.ports,
      rewriteTitle: async () => "Print flyers for Echo Park residents",
    });
    expect(bad.accept).not.toHaveBeenCalled();
    expect(refused.needsClarification).toHaveLength(1);
  });
});

describe("2. readback names what was added this turn, with the credit kind the operator declared", () => {
  const OCT15 =
    "I want this to go on the record as a marketing challenge so that I get credit for it because it's important that everything I'm doing like this is recorded as either a marketing challenge or a sales mission.";

  it("reads back 'Recorded as a marketing challenge: <title>' and never a bare line count first", async () => {
    const f = ledgerFixture();
    const challenge = item({
      title: "Build Laundry Farm landing page to match Instagram ad",
      quote: OCT15,
      businessDate: "2026-10-15",
      executionType: "challenge",
    });
    const result = await commitBriefing(parsed([challenge, item({ title: "Call Ava about the estimate", quote: "call Ava about the estimate", businessDate: "2026-10-15" })]), scope, { ...f.ports, rewriteTitle: null });
    const speech = speakBriefingCommit(result, "2026-10-15");
    expect(speech).toContain("Recorded as a marketing challenge: Build Laundry Farm landing page to match Instagram ad, for today.");
    expect(speech).toContain("Added Call Ava about the estimate for today.");
    expect(speech).not.toMatch(/\d+ on (?:today|tomorrow)'s line/);
    // The count is only a trailing aside.
    expect(speech.endsWith("That's 2 new items in all.")).toBe(true);
    expect((f.accept.mock.calls[0]![0] as any).proposal.executionType).toBe("challenge");
  });

  it("does not call every challenge a marketing challenge or every mission a sales mission", async () => {
    const f = ledgerFixture();
    const result = await commitBriefing(
      parsed([
        item({ title: "Text the dormant customers", quote: "text the dormant customers", executionType: "challenge", businessDate: "2026-10-15" }),
        item({ title: "Visit Greystar properties", quote: "visit the Greystar properties", executionType: "mission", businessDate: "2026-10-15" }),
        item({ title: "Pitch Wilshire Grand", quote: "pitch Wilshire Grand as a sales mission", executionType: "mission", businessDate: "2026-10-15" }),
      ]),
      scope,
      { ...f.ports, rewriteTitle: null }
    );
    const speech = speakBriefingCommit(result, "2026-10-15");
    expect(speech).toContain("Recorded as a challenge: Text the dormant customers, for today.");
    expect(speech).toContain("Recorded as a mission: Visit Greystar properties, for today.");
    expect(speech).toContain("Recorded as a sales mission: Pitch Wilshire Grand, for today.");
    expect(speech).not.toContain("marketing challenge");
  });

  it("the work ledger carries the declared kind onto the one item being saved, even when the model forgot it", () => {
    const input: WorkLedgerPlanInput = {
      tenantId: "default",
      utterance: OCT15,
      transcript: [{ speaker: "operator", text: "I need to build the Laundry Farm landing page to match the Instagram ad." }],
      dayLine: [],
      held: [],
      clock: { today: "2026-10-15", tomorrow: "2026-10-16", localTime: "5:31 PM", timeZone: "America/Los_Angeles" },
      sessionKind: "pre_drive",
      callFacts: [],
    };
    const plan = validateWorkLedgerPlan(
      {
        workChanged: true,
        endCall: false,
        held: [
          {
            ref: "new-1",
            title: "Build Laundry Farm landing page to match Instagram ad",
            day: "today",
            date: "",
            timing: "",
            executionType: "none",
            detail: "",
            quote: "I need to build the Laundry Farm landing page to match the Instagram ad.",
            save: true,
            unchanged: false,
          },
        ],
        edits: [],
        completeIds: [],
        confirmIds: [],
        removeIds: [],
        reply: "",
        operatorSignal: { kind: "none", about: "", quote: "" },
      },
      input,
      1
    );
    expect(plan.held[0]!.executionType).toBe("challenge");
  });
});

describe("3. duplicate stops speak once per building", () => {
  it("collapses the two Los Feliz Towers follow-ups and The Louise / The Louise Los Feliz at one address", () => {
    const stops = [
      { id: "living-world-follow-up:a", title: "The Louise", address: "1633 N Edgemont St, Los Angeles, CA 90027", physicalEntityId: null },
      { id: "living-world-follow-up:b", title: "Los Feliz Towers", address: null, physicalEntityId: null },
      { id: "living-world-follow-up:c", title: "The Louise Los Feliz", address: "1633 North Edgemont Street", physicalEntityId: null },
      { id: "living-world-follow-up:d", title: "Los Feliz Towers", address: null, physicalEntityId: null },
      { id: "living-world-follow-up:e", title: "sageLA", address: null, physicalEntityId: null },
    ];
    expect(dedupeStopsByBuilding(stops).map(stop => stop.title)).toEqual(["The Louise", "Los Feliz Towers", "sageLA"]);
    expect(normalizeAddressKey("1633 N Edgemont St, Los Angeles")).toBe(normalizeAddressKey("1633 North Edgemont Street"));
  });

  function fact(over: Partial<DriverDayLineStopFact> & Pick<DriverDayLineStopFact, "id" | "title">): DriverDayLineStopFact {
    return { status: "ready", timeLabel: "Flexible today", executable: true, completion: "unfinished", needsApproval: false, evidence: null, source: "living_world", ...over };
  }

  it("the opening line from 2026-10-20 no longer lists a building twice", () => {
    const line: DriverDayLineCallFacts = {
      read: "read",
      businessDate: "2026-10-20",
      designatedMission: null,
      fieldBlockers: [],
      pendingApproval: [],
      omissions: [],
      stops: [
        fact({ id: "1", title: "The Louise", address: "1633 N Edgemont St" }),
        fact({ id: "2", title: "Los Feliz Towers" }),
        fact({ id: "3", title: "The Louise Los Feliz", address: "1633 North Edgemont Street" }),
        fact({ id: "4", title: "Los Feliz Towers" }),
        fact({ id: "5", title: "sageLA" }),
        fact({ id: "6", title: "Jojo Test", source: "laundry_butler" }),
      ],
    };
    const spoken = speakDriverDayLineCall(line, "evening_debrief");
    expect(spoken).toBe("Still open: The Louise, Los Feliz Towers and sageLA.");
  });

  it("two pickups at one address are two people and are never merged", () => {
    const line: DriverDayLineCallFacts = {
      read: "read", businessDate: "2026-10-20", designatedMission: null, fieldBlockers: [], pendingApproval: [], omissions: [],
      stops: [
        fact({ id: "p1", title: "Pick up Ana", source: "laundry_butler", address: "3545 Wilshire Blvd" }),
        fact({ id: "p2", title: "Pick up Ben", source: "laundry_butler", address: "3545 Wilshire Blvd" }),
      ],
    };
    expect(speakDriverDayLineCall(line, "morning_readiness")).toBe("On today's line: Pick up Ana and Pick up Ben.");
  });

  it("follow-up writers treat 'email him with collateral' and 'Email him the collateral' as one kind", () => {
    expect(followUpKind("email him with collateral")).toBe(followUpKind("Email him the collateral"));
    expect(sameFollowUpKind("email him with collateral", "Email him the collateral")).toBe(true);
    expect(sameFollowUpKind("email him with collateral", "call about pricing")).toBe(false);
  });
});

describe("4. an open item across dates is one item with its age, asked as a yes/no", () => {
  const dana = [
    { id: "a9205d11", title: "Call Dana", businessDate: "2026-09-21", status: "open" as const },
    { id: "8baa4898", title: "Call Dana", businessDate: "2026-09-22", status: "open" as const },
    { id: "cf7f48fb", title: "Call Dana Tuesday", businessDate: "2026-09-29", status: "open" as const },
    { id: "e758bb5d", title: "Call Dana to resolve the overdue Louise follow-up", businessDate: "2026-10-13", status: "open" as const },
    { id: "b4b08ed4", title: "Win back lapsed Silver Lake customers", businessDate: "2026-10-19", status: "open" as const },
  ];

  it("collapses the four Call Dana rows to one item, keeps the latest, counts the age from the first", () => {
    const carried = collapseOpenCommitments(dana, "2026-10-20");
    expect(carried.map(entry => entry.title)).toEqual([
      "Call Dana to resolve the overdue Louise follow-up",
      "Win back lapsed Silver Lake customers",
    ]);
    expect(carried[0]).toMatchObject({ keeperId: "e758bb5d", ageDays: 29, ids: ["a9205d11", "8baa4898", "cf7f48fb", "e758bb5d"] });
    expect(carried[0]!.question).toBe("Did you call Dana?");
  });

  it("asks yes/no questions an operator can answer in a word", () => {
    expect(agendaQuestion("Call Dana Tuesday")).toBe("Did you call Dana?");
    expect(agendaQuestion("Follow up with Maria at KITH")).toBe("Did you follow up with Maria?");
    expect(agendaQuestion("Build the landing page")).toBe("Did you build the landing page?");
  });

  it("reads done, drop, not-this-week and 'never talk about it again'", () => {
    const today = "2026-10-20"; // Tuesday
    expect(interpretOpenItemReply("yes", today)).toEqual({ kind: "done" });
    expect(interpretOpenItemReply("I called her this morning", today)).toEqual({ kind: "done" });
    expect(interpretOpenItemReply("no, not yet", today)).toEqual({ kind: "still_open" });
    expect(interpretOpenItemReply("drop it", today)).toEqual({ kind: "drop" });
    expect(interpretOpenItemReply("kill it", today)).toEqual({ kind: "drop" });
    expect(interpretOpenItemReply("I will resolve this so that you never talk about it again", today)).toEqual({ kind: "drop" });
    expect(interpretOpenItemReply("not this week", today)).toEqual({ kind: "snooze", until: "2026-10-26" });
    expect(interpretOpenItemReply("push it to Friday", today)).toEqual({ kind: "snooze", until: "2026-10-23" });
  });

  function deps(rows: Map<string, { id: string; businessDate: string; status: string }>, over: Partial<OpenItemDeps> = {}): OpenItemDeps {
    return {
      complete: vi.fn(async ({ commitmentId }: any) => {
        rows.get(commitmentId)!.status = "completed";
        return { ok: true } as never;
      }) as never,
      cancel: vi.fn(async ({ item }: any) => {
        rows.delete(item.sourceId);
        return { ok: true } as never;
      }) as never,
      move: vi.fn(async ({ commitmentId, toBusinessDate }: any) => {
        rows.get(commitmentId)!.businessDate = toBusinessDate;
        return true;
      }) as never,
      readState: vi.fn(async ({ businessDate }: any) => ({
        commitments: [...rows.values()].filter(row => row.businessDate === businessDate),
      })) as never,
      ...over,
    };
  }
  const seed = () => new Map(dana.slice(0, 4).map(row => [row.id, { id: row.id, businessDate: row.businessDate, status: "open" }]));
  const carried = () => collapseOpenCommitments(dana, "2026-10-20")[0]!;

  it("'drop it' cancels every copy through the governed path and reads the line back before speaking", async () => {
    const rows = seed();
    const d = deps(rows);
    const outcome = await applyOpenItemDecision({ decision: { kind: "drop" }, item: carried(), target: { tenantId: "default", actorId: "1" }, operatorWords: "drop it", today: "2026-10-20", deps: d });
    expect(outcome).toMatchObject({ applied: true, verified: true });
    expect(outcome.speak).toBe('Dropped "Call Dana to resolve the overdue Louise follow-up" and cleared 3 older copies. It\'s off the line.');
    expect(d.cancel).toHaveBeenCalledTimes(4);
    expect(rows.size).toBe(0);
  });

  it("'done' completes the newest and folds the older copies", async () => {
    const rows = seed();
    const outcome = await applyOpenItemDecision({ decision: { kind: "done" }, item: carried(), target: { tenantId: "default", actorId: "1" }, operatorWords: "yes", today: "2026-10-20", deps: deps(rows) });
    expect(outcome.speak).toBe('Marked "Call Dana to resolve the overdue Louise follow-up" done and cleared 3 older copies.');
    expect(rows.get("e758bb5d")!.status).toBe("completed");
    expect(rows.size).toBe(1);
  });

  it("'not this week' moves the keeper to Monday and says the day", async () => {
    const rows = seed();
    const outcome = await applyOpenItemDecision({ decision: { kind: "snooze", until: "2026-10-26" }, item: carried(), target: { tenantId: "default", actorId: "1" }, operatorWords: "not this week", today: "2026-10-20", deps: deps(rows) });
    expect(outcome.applied).toBe(true);
    expect(outcome.speak).toMatch(/^Moved "Call Dana to resolve the overdue Louise follow-up" to /);
    expect(rows.get("e758bb5d")!.businessDate).toBe("2026-10-26");
  });

  it("never claims a close it could not verify", async () => {
    const rows = seed();
    const lying = deps(rows, { cancel: vi.fn(async () => ({ ok: true })) as never }); // reports success, removes nothing
    const outcome = await applyOpenItemDecision({ decision: { kind: "drop" }, item: carried(), target: { tenantId: "default", actorId: "1" }, operatorWords: "drop it", today: "2026-10-20", deps: lying });
    expect(outcome).toMatchObject({ applied: false, verified: false });
    expect(outcome.speak).toContain("couldn't verify");
    expect(outcome.speak).toContain("still open");
  });

  function briefing(over: Partial<ShowrunnerBriefing> = {}): ShowrunnerBriefing {
    return {
      purpose: "evening_debrief", businessDate: "2026-10-20", weekday: "Tuesday", objective: null, weekPlan: null, today: [], tomorrow: [],
      developments: [], pendingDecision: null, adaptations: [], uncertain: [], weekToDate: { reportedOutcomes: [], planChanges: [] },
      driverDayLine: { read: "read", businessDate: "2026-10-20", stops: [], designatedMission: null, fieldBlockers: [], pendingApproval: [], omissions: [] },
      carriedOpen: collapseOpenCommitments(dana, "2026-10-20"),
      ...over,
    };
  }

  it("the evening opening ends on the one yes/no question, not a list and a generic 'How did it go?'", () => {
    const opening = showrunnerOpening(briefing());
    expect(opening).toContain("One thing has been open 29 days across 4 entries: Call Dana to resolve the overdue Louise follow-up.");
    expect(opening.endsWith("Did you call Dana?")).toBe(true);
    expect(opening).not.toContain("How did it go?");
  });

  it("the answer on the call closes it through the governed path and speaks the readback", async () => {
    const rows = seed();
    const state = {
      purpose: "evening_debrief", tenantId: "default", canonicalOperatorId: "op", operatorUserId: "adam", dayDirectorActorId: "1", dayDirectorActorIds: ["1"],
      timeZone: "America/Los_Angeles", businessDate: "2026-10-20", briefing: briefing(),
      captured: { missionUpdates: [], developments: [], readinessNeeds: [] }, replan: null, turns: 0,
    } as unknown as ShowrunnerCallState;
    const invoke = vi.fn();
    const turn = await runShowrunnerTurn({
      state, history: [], utterance: "I will resolve this so that you never talk about it again", sourceEventId: "e1", conversationKey: "c1",
      invoke: invoke as never, openItem: deps(rows),
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(turn.speak).toBe('Dropped "Call Dana to resolve the overdue Louise follow-up" and cleared 3 older copies. It\'s off the line. How did the rest of the day go?');
    expect(turn.state.openItemHandled).toBe(true);
    expect(rows.size).toBe(0);
  });
});

describe("weekend default: an overdue sales follow-up is not raised on Saturday or Sunday unless asked", () => {
  it("knows the weekend", () => {
    expect(isWeekendBusinessDate("2026-10-18")).toBe(true); // the Saturday Claire said '71 days overdue'
    expect(isWeekendBusinessDate("2026-10-19")).toBe(false);
    expect(mayRaiseOverdueSalesFollowUp({ businessDate: "2026-10-18" })).toBe(false);
    expect(mayRaiseOverdueSalesFollowUp({ businessDate: "2026-10-18", operatorAsked: true })).toBe(true);
    expect(looksLikeSalesFollowUp("Call Dana to resolve the overdue Louise follow-up")).toBe(true);
    expect(looksLikeSalesFollowUp("Deliver two dry cleaning orders")).toBe(false);
  });

  const field = (businessDate: string): FieldTodayProjection =>
    ({
      businessDate,
      timeline: [
        { id: "follow-up:louise", kind: "follow_up", urgency: "overdue", title: "The Louise", subtitle: "", status: "open", scheduledAt: "2026-08-07T22:00:00Z", destination: null, customer: null, money: null, source: { entityType: "x", entityId: "x", sourceReference: "x" }, verificationClass: "VERIFIED", actions: [] },
      ],
      blockers: [],
      authoritativeCompletedObjectiveIds: [],
      nextFixedCommitment: null,
    }) as unknown as FieldTodayProjection;

  it("Saturday: the overdue Louise follow-up stays on the line but is not spoken", () => {
    const sat = projectDriverDayLineForCall({ businessDate: "2026-10-17", now: new Date("2026-10-18T01:00:00Z"), field: field("2026-10-17") });
    expect(sat.stops.map(stop => stop.title)).toEqual(["The Louise"]);
    expect(sat.withheld?.weekendFollowUps).toBe(1);
    expect(speakDriverDayLineCall(sat, "evening_debrief")).toBe("Nothing was left open on today's line.");
  });

  it("Monday: it is spoken; Saturday with an operator ask: it is spoken", () => {
    const mon = projectDriverDayLineForCall({ businessDate: "2026-10-19", now: new Date("2026-10-19T22:00:00Z"), field: field("2026-10-19") });
    expect(speakDriverDayLineCall(mon, "evening_debrief")).toBe("Still open: The Louise.");
    const asked = projectDriverDayLineForCall({ businessDate: "2026-10-17", now: new Date("2026-10-18T01:00:00Z"), field: field("2026-10-17"), operatorAskedAboutSales: true });
    expect(speakDriverDayLineCall(asked, "evening_debrief")).toBe("Still open: The Louise.");
  });
});

describe("5. test data never reaches a production briefing", () => {
  it("matches the Jojo Test order and the CODEX E2E fixtures, not ordinary titles", () => {
    expect(isTestFixtureTitle("Jojo Test")).toBe(true);
    expect(isTestFixtureTitle("Pick up Jojo Test")).toBe(true);
    expect(isTestFixtureTitle("CODEX PROPERTY MISSION E2E 184fdf60 — SAFE TO ARCHIVE")).toBe(true);
    expect(isTestFixtureTitle("Call Dana")).toBe(false);
    // Titles the Claire Desk acceptance spec uses are ordinary titles, not test data.
    expect(isTestFixtureTitle("Desk fixture second mission")).toBe(false);
    expect(isTestFixtureTitle("Contest entry for Laundry Farm")).toBe(false);
  });

  it("the projection withholds a test stop and says how many it withheld", () => {
    const projection = projectDriverDayLineForCall({
      businessDate: "2026-10-20",
      now: new Date("2026-10-20T20:00:00Z"),
      field: { businessDate: "2026-10-20", timeline: [
        { id: "recovery:jojo", kind: "customer_recovery", urgency: "scheduled", title: "Jojo Test", subtitle: "", status: "open", scheduledAt: null, destination: null, customer: null, money: null, source: { entityType: "x", entityId: "x", sourceReference: "x" }, verificationClass: "VERIFIED", actions: [] },
      ], blockers: [], authoritativeCompletedObjectiveIds: [], nextFixedCommitment: null } as unknown as FieldTodayProjection,
    });
    expect(projection.stops.map(stop => stop.title)).not.toContain("Jojo Test");
    expect(projection.withheld?.testData).toBe(1);
  });
});

describe("the title contract no longer chops a faithful title", () => {
  it("keeps the last word of a nine-word title", () => {
    const title = "Build Laundry Farm landing page to match Instagram ad";
    expect(enforceTitleContract(title)).toBe(title);
  });
  it("the gate refuses a title the contract would cut in the middle of the task", () => {
    const long = "Figure out how to get out in the streets and hand printouts out to people everywhere";
    expect(gateDayLineTitle({ title: long, quote: long }).verdict).toBe("needs_rewrite");
  });
});

describe("the assertion guard still blocks free-form speech that imitates the new commit readback", () => {
  it("flags a model-written 'Done. Added …' and 'Recorded as a marketing challenge: …' without a receipt", async () => {
    const { lintPostGenerationStateVerbs, VerifiedFactInventory } = await import("../assertionGuard");
    const empty = new VerifiedFactInventory([]);
    expect(lintPostGenerationStateVerbs("Done. Added Call Ava for today.", empty).pass).toBe(false);
    expect(lintPostGenerationStateVerbs("Recorded as a marketing challenge: Build the page, for today.", empty).pass).toBe(false);
  });
});
