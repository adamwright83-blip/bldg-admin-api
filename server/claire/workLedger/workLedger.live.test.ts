/**
 * Real-model replay of the production call that failed on 2026-10-15
 * (conversation 86279c0b, 17:30–17:34 PT), through the work ledger.
 *
 * The operator's words are the production transcript verbatim, including the
 * speech-recognition errors. Claire's side is whatever the ledger actually
 * says; for turns the ledger hands back to the conversational pipeline, a
 * neutral stand-in line is recorded so the planner sees a realistic history.
 *
 * Runs only with CLAIRE_WORK_LEDGER_LIVE=1 and a real ANTHROPIC_API_KEY:
 *   CLAIRE_WORK_LEDGER_LIVE=1 railway run pnpm vitest run server/claire/workLedger/workLedger.live.test.ts
 * Nothing is written anywhere but an in-memory Day Line.
 */
import { describe, expect, it } from "vitest";
import { runWorkLedgerTurn } from "./workLedgerTurn";
import { createFakeDayLine } from "./workLedgerTestDayLine";
import { OCTOBER_15_CALL } from "./october15CallFixture";
import type { ClaireTurnState } from "../turn/claireTurn";

const live =
  process.env.CLAIRE_WORK_LEDGER_LIVE === "1" &&
  Boolean(process.env.ANTHROPIC_API_KEY?.trim()) &&
  process.env.ANTHROPIC_API_KEY !== "verification-transport-stub";

const ZONE = "America/Los_Angeles";
const TODAY = "2026-10-15";
const TOMORROW = "2026-10-16";

const FRAGMENT_TITLES = /^(?:it for today|our processing center|claim free order|if in the case|we will pick up)/i;

