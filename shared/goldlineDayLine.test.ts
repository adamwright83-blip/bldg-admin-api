import { describe, expect, it } from "vitest";
import {
  classifyIntentHeuristics,
} from "./claireRuntime";
import {
  capabilityIsActionable,
  formatCapabilityBriefing,
  getGoldlineCapability,
} from "./goldlineCapabilities";
import {
  extractCancellationReason,
  extractRequestedActionTitle,
  isDayLineCancelled,
  matchDayLineItem,
  mergeDayLineOverlay,
  readDayLineOverlay,
  type DayLineItemRef,
} from "./goldlineDayLine";
import { resolveDayLineTargets } from "../server/goldline/dayline/dayLineMutationService";

const louise: DayLineItemRef = {
  sourceType: "commercial_mission",
  sourceId: "12",
  displayTitle: "The Louise",
  accountName: "The Louise",
  missionId: 12,
  editableCapabilities: ["dayline.edit", "dayline.cancel"],
  status: "active",
};

const maybourne: DayLineItemRef = {
  sourceType: "commercial_follow_up",
  sourceId: "fu-1",
  displayTitle: "Maybourne Beverly Hills",
  accountName: "Maybourne Beverly Hills",
  missionId: 9,
  followupId: "fu-1",
  editableCapabilities: ["dayline.edit", "dayline.cancel"],
  status: "active",
};

describe("Day Line identity and natural language", () => {
  it("resolves The Louise to exactly one active item", () => {
    expect(resolveDayLineTargets([louise, maybourne], "Change The Louise to Call Dana w/ THE LOUISE")).toEqual([
      louise,
    ]);
  });

  it("resolves Maybourne to the existing active item", () => {
    expect(resolveDayLineTargets([louise, maybourne], "Remove The Maybourne")).toEqual([
      maybourne,
    ]);
  });

  it("asks nothing extra for a unique target", () => {
    expect(matchDayLineItem(maybourne, "Take Maybourne off")).toBe(true);
  });

  it("extracts the action title without renaming the account", () => {
    expect(
      extractRequestedActionTitle("Change The Louise to ‘Call Dana w/ THE LOUISE.’")
    ).toBe("Call Dana w/ THE LOUISE");
    expect(louise.accountName).toBe("The Louise");
  });

  it("keeps operator-attested cancellation rationale", () => {
    const reason = extractCancellationReason(
      "Remove The Maybourne. I decided I don’t want to pursue them because I don’t want us taking on the liability of potentially damaging extremely expensive clothing."
    );
    expect(reason).toMatch(/liability|expensive/i);
  });

  it("does not treat overlay cancellation as a lost sale flag", () => {
    const overlay = readDayLineOverlay(
      mergeDayLineOverlay(
        {},
        {
          notPursuing: true,
          cancelledReason: "Adam decided not to pursue because of perceived liability.",
        }
      )
    );
    expect(isDayLineCancelled(overlay)).toBe(true);
    expect(overlay.cancelledReason).toMatch(/Adam decided/);
  });
});

describe("Claire classification for existing Day Line operations", () => {
  it("classifies remove as cancel, not uncertain", () => {
    expect(classifyIntentHeuristics("Take Maybourne off.")).toBe("cancel_existing_work");
    expect(classifyIntentHeuristics("Get rid of the Maybourne stop.")).toBe(
      "cancel_existing_work"
    );
    expect(classifyIntentHeuristics("I'm not pursuing them anymore. Remove it.")).toBe(
      "cancel_existing_work"
    );
  });

  it("classifies title change as edit", () => {
    expect(classifyIntentHeuristics("Change Louise to call Dana.")).toBe("edit_existing_work");
    expect(classifyIntentHeuristics("Make it say Call Dana.")).toBe("edit_existing_work");
  });
});

describe("Capability registry", () => {
  it("marks dayline edit and cancel supported after this implementation", () => {
    expect(getGoldlineCapability("dayline.edit")?.status).toBe("SUPPORTED");
    expect(getGoldlineCapability("dayline.cancel")?.status).toBe("SUPPORTED");
    expect(capabilityIsActionable("dayline.cancel")).toBe(true);
  });

  it("does not invent capabilities", () => {
    expect(getGoldlineCapability("dayline.teleport")).toBeUndefined();
    expect(formatCapabilityBriefing()).toMatch(/dayline.cancel/);
  });
});
