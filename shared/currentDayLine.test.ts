import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExplicitOperatorMissionCommand } from "../server/claire/operatorMissionCommand";
import {
  adminCurrentDayLineOrder,
  claireCurrentDayLineOrder,
  driverCurrentDayLineOrder,
  executionContractFromWork,
  projectCurrentDayLine,
  stampExecutionType,
  type RankedDayWork,
} from "./currentDayLine";

function work(partial: RankedDayWork): RankedDayWork {
  return partial;
}

describe("current day line execution contract", () => {
  it("stamps a field completion as Mission", () => {
    const contract = executionContractFromWork({
      title: "commercial_mission:greystar",
      completionCondition: "All five properties have a recorded visit outcome.",
    });
    expect(stampExecutionType(contract)).toBe("mission");
  });

  it("stamps remote work as Challenge even when the identifier says mission", () => {
    const contract = executionContractFromWork({
      title: "commercial_mission:follow-up",
      objective: "mission dispatch for the account",
      completionCondition: "Send the follow-up email to the property manager.",
    });
    expect(stampExecutionType(contract)).toBe("challenge");
    expect(contract.fieldRequired).toBe(false);
  });

  it("stamps a call as Challenge", () => {
    expect(
      stampExecutionType(
        executionContractFromWork({
          completionCondition: "Operator reports completion of: Call Dana",
        })
      )
    ).toBe("challenge");
  });

  it("stamps work that requires both presence and a remote action as Hybrid", () => {
    const contract = executionContractFromWork({
      completionCondition: "Visit the office and email the proposal before leaving.",
    });
    expect(stampExecutionType(contract)).toBe("hybrid_objective");
    expect(contract.fieldRequired).toBe(true);
    expect(contract.remoteRequired).toBe(true);
  });

  it("does not treat an either-or completion as Hybrid", () => {
    const contract = executionContractFromWork({
      objective: "Ask a customer to refer a neighbor, coworker, or friend.",
      completionCondition: "The ask was made in person or by message.",
    });
    expect(contract.eitherAcceptable).toBe(true);
    expect(stampExecutionType(contract)).toBeNull();
  });

  it("does not treat the word mission as a field execution", () => {
    const contract = executionContractFromWork({
      title: "today's mission",
      completionCondition: "Operator reports completion of: today's mission",
    });
    expect(stampExecutionType(contract)).toBeNull();
  });

  it("keeps a published post remote when the objective mentions a delivery", () => {
    expect(
      stampExecutionType(
        executionContractFromWork({
          objective: "Post a photo of a delivery to a local page.",
          completionCondition: "A post was published to a real account.",
        })
      )
    ).toBe("challenge");
  });
});

describe("current day line ranking projection", () => {
  const ranked = [
    work({
      id: "zzz-visit",
      title: "Visit Greystar",
      completionCondition: "The visit is completed.",
    }),
    work({
      id: "aaa-email",
      title: "commercial_mission:email",
      completionCondition: "Email the leasing office.",
    }),
  ];

  it("does not use execution type to restamp today's order", () => {
    const line = projectCurrentDayLine({
      businessDate: "2026-09-23",
      rankingStatus: "ranked",
      rankedWorks: [
        work({
          id: "first-call",
          title: "Call the office",
          completionCondition: "Call the office.",
        }),
        work({
          id: "second-visit",
          title: "Visit the building",
          completionCondition: "The visit is completed.",
        }),
      ],
    });
    expect(line.items.map(item => item.executionType)).toEqual(["challenge", "mission"]);
    expect(line.items.map(item => item.id)).toEqual(["first-call", "second-visit"]);
    expect(line.items.map(item => item.position)).toEqual([0, 1]);
  });

  it("keeps Mission Director order and does not rerank", () => {
    const line = projectCurrentDayLine({
      businessDate: "2026-09-23",
      rankingStatus: "ranked",
      rankedWorks: ranked,
      designated: {
        id: "operator-call",
        title: "Call Dana",
        completionCondition: "Operator reports completion of: Call Dana",
        compatibilityPhrase: "todays_mission",
      },
    });
    expect(line.orderingAuthority).toBe("system.mission_director");
    expect(line.items.map(item => item.id)).toEqual(["zzz-visit", "aaa-email"]);
    expect(line.items.map(item => item.executionType)).toEqual(["mission", "challenge"]);
    expect(line.designated?.id).toBe("operator-call");
    expect(line.designated?.executionType).toBe("challenge");
    expect(line.designated?.position).toBe(-1);
    expect(adminCurrentDayLineOrder(line)).toEqual(driverCurrentDayLineOrder(line));
    expect(driverCurrentDayLineOrder(line)).toEqual(claireCurrentDayLineOrder(line));
    expect(adminCurrentDayLineOrder(line)).toEqual(["zzz-visit", "aaa-email"]);
  });

  it("keeps make-this-today's-mission and stamps the real execution type", () => {
    const parsed = parseExplicitOperatorMissionCommand("Make calling Dana today's mission.");
    expect(parsed?.title.toLowerCase()).toContain("call");
    const line = projectCurrentDayLine({
      businessDate: "2026-09-23",
      rankingStatus: "ranked",
      rankedWorks: ranked,
      designated: parsed
        ? {
            id: "operator-1",
            title: parsed.title,
            completionCondition: parsed.completionCondition,
            compatibilityPhrase: "todays_mission",
          }
        : null,
    });
    expect(line.designated?.compatibilityPhrase).toBe("todays_mission");
    expect(line.designated?.executionType).toBe("challenge");
    expect(line.items.map(item => item.id)).toEqual(["zzz-visit", "aaa-email"]);
  });

  it("does not add a second planner beside Mission Director", () => {
    const source = readFileSync(new URL("./currentDayLine.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/rankCampaigns|selectMissionPlan|sort\(/);
    const service = readFileSync(
      new URL("../server/goldline/dayline/currentDayLineService.ts", import.meta.url),
      "utf8"
    );
    expect(service).not.toMatch(/rankCampaigns|selectMissionPlan|sortFieldTimeline|sortDayforgeTodayItems|\.sort\(/);
    expect(service).toMatch(/planForDate/);
  });
});
