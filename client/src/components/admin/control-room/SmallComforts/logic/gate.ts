/**
 * Small Comforts: what the unlock gate looks like.
 *
 * Pure. The server decides whether a chapter is open; this only turns that
 * answer into what the player sees. The game never calls a mutation and has
 * no way to open a chapter itself.
 *
 * Fail closed: until the server has said a chapter is open, none is.
 */

export type GateEligibility = {
  unlockedChapters: number;
  todayComplete: boolean;
  todayRequiredTotal: number;
  todayRequiredComplete: number;
  nextUnlockRequirement: "finish_today" | "come_back_tomorrow" | "all_unlocked";
};

export type GateQueryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; data: GateEligibility };

export const PLAYABLE_CHAPTERS = 3;

export type ChapterTag = {
  chapter: number;
  state: "open" | "tomorrow" | "shut" | "mystery";
  /** What is printed on the luggage tag. Null when nothing is printed. */
  label: string | null;
};

export type GateView =
  | { kind: "loading"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "locked"; message: string; progress: string | null }
  | { kind: "open"; tags: ChapterTag[]; playable: number[] };

export const LOCKED_COPY = "Finish today's line to open the suitcase.";
export const UNAVAILABLE_COPY = "The suitcase is shut for now.";

export function chapterTags(unlockedChapters: number): ChapterTag[] {
  const unlocked = Math.max(0, Math.min(PLAYABLE_CHAPTERS, Math.floor(unlockedChapters)));
  const tags: ChapterTag[] = [];
  for (let chapter = 1; chapter <= PLAYABLE_CHAPTERS; chapter += 1) {
    if (chapter <= unlocked) {
      tags.push({ chapter, state: "open", label: `Chapter ${chapter}` });
    } else if (chapter === unlocked + 1) {
      tags.push({ chapter, state: "tomorrow", label: "Tomorrow" });
    } else {
      tags.push({ chapter, state: "shut", label: null });
    }
  }
  tags.push({ chapter: PLAYABLE_CHAPTERS + 1, state: "mystery", label: "?" });
  return tags;
}

export function presentGate(query: GateQueryState): GateView {
  if (query.status === "loading") {
    return { kind: "loading", message: "Opening Small Comforts…" };
  }
  if (query.status === "error") {
    return { kind: "unavailable", message: UNAVAILABLE_COPY };
  }
  const { data } = query;
  if (data.unlockedChapters < 1) {
    const total = data.todayRequiredTotal;
    return {
      kind: "locked",
      message: LOCKED_COPY,
      progress: total > 0 ? `${data.todayRequiredComplete} / ${total}` : null,
    };
  }
  const tags = chapterTags(data.unlockedChapters);
  return {
    kind: "open",
    tags,
    playable: tags.filter(tag => tag.state === "open").map(tag => tag.chapter),
  };
}

/** Lantern City entry tile. Same answer, smaller. */
export function presentTile(query: GateQueryState): {
  state: "lit" | "locked" | "unknown";
  label: string;
} {
  if (query.status !== "success") return { state: "unknown", label: "" };
  return query.data.unlockedChapters >= 1
    ? { state: "lit", label: "Open" }
    : { state: "locked", label: "Finish today's line" };
}
