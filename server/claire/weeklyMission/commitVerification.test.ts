import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyCommandMetadata } from "../../../shared/claireWorkdayCommand";
import type { WeeklyIntentRecord } from "../../../shared/weeklyMissionReadiness";
import { createMemoryConversationStateStore, setClaireConversationStateStoreForTests } from "../turn/conversationStateStore";
import { commitWeeklyPlan, type WeeklyCommitPorts } from "./commit";
import { loadWeeklySession, newWeeklySession, saveWeeklySession } from "./session";

function fixture() {
  const session = newWeeklySession({
    tenantId: "tenant-a", operatorId: "operator-a", dayDirectorActorId: "11", weekStart: "2026-10-12",
    draft: {
      weekStart: "2026-10-12",
      days: ["2026-10-12", "2026-10-13", "2026-10-14"].map((businessDate, i) => ({
        businessDate, weekday: ["Monday", "Tuesday", "Wednesday"][i]!, disposition: "primary" as const,
        primary: { text: `Visit account ${i + 1}`, source: "operator_stated" as const, existingCommitmentId: null },
        fixedConstraints: [], readinessRequirements: [], uncertainty: null,
      })),
    },
  });
  session.phase = "awaiting_confirmation";
  const rows = new Map<string, any>();
  let saved: WeeklyIntentRecord | null = null;
  const ports = {
    acceptProposal: vi.fn(async (input: any) => {
      const prior = [...rows.values()].find(row => row.idempotencyKey === input.proposal.promptKey);
      const row = prior ?? {
        id: `commitment-${rows.size + 1}`, tenantId: input.tenantId, actorId: input.actorId,
        businessDate: input.businessDate, idempotencyKey: input.proposal.promptKey, status: "open",
      };
      row.title = input.proposal.title;
      row.metadataJson = { command: input.proposal.command ?? emptyCommandMetadata() };
      rows.set(row.id, row);
      return { stored: structuredClone(row), created: !prior };
    }),
    designatePrimary: vi.fn(async (input: any) => {
      const row = rows.get(input.commitmentId);
      if (row) row.metadataJson.command = { ...emptyCommandMetadata(), role: "primary" };
      return { commitmentId: input.commitmentId };
    }),
    readCommitment: vi.fn(async (input: any) => structuredClone(rows.get(input.commitmentId) ?? null)),
    updateCommitment: vi.fn(async (input: any) => {
      const row = rows.get(input.commitmentId);
      if (row) Object.assign(row.metadataJson, input.patch);
      return { ok: true, id: input.commitmentId };
    }),
    saveIntent: vi.fn(async (intent: WeeklyIntentRecord) => { saved = structuredClone(intent); }),
    latestIntent: vi.fn(async () => saved),
  };
  return { session, rows, ports, commit: () => commitWeeklyPlan({ session, now: new Date("2026-10-12T16:00:00Z") }, ports as unknown as WeeklyCommitPorts) };
}

describe("weekly canonical write verification", () => {
  beforeEach(() => setClaireConversationStateStoreForTests(createMemoryConversationStateStore()));
  afterEach(() => setClaireConversationStateStoreForTests(null));

  it("retains the unfinished plan when a successful write response has no canonical row", async () => {
    const f = fixture();
    f.ports.readCommitment.mockImplementation(async () => null);
    await saveWeeklySession(f.session);
    const result = await f.commit();
    expect(result.locked).toBe(false);
    expect(result.receipts).toHaveLength(0);
    expect(f.ports.saveIntent).not.toHaveBeenCalled();
    expect(await loadWeeklySession({ tenantId: "tenant-a", operatorId: "operator-a", weekStart: "2026-10-12" })).not.toBeNull();
  });

  it.each(["actorId", "businessDate", "title", "status"])("rejects a canonical %s mismatch", async field => {
    const f = fixture();
    f.ports.readCommitment.mockImplementation(async (input: any) => ({
      ...structuredClone(f.rows.get(input.commitmentId)), [field]: "wrong",
    }));
    const result = await f.commit();
    expect(result.locked).toBe(false);
    expect(result.receipts).toHaveLength(0);
    expect(f.ports.saveIntent).not.toHaveBeenCalled();
  });

  it("requires a canonical weekly intent read after the save", async () => {
    const f = fixture();
    f.ports.latestIntent.mockImplementation(async () => null);
    await saveWeeklySession(f.session);
    const result = await f.commit();
    expect(result.locked).toBe(false);
    expect(result.speech).toContain("not locked");
    expect(await loadWeeklySession({ tenantId: "tenant-a", operatorId: "operator-a", weekStart: "2026-10-12" })).not.toBeNull();
  });

  it("stores two distinct readiness items at the same clock and counts every verified row", async () => {
    const f = fixture();
    f.session.draft.days[0]!.readinessRequirements = ["Call Russell at 11", "Print account sheet at 11"].map(text => ({
      text, kind: "information", neededForDate: "2026-10-12", completeByDate: "2026-10-12", status: "open",
    }));
    const result = await f.commit();
    expect(result.locked).toBe(true);
    expect(result.commitmentIds).toHaveLength(5);
    expect(new Set(result.commitmentIds).size).toBe(5);
    const readiness = [...f.rows.values()].filter(row => row.title.includes("at 11"));
    expect(readiness).toHaveLength(2);
    expect(readiness.every(row => row.metadataJson.scheduleKind === "EXACT_TIME" && row.metadataJson.scheduleLabel === "11")).toBe(true);
    expect(result.speech).toContain("5 Day Line items verified");
  });

  it("reports only verified partial items and retries without duplicating accepted work", async () => {
    const f = fixture();
    const realRead = f.ports.readCommitment.getMockImplementation()!;
    f.ports.readCommitment.mockImplementation(async (input: any) => input.businessDate === "2026-10-14" ? null : realRead(input));
    const first = await f.commit();
    expect(first.locked).toBe(false);
    expect(first.commitmentIds).toHaveLength(2);
    expect(first.speech).toContain("2 Day Line items verified");
    f.ports.readCommitment.mockImplementation(realRead);
    const second = await f.commit();
    expect(second.locked).toBe(true);
    expect(f.rows.size).toBe(3);
    expect(second.receipts.every(receipt => receipt.claimedState === "updated")).toBe(true);
  });

  it("fails closed in production code path when canonical DB readback is unavailable and never consults mock tracker", async () => {
    const f = fixture();
    // In production code path (invoking commitWeeklyPlan without mock ports),
    // missing canonical readback fails closed and does not use mock tracking.
    const result = await commitWeeklyPlan({ session: f.session, now: new Date("2026-10-12T16:00:00Z") });
    expect(result.locked).toBe(false);
    expect(result.commitmentIds).toHaveLength(0);
    expect(result.receipts).toHaveLength(0);
    expect(result.speech).toContain("not locked");
  });
});

