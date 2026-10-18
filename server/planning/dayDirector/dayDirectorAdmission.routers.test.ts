import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../../_core/context";

// The authenticated app procedures that write Day Line commitments pass the signed-in
// operator's instruction as the admission, and the cargo linkage forwards its caller's.

const writers = vi.hoisted(() => ({
  acceptProposalWithReceipt: vi.fn(async () => ({ stored: { id: "c-new" }, created: false })),
  completeDayDirectorCommitment: vi.fn(async () => ({ ok: true as const, alreadyCompleted: true })),
  acceptProposal: vi.fn(async () => ({ id: "c-cargo" })),
  updateDayDirectorCommitment: vi.fn(async () => ({ ok: true as const, id: "c-cargo" })),
  activateTowerWarsPromise: vi.fn(async () => ({ ok: true as const })),
}));

const identity = {
  tenantId: "t1",
  canonicalOperatorId: "tenant:t1:operator:adam-open-id",
  canonicalOpenId: "adam-open-id",
  canonicalUserId: 42,
  sourceOpenId: "adam-open-id",
  sourceUserId: 42,
  sourceRole: "admin",
  dayDirectorActorId: "42",
  dayDirectorActorIds: ["42"],
  weeklyOperatorId: "adam-open-id",
  campaignOperatorUserId: "adam-open-id",
  communicationOperatorUserId: "adam-open-id",
  membership: { source: "owner", canonical: "owner" },
  aliases: [],
};

vi.mock("../../saas/tenantAccess", () => ({
  resolveLegacyDayforgeMembership: vi.fn(async () => ({ tenantId: "t1", userOpenId: "adam-open-id", role: "owner" })),
  hasLegacyDayforgeEntitlement: vi.fn(async () => true),
  roleAllows: (actual: string, allowed: readonly string[]) => allowed.includes(actual),
  isLegacyDayforgeTenant: () => false,
}));
vi.mock("../../agents/persistentOperator/identity", () => ({
  requireCanonicalOperatorIdentityForUser: vi.fn(async () => identity),
  requireEffectiveOperatorIdentityForTenant: vi.fn(async () => identity),
}));
vi.mock("../../agents/persistentOperator/observability", () => ({
  recordPersistentOperatorDiagnosticEvent: vi.fn(async () => undefined),
}));
vi.mock("./dayDirectorService", () => ({
  acceptProposalWithReceipt: writers.acceptProposalWithReceipt,
  completeDayDirectorCommitment: writers.completeDayDirectorCommitment,
  acceptProposal: writers.acceptProposal,
  updateDayDirectorCommitment: writers.updateDayDirectorCommitment,
  getDayDirectorState: vi.fn(),
  proposeCommitment: vi.fn(),
  setPromptState: vi.fn(),
}));
vi.mock("./towerWarsPromiseService", () => ({
  activateTowerWarsPromise: writers.activateTowerWarsPromise,
  fulfillTowerWarsPromise: vi.fn(),
  recordTowerWarsPromise: vi.fn(),
  listTowerWarsPromises: vi.fn(),
}));
vi.mock("../missionDirector/missionDirectorRouter", () => ({
  resolveMissionDirectorBusinessTimeZone: vi.fn(async () => "America/Los_Angeles"),
}));
vi.mock("../missionDirector/missionDirectorService", () => ({ getLatestPlan: vi.fn(async () => null) }));
vi.mock("../../agents/daphne/missionFollowUp", () => ({
  answerMissionFollowUp: vi.fn(),
  revokeMissionPresentation: vi.fn(),
  syncMissionFollowUp: vi.fn(),
}));
vi.mock("../dayline/currentDayLineService", () => ({
  readCurrentDayLine: vi.fn(async () => ({
    businessDate: "2026-10-19",
    items: [{ id: "c-9", lineage: { kind: "commitment", commitmentId: "c-9" } }],
    designated: null,
  })),
}));
vi.mock("../../agents/persistentOperator/fieldEventBridge", () => ({
  bridgeDriverAction: vi.fn(async () => ({ bridged: false, reason: "no_linked_objective" })),
}));
vi.mock("../../campaignRuns/campaignRunService", () => ({ listOperatorRunsForIdentities: vi.fn(async () => []) }));
vi.mock("../../goldlineCargo/cargoService", () => ({
  proposeCargo: vi.fn(async () => ({ matchState: "unmatched", matchedOrderId: null, customerDisplayName: "Mei", quantity: 2 })),
  confirmCargo: vi.fn(async () => ({ id: 77, kind: "field" })),
  deliverCustodyToCustomer: vi.fn(),
}));
vi.mock("../../db", () => ({ getDb: vi.fn(async () => null) }));

