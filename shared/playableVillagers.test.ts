import { describe, it, expect } from "vitest";
import {
  LETTER_APPROACHES,
  VILLAGER_PERSONALITIES,
  getVillagerPersonality,
  NEIGHBORHOOD_FEATURES,
  SYNTHETIC_SILVER_LAKE_TARGETS,
  type LetterApproachId,
} from "./playableVillagers";

describe("playableVillagers", () => {
  const fox = getVillagerPersonality("fox");
  const badger = getVillagerPersonality("badger");
  const sampleTarget = SYNTHETIC_SILVER_LAKE_TARGETS[0]; // Mei Lin

  describe("Villager Personality Distinction (Fox vs Badger)", () => {
    it("assigns distinct personality styles to Fox and Badger", () => {
      expect(fox.style).toBe("enthusiastic");
      expect(badger.style).toBe("concise");
      expect(fox.canonicalName).toContain("Barnaby");
      expect(badger.canonicalName).toContain("Bramble");
    });

    it("produces distinct first-encounter greetings", () => {
      const foxGreeting = fox.firstEncounterGreeting("Mei Lin");
      const badgerGreeting = badger.firstEncounterGreeting("Mei Lin");

      expect(foxGreeting).toContain("heartfelt");
      expect(foxGreeting).toContain("Barnaby");
      expect(badgerGreeting).toContain("don't want a novel");
      expect(badgerGreeting).toContain("zero fuss");
      expect(badgerGreeting).toContain("Bramble");
      expect(foxGreeting).not.toEqual(badgerGreeting);
    });

    it("makes subsequent/repeat encounters faster and references past interactions", () => {
      const foxRepeat = fox.repeatEncounterGreeting("Mei Lin", "Mei's letter is in the shelf.");
      const badgerRepeat = badger.repeatEncounterGreeting("Marcus", "Keep it under forty words.");

      expect(foxRepeat).toContain("Welcome back!");
      expect(foxRepeat).toContain("Mei's letter is in the shelf.");
      expect(badgerRepeat).toContain("You again. Good.");
      expect(badgerRepeat).toContain("under forty words");
    });

    it("reacts with distinct emotional tone to Short vs Detailed approaches", () => {
      // Fox reactions
      const foxBriefReaction = fox.reactionToApproach("warm_brief", "Short check-in");
      const foxDetailedReaction = fox.reactionToApproach("helpful_detailed", "Long detailed order history");

      expect(foxDetailedReaction.dialogue).toContain("hug in an envelope");
      expect(foxDetailedReaction.glyph).toContain("❤️");
      expect(foxDetailedReaction.pose).toBe("wave");

      // Badger reactions
      const badgerBriefReaction = badger.reactionToApproach("warm_brief", "Short check-in");
      const badgerDetailedReaction = badger.reactionToApproach("helpful_detailed", "Long detailed order history");

      expect(badgerBriefReaction.dialogue).toContain("Now that's a proper message");
      expect(badgerBriefReaction.dialogue).toContain("before we start adding extra adjectives");
      expect(badgerDetailedReaction.dialogue).toContain("Two whole sentences?");
      expect(badgerDetailedReaction.dialogue).toContain("Don't go adding exclamation marks");
    });

    it("reacts distinctly to scheduling commitments without implying automatic delivery", () => {
      const foxSchedule = fox.reactionToSchedule("Tomorrow Morning (10:00 AM PT)");
      const badgerSchedule = badger.reactionToSchedule("Tomorrow Morning (10:00 AM PT)");

      expect(foxSchedule.dialogue).toContain("dispatch shelf");
      expect(foxSchedule.dialogue).toContain("open Google Messages");
      expect(foxSchedule.dialogue).toContain("No automatic delivery");
      expect(foxSchedule.pose).toBe("wave");

      expect(badgerSchedule.dialogue).toContain("On the shelf it goes");
      expect(badgerSchedule.dialogue).toContain("open Google Messages on your handset");
      expect(badgerSchedule.dialogue).toContain("No magic automated texting");
    });
  });

  describe("Letter Approaches (The Collaborative Writing Activity)", () => {
    it("provides the four canonical approach options", () => {
      const approaches: LetterApproachId[] = ["warm_brief", "helpful_detailed", "cozy_care_perk", "custom"];
      for (const id of approaches) {
        expect(LETTER_APPROACHES[id]).toBeDefined();
        expect(LETTER_APPROACHES[id].label.length).toBeGreaterThan(0);
        expect(LETTER_APPROACHES[id].icon.length).toBeGreaterThan(0);
      }
    });

    it("generates honest, fact-grounded text for each approach with Laundry Farm branding", () => {
      const briefText = LETTER_APPROACHES.warm_brief.generateText(sampleTarget);
      const detailedText = LETTER_APPROACHES.helpful_detailed.generateText(sampleTarget);
      const perkText = LETTER_APPROACHES.cozy_care_perk.generateText(sampleTarget);

      // Must address the real recipient
      expect(briefText).toContain("Mei");
      expect(detailedText).toContain("Mei");
      expect(perkText).toContain("Mei");

      // Must truthfully state the days since last order (42 days)
      expect(briefText).toContain("42 days");
      expect(detailedText).toContain("42 days");
      expect(perkText).toContain("42 days");

      // Brand must be Laundry Farm, never hardcoded Laundry Butler
      expect(briefText).toContain("Laundry Farm");
      expect(briefText).not.toContain("Laundry Butler");
      expect(detailedText).toContain("Laundry Farm");
      expect(detailedText).not.toContain("Laundry Butler");
      expect(perkText).toContain("Laundry Farm");
      expect(perkText).not.toContain("Laundry Butler");

      // Detailed approach cites the last care summary
      expect(detailedText).toContain("wash & fold");
    });
  });

  describe("Persistent Neighborhood Consequence", () => {
    it("defines the two neighborhood outdoor placement choices", () => {
      expect(NEIGHBORHOOD_FEATURES.tea_table).toBeDefined();
      expect(NEIGHBORHOOD_FEATURES.reading_bench).toBeDefined();

      expect(NEIGHBORHOOD_FEATURES.tea_table.name).toBe("Cozy Cedar Tea Table");
      expect(NEIGHBORHOOD_FEATURES.reading_bench.name).toBe("Sunlit Garden Reading Bench");
      expect(NEIGHBORHOOD_FEATURES.tea_table.icon).toBe("🍵");
      expect(NEIGHBORHOOD_FEATURES.reading_bench.icon).toBe("🌸");
    });
  });

  describe("Isolated Synthetic Test Fixtures", () => {
    it("provides exactly 8 customer slots covering all realistic outreach states", () => {
      expect(SYNTHETIC_SILVER_LAKE_TARGETS).toHaveLength(8);

      const slotIds = SYNTHETIC_SILVER_LAKE_TARGETS.map((t) => t.slotId);
      expect(new Set(slotIds).size).toBe(8);

      // Verify states represented
      const statuses = SYNTHETIC_SILVER_LAKE_TARGETS.map((t) => t.status);
      expect(statuses).toContain("draft_ready");
      expect(statuses).toContain("scheduled");
      expect(statuses).toContain("awaiting_sender_setup");
      expect(statuses).toContain("accepted");
      expect(statuses).toContain("failed");
      expect(statuses).toContain("consent_blocked");

      // Verify recipient identities are explicit synthetic prefixes
      for (const target of SYNTHETIC_SILVER_LAKE_TARGETS) {
        expect(target.customerId).toMatch(/^synthetic:customer:/);
        expect(target.territoryId).toBe("silver-lake");
      }
    });

    it("blocks consent truthfully when phone number is missing", () => {
      const missingPhoneTarget = SYNTHETIC_SILVER_LAKE_TARGETS.find((t) => t.phone === null);
      expect(missingPhoneTarget).toBeDefined();
      expect(missingPhoneTarget?.hasConsent).toBe(false);
      expect(missingPhoneTarget?.consentStatus).toBe("missing_phone");
      expect(missingPhoneTarget?.status).toBe("consent_blocked");
    });

    it("verifies phone normalization and format on contactable targets", () => {
      const contactable = SYNTHETIC_SILVER_LAKE_TARGETS.filter((t) => t.phone !== null);
      for (const target of contactable) {
        expect(target.phone).toMatch(/^\+1\d{10}$/);
      }
    });
  });

  describe("Phase 4 Evolving Villager Memory & Contextual Greetings", () => {
    it("evolves greeting when player returns tomorrow or later", () => {
      const foxGreeting = fox.contextualGreeting?.({
        customerName: "Mei Lin",
        isReturnVisitTomorrowOrLater: true,
      });
      const badgerGreeting = badger.contextualGreeting?.({
        customerName: "Mei Lin",
        isReturnVisitTomorrowOrLater: true,
      });

      expect(foxGreeting).toContain("Good morning!");
      expect(foxGreeting).toContain("brand new day");
      expect(badgerGreeting).toContain("Morning. Good to see you back.");
    });

    it("acknowledges unfinished letter draft left on the desk", () => {
      const foxDraft = fox.contextualGreeting?.({
        customerName: "Mei Lin",
        unfinishedDraftCustomer: "Mei Lin",
      });
      const badgerDraft = badger.contextualGreeting?.({
        customerName: "Mei Lin",
        unfinishedDraftCustomer: "Mei Lin",
      });

      expect(foxDraft).toContain("left off drafting");
      expect(foxDraft).toContain("Mei Lin");
      expect(badgerDraft).toContain("unfinished note for Mei Lin is still on the desk");
    });

    it("responds with distinct personality to verified customer reply and paid reorder", () => {
      // Customer reply
      const foxReply = fox.contextualGreeting?.({
        customerName: "Mei Lin",
        customerReplied: true,
      });
      const badgerReply = badger.contextualGreeting?.({
        customerName: "Mei Lin",
        customerReplied: true,
      });

      expect(foxReply).toContain("reply arrived from Mei Lin");
      expect(badgerReply).toContain("Inbound reply arrived from Mei Lin");

      // Paid reorder verified
      const foxPaid = fox.contextualGreeting?.({
        customerName: "Mei Lin",
        paidReorderVerified: true,
      });
      const badgerPaid = badger.contextualGreeting?.({
        customerName: "Mei Lin",
        paidReorderVerified: true,
      });

      expect(foxPaid).toContain("Celebration!");
      expect(foxPaid).toContain("placed a new verified order with Laundry Farm");
      expect(badgerPaid).toContain("Order confirmed paid in CleanCloud");
      expect(badgerPaid).toContain("Real business");
    });
  });
});
