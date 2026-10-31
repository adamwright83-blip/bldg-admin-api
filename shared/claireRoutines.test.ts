import { describe, expect, it } from "vitest";
import type { AwaitingReplies } from "./firstTenMinutesKnowledge";
import {
  describeRoutine,
  nextRunAt,
  parseRoutineInstruction,
  ROUTINE_CAN_DO,
  ROUTINES_RULE,
  routineFindings,
  routinePeriodKey,
  routinesForBriefing,
  routinesOpeningLine,
  summarizeRoutineFindings,
  type RoutineView,
} from "./claireRoutines";

const LA = "America/Los_Angeles";
const parse = (text: string) => parseRoutineInstruction(text, LA);
const plan = (text: string) => {
  const parsed = parse(text);
  return parsed.ok ? [parsed.kind, parsed.cadence, parsed.weekday, parsed.localTime] : ["refused", parsed.reason];
};

describe("parseRoutineInstruction: the operator's words, read deterministically", () => {
  it.each([
    ["Every Monday morning, tell me who I'm waiting to hear back from", ["waiting_on", "weekly", 1, "08:00"]],
    ["Check every morning who wrote back", ["wrote_back", "daily", null, "08:00"]],
    ["Every Friday, list people who've gone quiet", ["waiting_on", "weekly", 5, "08:00"]],
    ["Daily at 9am: who hasn't replied?", ["waiting_on", "daily", null, "09:00"]],
    ["Every evening tell me who responded", ["wrote_back", "daily", null, "17:00"]],
    ["Every afternoon, who still owes me an answer", ["waiting_on", "daily", null, "13:00"]],
    ["On Mondays at 8:30am show me unanswered emails", ["waiting_on", "weekly", 1, "08:30"]],
    ["Tuesdays at 7pm — who got back to me", ["wrote_back", "weekly", 2, "19:00"]],
    ["weekly on Thursday, who do I need to follow up with", ["waiting_on", "weekly", 4, "08:00"]],
    ["Each Wednesday at 17:00 who answered", ["wrote_back", "weekly", 3, "17:00"]],
    ["Every day at 8 tell me who has no reply", ["waiting_on", "daily", null, "08:00"]],
    ["every sunday evening at 6 who replied", ["wrote_back", "weekly", 0, "18:00"]],
    ["Every morning at 10, who haven't I heard from", ["waiting_on", "daily", null, "10:00"]],
    ["Send me a list every Saturday of people who never got back to me", ["waiting_on", "weekly", 6, "08:00"]],
    ["Every morning, who wrote back since last night", ["wrote_back", "daily", null, "08:00"]],
    ["Every Friday at eight, who's waiting to hear back since Monday", ["waiting_on", "weekly", 5, "08:00"]],
    ["at 9 every day: who answered?", ["wrote_back", "daily", null, "09:00"]],
    ["Once a week on Monday, who's gone silent", ["waiting_on", "weekly", 1, "08:00"]],
  ])("%s", (text, expected) => {
    expect(plan(text)).toEqual(expected);
  });

  it("describes what it will do in words the operator can check before creating it", () => {
    const parsed = parse("Every Monday morning, tell me who I'm waiting to hear back from");
    expect(parsed.ok && parsed.describe).toBe("Every Monday at 8:00 — who you're waiting to hear back from");
    expect(describeRoutine({ kind: "wrote_back", cadence: "daily", weekday: null, localTime: "17:30" })).toBe("Every day at 17:30 — who wrote back since the last check");
  });

  it.each([
    ["Every Monday, email everyone who hasn't replied", /only read and report/],
    ["Every morning send a reminder to people who've gone quiet", /only read and report/],
    ["Every Friday, follow up with them", /only read and report/],
    ["Email me every Monday who hasn't replied", /report here, on the Claire Desk/],
    ["Every Monday tell me my revenue", /can't check that on a schedule/],
    ["Every hour, who replied", /once a day, or once a week/],
    ["Every month on the first, who hasn't replied", /once a day, or once a week/],
    ["Every weekday at 8 who's waiting", /Weekdays only/],
    ["Mondays and Thursdays, who's gone quiet", /One day a week per routine.*Monday.*Thursday/],
    ["Every day except Sunday, who replied", /can't skip days/],
    ["Every morning tell me who replied and who I'm still waiting on", /two checks/],
    ["Every Monday at 5, who replied", /5am or 5pm/],
    ["Every Monday at 25:00, who replied", /isn't a time/],
    ["Weekly, who hasn't replied", /which day of the week/],
    ["Who hasn't replied", /Say when/],
    ["Tomorrow, tell me who replied", /Routines repeat/],
    ["Every morning, people I haven't replied to", /who is waiting on you/],
    ["Every morning and evening, who replied", /One time per routine/],
    ["", /what to check, and when/],
  ])("refuses %j honestly, with what Claire can run today", (text, reason) => {
    const parsed = parse(text);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(reason);
    expect(parsed.canDo).toEqual([...ROUTINE_CAN_DO]);
  });

  it("refuses an unknown time zone instead of guessing one", () => {
    expect(parseRoutineInstruction("Every day, who replied", "Mars/Olympus")).toMatchObject({ ok: false, reason: /time zone/ });
  });
});

describe("nextRunAt: the routine's own local time, in its own zone", () => {
  const daily = { cadence: "daily" as const, weekday: null, localTime: "08:00", timeZone: LA };
  const monday = { cadence: "weekly" as const, weekday: 1, localTime: "08:00", timeZone: LA };

  it("later today when the time hasn't come, tomorrow when it has", () => {
    // Fri 30 Oct 2026, 07:00 PDT = 14:00Z
    expect(nextRunAt(daily, new Date("2026-10-30T14:00:00Z")).toISOString()).toBe("2026-10-30T15:00:00.000Z");
    expect(nextRunAt(daily, new Date("2026-10-30T15:00:00Z")).toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });

  it("stays at 8:00 local across the end of daylight saving (1 Nov 2026) and its start (8 Mar 2026)", () => {
    // Sat 31 Oct 08:00 PDT (15:00Z) -> Sun 1 Nov 08:00 PST (16:00Z)
    expect(nextRunAt(daily, new Date("2026-10-31T15:00:00Z")).toISOString()).toBe("2026-11-01T16:00:00.000Z");
    // Sat 7 Mar 08:00 PST (16:00Z) -> Sun 8 Mar 08:00 PDT (15:00Z)
    expect(nextRunAt(daily, new Date("2026-03-07T16:00:00Z")).toISOString()).toBe("2026-03-08T15:00:00.000Z");
  });

  it("weekly lands on its weekday and rolls over to next week once it has run", () => {
    // Sat 31 Oct -> Mon 2 Nov 08:00 PST
    expect(nextRunAt(monday, new Date("2026-10-31T18:00:00Z")).toISOString()).toBe("2026-11-02T16:00:00.000Z");
    // Mon 2 Nov 07:59 PST -> the same morning
    expect(nextRunAt(monday, new Date("2026-11-02T15:59:00Z")).toISOString()).toBe("2026-11-02T16:00:00.000Z");
    // Mon 2 Nov 08:00 PST, exactly when it ran -> Mon 9 Nov
    expect(nextRunAt(monday, new Date("2026-11-02T16:00:00Z")).toISOString()).toBe("2026-11-09T16:00:00.000Z");
    // Sunday late evening local is already Monday in UTC: still the coming Monday morning local
    expect(nextRunAt(monday, new Date("2026-11-02T06:30:00Z")).toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });

  it("a period is the local date, or the local date of that week's scheduled weekday", () => {
    expect(routinePeriodKey(daily, new Date("2026-11-01T06:30:00Z"))).toBe("2026-10-31");
    expect(routinePeriodKey(monday, new Date("2026-11-02T16:00:00Z"))).toBe("2026-11-02");
    // a late run on Wednesday still belongs to that Monday
    expect(routinePeriodKey(monday, new Date("2026-11-04T20:00:00Z"))).toBe("2026-11-02");
  });
});

describe("what a run found, in one line", () => {
  const now = new Date("2026-10-31T16:00:00Z");
  const awaiting: AwaitingReplies = {
    checkedAt: now.toISOString(),
    account: "nina@wildrootflowers.example",
    items: [
      { person: { name: "Elena Ruiz", address: "elena@larkspur.example" }, subject: "Friday flowers?", sentAt: "2026-10-27T16:00:00Z", waitingDays: 4, lastLine: "Is that still something you're looking for?", asked: true, messageId: "s-elena", threadId: "th-elena", url: "https://mail.google.com/mail/u/nina/#all/th-elena" },
      { person: { name: null, address: "sam@cafe.example" }, subject: "Order", sentAt: "2026-10-26T16:00:00Z", waitingDays: 5, lastLine: "Shall I?", asked: true, messageId: "s-sam", threadId: "th-sam", url: null },
    ],
    replies: [
      { person: { name: "Teo Marsh", address: "teo@marsh.example" }, subject: "Re: Standing order", at: "2026-10-29T17:00:00Z", snippet: "Yes please.", messageId: "r-teo", threadId: "th-teo", url: "https://mail.google.com/mail/u/nina/#all/th-teo" },
      { person: { name: "Ivy", address: "ivy@old.example" }, subject: "Re: old", at: "2026-10-10T17:00:00Z", snippet: "Thanks", messageId: "r-ivy", threadId: "th-ivy", url: null },
    ],
    unavailable: null,
    scanned: { sent: 2, received: 2, days: 30 },
  };

  it("waiting on: each person with how long, and a link to the message", () => {
    const findings = routineFindings("waiting_on", awaiting, { since: null, now });
    expect(findings.items.map(item => [item.person.name ?? item.person.address, item.waitingDays, item.messageId, item.url])).toEqual([
      ["Elena Ruiz", 4, "s-elena", "https://mail.google.com/mail/u/nina/#all/th-elena"],
      ["sam@cafe.example", 5, "s-sam", null],
    ]);
    expect(summarizeRoutineFindings(findings, LA)).toBe("You're waiting on a reply from 2 people: Elena Ruiz (4 days) and sam@cafe.example (5 days).");
    expect(summarizeRoutineFindings({ ...findings, items: [] }, LA)).toBe("Nobody you wrote to still owes you a reply.");
  });

  it("wrote back: the last 7 days on a first check, since the previous check after that", () => {
    const first = routineFindings("wrote_back", awaiting, { since: null, now });
    expect(first.items.map(item => item.messageId)).toEqual(["r-teo"]);
    expect(summarizeRoutineFindings(first, LA)).toBe("1 person wrote back in the last 7 days: Teo Marsh (Thu 29 Oct).");
    const later = routineFindings("wrote_back", awaiting, { since: new Date("2026-10-30T00:00:00Z"), now });
    expect(summarizeRoutineFindings(later, LA)).toBe("Nobody wrote back since the last check.");
  });

  it("Gmail that couldn't be read says why rather than 'nobody'", () => {
    const findings = routineFindings("waiting_on", { ...awaiting, items: [], unavailable: "Gmail isn't connected to this workspace." }, { since: null, now });
    expect(summarizeRoutineFindings(findings, LA)).toBe("Not checked: Gmail isn't connected to this workspace.");
    expect(summarizeRoutineFindings(routineFindings("wrote_back", null, { since: null, now }), LA)).toBe("Not checked: No Gmail is connected to this workspace.");
  });
});

describe("Claire's briefing and the desk's opening line", () => {
  const view = (patch: Partial<RoutineView> = {}): RoutineView => ({
    id: "r1",
    instruction: "Every Monday morning, tell me who I'm waiting to hear back from",
    kind: "waiting_on",
    cadence: "weekly",
    weekday: 1,
    localTime: "08:00",
    timeZone: LA,
    status: "active",
    describe: "Every Monday at 8:00 — who you're waiting to hear back from",
    nextRunAt: "2026-11-09T16:00:00.000Z",
    lastRunAt: "2026-11-02T16:00:05.000Z",
    createdAt: "2026-10-31T16:00:00.000Z",
    runs: [
      {
        id: "run1",
        trigger: "schedule",
        status: "done",
        attempts: 1,
        startedAt: "2026-11-02T16:00:00.000Z",
        finishedAt: "2026-11-02T16:00:05.000Z",
        summary: "You're waiting on a reply from 3 people: A (4 days), B (3 days) and C (2 days).",
        findings: { kind: "waiting_on", checkedAt: "2026-11-02T16:00:04.000Z", account: null, unavailable: null, since: null, firstCheck: false, items: [1, 2, 3].map(n => ({ person: { name: `P${n}`, address: `p${n}@x.example` }, subject: "s", at: "2026-10-30T16:00:00Z", waitingDays: n, line: "?", messageId: `m${n}`, threadId: `t${n}`, url: null })) },
        note: null,
      },
    ],
    ...patch,
  });

  it("each routine in words with its latest run as recorded", () => {
    expect(routinesForBriefing([view()], LA)).toEqual([
      {
        routine: "Every Monday at 8:00 — who you're waiting to hear back from",
        instruction: "Every Monday morning, tell me who I'm waiting to hear back from",
        status: "active",
        nextRun: "Monday 9 November, 08:00",
        lastRun: { at: "Monday 2 November, 08:00", trigger: "schedule", status: "done", summary: expect.stringMatching(/^You're waiting on a reply from 3 people/), found: 3 },
      },
    ]);
    expect(routinesForBriefing([view({ status: "paused", nextRunAt: null, runs: [] })], LA)[0]).toMatchObject({ status: "paused", nextRun: null, lastRun: null });
    expect(ROUTINES_RULE).toMatch(/never say a routine ran, or what it found, unless lastRun shows it/);
    expect(ROUTINES_RULE).toMatch(/never send, contact, label or change anything/);
  });

  it("mentions a scheduled run only when it finished since the last visit", () => {
    expect(routinesOpeningLine([view()], new Date("2026-11-01T00:00:00Z"))).toBe("Your Monday check found 3 people you're waiting to hear back from.");
    expect(routinesOpeningLine([view()], new Date("2026-11-03T00:00:00Z"))).toBeNull();
    expect(routinesOpeningLine([view()], null)).toBeNull();
    const manual = view({ runs: [{ ...view().runs[0], trigger: "manual" }] });
    expect(routinesOpeningLine([manual], new Date("2026-11-01T00:00:00Z"))).toBeNull();
  });
});

describe("waiting words that carry their own noun", () => {
  it.each([
    ["Every Monday, who am I waiting on a reply from", "waiting_on"],
    ["Every morning, who's waiting for an answer from me", "refused"],
    ["Every Friday, who still owes me a response", "waiting_on"],
    ["Every morning, who have I not heard from", "waiting_on"],
  ])("%s", (text, kind) => {
    expect(plan(text)[0]).toBe(kind);
  });
});
