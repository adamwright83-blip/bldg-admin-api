import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { storySeasonSchema, type StorySeasonInput } from "../../shared/story";
import { EMPTY_PROGRESS, progressAfter, type StoryLineRow, type StoryProgressState } from "./storyEngine";
import { createStoryService, StoryAccessError } from "./storyService";
import type { StoryChapterRow, StoryScope, StoryStore } from "./storyStore";

const SEASON0: StorySeasonInput = storySeasonSchema.parse(
  JSON.parse(readFileSync(new URL("./fixtures/season-0.json", import.meta.url), "utf8"))
);

/** The same contract as drizzleStoryStore, in memory. */
function memoryStore(season: StorySeasonInput) {
  const chapters: StoryChapterRow[] = season.chapters.map((c, i) => ({
    id: 100 + i,
    number: c.number,
    gameKey: c.gameKey,
    title: c.title,
    questionKey: c.questionKey ?? null,
    config: c.config ?? null,
  }));
  const lines = new Map<number, StoryLineRow[]>(
    season.chapters.map((c, i) => [
      100 + i,
      c.lines.map(l => ({ slot: l.slot, lineKey: l.key, variantKey: l.variant, sortOrder: l.order, condition: l.when ?? null, text: l.text, stillId: l.still ?? null })),
    ])
  );
  const k = (s: StoryScope) => `${s.tenantId}|${s.operatorId}|${s.seasonId}`;
  const progress = new Map<string, StoryProgressState>();
  const answers = new Map<string, Record<string, string>>();
  const attempts: { scope: StoryScope; chapterNumber: number; outcome: string; localDate: string }[] = [];
  const store: StoryStore = {
    findSeasonBySlug: async slug => (slug === season.slug ? { id: 7, slug, title: season.title, status: "draft" } : null),
    listChapters: async () => chapters,
    listLines: async ids => new Map(ids.map(id => [id, lines.get(id) ?? []])),
    readProgress: async s => ({ ...(progress.get(k(s)) ?? EMPTY_PROGRESS) }),
    // Same contract as the database: only the last-played fields, only if not already tonight's.
    markPlayed: async (s, today, away) => {
      const p = progress.get(k(s)) ?? EMPTY_PROGRESS;
      if (p.lastPlayedOn !== today) progress.set(k(s), { ...p, lastPlayedOn: today, chapterDaysAway: away });
    },
    // Same contract as the database: a conditional update, so only one concurrent win can succeed.
    recordWin: async (s, n, today) => {
      const p = progress.get(k(s)) ?? EMPTY_PROGRESS;
      if (p.highestChapterWon !== n - 1 || (p.lastWonOn !== null && p.lastWonOn >= today)) return false;
      progress.set(k(s), { ...p, highestChapterWon: n, lastWonOn: today });
      return true;
    },
    listAnswers: async s => ({ ...(answers.get(k(s)) ?? {}) }),
    insertAnswer: async (s, q, o) => {
      const a = answers.get(k(s)) ?? {};
      if (q in a) return false;
      answers.set(k(s), { ...a, [q]: o });
      return true;
    },
    recordAttempt: async (scope, a) => void attempts.push({ scope, ...a }),
  };
  return { store, attempts, progress, answers };
}

function harness(opts: { enabled?: boolean; slug?: string | null } = {}) {
  const mem = memoryStore(SEASON0);
  let now = new Date("2026-10-27T19:00:00Z"); // noon in Los Angeles
  const service = createStoryService({
    store: mem.store,
    now: () => now,
    timeZone: () => "America/Los_Angeles",
    isEnabled: () => opts.enabled ?? true,
    seasonSlug: () => (opts.slug === undefined ? "season-0" : opts.slug),
  });
  return {
    ...mem,
    service,
    nextNight(days = 1) {
      now = new Date(now.getTime() + days * 86_400_000);
    },
  };
}

const ADAM = { tenantId: "t1", operatorId: "op-a" };
const OTHER = { tenantId: "t1", operatorId: "op-b" };

const reason = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    if (error instanceof StoryAccessError) return error.reason;
    throw error;
  }
  return "no error";
};

