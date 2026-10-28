import { useEffect, useMemo, useRef, useState } from "react";
import { createChapterSession, type ChapterHostState } from "./chapterSession";
import { storyGameFor } from "./games/registry";
import type { StoryClosing } from "@shared/story";
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
  const stage = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    stage.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
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
    <div
      ref={stage}
      className="story-host"
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const buttons = Array.from(
          stage.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],[tabindex="0"]'
          ) ?? []
        );
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`${heading}: ${title}`}
      data-testid="story-chapter-host"
    >
      <div className="story-host-card">
        <header className="story-host-head">
          <span className="story-host-eyebrow">{heading}</span>
          <button
            type="button"
            className="story-host-close"
            onClick={close}
            aria-label="Leave the chapter"
          >
            ×
          </button>
        </header>
        <h2 className="story-host-title">{title}</h2>
        <ChapterBody
          state={state}
          session={session}
          onClose={close}
          client={client}
        />
      </div>
    </div>
  );
}

function ChapterBody({
  state,
  session,
  onClose,
  client,
}: {
  client: StoryClient;
  state: ChapterHostState;
  session: ReturnType<typeof createChapterSession>;
  onClose: () => void;
}) {
  switch (state.phase) {
    case "starting":
    case "finishing":
      return (
        <p className="story-host-wait" aria-live="polite">
          One moment…
        </p>
      );
    case "playing": {
      const game = storyGameFor(state.gameKey);
      if (!game) {
        return (
          <div className="story-host-block">
            <p>This chapter's game is not in this build yet.</p>
            <button
              type="button"
              className="story-host-button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        );
      }
      const Game = game.Game;
      return (
        <div className="story-host-game" key={state.attempt}>
          <Game
            config={state.config}
            onFinish={outcome => void session.report(outcome)}
          />
        </div>
      );
    }
    case "lost":
      return (
        <div className="story-host-block" data-testid="story-host-lost">
          <p>Not this time. The chapter stays open tonight.</p>
          <div className="story-host-actions">
            <button
              type="button"
              className="story-host-button is-gold"
              onClick={() => session.retry()}
              data-testid="story-host-retry"
            >
              Try again
            </button>
            <button
              type="button"
              className="story-host-button"
              onClick={onClose}
            >
              Later
            </button>
          </div>
        </div>
      );
    case "ended":
      return (
        <div className="story-host-block" data-testid="story-host-ended">
          <div className="story-host-lines">
            {state.after.map(line => (
              <p key={line.key}>{line.text}</p>
            ))}
          </div>
          {state.question && !state.answered ? (
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
          {state.answered ? (
            <div className="story-host-saved" role="status">
              <p>Your choice is saved.</p>
              <EarnedClosing client={client} />
              <p>The next chapter opens tomorrow night.</p>
            </div>
          ) : null}
          {!state.question || state.answered ? (
            <button
              type="button"
              className="story-host-button is-gold"
              onClick={onClose}
              data-testid="story-host-done"
            >
              Back to the city
            </button>
          ) : null}
        </div>
      );
    case "error":
      return (
        <div className="story-host-block" role="alert">
          <p>{state.message}</p>
          <div className="story-host-actions">
            <button
              type="button"
              className="story-host-button is-gold"
              onClick={() => void session.recover()}
            >
              Try again
            </button>
            <button
              type="button"
              className="story-host-button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
      );
  }
}

function EarnedClosing({ client }: { client: StoryClient }) {
  const [closing, setClosing] = useState<StoryClosing>();
  useEffect(() => {
    let active = true;
    void client
      .tonight()
      .then(result => {
        if (active && result.enabled) setClosing(result.chapter?.closing);
      })
      .catch(() => {
        /* The saved answer stands; earned material is available again from the home. */
      });
    return () => {
      active = false;
    };
  }, [client]);
  return (
    <>
      {closing?.response ? <p>{closing.response}</p> : null}
      {closing?.keepsake ? (
        <div className="sh-keepsake">
          <span>KEPT FROM TONIGHT</span>
          <h3>{closing.keepsake.title}</h3>
          <p>{closing.keepsake.text}</p>
        </div>
      ) : null}
      {closing?.tomorrow ? <p>{closing.tomorrow}</p> : null}
    </>
  );
}
