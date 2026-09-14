import { describe, expect, it, vi } from "vitest";
import type { ClaireDriveContext } from "./contextAssembler";
import { writeClairePreDriveBrief } from "./reasoning";

const context: ClaireDriveContext = {
  phase: "pre_drive",
  generatedAt: "2026-09-14T12:00:00.000Z",
  businessDate: "2026-09-14",
  actorId: "operator-1",
  truthLaw: "game_projection_never_creates_business_truth",
  nextFixedCommitment: null,
  blockers: [],
  relevantTimeline: [],
  mission: null,
  missionSalesBrief: {
    briefId: 42,
    version: 2,
    primaryObjective: "Identify the corporate approval path.",
    keyKnownFacts: ["Management previously showed interest."],
    keyUnknown: "Who owns vendor approval?",
    recommendedOpening: null,
    questionsToAsk: ["Who approves new vendors?"],
    thingsToAvoid: ["Repeating the introductory pitch."],
    frameworkId: null,
  },
};

describe("M/N — Claire's pre-drive prompt is grounded to the active MissionSalesBrief", () => {
  it("forwards missionSalesBrief in the user payload sent to the model", async () => {
    const invokeText = vi.fn().mockResolvedValue("Model brief.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const payload = JSON.parse(invokeText.mock.calls[0][0].messages[1].content);
    expect(payload.missionSalesBrief).toEqual(context.missionSalesBrief);
  });

  it("instructs the model not to promote the brief's unknowns/recommendations into facts", async () => {
    const invokeText = vi.fn().mockResolvedValue("Model brief.");
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const systemContent = invokeText.mock.calls[0][0].messages[0].content;
    expect(systemContent).toMatch(/one authoritative sales strategy/i);
    expect(systemContent).toMatch(/never state a missionSalesBrief unknown.*as if it were already a known fact/i);
  });

  it("omits missionSalesBrief entirely from the payload when no mission is in play (no regression)", async () => {
    const invokeText = vi.fn().mockResolvedValue("Model brief.");
    const noMissionContext: ClaireDriveContext = { ...context, missionSalesBrief: undefined };
    await writeClairePreDriveBrief(
      { tenantId: "tenant-1", context: noMissionContext },
      { invokeText, recordGeneration: vi.fn().mockResolvedValue(undefined) }
    );
    const payload = JSON.parse(invokeText.mock.calls[0][0].messages[1].content);
    expect(payload).not.toHaveProperty("missionSalesBrief");
  });
});