describe("story service: feature flag", () => {
  it("reports disabled and refuses every write when the tenant is off", async () => {
    const h = harness({ enabled: false });
    expect(await h.service.tonight(ADAM)).toEqual({ enabled: false });
    expect(await reason(h.service.start(ADAM, 1))).toBe("not_enabled");
    expect(await reason(h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" }))).toBe("not_enabled");
    expect(await reason(h.service.answer(ADAM, { questionKey: "s0.first", optionKey: "left" }))).toBe("not_enabled");
    expect(h.attempts).toHaveLength(0);
  });

  it("is disabled when no season is configured, or the configured one is missing", async () => {
    expect(await harness({ slug: null }).service.tonight(ADAM)).toEqual({ enabled: false });
    expect(await harness({ slug: "season-9" }).service.tonight(ADAM)).toEqual({ enabled: false });
    expect(await reason(harness({ slug: "season-9" }).service.start(ADAM, 1))).toBe("no_season");
  });
});

describe("story service: a full night", () => {
  it("projects only the reached location and withholds all closing content until answered", async () => {
    const h = harness();
    const first = await h.service.tonight(ADAM);
    expect(first).toMatchObject({ chapter: { location: "century_park_east" } });
    expect(JSON.stringify(first)).not.toContain("keepsake");
    const opened = await h.service.start(ADAM, 1);
    expect(opened.config.location).toBe("century_park_east");
    expect(opened.config).not.toHaveProperty("closing");
    await h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" });
    expect(JSON.stringify(await h.service.tonight(ADAM))).not.toContain(
      "keepsake"
    );
    await h.service.answer(ADAM, {
      questionKey: "s0.first",
      optionKey: "left",
    });
    const ended = await h.service.tonight(ADAM);
    expect(ended).toMatchObject({
      chapter: {
        closing: {
          response: "Placeholder response to left.",
          keepsake: { title: "Placeholder keepsake" },
        },
      },
    });
    expect(JSON.stringify(ended)).not.toContain("response to right");
    expect(JSON.stringify(await h.service.tonight(OTHER))).not.toContain(
      "keepsake"
    );
  });
  it("shows chapter 1 without its ending, then the ending and question after a win", async () => {
    const h = harness();
    const first = await h.service.tonight(ADAM);
    expect(first).toMatchObject({ enabled: true, state: "available", chapterCount: 3, chapter: { number: 1 } });
    if (!first.enabled || !first.chapter) throw new Error("expected a chapter");
    expect(first.chapter.before.map(l => l.key)).toEqual(["b1", "b2"]);
    expect(first.chapter.after).toBeUndefined();
    expect(first.chapter.question).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain("after-line");

    await h.service.start(ADAM, 1);
    expect(await h.service.finish(ADAM, { chapterNumber: 1, outcome: "lose" })).toEqual({ advanced: false, after: null, question: null });
    const won = await h.service.finish(ADAM, { chapterNumber: 1, outcome: "win", durationMs: 240_000 });
    expect(won.advanced).toBe(true);
    expect(won.after?.map(l => l.key)).toEqual(["a1"]);
    expect(won.question).toMatchObject({ key: "s0.first", options: [{ key: "left" }, { key: "right" }], answered: null });
    expect(h.attempts.map(a => a.outcome)).toEqual(["lose", "win"]);

    const reload = await h.service.tonight(ADAM);
    expect(reload).toMatchObject({ state: "won_tonight", chapter: { number: 1, question: { answered: null } } });
  });

  it("locks chapter 2 until the next night and never serves its lines early", async () => {
    const h = harness();
    await h.service.start(ADAM, 1);
    await h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" });
    expect(await reason(h.service.start(ADAM, 2))).toBe("chapter_locked");
    expect(await reason(h.service.finish(ADAM, { chapterNumber: 2, outcome: "win" }))).toBe("chapter_locked");
    expect(await reason(h.service.finish(ADAM, { chapterNumber: 3, outcome: "win" }))).toBe("chapter_locked");
    expect(JSON.stringify(await h.service.tonight(ADAM))).not.toContain("chapter two");
    h.nextNight();
    expect(await h.service.tonight(ADAM)).toMatchObject({ state: "available", chapter: { number: 2 } });
  });

  it("refuses chapters that do not exist", async () => {
    const h = harness();
    expect(await reason(h.service.start(ADAM, 9))).toBe("chapter_locked");
    expect(await reason(h.service.finish(ADAM, { chapterNumber: 9, outcome: "win" }))).toBe("chapter_locked");
  });
});

describe("story service: retries and failures", () => {
  it("a retried win returns the same ending, records once, advances once", async () => {
    const h = harness();
    await h.service.start(ADAM, 1);
    const a = await h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" });
    const b = await h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" });
    expect(b.advanced).toBe(false);
    expect(b.after).toEqual(a.after);
    expect(b.question).toEqual(a.question);
    expect(h.attempts.filter(x => x.outcome === "win")).toHaveLength(1);
    expect((await h.store.readProgress({ ...ADAM, seasonId: 7 })).highestChapterWon).toBe(1);
  });

  it("a lose or quit sent after the win changes nothing", async () => {
    const h = harness();
    await h.service.start(ADAM, 1);
    await h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" });
    expect(await h.service.finish(ADAM, { chapterNumber: 1, outcome: "lose" })).toEqual({ advanced: false, after: null, question: null });
    expect(h.attempts).toHaveLength(1);
  });

  it("losing any number of times keeps the chapter open", async () => {
    const h = harness();
    for (let i = 0; i < 5; i++) await h.service.finish(ADAM, { chapterNumber: 1, outcome: "lose" });
    expect(await h.service.tonight(ADAM)).toMatchObject({ state: "available", chapter: { number: 1 } });
  });

  it("a storage failure surfaces as an error and writes nothing partial", async () => {
    const h = harness();
    h.store.recordWin = vi.fn().mockRejectedValue(new Error("db down"));
    await expect(h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" })).rejects.toThrow("db down");
    expect(await h.service.tonight(ADAM)).toMatchObject({ state: "available", chapter: { number: 1 } });
  });
});

describe("story service: concurrent requests", () => {
  it("a slow start cannot undo a win that lands while it is in flight", async () => {
    const h = harness();
    // Hold start between its read and its write, let a whole winning finish run, then release start.
    const realMark = h.store.markPlayed;
    let release!: () => void;
    const held = new Promise<void>(r => (release = r));
    let marks = 0;
    h.store.markPlayed = async (...args) => {
      if (marks++ === 0) await held;
      return realMark(...args);
    };
    const slowStart = h.service.start(ADAM, 1);
    await new Promise(r => setTimeout(r, 0));
    const won = await h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" });
    expect(won.advanced).toBe(true);
    release();
    await slowStart;
    const p = await h.store.readProgress({ ...ADAM, seasonId: 7 });
    expect(p).toMatchObject({ highestChapterWon: 1, lastWonOn: "2026-10-27" });
    expect(await h.service.tonight(ADAM)).toMatchObject({ state: "won_tonight" });
  });

  it("of many concurrent wins exactly one advances and is recorded; all return the ending", async () => {
    const h = harness();
    await h.service.start(ADAM, 1);
    const results = await Promise.all(Array.from({ length: 6 }, () => h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" })));
    expect(results.filter(r => r.advanced)).toHaveLength(1);
    expect(results.every(r => r.after?.length === 1 && r.question?.key === "s0.first")).toBe(true);
    expect(h.attempts.filter(a => a.outcome === "win")).toHaveLength(1);
    expect((await h.store.readProgress({ ...ADAM, seasonId: 7 })).highestChapterWon).toBe(1);
  });

  it("the in-memory store's win rule matches the engine's", () => {
    const p = { ...EMPTY_PROGRESS };
    expect(progressAfter(p, 3, "2026-10-27", 1, "win").advanced).toBe(true);
  });
});

describe("story service: decisions persist and steer later lines", () => {
  async function winChapter1(h: ReturnType<typeof harness>, option: "left" | "right") {
    await h.service.start(ADAM, 1);
    await h.service.finish(ADAM, { chapterNumber: 1, outcome: "win" });
    await h.service.answer(ADAM, { questionKey: "s0.first", optionKey: option });
  }

  it("serves only the branch the operator earned", async () => {
    for (const option of ["left", "right"] as const) {
      const h = harness();
      await winChapter1(h, option);
      h.nextNight();
      const tonight = await h.service.tonight(ADAM);
      const text = JSON.stringify(tonight);
      expect(text).toContain(`chose ${option}`);
      expect(text).not.toContain(`chose ${option === "left" ? "right" : "left"}`);
      expect(text).not.toContain("for any answer");
    }
  });

  it("answers are final: same answer accepted, a change refused, an unknown option refused", async () => {
    const h = harness();
    await winChapter1(h, "left");
    expect(await h.service.answer(ADAM, { questionKey: "s0.first", optionKey: "left" })).toEqual({ answered: "left" });
    expect(await reason(h.service.answer(ADAM, { questionKey: "s0.first", optionKey: "right" }))).toBe("already_answered");
    expect(await reason(h.service.answer(ADAM, { questionKey: "s0.first", optionKey: "up" }))).toBe("unknown_option");
    expect(h.answers.get("t1|op-a|7")).toEqual({ "s0.first": "left" });
  });

  it("refuses to answer a question before its chapter is won, or one that does not exist", async () => {
    const h = harness();
    expect(await reason(h.service.answer(ADAM, { questionKey: "s0.first", optionKey: "left" }))).toBe("question_locked");
    expect(await reason(h.service.answer(ADAM, { questionKey: "nope", optionKey: "left" }))).toBe("unknown_question");
  });

  it("each operator on a tenant plays their own season", async () => {
    const h = harness();
    await winChapter1(h, "left");
    expect(await h.service.tonight(OTHER)).toMatchObject({ state: "available", chapter: { number: 1 } });
    expect(await reason(h.service.answer(OTHER, { questionKey: "s0.first", optionKey: "right" }))).toBe("question_locked");
  });

  it("selects the away variant after two nights without play, and not before", async () => {
    const h = harness();
    await winChapter1(h, "left");
    h.nextNight();
    expect(JSON.stringify(await h.service.tonight(ADAM))).not.toContain("two or more nights away");
    h.nextNight(2);
    expect(JSON.stringify(await h.service.tonight(ADAM))).toContain("two or more nights away");
  });

  it("keeps the absence through the whole chapter: reload after start, and the ending after the win", async () => {
    const h = harness();
    await winChapter1(h, "left");
    h.nextNight(8);
    await h.service.start(ADAM, 2);
    expect(JSON.stringify(await h.service.tonight(ADAM))).toContain("line shown only after two or more nights away");
    const won = await h.service.finish(ADAM, { chapterNumber: 2, outcome: "win" });
    expect(won.after?.map(l => l.text)).toContain("Placeholder ending line shown only after two or more nights away.");
    expect(JSON.stringify(await h.service.tonight(ADAM))).toContain("ending line shown only after two or more nights away");
  });

  it("does not show the away ending to an operator who came back the next night", async () => {
    const h = harness();
    await winChapter1(h, "left");
    h.nextNight();
    await h.service.start(ADAM, 2);
    const won = await h.service.finish(ADAM, { chapterNumber: 2, outcome: "win" });
    expect(JSON.stringify(won)).not.toContain("nights away");
  });

  it("completes the season after the last chapter", async () => {
    const h = harness();
    await winChapter1(h, "right");
    for (const n of [2, 3]) {
      h.nextNight();
      await h.service.start(ADAM, n);
      await h.service.finish(ADAM, { chapterNumber: n, outcome: "win" });
    }
    expect(await h.service.tonight(ADAM)).toMatchObject({ state: "won_tonight", chapter: { number: 3 } });
    h.nextNight();
    expect(await h.service.tonight(ADAM)).toMatchObject({ state: "season_complete", chapter: null });
    expect(await reason(h.service.start(ADAM, 3))).toBe("chapter_locked");
  });
});
