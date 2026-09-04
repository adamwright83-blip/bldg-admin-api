import { describe, expect, it } from "vitest";
import {
  RECOVERY_CLAIM_WORDS,
  VOICE_MOMENTS,
  canRender,
  linesFor,
  renderableCount,
  speak,
  type VoiceMoment,
} from "./goldlineVoice";

describe("data slots are mandatory", () => {
  /*
    The whole point of the slot system: a line that promises a number must not
    be selectable without one, or it renders with a hole and reads as a bug.
  */
  it("never renders a line with an empty slot", () => {
    for (const moment of VOICE_MOMENTS) {
      for (let index = 0; index < 40; index += 1) {
        const spoken = speak({ moment, slots: {}, salt: String(index) });
        if (!spoken) continue;
        expect(spoken.text, `${moment} rendered "${spoken.text}"`).not.toMatch(/\{|\}/);
        expect(spoken.text).not.toMatch(/\s{2,}/);
        expect(spoken.text.trim()).not.toBe("");
      }
    }
  });

  it("unlocks the specific lines once the facts exist", () => {
    const bare = renderableCount("lantern_dormant", {});
    const withFacts = renderableCount("lantern_dormant", {
      customerName: "Dot Evers",
      days: 125,
      buildingName: "Opus Los Angeles",
    });
    expect(withFacts).toBeGreaterThan(bare);
  });

  it("interpolates real evidence rather than generic mood", () => {
    const spoken = speak({
      moment: "lantern_dormant",
      slots: { customerName: "Dot Evers", days: 125 },
      salt: "ld_days",
      recent: linesFor("lantern_dormant").filter(l => l.id !== "ld_days").map(l => l.id),
    });
    expect(spoken?.text).toBe("Dot Evers has been dark 125 days.");
  });

  it("says nothing rather than something broken when it has no usable line", () => {
    const line = linesFor("lantern_dormant").find(l => l.requires.includes("days"))!;
    expect(canRender(line, {})).toBe(false);
  });
});

describe("the firewall applies to speech", () => {
  /*
    A cheerful sentence after an outreach is exactly as much of a lie as a window
    lighting on outreach alone. This is the test that keeps the writing honest.
  */
  it("no outreach line claims the customer came back", () => {
    for (const line of linesFor("outreach_sent")) {
      for (const word of RECOVERY_CLAIM_WORDS) {
        expect(
          line.text.toLowerCase(),
          `outreach line "${line.text}" contains "${word}"`
        ).not.toContain(word);
      }
    }
  });

  it("every outreach line states the customer is still dark", () => {
    for (const line of linesFor("outreach_sent")) {
      expect(
        line.text.toLowerCase(),
        `"${line.text}" does not say the outreach changed nothing`
      ).toMatch(/still|not moved|nothing lit|nothing/);
    }
  });

  /*
    Celebration is allowed in exactly one place, and only that place, because a
    verified reorder is the only thing that earns it.
  */
  it("only a confirmed return is allowed to celebrate", () => {
    const celebratory = /came back|real|back on/i;
    for (const moment of VOICE_MOMENTS) {
      if (moment === "confirmed_return") continue;
      for (const line of linesFor(moment)) {
        expect(line.text, `${moment}: "${line.text}"`).not.toMatch(celebratory);
      }
    }
    expect(linesFor("confirmed_return").some(l => celebratory.test(l.text))).toBe(true);
  });
});

describe("repetition limits", () => {
  /*
    The gap in the guardian system. A moment like "a lantern went quiet" fires
    with identical inputs day after day, and hearing one sentence four mornings
    running is how a world stops feeling alive.
  */
  it("does not repeat a line that was just spoken", () => {
    const slots = { count: 3, total: 8, buildingName: "Opus Los Angeles" };
    const recent: string[] = [];
    const seen = new Set<string>();
    const pool = renderableCount("morning_report", slots);

    for (let turn = 0; turn < pool; turn += 1) {
      const spoken = speak({ moment: "morning_report", slots, recent, salt: String(turn) })!;
      expect(seen.has(spoken.id), `repeated "${spoken.id}" before the pool ran out`).toBe(false);
      seen.add(spoken.id);
      recent.push(spoken.id);
    }
    expect(seen.size).toBe(pool);
  });

  it("resets rather than falling silent once every line has been used", () => {
    const slots = { count: 2 };
    const all = linesFor("morning_report").filter(l => canRender(l, slots)).map(l => l.id);
    const spoken = speak({ moment: "morning_report", slots, recent: all });
    expect(spoken).not.toBeNull();
    expect(all).toContain(spoken!.id);
  });
});

describe("determinism", () => {
  it("returns the same line for the same inputs", () => {
    const args = {
      moment: "clockhead_attack" as VoiceMoment,
      slots: { count: 6 },
      recent: ["ca_not_yet"],
      salt: "wave-3",
    };
    expect(speak(args)).toEqual(speak(args));
  });

  it("needs no model call — every line is authored", () => {
    for (const moment of VOICE_MOMENTS) {
      expect(linesFor(moment).length).toBeGreaterThan(0);
      for (const line of linesFor(moment)) expect(line.text.length).toBeGreaterThan(0);
    }
  });
});

describe("Clockhead speaks his canon", () => {
  /*
    From the World Bible: his obsession is that nothing may happen before the
    correct time, and his clocks read SOON / PENDING / AFTER REVIEW / NEXT WEEK /
    WHEN CONDITIONS IMPROVE / PROVISIONALLY / NOT YET. A dormant customer is
    exactly someone for whom the correct time never arrives, which is why he is
    the right voice for churn pressure rather than a generic villain.
  */
  it("uses the deferral vocabulary the bible gives him", () => {
    const bank = linesFor("clockhead_attack").map(l => l.text.toLowerCase()).join(" ");
    for (const word of ["not yet", "pending", "review", "conditions", "next week", "provisional", "soon"]) {
      expect(bank, `Clockhead never says "${word}"`).toContain(word);
    }
  });

  it("keeps his lines short enough to read mid-fight", () => {
    for (const line of linesFor("clockhead_attack")) {
      expect(line.text.length, `"${line.text}" is too long to read while dodging`).toBeLessThan(80);
    }
  });
});
