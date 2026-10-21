import { describe, expect, it } from "vitest";
import {
  FIXTURE_ENCOURAGEMENT,
  FIXTURE_SUNDAY_REVIEW,
  FIXTURE_TOMORROW_VISITS,
} from "../agents/daphne/standingInstructions/productionFixtures";
import { inMemoryPreparedItemStore } from "../agents/persistentOperator/preparedItems";
import { findPromiseSentences, isPromiseSentence, lintAndStripUnbackedPromises, splitSentences } from "./promiseGuard";
import { businessDateForPreparedItem, reconcileSpokenPromises, type PromiseScope } from "./promiseReconciler";

describe("promise guard: unbacked promises are never spoken", () => {
  it.each([
    FIXTURE_ENCOURAGEMENT.claireReplied,
    FIXTURE_TOMORROW_VISITS.claireSaid,
    "I'll hold it until then.",
    "I'll have the plan ready for you in the morning.",
    "I'll keep the Louise follow-up in front of you.",
    "Tomorrow I'll bring you the three best options.",
    "From now on I'll open with the goal.",
    "I'll make sure it's covered.",
  ])("flags: %s", sentence => expect(isPromiseSentence(sentence)).toBe(true));

  it.each([
    "That's on me to fix.",
    "I'll check the numbers now.",
    "You have two pickups tomorrow.",
    "Fifty is attainable if you count buildings.",
    "Got it. Sunday 5–7 PM for that kind of review.",
    "Which one do you want first?",
  ])("leaves alone: %s", sentence => expect(isPromiseSentence(sentence)).toBe(false));

  it("strips only the promise from the production 10-18 reply", () => {
    const result = lintAndStripUnbackedPromises(FIXTURE_SUNDAY_REVIEW.claireReplied);
    expect(result.text).toBe("Got it. Sunday 5–7 PM for that kind of review.");
    expect(result.pass).toBe(false);
    expect(result.removed).toEqual(["I'll hold it until then."]);
  });

  it("a reply that was only a promise is reported as emptied so the caller supplies its own line", () => {
    const result = lintAndStripUnbackedPromises(FIXTURE_ENCOURAGEMENT.claireReplied);
    expect(result).toMatchObject({ text: "", emptied: true });
  });

  it("a backed promise is kept; an unrelated one in the same reply is not", () => {
    const text = `${FIXTURE_TOMORROW_VISITS.claireSaid} Also, I'll keep that in mind.`;
    const result = lintAndStripUnbackedPromises(text, { backed: [{ id: "property_visit_choice", matches: /property visits/i }] });
    expect(result.text).toBe(FIXTURE_TOMORROW_VISITS.claireSaid);
    expect(result.kept).toHaveLength(1);
    expect(result.removed).toEqual(["Also, I'll keep that in mind."]);
  });

  it("never splits a figure or a time, and returns a clean answer byte for byte", () => {
    const revenue = "Paid revenue in the last 30 days is $2,314.42 across 18 orders.";
    expect(splitSentences(revenue)).toEqual([revenue]);
    expect(splitSentences("Pickup is at 5:30 PM. Then Elan.")).toEqual(["Pickup is at 5:30 PM.", "Then Elan."]);
    expect(lintAndStripUnbackedPromises(revenue)).toMatchObject({ text: revenue, pass: true, emptied: false });
    expect(lintAndStripUnbackedPromises("  Two  pickups.  ").text).toBe("  Two  pickups.  ");
  });

  it("splits sentences and keeps punctuation", () => {
    expect(splitSentences("One. Two? Three!")).toEqual(["One.", "Two?", "Three!"]);
    expect(findPromiseSentences("Hello. I'll have it ready tomorrow.")).toEqual([{ text: "I'll have it ready tomorrow.", index: 1 }]);
  });
});

describe("promise ledger: a spoken promise is backed by a prepared item or removed", () => {
  const scope: PromiseScope = { tenantId: "default", canonicalOperatorId: "adam-admin", dayDirectorActorId: "1", dayDirectorActorIds: ["1"] };
  const evening = new Date("2026-10-20T03:00:00Z"); // Mon 8 PM PT
  const campaign = (names: string[]) => async () =>
    ({
      campaignName: "Colosseum", active: names.length > 0, completedCount: 3, remainingCount: names.length, totalCount: 10,
      realWorldExtension: "Greystar property prospecting visits", relationToGoal: "customer acquisition pipeline",
      remainingTargets: names.map(name => ({ name, address: null })),
    }) as never;

  it("prepares tomorrow's property-visit choice and keeps the sentence", async () => {
    const store = inMemoryPreparedItemStore();
    const out = await reconcileSpokenPromises(
      FIXTURE_TOMORROW_VISITS.claireSaid,
      { scope, conversationKey: "call-1", now: evening, timeZone: "America/Los_Angeles" },
      { store, loadCampaign: campaign(["Elan", "Solaire", "The Edge"]) }
    );
    expect(out.text).toBe(FIXTURE_TOMORROW_VISITS.claireSaid);
    expect(out.prepared).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      kind: "property_visit_choice", forBusinessDate: "2026-10-20", status: "prepared", sourceConversationKey: "call-1",
      payload: { remainingCount: 3, targets: [{ name: "Elan" }, { name: "Solaire" }, { name: "The Edge" }] },
    });
  });

  it("with no open visit to prepare, the promise is removed and nothing is written", async () => {
    const store = inMemoryPreparedItemStore();
    const out = await reconcileSpokenPromises(
      FIXTURE_TOMORROW_VISITS.claireSaid,
      { scope, conversationKey: "call-1", now: evening, timeZone: "America/Los_Angeles" },
      { store, loadCampaign: campaign([]) }
    );
    expect(out).toMatchObject({ text: "", emptied: true, prepared: [] });
    expect(store.rows).toEqual([]);
  });

  it("an unreadable campaign removes the promise too", async () => {
    const store = inMemoryPreparedItemStore();
    const out = await reconcileSpokenPromises(
      FIXTURE_TOMORROW_VISITS.claireSaid,
      { scope, conversationKey: "call-1", now: evening, timeZone: "America/Los_Angeles" },
      { store, loadCampaign: async () => { throw new Error("down"); } }
    );
    expect(out.emptied).toBe(true);
    expect(store.rows).toEqual([]);
  });

  it("a promise the system cannot prepare for is removed even when visits are open", async () => {
    const store = inMemoryPreparedItemStore();
    const out = await reconcileSpokenPromises(
      "Got it. I'll keep that in mind.",
      { scope, conversationKey: "call-1", now: evening, timeZone: "America/Los_Angeles" },
      { store, loadCampaign: campaign(["Elan"]) }
    );
    expect(out.text).toBe("Got it.");
    expect(store.rows).toEqual([]);
  });

  it("is for tomorrow when promised in the evening and for today when promised in the morning", () => {
    expect(businessDateForPreparedItem(new Date("2026-10-20T03:00:00Z"), "America/Los_Angeles")).toBe("2026-10-20");
    expect(businessDateForPreparedItem(new Date("2026-10-20T16:00:00Z"), "America/Los_Angeles")).toBe("2026-10-20");
    expect(businessDateForPreparedItem(new Date("2026-10-20T22:00:00Z"), "America/Los_Angeles")).toBe("2026-10-21");
  });
});
