/**
 * Small Comforts: what the unlock gate looks like. (Spec v2 §2.)
 *
 * Pure. The server decides whether a chapter is open; this only turns that
 * answer into what the player sees. The game never calls a mutation and has
 * no way to open a chapter itself.
 *
 * Fail closed: until the server has said a chapter is open, none is.
 */

export type GateEligibility = {
  unlockedChapters: number;
  nextChapter: number | null;
  objectivesRemaining: number | null;
  firstSaleTerritoryId: string | null;
  nextUnlockRequirement: "first_verified_sale" | "complete_objectives" | "all_unlocked";
  preview: boolean;
};

export type GateQueryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "success"; data: GateEligibility };

export const PLAYABLE_CHAPTERS = 3;

/** Shown wherever the game is offered (spec §2, system map §3a.9). Nothing more specific. */
export const CONTENT_NOTE = "Contains mature themes.";

export const SHUT_COPY = "The suitcase is shut for now.";

export type ChapterTag = {
  chapter: number;
  state: "open" | "next" | "shut" | "mystery";
  /** What is printed on the luggage tag. Null when nothing is printed. */
  label: string | null;
};

export type GateView =
  | { kind: "loading"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "locked"; message: string }
  | { kind: "open"; tags: ChapterTag[]; playable: number[]; preview: boolean };

export function chapterTags(input: {
  unlockedChapters: number;
  objectivesRemaining: number | null;
}): ChapterTag[] {
  const unlocked = Math.max(0, Math.min(PLAYABLE_CHAPTERS, Math.floor(input.unlockedChapters)));
  const tags: ChapterTag[] = [];
  for (let chapter = 1; chapter <= PLAYABLE_CHAPTERS; chapter += 1) {
    if (chapter <= unlocked) {
      tags.push({ chapter, state: "open", label: `Chapter ${chapter}` });
    } else if (chapter === unlocked + 1 && input.objectivesRemaining != null) {
      tags.push({ chapter, state: "next", label: `${Math.max(0, input.objectivesRemaining)} to go` });
    } else {
      tags.push({ chapter, state: "shut", label: null });
    }
  }
  tags.push({ chapter: PLAYABLE_CHAPTERS + 1, state: "mystery", label: "?" });
  return tags;
}

export function presentGate(query: GateQueryState): GateView {
  if (query.status === "loading") return { kind: "loading", message: "Opening Small Comforts…" };
  if (query.status === "error") return { kind: "unavailable", message: SHUT_COPY };
  const { data } = query;
  if (data.unlockedChapters < 1) return { kind: "locked", message: SHUT_COPY };
  const tags = chapterTags(data);
  return {
    kind: "open",
    tags,
    playable: tags.filter(tag => tag.state === "open").map(tag => tag.chapter),
    preview: data.preview === true,
  };
}

/** Lantern City entry tile. Same answer, smaller. */
export function presentTile(query: GateQueryState): {
  state: "lit" | "locked" | "unknown";
  label: string;
  note: string;
} {
  if (query.status !== "success") return { state: "unknown", label: "", note: CONTENT_NOTE };
  return query.data.unlockedChapters >= 1
    ? { state: "lit", label: query.data.preview ? "Preview" : "Open", note: CONTENT_NOTE }
    : { state: "locked", label: "Locked", note: CONTENT_NOTE };
}
