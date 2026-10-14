/* LEGACY DAYFORGE COMPATIBILITY: historical SaaS SQL table names retained for the production schema; current product is JOYSTICK. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
/*
 * Showrunner week acceptance on an ISOLATED COPY of production data with the
 * real model. Opt-in: SHOWRUNNER_ACCEPTANCE=1 and OUT=<json path>. The phone
 * provider is controlled; no real call is placed and no production row is written.
 */
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { resolveCanonicalOperatorIdentity } from "../../agents/persistentOperator/identity";
import { OperatorAppointmentStore } from "../../agents/persistentOperator/operatorAppointmentStore";
import { OperatorAppointmentWorker } from "../../agents/persistentOperator/operatorAppointmentWorker";
import { grantDailyClaireCall } from "../../agents/persistentOperator/dailyCallAuthorization";
import { prepareStrategicProposal } from "../../strategy/strategicPreparation";
import { respondToStrategicProposal } from "../../strategy/strategicApproval";
import { latestStrategicProposal } from "../../strategy/strategicStore";
import { getDayDirectorState } from "../../planning/dayDirector/dayDirectorService";
import { claireConversationStateStore } from "../turn/conversationStateStore";
import { issueClaireToken } from "../claireToken";
import { runAuthoritativeClaireVoiceTurn } from "../claireTwilio";
import { buildDayPlanProjection } from "../../../client/src/pages/driver/goldlineDayPlanModel";

const provider = vi.hoisted(() => ({ calls: [] as Array<{ to: string }> }));
vi.mock("../../twilioPlatform/claireCallProvider", () => ({
  placeClaireOutboundCall: async (request: { to: string }) => {
    if (request.to !== "+15555550111") throw new Error("Controlled provider refuses any non-test phone");
    provider.calls.push(request);
    return { callSid: `CA${randomUUID().replaceAll("-", "")}` };
  },
}));

const run = process.env.SHOWRUNNER_ACCEPTANCE === "1" ? describe : describe.skip;
const zone = "America/Los_Angeles";
const at = (iso: string) => new Date(iso);
// The coming week, Mon Oct 19 2026 (PDT = UTC-7), so approval staleness checks
// on the real clock agree with the simulated business clock.
const T = {
  sunday: at("2026-10-19T01:00:00Z"), // Sun Oct 18, 6 PM
  monMorning: at("2026-10-19T15:00:00Z"),
  monEvening: at("2026-10-20T01:00:00Z"),
  tueMorning: at("2026-10-20T15:00:00Z"),
  tueEvening: at("2026-10-21T01:00:00Z"),
  wedMorning: at("2026-10-21T15:00:00Z"),
  friEvening: at("2026-10-24T01:00:00Z"),
};

