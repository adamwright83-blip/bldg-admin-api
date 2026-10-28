import type { StoryQuestion, StoryResolvedLine } from "@shared/story";
import type { StoryClient } from "./storyClient";

/**
 * One play of tonight's chapter: start → game → finish → ending → answer. No React and no network of its own; every
 * call goes through the StoryClient it is given, so it can only ever reach `system.story.*`.
 */

export type ChapterHostState =
  | { phase: "starting" }
  | { phase: "playing"; gameKey: string; config: Record<string, unknown>; attempt: number }
  | { phase: "finishing" }
  | { phase: "lost"; attempt: number }
  | {
      phase: "ended";
      after: StoryResolvedLine[];
      question: StoryQuestion | null;
      answering: boolean;
      answered: string | null;
    }
  | { phase: "error"; message: string; failed: "start" | "finish" | "answer" };

export type ChapterSession = {
  state(): ChapterHostState;
  begin(): Promise<void>;
  /** The mounted game reports how it ended. */
  report(outcome: "win" | "lose"): Promise<void>;
  /** After a loss: play again. Retry is unlimited and changes nothing on the server until a win. */
  retry(): void;
  choose(optionKey: string): Promise<void>;
  /** Retry the call that failed. */
  recover(): Promise<void>;
  /** Leaving mid-game records a quit. Leaving at any other point records nothing. */
  leave(): Promise<void>;
};

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

export function createChapterSession(input: {
  client: StoryClient;
  chapterNumber: number;
  onChange: (state: ChapterHostState) => void;
  clock?: () => number;
}): ChapterSession {
  const clock = input.clock ?? (() => Date.now());
  let current: ChapterHostState = { phase: "starting" };
  let game: { gameKey: string; config: Record<string, unknown> } | null = null;
  let attempt = 0;
  let startedAt = 0;
  let pendingOutcome: "win" | "lose" = "lose";
  let pendingOption: string | null = null;
  let lastEnded: Extract<ChapterHostState, { phase: "ended" }> | null = null;

  const set = (next: ChapterHostState) => {
    current = next;
    input.onChange(next);
  };

  const play = () => {
    if (!game) return;
    attempt += 1;
    startedAt = clock();
    set({ phase: "playing", gameKey: game.gameKey, config: game.config, attempt });
  };

  const begin = async () => {
    set({ phase: "starting" });
    try {
      const opened = await input.client.start(input.chapterNumber);
      game = { gameKey: opened.gameKey, config: opened.config ?? {} };
      play();
    } catch (error) {
      set({ phase: "error", message: messageOf(error), failed: "start" });
    }
  };

  const report = async (outcome: "win" | "lose") => {
    if (current.phase !== "playing" && !(current.phase === "error" && current.failed === "finish")) return;
    pendingOutcome = outcome;
    const durationMs = Math.max(0, Math.round(clock() - startedAt));
    set({ phase: "finishing" });
    try {
      const result = await input.client.finish({ chapterNumber: input.chapterNumber, outcome, durationMs });
      if (outcome === "lose") {
        set({ phase: "lost", attempt });
        return;
      }
      if (!result.after) {
        set({ phase: "error", message: "The chapter did not close. Try again.", failed: "finish" });
        return;
      }
      set({
        phase: "ended",
        after: result.after,
        question: result.question,
        answering: false,
        answered: result.question?.answered ?? null,
      });
    } catch (error) {
      set({ phase: "error", message: messageOf(error), failed: "finish" });
    }
  };

  const choose = async (optionKey: string) => {
    const ended = current.phase === "ended" ? current : null;
    if (!ended?.question || ended.answered || ended.answering) return;
    pendingOption = optionKey;
    set({ ...ended, answering: true });
    try {
      const result = await input.client.answer({ questionKey: ended.question.key, optionKey });
      set({ ...ended, answering: false, answered: result.answered });
    } catch (error) {
      lastEnded = ended;
      set({ phase: "error", message: messageOf(error), failed: "answer" });
    }
  };

  return {
    state: () => current,
    begin,
    report,
    retry: () => {
      if (current.phase === "lost") play();
    },
    choose,
    recover: async () => {
      if (current.phase !== "error") return;
      if (current.failed === "start") return begin();
      if (current.failed === "finish") return report(pendingOutcome);
      if (lastEnded && pendingOption) {
        set(lastEnded);
        return choose(pendingOption);
      }
    },
    leave: async () => {
      if (current.phase !== "playing") return;
      const durationMs = Math.max(0, Math.round(clock() - startedAt));
      try {
        await input.client.finish({ chapterNumber: input.chapterNumber, outcome: "quit", durationMs });
      } catch {
        // A quit that fails to record changes nothing: the chapter stays open either way.
      }
    },
  };
}
