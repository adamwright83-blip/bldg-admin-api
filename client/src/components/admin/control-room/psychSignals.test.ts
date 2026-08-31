import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import {
  PSYCH_SIGNALS,
  SIGNAL_ART,
  deriveSignals,
  type SignalContext,
} from "./psychSignals";

const base: SignalContext = {
  lastFieldActivityAt: null,
  lastResponseAt: null,
  responseMeaningClassified: false,
  hasOpportunity: false,
  nextActionDueAt: null,
  commitmentDueAt: null,
  missionExecuting: false,
  expectedReplyDays: null,
  stakesAreReal: true,
  today: "2026-08-30",
};
const kinds = (c: Partial<SignalContext>) =>
  deriveSignals({ ...base, ...c }).map(s => s.kind);

describe("nothing appears without a real condition behind it", () => {
  it("shows no ambient creatures on an empty situation", () => {
    expect(deriveSignals(base)).toEqual([]);
  });

  it("does not haunt a situation whose outcome does not matter", () => {
    expect(
      kinds({ lastFieldActivityAt: "2026-08-20", stakesAreReal: false })
    ).toEqual([]);
  });
});

describe("ghost is silence, not absence of contact", () => {
  it("appears when real outreach has gone unanswered", () => {
    expect(kinds({ lastFieldActivityAt: "2026-08-27" })).toContain("ghost");
  });

  it("clears once the other side actually replies", () => {
    expect(
      kinds({ lastFieldActivityAt: "2026-08-20", lastResponseAt: "2026-08-28" })
    ).not.toContain("ghost");
  });

  it("returns if you reach out again and are met with silence again", () => {
    expect(
      kinds({ lastFieldActivityAt: "2026-08-29", lastResponseAt: "2026-08-25" })
    ).toContain("ghost");
  });

  it("grows only with elapsed time", () => {
    const near = deriveSignals({ ...base, lastFieldActivityAt: "2026-08-29" });
    const far = deriveSignals({ ...base, lastFieldActivityAt: "2026-08-01" });
    expect(near[0]!.intensity).toBe("faint");
    expect(far[0]!.intensity).toBe("insistent");
  });
});

describe("goblins never invent a deadline", () => {
  it("cannot spawn when the account has no observed reply window", () => {
    // No expectation exists, so nothing has been exceeded.
    expect(
      kinds({ lastFieldActivityAt: "2026-01-01", expectedReplyDays: null })
    ).not.toContain("goblins");
  });

  it("spawns only once the silence outlasts that account's own window", () => {
    expect(
      kinds({ lastFieldActivityAt: "2026-08-28", expectedReplyDays: 5 })
    ).not.toContain("goblins");
    expect(
      kinds({ lastFieldActivityAt: "2026-08-10", expectedReplyDays: 5 })
    ).toContain("goblins");
  });

  it("frames itself as a story, not a finding", () => {
    const g = deriveSignals({
      ...base,
      lastFieldActivityAt: "2026-08-10",
      expectedReplyDays: 5,
    }).find(s => s.kind === "goblins")!;
    expect(g.clearedBy).toContain("Evidence");
    expect(g.because).not.toMatch(/hates|ignoring|angry|dead/i);
  });
});

describe("fog is ambiguity, distinct from silence", () => {
  it("appears when a reply exists but its meaning is unrecorded", () => {
    expect(
      kinds({ lastFieldActivityAt: "2026-08-20", lastResponseAt: "2026-08-28" })
    ).toContain("fog");
  });

  it("clears when someone classifies what it meant", () => {
    expect(
      kinds({
        lastResponseAt: "2026-08-28",
        responseMeaningClassified: true,
      })
    ).not.toContain("fog");
  });
});

describe("vines are avoidance, never correct waiting", () => {
  it("appears only when a real next step is overdue", () => {
    expect(
      kinds({ hasOpportunity: true, nextActionDueAt: "2026-08-25" })
    ).toContain("vines");
  });

  it("does not appear while the step is still ahead", () => {
    expect(
      kinds({ hasOpportunity: true, nextActionDueAt: "2026-09-05" })
    ).not.toContain("vines");
  });

  it("does not appear when there is no legitimate next step at all", () => {
    expect(
      kinds({ hasOpportunity: false, nextActionDueAt: "2026-08-01" })
    ).not.toContain("vines");
  });
});

