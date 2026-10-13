import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCommandMetadata } from "../../../shared/claireWorkdayCommand";
import type { WeeklyIntentRecord } from "../../../shared/weeklyMissionReadiness";
import {
  createMemoryConversationStateStore,
  setClaireConversationStateStoreForTests,
} from "../turn/conversationStateStore";
import { commitWeeklyPlan, type WeeklyCommitPorts } from "./commit";
import { loadWeeklySession, newWeeklySession, saveWeeklySession } from "./session";
import { admitOperatorAppointmentExecution, type OperatorAppointmentExecutionContext } from "../../agents/persistentOperator/operatorAppointmentExecutionContext";
import type { ClaimedOperatorAppointment } from "../../agents/persistentOperator/operatorAppointmentStore";
import { runClaireTurn, type ClaireTurnDeps, type ClaireTurnState } from "../turn/claireTurn";

function setupWeeklyPlanningFixture() {
  const weekStart = "2026-10-12";
  const tenantId = "tenant-prod-a";
  const operatorUserId = "adam";
  const dayDirectorActorId = "42";

  // 1. Appointment definition for Sunday weekly planning
  const appointment: ClaimedOperatorAppointment = {
    id: "appt-sunday-plan-1",
    tenantId,
    canonicalOperatorId: `tenant:${tenantId}:operator:${operatorUserId}`,
    operatorUserId,
    appointmentKind: "sunday_weekly_planning",
    weekStart,
    scheduledFor: new Date("2026-10-11T18:00:00.000Z"),
    timeZone: "America/Los_Angeles",
    source: "standing_weekly_authorization",
    sourceReference: "operator_rule:2026-10-11:sunday_weekly_planning",
    idempotencyKey: `sunday_weekly_planning:${tenantId}:${weekStart}`,
    standingAuthorizationId: "auth-weekly-1",
    unprompted: false,
    attemptCount: 1,
    maxAttempts: 3,
    leaseOwner: "worker-prod-1",
  };

  // Canonical storage fixtures
  const dayLineRows = new Map<string, any>();
  let savedIntent: WeeklyIntentRecord | null = null;

  const ports: WeeklyCommitPorts = {
    acceptProposal: vi.fn(async (input: any) => {
      const prior = [...dayLineRows.values()].find(
        row => row.idempotencyKey === input.proposal.promptKey
      );
      const row = prior ?? {
        id: `commitment-${dayLineRows.size + 1}`,
        tenantId: input.tenantId,
        actorId: input.actorId,
        businessDate: input.businessDate,
        idempotencyKey: input.proposal.promptKey,
        status: "open",
      };
      row.title = input.proposal.title;
      row.metadataJson = {
        command: input.proposal.command ?? emptyCommandMetadata(),
        scheduleKind: input.proposal.scheduleKind,
        scheduleLabel: input.proposal.scheduleLabel,
      };
      dayLineRows.set(row.id, row);
      return { stored: structuredClone(row), created: !prior };
    }),
    designatePrimary: vi.fn(async (input: any) => {
      const row = dayLineRows.get(input.commitmentId);
      if (row) row.metadataJson.command = { ...emptyCommandMetadata(), role: "primary" };
      return { commitmentId: input.commitmentId };
    }),
    readCommitment: vi.fn(async (input: any) =>
      structuredClone(dayLineRows.get(input.commitmentId) ?? null)
    ),
    updateCommitment: vi.fn(async (input: any) => {
      const row = dayLineRows.get(input.commitmentId);
      if (row) Object.assign(row.metadataJson, input.patch);
      return { ok: true, id: input.commitmentId };
    }),
    saveIntent: vi.fn(async (intent: WeeklyIntentRecord) => {
      savedIntent = structuredClone(intent);
    }),
    latestIntent: vi.fn(async () => savedIntent),
  };

  return {
    weekStart,
    tenantId,
    operatorUserId,
    dayDirectorActorId,
    appointment,
    dayLineRows,
    ports,
  };
}

