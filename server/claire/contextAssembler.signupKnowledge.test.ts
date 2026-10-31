import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AwaitingReplies, OnboardingKnowledge } from "../../shared/firstTenMinutesKnowledge";

const mocks = vi.hoisted(() => ({
  getFieldToday: vi.fn(),
  readTenantOnboardingKnowledge: vi.fn(),
  cachedAwaitingReplies: vi.fn(),
  readAwaitingReplies: vi.fn(),
  refreshAwaitingRepliesInBackground: vi.fn(),
}));

vi.mock("../field/fieldTodayService", () => ({ getFieldToday: mocks.getFieldToday }));
vi.mock("../commercialMissions/commercialMissionFieldService", () => ({ getCommercialMissionFieldState: vi.fn().mockResolvedValue(null) }));
vi.mock("../missionSalesBrief/missionSalesBriefService", () => ({ ensureCurrentMissionSalesBrief: vi.fn() }));
vi.mock("../saas/tenantIdentityService", () => ({
  loadTenantBusinessIdentity: async () => ({ businessName: "Fixture Laundry", brandName: "Fixture Laundry" }),
}));
vi.mock("./macroGoalService", () => ({ getActiveMacroGoal: vi.fn().mockResolvedValue(null) }));
vi.mock("./campaignAwareness", () => ({ getClaireCampaignSummary: vi.fn().mockResolvedValue(null) }));
vi.mock("../firstTenMinutes/knowledge/tenantKnowledge", () => ({ readTenantOnboardingKnowledge: mocks.readTenantOnboardingKnowledge }));
vi.mock("../firstTenMinutes/knowledge/awaitingReplies", () => ({
  cachedAwaitingReplies: mocks.cachedAwaitingReplies,
  readAwaitingReplies: mocks.readAwaitingReplies,
  refreshAwaitingRepliesInBackground: mocks.refreshAwaitingRepliesInBackground,
}));

import { assembleClaireDriveContext } from "./contextAssembler";

const knowledge: OnboardingKnowledge = {
  journeyId: "journey-1",
  readAt: "2026-10-28T19:00:00.000Z",
  business: "Fixture Laundry",
  owner: "Sam",
  readFrom: [{ provider: "google", account: "sam@fixture.test", scopes: ["gmail.readonly"] }],
  facts: [
    {
      id: "finding-1",
      kind: "service",
      statement: "Wash and fold is $2.25 a pound",
      status: "confirmed",
      correction: null,
      sources: [{ provider: "gmail", label: "Gmail", excerpt: "$2.25/lb", at: "2026-10-20T17:00:00.000Z", who: null, url: null }],
      learnedAt: "2026-10-28T19:00:00.000Z",
    },
  ],
  portrait: null,
  opportunity: null,
  message: {
    to: { name: "Elena Park", address: "elena@wilshire.test" },
    subject: "Weekly linens",
    status: "verified_sent",
    sentAt: "2026-10-30T18:00:00.000Z",
    verified: true,
    gmailThreadId: "thread-elena",
    reply: { state: "none_seen" },
  },
};

const awaiting: AwaitingReplies = {
  checkedAt: "2026-10-31T15:55:00.000Z",
  account: "sam@fixture.test",
  items: [],
  replies: [],
  unavailable: null,
  scanned: { sent: 4, received: 9, days: 30 },
};

const projection = (businessDate: string) => ({
  generatedAt: `${businessDate}T12:00:00.000Z`,
  businessDate,
  currentUserId: "operator-1",
  timeline: [],
  authoritativeCompletedObjectiveIds: [],
  nextFixedCommitment: null,
  blockers: [],
  dataQuality: { status: "trusted", warnings: [], sources: ["fixture"] },
});

const assemble = (extra: Partial<Parameters<typeof assembleClaireDriveContext>[0]> = {}) =>
  assembleClaireDriveContext({ tenantId: "tenant-1", actorId: "operator-1", phase: "pre_drive", now: new Date("2026-10-31T16:00:00.000Z"), ...extra });