import { dayDirectorRouter } from "./dayDirectorRouter";
import { currentDayLineRouter } from "../dayline/currentDayLineRouter";
import { towerWarsRouter } from "../../experience/goldline/modes/towerWars/towerWarsRouter";
import { confirmLinkedVehicleWork } from "../../claire/workdayCargoOrchestrator";

function context(): TrpcContext {
  return {
    req: { headers: {} } as never,
    res: undefined as never,
    vendorSession: null,
    tenantId: "t1",
    user: {
      id: 42,
      tenantId: "t1",
      openId: "adam-open-id",
      name: "Adam",
      email: "adam@example.test",
      loginMethod: "test",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
  } as TrpcContext;
}

const appInstruction = (instructionRef: string) => ({
  kind: "operator_instruction",
  channel: "authenticated_app",
  operatorActorId: "42",
  instructionRef,
});

describe("authenticated app writers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dayDirector.accept admits the signed-in operator's accept", async () => {
    await dayDirectorRouter.createCaller(context()).accept({
      businessDate: "2026-10-19",
      proposal: {
        promptKey: "commitment:abc",
        title: "Call Mei",
        kind: "growth",
        quantity: null,
        sourceText: "Call Mei",
        prerequisites: [],
        question: null,
        intelligence: "manual_fallback",
      },
    });
    expect(writers.acceptProposalWithReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: "42", admission: appInstruction("day_director.accept:adam-open-id:commitment:abc") })
    );
  });

  it("dayDirector.complete admits the signed-in operator's completion", async () => {
    const commitmentId = "11111111-1111-4111-8111-111111111111";
    await dayDirectorRouter.createCaller(context()).complete({ commitmentId });
    expect(writers.completeDayDirectorCommitment).toHaveBeenCalledWith(
      expect.objectContaining({ commitmentId, admission: appInstruction(`day_director.complete:adam-open-id:${commitmentId}`) })
    );
  });

  it("currentDayLine.completeItem admits the caller's completion with its evidence reference", async () => {
    await currentDayLineRouter.createCaller(context()).completeItem({ itemId: "c-9", evidenceReference: "hud:tap:5" });
    expect(writers.completeDayDirectorCommitment).toHaveBeenCalledWith(
      expect.objectContaining({ commitmentId: "c-9", admission: appInstruction("day_line.completeItem:adam-open-id:hud:tap:5") })
    );
  });

  it("towerWars.activatePromise admits the signed-in admin's activation", async () => {
    const promiseId = "22222222-2222-4222-8222-222222222222";
    await towerWarsRouter.createCaller(context()).activatePromise({ promiseId });
    expect(writers.activateTowerWarsPromise).toHaveBeenCalledWith(
      expect.objectContaining({ promiseId, actorId: "42", admission: appInstruction(`tower_wars.activatePromise:adam-open-id:${promiseId}`) })
    );
  });
});

describe("vehicle cargo linkage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards its caller's admission to the Day Line row and its cargo note", async () => {
    const admission = {
      kind: "operator_instruction" as const,
      channel: "claire_conversation" as const,
      operatorActorId: "42",
      instructionRef: "briefing:conv-3",
    };
    const result = await confirmLinkedVehicleWork({
      tenantId: "t1",
      actorId: "42",
      vehicleId: "adam-open-id",
      businessDate: "2026-10-19",
      requestId: "req-3",
      transcript: "I have Mei's dry cleaning in the car",
      confirmed: true,
      admission,
    });
    expect(result.dayLine).toEqual({ ok: true, id: "c-cargo" });
    expect(writers.acceptProposal).toHaveBeenCalledWith(expect.objectContaining({ admission }));
    expect(writers.updateDayDirectorCommitment).toHaveBeenCalledWith(expect.objectContaining({ admission }));
  });
});
