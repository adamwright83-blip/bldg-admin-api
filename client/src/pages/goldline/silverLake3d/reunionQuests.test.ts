import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSyntheticSilverLakeTargets } from "@shared/playableVillagers";
import type { CozyProjectedTarget } from "@shared/cozyVillagerEvidence";
import {
  REUNION_QUEST_TEMPLATES,
  assignReunionQuests,
  fillLine,
  hasRealDecision,
  questPhases,
  questSlotsFor,
  reunionBeats,
  type QuestSpot,
} from "./reunionQuests";

const targets = () => buildSyntheticSilverLakeTargets("laundry_farm");
const byId = (list: CozyProjectedTarget[]) => new Map(list.map(t => [t.customerId, t]));
const MEI = "synthetic:customer:mei_lin";
const MARCUS = "synthetic:customer:marcus_vance";
const GRACE = "synthetic:customer:grace_holloway";
const none = { found: new Set<string>(), reunited: new Set<string>() };
const decide = (list: CozyProjectedTarget[], id: string, patch: Partial<CozyProjectedTarget>) =>
  list.map(t => (t.customerId === id ? { ...t, ...patch } : t));
const withMessage = (t: CozyProjectedTarget, message: string) =>
  ({ ...t, silverLakeStatus: { ...t.silverLakeStatus, message } }) as CozyProjectedTarget;

const spots: QuestSpot[] = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../public/assets/goldline/silver-lake-3d/courtyard.json"), "utf8")
).questSpots;

describe("reunion quests: who gets one", () => {
  it("introduces only actionable, undecided customers, in slot order, never with a giver of the same animal", () => {
    const chain = assignReunionQuests(targets());
    expect(chain.map(q => [q.customerId, q.template.id])).toEqual([
      [MEI, "cat_flute"],
      [MARCUS, "bunny_kite"],
      [GRACE, "bear_watering_can"],
    ]);
    const list = byId(targets());
    for (const q of chain) expect(q.template.giver.variant).not.toBe(list.get(q.customerId)!.villagerVariant);
  });

  it("every template's hiding spot exists in courtyard.json", () => {
    const ids = new Set(spots.map(s => s.id));
    for (const t of REUNION_QUEST_TEMPLATES) expect(ids.has(t.spotId)).toBe(true);
  });
});

describe("reunion quests: the unlock rule", () => {
  it("only the first undecided quest talks; the next giver stays on a one-liner", () => {
    const list = targets();
    const chain = assignReunionQuests(list);
    const phases = questPhases(chain, byId(list), new Set(), none);
    expect(phases.get(MEI)).toBe("need");
    expect(phases.get(MARCUS)).toBe("locked");
    expect(phases.get(GRACE)).toBe("locked");
  });

  it("solving the puzzle and watching the reunion does not unlock the next villager", () => {
    const list = targets();
    const chain = assignReunionQuests(list);
    const progress = { found: new Set([MEI]), reunited: new Set([MEI]) };
    const phases = questPhases(chain, byId(list), new Set(), progress);
    expect(phases.get(MEI)).toBe("waiting");
    expect(phases.get(MARCUS)).toBe("locked");
  });

  it("opening the desk, editing, saving or approving the text does not count as a decision", () => {
    const mei = targets().find(t => t.customerId === MEI)!;
    for (const message of ["draft_prepared", "draft_edited_unsaved", "saved_draft", "explicitly_approved", "failed", "cancelled"]) {
      expect(hasRealDecision(withMessage(mei, message), new Set())).toBe(false);
    }
  });

  it.each([
    ["scheduled", { status: "scheduled", communicationState: "scheduled" }],
    ["handed off to the phone", { silverLakeStatus: { message: "compose_handoff_opened" } }],
    ["reported sent", { silverLakeStatus: { message: "operator_reported_sent" } }],
    ["send observed", { communicationState: "send_observed" }],
  ] as const)("a real decision (%s) completes the quest and unlocks the next giver", (_label, patch) => {
    const before = targets();
    const chain = assignReunionQuests(before);
    const mei = before.find(t => t.customerId === MEI)!;
    const changed = "silverLakeStatus" in patch ? withMessage(mei, patch.silverLakeStatus.message) : { ...mei, ...patch };
    const after = before.map(t => (t.customerId === MEI ? (changed as CozyProjectedTarget) : t));
    const phases = questPhases(chain, byId(after), new Set(), none);
    expect(phases.get(MEI)).toBe("done");
    expect(phases.get(MARCUS)).toBe("need");
    expect(phases.get(GRACE)).toBe("locked");
  });

  it("an explicit pass is a real decision", () => {
    const list = targets();
    const chain = assignReunionQuests(list);
    const phases = questPhases(chain, byId(list), new Set([MEI]), none);
    expect(phases.get(MEI)).toBe("done");
    expect(phases.get(MARCUS)).toBe("need");
  });

  it("writing to a later customer directly completes that quest without skipping the active one", () => {
    const list = decide(targets(), MARCUS, { status: "scheduled", communicationState: "scheduled" });
    const chain = assignReunionQuests(targets());
    const phases = questPhases(chain, byId(list), new Set(), none);
    expect(phases.get(MEI)).toBe("need");
    expect(phases.get(MARCUS)).toBe("done");
    expect(phases.get(GRACE)).toBe("locked");
  });
});

describe("reunion quests: never invent facts about the real customer", () => {
  it("fills the reunion with the customer's real numbers", () => {
    const [q] = assignReunionQuests(targets());
    const mei = targets().find(t => t.customerId === MEI)!;
    const text = reunionBeats(q.template, questSlotsFor(q.template, spots[0], mei)).map(b => b.text).join(" ");
    expect(text).toContain("Mei Lin follows the tune");
    expect(text).toContain("42 days since your last order");
    expect(text).toContain("5 orders with us");
  });

  it("drops a beat whose real number is missing instead of guessing", () => {
    const [q] = assignReunionQuests(targets());
    const mei = { ...targets().find(t => t.customerId === MEI)!, daysSinceLastOrder: null, paidOrders: undefined } as unknown as CozyProjectedTarget;
    const text = reunionBeats(q.template, questSlotsFor(q.template, spots[0], mei)).map(b => b.text).join(" ");
    expect(text).not.toMatch(/days|orders? with us|undefined|null|NaN/);
    expect(text).toContain("You should write to Mei.");
  });

  it("uses the singular for one order", () => {
    const slots = { giver: "Cleo", item: "flute", hint: "", customerName: "A B", customerFirst: "A", daysSinceLastOrder: 3, paidOrders: 1 };
    expect(fillLine("{paidOrders} {orderWord}", slots)).toBe("1 order");
  });

  it("every authored line uses only known slots and fills for every synthetic customer", () => {
    for (const tpl of REUNION_QUEST_TEMPLATES) {
      for (const t of targets()) {
        const slots = questSlotsFor(tpl, spots.find(s => s.id === tpl.spotId) ?? null, t);
        for (const line of Object.values(tpl.lines)) expect(fillLine(line, slots)).not.toBeNull();
        expect(reunionBeats(tpl, slots).length).toBeGreaterThan(0);
      }
    }
  });

  it("the customer never speaks and is never given a pronoun", () => {
    for (const tpl of REUNION_QUEST_TEMPLATES) {
      const lines = [...Object.values(tpl.lines), ...tpl.reunion.map(b => b.text)];
      for (const line of lines) expect(line).not.toMatch(/\b(he|she|him|her|his|hers|they|them|their)\b/i);
      for (const b of tpl.reunion) expect(["giver", "narrator"]).toContain(b.speaker);
    }
  });
});
