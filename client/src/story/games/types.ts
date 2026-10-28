import type { ComponentType } from "react";

/**
 * A chapter's game. It plays, then reports "win" or "lose" once. It gets the chapter's config and nothing else: no
 * network, no business data, no story client. The host does every server call.
 */
export type StoryGameProps = {
  config: Record<string, unknown>;
  onFinish: (outcome: "win" | "lose") => void;
};

export type StoryGameModule = {
  /** The gameKeys this game answers to (a chapter's `gameKey`). */
  keys: readonly string[];
  Game: ComponentType<StoryGameProps>;
  /**
   * A frame from the game itself, shown on the home under tonight's invitation so the operator sees what they will be
   * doing. It must be taken before anything the chapter reveals.
   */
  poster?: { src: string; alt: string };
  /** Names the first interaction without disclosing a story outcome. */
  launchLabel?: string;
};
