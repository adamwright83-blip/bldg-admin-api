import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rescueActionGrammar, SPIRIT_HUMAN_RESCUE_TEMPLATE_ID } from "../../../../shared/spiritHumanRescue";
import { selectFictionForMission } from "./fictionDirector";
import { SPIRIT_HUMAN_RESCUE_TEMPLATE } from "./templates/spiritHumanRescueTemplate";
import { HELD_BREATH_TEMPLATE } from "./templates/heldBreathTemplate";

describe("Spirit Human rescue overlay wiring", () => {
  const source = readFileSync(
    new URL("./SpiritHumanRescueMission.tsx", import.meta.url),
    "utf8"
  );
  const gameHome = readFileSync(
    new URL("../GoldlineGameHome.tsx", import.meta.url),
    "utf8"
  );
  const controller = readFileSync(
    new URL("../../pages/driver/GoldlineDriverController.tsx", import.meta.url),
    "utf8"
  );

  it("requires explicit operatorAuthorizedSend and never treats draft as completion", () => {
    expect(source).toContain("operatorAuthorizedSend: true");
    expect(source).toContain("canCompleteRescue");
    expect(source).toContain("player_prepare");
    expect(source).toContain("isDriving");
    expect(source).toContain("NOT NOW");
    expect(source).toContain("Provisional");
    expect(source).toContain('type: "restore"');
    expect(source).toContain("shouldPersistPressureAnchor");
    expect(source).toContain("Draft outreach");
    expect(source).not.toContain("Claire draft");
    expect(source).not.toContain("Reply YES");
    expect(source).not.toContain("sendCustomerReminderTool");
    expect(source).toContain("spiritHumanRescue.defer");
    expect(source).toContain("spiritHumanRescue.cancel");
    expect(source).not.toContain("no_response");
  });

  it("is wired into the Driver Day Line and game overlay", () => {
    expect(controller).toContain("spiritHumanRescue.listMine");
    expect(controller).toContain("rescueMissionCard");
    expect(gameHome).toContain("GoldlineSpiritHumanRescue");
    expect(gameHome).toContain('data-testid="enter-spirit-human-rescue"');
  });
});

describe("presentation does not change the business action", () => {
  it("keeps ActionGrammar identical when the rescue template is preferred", () => {
    const grammar = rescueActionGrammar({ missionId: "shr_1", opsTaskId: 41 });
    const now = new Date("2026-09-17T15:00:00.000Z");
    const standard = selectFictionForMission(grammar, {
      now,
      registry: [HELD_BREATH_TEMPLATE],
    });
    const rescue = selectFictionForMission(grammar, {
      now,
      registry: [HELD_BREATH_TEMPLATE, SPIRIT_HUMAN_RESCUE_TEMPLATE],
      preferredTemplateId: SPIRIT_HUMAN_RESCUE_TEMPLATE_ID,
    });
    expect(standard?.grammar).toEqual(grammar);
    expect(rescue?.grammar).toEqual(grammar);
    expect(rescue?.template.id).toBe(SPIRIT_HUMAN_RESCUE_TEMPLATE_ID);
    expect(standard?.grammar.businessActionId).toBe(rescue?.grammar.businessActionId);
  });
});