describe.skipIf(!live)("work ledger — real-model replay of the 2026-10-15 production call", () => {
  it(
    "keeps the dry-cleaning orders, the next-morning delivery and one marketing challenge, with no fragments",
    async () => {
      const dayLine = createFakeDayLine();
      const state: ClaireTurnState = {
        history: [{ speaker: "claire", text: "Claire here. What's up?", at: Date.parse("2026-10-16T00:30:33Z") }],
      };
      const transcript: string[] = [];
      let clockMs = Date.parse("2026-10-16T00:30:47Z");
      const latencies: number[] = [];
      for (const step of OCTOBER_15_CALL) {
        clockMs += 14_000;
        const now = new Date(clockMs);
        const outcome = await runWorkLedgerTurn(
          {
            tenantId: "default",
            operatorUserId: "adam-admin",
            dayDirectorActorId: "1",
            conversationKey: "claire-call:replay-2026-10-15",
            surface: "voice",
            utterance: step.operator,
            state,
            timeZone: ZONE,
            sessionKind: "pre_drive",
            callFacts: [
              "Moments before this call, Claire called the operator for the scheduled evening debrief call; it ended after 9 seconds (remote hangup) before the operator said anything. If the operator mentions Claire calling and hanging up, that was this call: own it plainly and pick up where it should have gone. Never deny making calls.",
            ],
          },
          { now: () => now, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
        );
        transcript.push(`OPERATOR: ${step.operator}`);
        if (outcome.handled) {
          latencies.push(outcome.latencyMs);
          transcript.push(`CLAIRE [ledger ${outcome.latencyMs}ms]: ${outcome.result.speak}`);
          if (outcome.plan.refused.length) transcript.push(`   refused: ${outcome.plan.refused.join(" | ")}`);
        } else {
          transcript.push(`   (ledger: ${outcome.reason}${outcome.plan?.operatorSignal.kind && outcome.plan.operatorSignal.kind !== "none" ? `, signal ${outcome.plan.operatorSignal.kind}: ${outcome.plan.operatorSignal.about}` : ""})`);
          const standIn = step.standIn ?? "Okay.";
          state.history = [
            ...(state.history ?? []),
            { speaker: "operator", text: step.operator, at: clockMs },
            { speaker: "claire", text: standIn, at: clockMs + 1 },
          ];
          transcript.push(`CLAIRE [conversation stand-in]: ${standIn}`);
        }
        transcript.push(`   Day Line: ${dayLine.open().map(row => `[${row.businessDate === TODAY ? "today" : "tomorrow"}${row.executionType ? `/${row.executionType}` : ""}] ${row.title}`).join(" · ") || "(empty)"}`);
      }
      console.log(`\n${transcript.join("\n")}\n\nwrites:\n${dayLine.writes.join("\n")}\nledger latency ms: ${latencies.join(", ")}`);

      const open = dayLine.open();
      const today = open.filter(row => row.businessDate === TODAY);
      const tomorrow = open.filter(row => row.businessDate === TOMORROW);

      // Nothing from ad copy, places, or sentence fragments.
      expect(open.filter(row => FRAGMENT_TITLES.test(row.title))).toEqual([]);
      expect(tomorrow.filter(row => /\b(?:20 pounds|pick up|free)\b/i.test(row.title))).toEqual([]);

      // The dry-cleaning work: charge check (conditional) and tonight's two deliveries, on today.
      expect(today.some(row => /charg/i.test(`${row.title} ${row.sourceText}`) && /dry/i.test(`${row.title} ${row.sourceText}`))).toBe(true);
      expect(today.some(row => /deliver/i.test(row.title))).toBe(true);
      // The third order goes out tomorrow morning.
      expect(tomorrow.some(row => /deliver/i.test(row.title))).toBe(true);

      // Exactly one landing-page item, today, recorded as a marketing challenge.
      const landing = today.filter(row => /landing page|website/i.test(row.title));
      expect(landing).toHaveLength(1);
      expect(landing[0]!.executionType).toBe("challenge");

      // Claire never reads back robot prompts.
      expect(transcript.join("\n")).not.toMatch(/say yes or no|quantity 1|Done\. \d+ on/i);
    },
    360_000
  );

  it(
    "keeps three separate instructions separate, replaces content on correction, completes, moves, holds the tentative, and ends the call",
    async () => {
      const dayLine = createFakeDayLine();
      const state: ClaireTurnState = { history: [{ speaker: "claire", text: "Claire here. What's up?", at: Date.parse("2026-10-15T16:00:00Z") }] };
      const turns = [
        "Put three things on the day line: pick up from Coast at 10, deliver Jim's towels to Opus by noon, and call Louise about the contract.",
        "Actually the Coast pickup is wrong. It's KITH TREATS, not Coast.",
        "How many orders did we do this week?",
        "Okay I delivered Jim's towels.",
        "And the Louise call isn't happening today, move it to Monday.",
        "I might swing by Sunset Towers later if I have time.",
        "Alright that's it, talk later.",
      ];
      let clockMs = Date.parse("2026-10-15T16:00:30Z");
      const log: string[] = [];
      const outcomes: Awaited<ReturnType<typeof runWorkLedgerTurn>>[] = [];
      for (const operator of turns) {
        clockMs += 20_000;
        const now = new Date(clockMs);
        const outcome = await runWorkLedgerTurn(
          {
            tenantId: "default", operatorUserId: "adam-admin", dayDirectorActorId: "1",
            conversationKey: "claire-call:replay-pr599", surface: "voice", utterance: operator, state,
            timeZone: ZONE, sessionKind: "pre_drive",
          },
          { now: () => now, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
        );
        outcomes.push(outcome);
        log.push(`OPERATOR: ${operator}`);
        if (outcome.handled) log.push(`CLAIRE [ledger ${outcome.latencyMs}ms${outcome.result.endCall ? ", ends call" : ""}]: ${outcome.result.speak}`);
        else {
          log.push(`   (ledger: ${outcome.reason})`);
          state.history = [...(state.history ?? []), { speaker: "operator", text: operator, at: clockMs }, { speaker: "claire", text: "We did 41 orders this week.", at: clockMs + 1 }];
        }
        log.push(`   Day Line: ${Array.from(dayLine.rows.values()).map(row => `[${row.businessDate}${row.status === "completed" ? " done" : ""}${row.cancelled ? " removed" : ""}] ${row.title}`).join(" · ")}`);
      }
      console.log(`\n${log.join("\n")}\nwrites:\n${dayLine.writes.join("\n")}`);

      const open = dayLine.open();
      const live = open.filter(row => row.status === "open");
      // Three separate items, never collapsed.
      expect(dayLine.writes.filter(write => write.startsWith("create 2026-10-15")).length).toBeGreaterThanOrEqual(3);
      // The correction replaced content; no Coast item survives and KITH TREATS exists exactly once.
      expect(open.filter(row => /coast/i.test(row.title))).toEqual([]);
      expect(open.filter(row => /kith/i.test(row.title))).toHaveLength(1);
      // The business question was not work.
      expect(outcomes[2]!.handled).toBe(false);
      // Jim's towels are done.
      expect(open.find(row => /jim/i.test(row.title))?.status).toBe("completed");
      // Louise moved to Monday 2026-10-19 and is no longer on today.
      expect(live.filter(row => /louise/i.test(row.title)).map(row => row.businessDate)).toEqual(["2026-10-19"]);
      // Tentative stop is held, not saved.
      expect(open.filter(row => /sunset/i.test(row.title))).toEqual([]);
      // The goodbye ends the call.
      const last = outcomes.at(-1)!;
      expect(last.handled && last.result.endCall).toBe(true);
    },
    240_000
  );

  it(
    "runs an evening debrief against a seeded Day Line: completes, moves, and reads back",
    async () => {
      const dayLine = createFakeDayLine([
        { title: "Check whether 3 dry-cleaning orders were charged and charge any that weren't", businessDate: TODAY },
        { title: "Deliver 2 dry-cleaning orders tonight", businessDate: TODAY },
        { title: "Build Laundry Farm landing page to match Instagram ad", businessDate: TODAY, executionType: "challenge" },
        { title: "Deliver third dry-cleaning order tomorrow morning", businessDate: TOMORROW },
      ]);
      const state: ClaireTurnState = {
        history: [{ speaker: "claire", text: "Hi, it's Claire for today's wrap. You had four things on today's line. How did it go?", at: Date.parse("2026-10-16T01:30:00Z") }],
      };
      const turns = [
        "Charged all three, delivered both tonight. The landing page didn't happen, I ran out of time, push it to tomorrow.",
        "What's left?",
      ];
      let clockMs = Date.parse("2026-10-16T01:30:20Z");
      const log: string[] = [];
      for (const operator of turns) {
        clockMs += 20_000;
        const now = new Date(clockMs);
        const outcome = await runWorkLedgerTurn(
          {
            tenantId: "default", operatorUserId: "adam-admin", dayDirectorActorId: "1",
            conversationKey: "claire-call:replay-evening", surface: "voice", utterance: operator, state,
            timeZone: ZONE, sessionKind: "evening_debrief",
          },
          { now: () => now, readState: dayLine.deps.readState, apply: dayLine.deps.apply, recordSignal: async () => ({ status: "ineligible" }) }
        );
        log.push(`OPERATOR: ${operator}`);
        log.push(outcome.handled ? `CLAIRE [ledger ${outcome.latencyMs}ms]: ${outcome.result.speak}` : `   (ledger: ${outcome.reason})`);
        if (!outcome.handled) state.history = [...(state.history ?? []), { speaker: "operator", text: operator, at: clockMs }];
      }
      console.log(`\n${log.join("\n")}\nwrites:\n${dayLine.writes.join("\n")}`);
      const rows = Array.from(dayLine.rows.values());
      expect(rows.find(row => /charged/i.test(row.title))?.status).toBe("completed");
      expect(rows.find(row => /deliver 2/i.test(row.title))?.status).toBe("completed");
      const landing = rows.filter(row => /landing page/i.test(row.title) && !row.cancelled);
      expect(landing.map(row => row.businessDate)).toEqual([TOMORROW]);
      expect(landing[0]!.executionType).toBe("challenge");
    },
    180_000
  );
});
