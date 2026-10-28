import { useEffect, useMemo, useRef, useState } from "react";
import { createChapterSession, type ChapterHostState } from "./chapterSession";
import { storyGameFor } from "./games/registry";
import type { StoryClient } from "./storyClient";

/**
 * Plays tonight's chapter over the page. Every server call goes through the story client (the four `system.story.*`
 * procedures, each carrying the story header). The mounted game sees only its config and an onFinish callback.
 */
export function ChapterHost({
  client,
  chapterNumber,
  title,
  onClose,
}: {
  client: StoryClient;
  chapterNumber: number;
  title: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<ChapterHostState>({ phase: "starting" });
  const session = useMemo(
    () => createChapterSession({ client, chapterNumber, onChange: setState }),
    [client, chapterNumber]
  );
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void session.begin();
  }, [session]);

  const close = () => {
    void session.leave();
    onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const heading = `Chapter ${String(chapterNumber).padStart(2, "0")}`;

  return (
    <div className="story-host" role="dialog" aria-modal="true" aria-label={`${heading}: ${title}`} data-testid="story-chapter-host">
      <div className="story-host-card">
        <header className="story-host-head">
          <span className="story-host-eyebrow">{heading}</span>
          <button type="button" className="story-host-close" onClick={close} aria-label="Leave the chapter">×</button>
        </header>
        <h2 className="story-host-title">{title}</h2>
        <ChapterBody state={state} session={session} onClose={close} />
      </div>
    </div>
  );
}

function ChapterBody({
  state,
  session,
  onClose,
}: {
  state: ChapterHostState;
  session: ReturnType<typeof createChapterSession>;
  onClose: () => void;
}) {
  switch (state.phase) {
    case "starting":
    case "finishing":
      return <p className="story-host-wait" aria-live="polite">One moment…</p>;
    case "playing": {
      const game = storyGameFor(state.gameKey);
      if (!game) {
        return (
          <div className="story-host-block">
            <p>This chapter's game is not in this build yet.</p>
            <button type="button" className="story-host-button" onClick={onClose}>Close</button>
          </div>
        );
      }
      const Game = game.Game;
      return (
        <div className="story-host-game" key={state.attempt}>
          <Game config={state.config} onFinish={outcome => void session.report(outcome)} />
        </div>
      );
    }
    case "lost":
      return (
        <div className="story-host-block" data-testid="story-host-lost">
          <p>Not this time. The chapter stays open tonight.</p>
          <div className="story-host-actions">
            <button type="button" className="story-host-button is-gold" onClick={() => session.retry()} data-testid="story-host-retry">Try again</button>
            <button type="button" className="story-host-button" onClick={onClose}>Later</button>
          </div>
        </div>
      );
    case "ended":
      return (
        <div className="story-host-block" data-testid="story-host-ended">
          <div className="story-host-lines">
            {state.after.map(line => <p key={line.key}>{line.text}</p>)}
          </div>
          {state.question ? (
            <div className="story-host-question">
              <p className="story-host-question-text">{state.question.text}</p>
              <div className="story-host-options">
                {state.question.options.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    className={`story-host-option${state.answered === option.key ? " is-chosen" : ""}`}
                    disabled={Boolean(state.answered) || state.answering}
                    aria-pressed={state.answered === option.key}
                    onClick={() => void session.choose(option.key)}
                    data-testid={`story-host-option-${option.key}`}
                  >
                    {option.text}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {!state.question || state.answered ? (
            <button type="button" className="story-host-button is-gold" onClick={onClose} data-testid="story-host-done">Back to the city</button>
          ) : null}
        </div>
      );
    case "error":
      return (
        <div className="story-host-block" role="alert">
          <p>{state.message}</p>
          <div className="story-host-actions">
            <button type="button" className="story-host-button is-gold" onClick={() => void session.recover()}>Try again</button>
            <button type="button" className="story-host-button" onClick={onClose}>Close</button>
          </div>
        </div>
      );
  }
}