describe("Full Conversation Replay — Invitation to Execution and Continued Dialogue", () => {
  beforeEach(() => {
    setClaireConversationStateStoreForTests(createMemoryConversationStateStore());
  });

  afterEach(() => {
    setClaireConversationStateStoreForTests(null);
  });

  it("verifies invitation → callback → Sunday planning → operator correction → approved Day Line write → accurate speech → continued conversation", async () => {
    const f = setupWeeklyPlanningFixture();

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 1: INVITATION ADMISSION
    // Verify Sunday weekly planning appointment is properly admitted with infrastructure authority.
    // ──────────────────────────────────────────────────────────────────────────
    const executionContext: OperatorAppointmentExecutionContext =
      admitOperatorAppointmentExecution(f.appointment);

    expect(executionContext.jobId).toBe("appt-sunday-plan-1");
    expect(executionContext.scope.tenantId).toBe(f.tenantId);
    expect(executionContext.actor.operatorUserId).toBe(f.operatorUserId);
    expect(executionContext.source.appointmentKind).toBe("sunday_weekly_planning");
    expect(executionContext.idempotencyKey).toBe(f.appointment.idempotencyKey);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 2: CALLBACK EXECUTION
    // A scheduled callback or session starts. A new weekly planning session is initialized.
    // ──────────────────────────────────────────────────────────────────────────
    const session = newWeeklySession({
      tenantId: f.tenantId,
      operatorId: f.operatorUserId,
      dayDirectorActorId: f.dayDirectorActorId,
      weekStart: f.weekStart,
      draft: {
        weekStart: f.weekStart,
        days: [
          {
            businessDate: "2026-10-12",
            weekday: "Monday",
            disposition: "primary",
            primary: { text: "Review accounts", source: "operator_stated", existingCommitmentId: null },
            fixedConstraints: [],
            readinessRequirements: [],
            uncertainty: null,
          },
          {
            businessDate: "2026-10-13",
            weekday: "Tuesday",
            disposition: "primary",
            primary: { text: "Cold outreach batch", source: "inferred_proposal", existingCommitmentId: null },
            fixedConstraints: [],
            readinessRequirements: [],
            uncertainty: null,
          },
          {
            businessDate: "2026-10-14",
            weekday: "Wednesday",
            disposition: "primary",
            primary: { text: "Plant processing", source: "operator_stated", existingCommitmentId: null },
            fixedConstraints: [],
            readinessRequirements: [],
            uncertainty: null,
          },
          {
            businessDate: "2026-10-15",
            weekday: "Thursday",
            disposition: "primary",
            primary: { text: "Commercial deliveries", source: "operator_stated", existingCommitmentId: null },
            fixedConstraints: [],
            readinessRequirements: [],
            uncertainty: null,
          },
          {
            businessDate: "2026-10-16",
            weekday: "Friday",
            disposition: "primary",
            primary: { text: "Weekly reconciliations", source: "operator_stated", existingCommitmentId: null },
            fixedConstraints: [],
            readinessRequirements: [],
            uncertainty: null,
          },
        ],
      },
    });

    session.phase = "interview";
    await saveWeeklySession(session);

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 3: SUNDAY PLANNING INTERVIEW
    // Verify draft plan is held and active in session.
    // ──────────────────────────────────────────────────────────────────────────
    const loaded = await loadWeeklySession({
      tenantId: f.tenantId,
      operatorId: f.operatorUserId,
      weekStart: f.weekStart,
    });
    expect(loaded).not.toBeNull();
    expect(loaded?.phase).toBe("interview");
    expect(loaded?.draft.days[1]?.primary?.text).toBe("Cold outreach batch");

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 4: OPERATOR CORRECTION
    // Operator rejects the cold outreach recommendation and corrects Tuesday:
    // "Change Tuesday to visit Greystar instead."
    // ──────────────────────────────────────────────────────────────────────────
    const tuesday = loaded!.draft.days.find(d => d.weekday === "Tuesday")!;
    tuesday.primary = {
      text: "Visit Greystar",
      source: "operator_stated",
      existingCommitmentId: null,
    };
    loaded!.phase = "awaiting_confirmation";
    await saveWeeklySession(loaded!);

    const afterCorrection = await loadWeeklySession({
      tenantId: f.tenantId,
      operatorId: f.operatorUserId,
      weekStart: f.weekStart,
    });
    expect(afterCorrection?.draft.days[1]?.primary?.text).toBe("Visit Greystar");
    expect(afterCorrection?.draft.days[1]?.primary?.source).toBe("operator_stated");
    expect(afterCorrection?.phase).toBe("awaiting_confirmation");

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 5: APPROVED DAY LINE WRITE & ACCURATE SPEECH
    // Operator confirms: "Yes, lock the plan in."
    // commitWeeklyPlan executes canonical write and verification.
    // ──────────────────────────────────────────────────────────────────────────
    const commitResult = await commitWeeklyPlan(
      {
        session: afterCorrection!,
        now: new Date("2026-10-11T19:00:00.000Z"),
      },
      f.ports
    );

    // Verify successful write and lock
    expect(commitResult.locked).toBe(true);
    expect(commitResult.commitmentIds).toHaveLength(5);
    expect(commitResult.receipts).toHaveLength(5);

    // STEP 6: ACCURATE SPEECH
    // Speech must accurately state the exact verified count, never fabricating
    expect(commitResult.speech).toContain("5 Day Line items verified");
    expect(f.dayLineRows.size).toBe(5);

    // Verify Tuesday canonical row has the operator's corrected title
    const tuesdayRow = [...f.dayLineRows.values()].find(
      r => r.businessDate === "2026-10-13"
    );
    expect(tuesdayRow).toBeDefined();
    expect(tuesdayRow.title).toBe("Visit Greystar");
    expect(tuesdayRow.actorId).toBe(f.dayDirectorActorId);
    expect(tuesdayRow.tenantId).toBe(f.tenantId);

    // Weekly session should now be cleared / locked
    const sessionAfterCommit = await loadWeeklySession({
      tenantId: f.tenantId,
      operatorId: f.operatorUserId,
      weekStart: f.weekStart,
    });
    expect(sessionAfterCommit).toBeNull();

    // ──────────────────────────────────────────────────────────────────────────
    // STEP 7: CONTINUED CONVERSATION
    // After weekly planning locks, subsequent turns in the same conversation
    // must continue smoothly without getting stuck in the weekly planning interview.
    // ──────────────────────────────────────────────────────────────────────────
    const turnState: ClaireTurnState = {
      history: [
        { speaker: "operator", text: "Yes, lock the plan in." },
        { speaker: "claire", text: commitResult.speech },
      ],
    };

    const turnOverrides: Partial<ClaireTurnDeps> = {
      now: () => new Date("2026-10-11T19:01:00.000Z"),
      timeZone: () => "America/Los_Angeles",
      brainV3: vi.fn(async () => ({
        target: "open_conversation",
        act: "question",
        workDisposition: "none",
        dayLineDisposition: "none",
        priorClaim: "none",
        broadBriefingRequest: false,
        canonicalWork: null,
        referent: null,
        rationale: "question about tomorrow after weekly plan lock",
      })) as never,
      dayWork: vi.fn(async () => ({
        businessDate: "2026-10-12",
        open: [
          {
            id: "work-1",
            title: "Review accounts",
            timing: "9 AM",
            source: "day_line" as const,
          },
        ],
        completed: [],
        routeAvailable: true,
      })) as never,
      followUp: vi.fn(async () => "Tomorrow starts with the account review at 9 AM.") as never,
    };

    const nextTurn = await runClaireTurn(
      {
        tenantId: f.tenantId,
        operatorUserId: f.operatorUserId,
        dayDirectorActorId: f.dayDirectorActorId,
        surface: "voice",
        utterance: "What should I focus on first tomorrow?",
        state: turnState,
        conversationKey: "call-sunday-replay-1",
      },
      turnOverrides
    );

    expect(nextTurn.kind).toBe("answered");
    expect(nextTurn.speak).toContain("Review accounts");
    expect(nextTurn.speak).not.toContain("not locked");
  });
});