describe("clock pressure must be real and dated", () => {
  it("requires an actual commitment date", () => {
    expect(kinds({ commitmentDueAt: null })).not.toContain("clock");
    expect(kinds({ commitmentDueAt: "2026-09-01" })).toContain("clock");
  });

  it("tightens as the date approaches", () => {
    const soon = deriveSignals({ ...base, commitmentDueAt: "2026-08-31" });
    const later = deriveSignals({ ...base, commitmentDueAt: "2026-09-20" });
    expect(soon[0]!.intensity).toBe("present");
    expect(later[0]!.intensity).toBe("faint");
  });
});

describe("ruinbound is execution friction only", () => {
  it("appears while a mission is actually executing", () => {
    expect(kinds({ missionExecuting: true })).toContain("ruinbound");
  });
  it("is absent while merely planning or waiting", () => {
    expect(kinds({ missionExecuting: false })).not.toContain("ruinbound");
  });
});

describe("compulsive checking clears nothing", () => {
  it("has no view, session or refetch input at all", () => {
    // The anti-rumination guarantee is enforced by the type, not by discipline.
    const src = readFileSync(
      new URL("./psychSignals.ts", import.meta.url),
      "utf8"
    );
    const type = src.slice(
      src.indexOf("export type SignalContext"),
      src.indexOf("const DAY =")
    );
    for (const banned of ["viewCount", "opens", "sessionCount", "refetch", "visits"]) {
      expect(type).not.toContain(banned);
    }
  });

  it("returns an identical result however many times it is asked", () => {
    const ctx = { ...base, lastFieldActivityAt: "2026-08-20", expectedReplyDays: 3 };
    const first = deriveSignals(ctx);
    for (let i = 0; i < 50; i += 1) {
      expect(deriveSignals(ctx)).toEqual(first);
    }
  });

  it("only new evidence or elapsed time changes anything", () => {
    const ctx = { ...base, lastFieldActivityAt: "2026-08-20" };
    const haunted = deriveSignals(ctx);
    const answered = deriveSignals({ ...ctx, lastResponseAt: "2026-08-29" });
    expect(haunted.map(s => s.kind)).toContain("ghost");
    expect(answered.map(s => s.kind)).not.toContain("ghost");
  });
});

describe("real people stay real people", () => {
  it("never attaches a signal to a person", () => {
    const src = readFileSync(
      new URL("./psychSignals.ts", import.meta.url),
      "utf8"
    );
    const type = src.slice(
      src.indexOf("export type SignalContext"),
      src.indexOf("const DAY =")
    );
    for (const banned of ["contactName", "personName", "customerName", "contactId"]) {
      expect(type).not.toContain(banned);
    }
  });

  it("never speculates about the other side's motive", () => {
    const wide: SignalContext = {
      ...base,
      lastFieldActivityAt: "2026-07-01",
      lastResponseAt: "2026-07-05",
      hasOpportunity: true,
      nextActionDueAt: "2026-08-01",
      commitmentDueAt: "2026-09-02",
      missionExecuting: true,
      expectedReplyDays: 2,
    };
    for (const s of deriveSignals(wide)) {
      expect(s.because).not.toMatch(
        /hates|ignoring|angry|blew it|never reply|not interested|dead/i
      );
    }
  });

  it("never tells the operator to simply check again", () => {
    const wide: SignalContext = {
      ...base,
      lastFieldActivityAt: "2026-07-01",
      hasOpportunity: true,
      nextActionDueAt: "2026-08-01",
      expectedReplyDays: 2,
    };
    for (const s of deriveSignals(wide)) {
      expect(s.clearedBy).not.toMatch(/check|refresh|look again|wait and see/i);
    }
  });
});

describe("every signal ships its art", () => {
  it("has a production asset for all six", () => {
    const dir = new URL(
      "../../../../public/assets/admin/control-room/signals/",
      import.meta.url
    );
    const present = new Set(readdirSync(dir));
    expect(PSYCH_SIGNALS).toHaveLength(6);
    for (const kind of PSYCH_SIGNALS) {
      expect(present).toContain(SIGNAL_ART[kind].split("/").pop());
    }
  });

  it("uses none of the landscape concept boards", () => {
    // Those are storyboard reference only and must never ship.
    for (const kind of PSYCH_SIGNALS) {
      expect(SIGNAL_ART[kind]).not.toMatch(/ChatGPT Image|board|concept/i);
    }
  });
});