describe("Claire's main context: signup knowledge and awaiting replies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFieldToday.mockImplementation(async (input: { businessDate?: string }) => projection(input.businessDate ?? "2026-10-31"));
    mocks.readTenantOnboardingKnowledge.mockResolvedValue(null);
    mocks.cachedAwaitingReplies.mockReturnValue(null);
  });

  it("carries the compact signup briefing and the cached awaiting replies when they exist", async () => {
    mocks.readTenantOnboardingKnowledge.mockResolvedValue(knowledge);
    mocks.cachedAwaitingReplies.mockReturnValue(awaiting);
    const context = await assemble();
    expect(mocks.readTenantOnboardingKnowledge).toHaveBeenCalledWith("tenant-1");
    expect(mocks.cachedAwaitingReplies).toHaveBeenCalledWith("tenant-1");
    expect(context.signupKnowledge).toMatchObject({
      readAt: "2026-10-28",
      business: "Fixture Laundry",
      facts: [{ id: "finding-1", status: "confirmed", learnedAt: "2026-10-28" }],
      message: { to: "Elena Park", sent: true, verified: true, sentOn: "2026-10-30", reply: "none_seen" },
    });
    expect(context.awaitingReplies).toEqual(awaiting);
  });

  it("dates the briefing in the operator's own time zone", async () => {
    mocks.readTenantOnboardingKnowledge.mockResolvedValue({ ...knowledge, message: { ...knowledge.message!, sentAt: "2026-10-31T02:00:00.000Z" } });
    expect((await assemble({ timeZone: "America/Los_Angeles" })).signupKnowledge?.message?.sentOn).toBe("2026-10-30");
    expect((await assemble({ timeZone: "UTC" })).signupKnowledge?.message?.sentOn).toBe("2026-10-31");
  });

  it("omits both fields (absent, not null) when there is nothing", async () => {
    const context = await assemble();
    expect(context).not.toHaveProperty("signupKnowledge");
    expect(context).not.toHaveProperty("awaitingReplies");
    expect(JSON.stringify(context)).not.toContain("signupKnowledge");
  });

  it("a failed read leaves the field absent and never fails the turn", async () => {
    mocks.readTenantOnboardingKnowledge.mockRejectedValue(new Error("Database not available"));
    mocks.cachedAwaitingReplies.mockImplementation(() => {
      throw new Error("cache exploded");
    });
    const context = await assemble();
    expect(context.businessDate).toBe("2026-10-31");
    expect(context).not.toHaveProperty("signupKnowledge");
    expect(context).not.toHaveProperty("awaitingReplies");
  });

  it("never asks Gmail mid-turn: with nothing cached, awaiting replies are absent and a background read starts", async () => {
    mocks.refreshAwaitingRepliesInBackground.mockClear();
    await assemble();
    expect(mocks.readAwaitingReplies).not.toHaveBeenCalled();
    expect(mocks.refreshAwaitingRepliesInBackground).toHaveBeenCalledWith("tenant-1");
  });

  it("carries only the newest 12 recent replies into the turn", async () => {
    const replies = Array.from({ length: 20 }, (_, i) => ({ ...(awaiting.replies?.[0] ?? {}), messageId: `m${i}` })) as NonNullable<AwaitingReplies["replies"]>;
    mocks.cachedAwaitingReplies.mockReturnValue({ ...awaiting, replies });
    const context = await assemble();
    expect(context.awaitingReplies?.replies).toHaveLength(12);
    expect(context.awaitingReplies?.replies?.[0]?.messageId).toBe("m0");
  });

  it("a cached list is used as is, with no background read", async () => {
    mocks.refreshAwaitingRepliesInBackground.mockClear();
    mocks.cachedAwaitingReplies.mockReturnValue(awaiting);
    await assemble();
    expect(mocks.refreshAwaitingRepliesInBackground).not.toHaveBeenCalled();
  });

  it("takes injected readers in place of the production ones", async () => {
    const loadSignupKnowledge = vi.fn().mockResolvedValue(knowledge);
    const cached = vi.fn().mockReturnValue(awaiting);
    const context = await assemble({ loadSignupKnowledge, cachedAwaitingReplies: cached });
    expect(loadSignupKnowledge).toHaveBeenCalledWith("tenant-1");
    expect(cached).toHaveBeenCalledWith("tenant-1");
    expect(mocks.readTenantOnboardingKnowledge).not.toHaveBeenCalled();
    expect(context.signupKnowledge?.facts).toHaveLength(1);
    expect(context.awaitingReplies).toBe(awaiting);
  });
});
