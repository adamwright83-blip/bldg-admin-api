import type { StoryGameModule, StoryGameProps } from "./types";

/** Season 0's placeholder game: deliberately plain. Two buttons decide the outcome. */
function FixtureButtonGame({ onFinish }: StoryGameProps) {
  return (
    <div className="story-fixture-game" data-testid="story-fixture-game">
      <p className="story-fixture-game-label">Fixture game</p>
      <div className="story-fixture-game-buttons">
        <button type="button" onClick={() => onFinish("win")} data-testid="story-fixture-win">Win</button>
        <button type="button" onClick={() => onFinish("lose")} data-testid="story-fixture-lose">Lose</button>
      </div>
    </div>
  );
}

export const fixtureButtonGame: StoryGameModule = { keys: ["fixture.button"], Game: FixtureButtonGame };
