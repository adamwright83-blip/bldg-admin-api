/* LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExplicitOperatorMissionCommand } from "../server/claire/operatorMissionCommand";
import { SEED_CAMPAIGNS } from "../server/campaignLibrary/seedCampaigns";
import {
  adminCurrentDayLineOrder,
  claireCurrentDayLineOrder,
  dayLineForSelectedDate,
  driverCurrentDayLineOrder,
  executionContractFromWork,
  executionTypeLabel,
  presentCurrentDayLine,
  projectCurrentDayLine,
  stampExecutionType,
  type RankedDayWork,
} from "./currentDayLine";
import {
  OBJECTIVE_EXECUTION_AGREEMENT_CASES,
  classifyAgreementCase,
} from "./objectiveExecutionFixture";

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

  it("stamps pickup, physical pitch, and physical delivery as Mission", () => {
    expect(stampExecutionType(executionContractFromWork({ completionCondition: "Pick up the route bags." }))).toBe("mission");
    expect(stampExecutionType(executionContractFromWork({ completionCondition: "Give the physical pitch at the office." }))).toBe("mission");
    expect(stampExecutionType(executionContractFromWork({ completionCondition: "The physical delivery is in the customer's hands." }))).toBe("mission");
  });

  it("stamps SMS, browser, and Admin work as Challenge", () => {
    expect(stampExecutionType(executionContractFromWork({ completionCondition: "Send the SMS to the leasing office." }))).toBe("challenge");
    expect(stampExecutionType(executionContractFromWork({ completionCondition: "Finish the form in the browser." }))).toBe("challenge");
    expect(stampExecutionType(executionContractFromWork({ completionCondition: "Record the outcome in Admin." }))).toBe("challenge");
  });

  it("treats delivering an email as a Challenge", () => {
    const contract = executionContractFromWork({
      completionCondition: "Deliver the email to the property manager.",
    });
    expect(contract.fieldRequired).toBe(false);
    expect(contract.remoteRequired).toBe(true);
    expect(stampExecutionType(contract)).toBe("challenge");
  });

  it("stays Hybrid when a visit is required along with delivering an email", () => {
    expect(
      stampExecutionType(
        executionContractFromWork({
          completionCondition: "Visit the office and deliver the email before leaving.",
        })
      )
    ).toBe("hybrid_objective");
  });

  it("stamps the seeded campaign library from completion text", () => {
    const stamped = Object.fromEntries(
      SEED_CAMPAIGNS.map(row => [
        row.campaignId,
        stampExecutionType(
          executionContractFromWork({
            title: row.campaign.title,
            objective: row.campaign.objective,
            completionCondition: row.campaign.completionCondition,
          })
        ),
      ])
    );
    expect(stamped).toEqual({
      "door-hanger-territory-operation": "mission",
      "property-manager-office-pitch": "mission",
      "referral-ask": null,
      "review-request": null,
      "retention-win-back-outreach": "challenge",
      "local-digital-footprint-post": "challenge",
      "neighboring-business-partnership-outreach": "mission",
      "greystar-koreatown-colosseum": "mission",
      "the-last-valet-recurring-account-pitch": "mission",
    });
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

  it("does not present a no_plan or an empty ranking as today's ordered work", () => {
    const diagnostic = projectCurrentDayLine({
      businessDate: "2026-09-23",
      rankingStatus: "no_plan",
      rankedWorks: ranked,
      designated: {
        id: "operator-call",
        title: "Call Dana",
        completionCondition: "Operator reports completion of: Call Dana",
        compatibilityPhrase: "todays_mission",
      },
    });
    const presented = presentCurrentDayLine(diagnostic);
    expect(presented.rankingStatus).toBe("no_plan");
    expect(presented.items).toEqual([]);
    expect(presented.statusText).toBe("No ranked line for today.");
    expect(presented.designated?.executionType).toBe("challenge");
    expect(adminCurrentDayLineOrder(diagnostic)).toEqual([]);
    expect(driverCurrentDayLineOrder(diagnostic)).toEqual(claireCurrentDayLineOrder(diagnostic));
    expect(presentCurrentDayLine({ ...diagnostic, rankingStatus: "unavailable", designated: null }).statusText).toBe(
      "Today's ranking is unavailable."
    );
    expect(
      presentCurrentDayLine({
        ...diagnostic,
        rankingStatus: "ranked",
        items: [],
        designated: null,
      }).rankingStatus
    ).toBe("unavailable");
  });

  it("hides today's line when the selected date is not that business date", () => {
    const line = projectCurrentDayLine({
      businessDate: "2026-09-23",
      rankingStatus: "ranked",
      rankedWorks: ranked,
    });
    expect(dayLineForSelectedDate(line, "2026-09-23")?.items.map(item => item.id)).toEqual([
      "zzz-visit",
      "aaa-email",
    ]);
    expect(dayLineForSelectedDate(line, "2026-09-24")).toBeNull();
    expect(dayLineForSelectedDate(null, "2026-09-23")).toBeNull();
  });

  it("does not add a second planner beside Mission Director", () => {
    const source = readFileSync(new URL("./currentDayLine.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/rankCampaigns|selectMissionPlan|sort\(/);
    const service = readFileSync(
      new URL("../server/goldline/dayline/currentDayLineService.ts", import.meta.url),
      "utf8"
    );
    expect(service).not.toMatch(/rankCampaigns|selectMissionPlan|sortFieldTimeline|sortLegacyDayforgeTodayItems|\.sort\(/);
    expect(service).toMatch(/planForDate/);
  });
});

describe("shared execution fixture on today's Day Line", () => {
  const rankedWorks: RankedDayWork[] = OBJECTIVE_EXECUTION_AGREEMENT_CASES.map(row => ({
    id: row.id,
    title: row.identifier,
    objective: row.contract,
    completionCondition: row.contract,
  }));

  it("stamps Admin, Driver, and Claire with the same type and does not reorder", () => {
    const line = projectCurrentDayLine({
      businessDate: "2026-09-23",
      rankingStatus: "ranked",
      rankedWorks,
    });
    const expectedIds = OBJECTIVE_EXECUTION_AGREEMENT_CASES.map(row => row.id);
    const expectedTypes = OBJECTIVE_EXECUTION_AGREEMENT_CASES.map(row => row.expected);
    expect(line.items.map(item => item.id)).toEqual(expectedIds);
    expect(line.items.map(item => item.executionType)).toEqual(expectedTypes);
    for (const row of OBJECTIVE_EXECUTION_AGREEMENT_CASES) {
      expect(classifyAgreementCase(row).executionType).toBe(row.expected);
    }

    const admin = presentCurrentDayLine(line);
    const driver = presentCurrentDayLine(line);
    expect(driver).toEqual(admin);
    expect(admin.items.map(item => item.executionType)).toEqual(expectedTypes);
    expect(admin.items.map(item => executionTypeLabel(item.executionType))).toEqual(
      expectedTypes.map(type => executionTypeLabel(type))
    );
    expect(adminCurrentDayLineOrder(line)).toEqual(expectedIds);
    expect(driverCurrentDayLineOrder(line)).toEqual(expectedIds);
    expect(claireCurrentDayLineOrder(line)).toEqual(expectedIds);
  });

  it("preserves a stored type and keeps a stored unknown from becoming Mission", () => {
    const line = projectCurrentDayLine({
      businessDate: "2026-09-23",
      rankingStatus: "ranked",
      rankedWorks: [
        {
          id: "stored-challenge",
          title: "commercial_mission:greystar",
          completionCondition: "On-site property pitch",
          executionType: "challenge",
        },
        {
          id: "stored-unknown",
          title: "commercial_mission:onsite",
          completionCondition: "On-site property pitch",
          executionType: null,
        },
        {
          id: "derived-mission",
          title: "commercial_mission:derived",
          completionCondition: "On-site property pitch",
        },
      ],
    });
    expect(line.items.map(item => item.executionType)).toEqual(["challenge", null, "mission"]);
    expect(line.items.map(item => item.id)).toEqual(["stored-challenge", "stored-unknown", "derived-mission"]);
  });
});
