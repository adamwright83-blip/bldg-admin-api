import { z } from "zod";

/**
 * Story seasons: one authored chapter per night on the main account page.
 *
 * The repository only ever holds the shape of a season and the placeholder Season 0. Real seasons are seeded into the
 * database from a private file, and the server hands an operator only the lines of chapters they have reached, with
 * variants already resolved. See server/story/README.md.
 */

/** Every request made from story gameplay carries this header. The server refuses it anywhere but `system.story.*`. */
export const STORY_REQUEST_HEADER = "x-joystick-story";

/** The only tRPC namespace a story request may reach. */
export const STORY_PROCEDURE_PREFIX = "system.story.";

export const STORY_SLOTS = ["before", "after", "question", "option"] as const;
export type StorySlot = (typeof STORY_SLOTS)[number];

export const STORY_OUTCOMES = ["win", "lose", "quit"] as const;
export type StoryOutcome = (typeof STORY_OUTCOMES)[number];

const key = z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/, "lowercase letters, digits, dot, dash, underscore");

/** When a variant applies: every listed answer must match, and the operator must have been away at least this long. */
export const storyConditionSchema = z
  .object({
    answers: z.record(key, key).optional(),
    minDaysAway: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export type StoryCondition = z.infer<typeof storyConditionSchema>;

export const storyLineSchema = z
  .object({
    slot: z.enum(STORY_SLOTS),
    /** Stable within a chapter. Variants of one line share a key. For an `option`, the key is the option's answer value. */
    key,
    variant: key.default("default"),
    order: z.number().int().min(0).max(999).default(0),
    when: storyConditionSchema.optional(),
    text: z.string().trim().min(1).max(4000),
    still: z.string().trim().min(1).max(128).optional(),
  })
  .strict();
export type StoryLineInput = z.infer<typeof storyLineSchema>;

export const storyLocationSchema = z.enum(["century_park_east", "opus_la"]);
export type StoryLocation = z.infer<typeof storyLocationSchema>;
/** Presentation metadata stays in the existing chapter config; arbitrary game settings remain supported. */
export const storyClosingSchema = z
  .object({
    responses: z.record(key, z.string().trim().min(1).max(1000)).optional(),
    keepsake: z
      .object({
        title: z.string().trim().min(1).max(100),
        text: z.string().trim().min(1).max(1000),
      })
      .strict()
      .optional(),
    tomorrow: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type StoryClosing = {
  response?: string;
  keepsake?: { title: string; text: string };
  tomorrow?: string;
};
export const storyConfigSchema = z
  .object({
    location: storyLocationSchema.optional(),
    closing: storyClosingSchema.optional(),
  })
  .passthrough();

export const storyChapterSchema = z
  .object({
    number: z.number().int().min(1).max(99),
    /** Which game the host mounts. Game modules declare the keys they answer to. */
    gameKey: key,
    title: z.string().trim().min(1).max(200),
    /** The question asked after a win, if any. Its text is the `question` line; its choices are `option` lines. */
    questionKey: key.optional(),
    config: storyConfigSchema.optional(),
    lines: z.array(storyLineSchema).min(1),
  })
  .strict()
  .superRefine((chapter, ctx) => {
    const variants = new Set<string>();
    for (const line of chapter.lines) {
      const id = `${line.key}/${line.variant}`;
      if (variants.has(id)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `chapter ${chapter.number}: duplicate line ${id}` });
      variants.add(id);
    }
    const hasQuestionLine = chapter.lines.some(l => l.slot === "question");
    const options = chapter.lines.filter(l => l.slot === "option");
    if (chapter.questionKey && (!hasQuestionLine || options.length < 2)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `chapter ${chapter.number}: a question needs a question line and at least two options` });
    }
    if (!chapter.questionKey && (hasQuestionLine || options.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `chapter ${chapter.number}: question or option lines without a questionKey` });
    }
    if (!chapter.lines.some(l => l.slot === "before" && !l.when)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `chapter ${chapter.number}: needs at least one unconditional before line` });
    }
  });
export type StoryChapterInput = z.infer<typeof storyChapterSchema>;

export const storySeasonSchema = z
  .object({
    slug: key,
    title: z.string().trim().min(1).max(200),
    chapters: z.array(storyChapterSchema).min(1),
  })
  .strict()
  .superRefine((season, ctx) => {
    season.chapters.forEach((chapter, i) => {
      if (chapter.number !== i + 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `chapters must be numbered 1..n in order (found ${chapter.number} at position ${i + 1})` });
    });
    const questions = season.chapters.map(c => c.questionKey).filter(Boolean);
    if (new Set(questions).size !== questions.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "question keys must be unique within a season" });
  });
export type StorySeasonInput = z.infer<typeof storySeasonSchema>;

/** What the page shows for tonight. Text is already resolved for this operator; nothing unearned is included. */
export type StoryTonight =
  | { enabled: false }
  | {
      enabled: true;
      seasonTitle: string;
      chapterCount: number;
      state: "available" | "won_tonight" | "season_complete";
      chapter: {
        number: number;
        title: string;
        gameKey: string;
        before: StoryResolvedLine[];
        location?: StoryLocation;
        /** Earned closing content only, with the selected response resolved server-side. */
        closing?: StoryClosing;
        /** Present once tonight's chapter is won, so a reload after the win still shows the ending and the question. */
        after?: StoryResolvedLine[];
        question?: StoryQuestion;
      } | null;
      daysAway: number;
    };

export type StoryResolvedLine = { key: string; text: string; still: string | null };
export type StoryQuestion = { key: string; text: string; options: { key: string; text: string }[]; answered: string | null };

/** True when a decoded tRPC procedure path is inside the story namespace. */
export function isStoryProcedurePath(path: string): boolean {
  return path.startsWith(STORY_PROCEDURE_PREFIX) && path.length > STORY_PROCEDURE_PREFIX.length && !path.includes("..");
}
