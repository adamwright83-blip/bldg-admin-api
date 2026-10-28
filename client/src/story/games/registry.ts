import { fixtureButtonGame } from "./FixtureButtonGame";
import { monitorDeskGame } from "./monitorDesk/monitorDeskModule";
import type { StoryGameModule } from "./types";

/** Every game this build can mount. A chapter whose gameKey is not here cannot be played in this build. */
export const STORY_GAMES: readonly StoryGameModule[] = [fixtureButtonGame, monitorDeskGame];

export function storyGameFor(gameKey: string): StoryGameModule | null {
  return STORY_GAMES.find(game => game.keys.includes(gameKey)) ?? null;
}