run("Claire showrunner week on Laundry Farm data", () => {
  it("Sunday plan → Mon/Tue/Wed calls → replans → Daphne adaptation → week review", async () => {
    const out: Record<string, unknown> = {};
    const tenantId = "default";
    const operator = process.env.SHOWRUNNER_OPERATOR ?? "adam-admin";
    process.env.CLAIRE_OPERATOR_PHONES = JSON.stringify({ [operator]: "+15555550111" });
    const resolved = await resolveCanonicalOperatorIdentity({ tenantId, source: { type: "open_id", value: operator }, subsystem: "showrunner_acceptance" });
    if (!resolved.ok) throw new Error(`identity: ${JSON.stringify(resolved)}`);
    const identity = resolved.identity;
    const pool = mysql.createPool(process.env.DATABASE_URL!);
    const store = new OperatorAppointmentStore(pool);
    const sql = await mysql.createConnection(process.env.DATABASE_URL!);
    const stateArgs = { tenantId, actorId: identity.dayDirectorActorId, actorIds: identity.dayDirectorActorIds, canonicalOperatorId: identity.canonicalOperatorId };

    // Separate, explicit grants for the two daily purposes (isolated copy only).
    await grantDailyClaireCall({ identity, purpose: "morning_readiness", weekdays: [1, 2, 3, 4, 5], localStart: "07:30", localEnd: "09:00", timeZone: zone, sourceReference: `authenticated_app:${randomUUID()}` });
    await grantDailyClaireCall({ identity, purpose: "evening_debrief", weekdays: [1, 2, 3, 4, 5], localStart: "17:30", localEnd: "19:00", timeZone: zone, sourceReference: `authenticated_app:${randomUUID()}` });

    // Sunday: the weekly production plan.
    // Prepared on the real clock (fresh source coverage) for the coming week, as the Sunday worker does.
    const plan = await prepareStrategicProposal({ identity, timeZone: zone, weekStart: "2026-10-19" });
    out.sunday = { weekStart: plan.weekStart, weeklyPlan: plan.weeklyPlan, items: plan.items.map(i => ({ date: i.businessDate, title: i.title, window: i.timeWindow?.window ?? null })) };
    const approved = await respondToStrategicProposal({ identity, proposalId: plan.id, revision: plan.revision, action: "approve", itemIds: plan.items.map(i => i.id), source: "authenticated_app" });
    out.sundayApproval = approved.speech;

    async function scheduledCall(label: string, now: Date, kind: string) {
      const worker = new OperatorAppointmentWorker(store, { leaseOwner: `acc-${label}`, leaseMs: 60_000, pollMs: 100, concurrency: 1, retryBaseMs: 100, now: () => now });
      worker.start();
      const end = Date.now() + 90_000;
      let row: mysql.RowDataPacket | undefined;
      const businessDate = formatInTimeZone(now, zone, "yyyy-MM-dd");
      try {
        while (Date.now() < end) {
          const [rows] = await sql.execute<mysql.RowDataPacket[]>(
            "SELECT * FROM operator_appointments WHERE tenantId = ? AND appointmentKind = ? AND idempotencyKey LIKE ? LIMIT 1",
            [tenantId, kind, `%:${businessDate}`]
          );
          row = rows[0];
          if (row && ["completed", "dead_letter"].includes(row.status)) break;
          await new Promise(r => setTimeout(r, 200));
        }
      } finally {
        await worker.stop();
      }
      const [states] = await sql.execute<mysql.RowDataPacket[]>(
        "SELECT id, stateJson FROM claire_conversation_states WHERE tenantId = ? AND id LIKE 'claire-call:%' ORDER BY createdAt DESC LIMIT 1",
        [tenantId]
      );
      const state = states[0]!;
      const conversationId = String(state.id).slice("claire-call:".length);
      const conversation = typeof state.stateJson === "string" ? JSON.parse(state.stateJson) : state.stateJson;
      return { appointment: { kind: row?.appointmentKind, status: row?.status, callPlaced: Boolean(row?.callSid), scheduledFor: row?.scheduledFor }, conversationId, conversation };
    }

    async function talk(call: { conversationId: string; conversation: any }, lines: string[]) {
      const token = issueClaireToken({ kind: "pre_drive_conversation", tenantId, userId: operator, conversationId: call.conversationId });
      const transcript: Array<{ speaker: string; text: string }> = [{ speaker: "claire", text: call.conversation.history?.[0]?.text ?? "" }];
      let conversation = call.conversation;
      for (const line of lines) {
        const result: any = await runAuthoritativeClaireVoiceTurn({
          conversationId: call.conversationId, conversation, utterance: line, rawTranscript: line, allowFragmentWait: false, token,
          sourceConfirmed: true, sourceEventId: `acc-${randomUUID()}`, webhookReceivedAtMs: Date.now(),
        });
        transcript.push({ speaker: "operator", text: line }, { speaker: "claire", text: result.speak });
        const stored = await claireConversationStateStore().load<any>(`claire-call:${call.conversationId}`);
        if (!stored) break; // call ended
        conversation = stored.state;
      }
      return transcript;
    }

    // Monday morning: Day Line already prepared and approved; nothing pending.
    const mon = await scheduledCall("mon-am", T.monMorning, "daily_morning_readiness");
    out.mondayMorning = {
      appointment: mon.appointment,
      briefing: { today: mon.conversation.showrunner.briefing.today, pending: mon.conversation.showrunner.briefing.pendingDecision },
      transcript: await talk(mon, [
        "Morning. Yeah, I'm ready. Who am I contacting first?",
        "Heads up, I have a dentist appointment at 11, so I can only do outreach before then.",
        "Okay, got it. Thanks.",
      ]),
    };

    // Monday evening debrief with an unexpected development.
    const monPm = await scheduledCall("mon-pm", T.monEvening, "daily_evening_debrief");
    out.mondayEvening = {
      appointment: monPm.appointment,
      transcript: await talk(monPm, [
        "I only got through two of the five customers, Aimee and Liliana. I ran out of time; afternoons are too busy.",
        "Oh, and I ran into Maria, the property manager at the Sunset Junction building. She wants to meet Wednesday at 10am about laundry service for her residents.",
        "No, that's everything.",
        "Yes, lock it in.",
      ]),
    };

    // Tuesday morning: the briefing reflects Monday's news; a correction mid-call.
    const tue = await scheduledCall("tue-am", T.tueMorning, "daily_morning_readiness");
    out.tuesdayMorning = {
      appointment: tue.appointment,
      briefing: { developments: tue.conversation.showrunner.briefing.developments, pending: tue.conversation.showrunner.briefing.pendingDecision, today: tue.conversation.showrunner.briefing.today },
      opening: tue.conversation.history?.[0]?.text,
      transcript: await talk(tue, [
        "What's the plan for today?",
        "Wait, Maria just texted. She moved our meeting to Thursday at 10.",
        "Yes, go ahead and update it.",
        "Thanks, I'm heading out.",
      ]),
    };

    // Tuesday execution: approved changes appear on Day Line and Driver.
    const dayLine: Record<string, unknown> = {};
    for (const date of ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]) {
      const s = await getDayDirectorState({ ...stateArgs, businessDate: date });
      const driver = buildDayPlanProjection({ businessDate: date, commitments: s.commitments, now: new Date() } as never);
      dayLine[date] = s.commitments.map(c => ({
        title: c.title,
        status: c.status,
        presentation: c.presentation?.note ?? null,
        driverTimeLabel: driver.stops.find(st => st.id === `commitment-${c.id}`)?.timeLabel ?? null,
      }));
    }
    out.dayLineAfterTuesday = dayLine;

    // Tuesday evening: partial completion with a practical blocker.
    const tuePm = await scheduledCall("tue-pm", T.tueEvening, "daily_evening_debrief");
    out.tuesdayEvening = {
      appointment: tuePm.appointment,
      transcript: await talk(tuePm, [
        "I reached three more of the lapsed customers but didn't get to the last one. The truck had a flat in the afternoon.",
        "That's it for today.",
        "Sure, lock it in.",
      ]),
    };

    // Wednesday morning: Daphne's learned morning preference shapes the briefing and missions.
    const wed = await scheduledCall("wed-am", T.wedMorning, "daily_morning_readiness");
    out.wednesdayMorning = {
      appointment: wed.appointment,
      adaptations: wed.conversation.showrunner.briefing.adaptations,
      today: wed.conversation.showrunner.briefing.today,
      opening: wed.conversation.history?.[0]?.text,
      transcript: await talk(wed, ["Morning. What should I do first, and when?", "Great, thanks."]),
    };

    // End of week: Claire explains the week.
    const fri = await scheduledCall("fri-pm", T.friEvening, "daily_evening_debrief");
    out.weekReview = {
      appointment: fri.appointment,
      weekToDate: fri.conversation.showrunner.briefing.weekToDate,
      transcript: await talk(fri, ["Before we wrap: how did the week go overall? What changed and what's still open?", "That's all, thanks."]),
    };
    const finalPlan = await latestStrategicProposal(identity, "2026-10-19");
    out.finalPlanChanges = finalPlan?.weeklyPlan?.changes;
    out.providerCalls = provider.calls.length;
    await writeFile(process.env.OUT!, JSON.stringify(out, null, 2));
    await pool.end();
    await sql.end();
    expect(provider.calls.length).toBeGreaterThanOrEqual(6);
  }, 900_000);
});
