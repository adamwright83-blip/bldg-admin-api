import { useEffect, useMemo, useRef, useState } from "react";
import { createChapterSession, type ChapterHostState } from "./chapterSession";
import { storyGameFor } from "./games/registry";
import type { StoryClosing, StoryQuestion } from "@shared/story";
import { Keepsake } from "./Keepsake";
import type { StoryClient } from "./storyClient";

/**
 * Plays tonight's chapter over the page. Every server call goes through the story client (the four `system.story.*`
 * procedures, each carrying the story header). The mounted game sees only its config and an onFinish callback.
 */
export function ChapterHost({
  client,
  chapterNumber,
  title,
  arrival = null,
  onClose,
}: {
  client: StoryClient;
  chapterNumber: number;
  title: string;
  /** Settles when the camera has reached tonight's destination; the stage rises then. Null: rise at once. */
  arrival?: Promise<void> | null;
  onClose: () => void;
}) {
  // The stage rises once the camera reaches the destination. The chapter starts loading at once either way.
  const [arrived, setArrived] = useState(arrival === null);
  useEffect(() => {
    if (!arrival) return;
    let active = true;
    void arrival.then(() => {
      if (active) setArrived(true);
    });
    return () => {
      active = false;
    };
  }, [arrival]);
  const [leaving, setLeaving] = useState(false);
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

  // Leaving: the veil closes over the stage, then the page returns to the city beneath it.
  const close = () => {
    if (leaving) return;
    setLeaving(true);
    void session.leave();
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) onClose();
    else window.setTimeout(onClose, 260);
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
      aria-busy={!arrived}
      data-arrived={arrived}
      data-leaving={leaving || undefined}
      data-phase={state.phase}
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
          chapterNumber={chapterNumber}
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
  chapterNumber,
}: {
  client: StoryClient;
  chapterNumber: number;
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
      if (state.answered)
        return (
          <EarnedClosing
            client={client}
            chapterNumber={chapterNumber}
            question={state.question}
            answered={state.answered}
            onClose={onClose}
          />
        );
      return (
        <div className="story-host-block" data-testid="story-host-ended">
          <div className="story-host-lines">
            {state.after.map(line => (
              <p key={line.key}>{line.text}</p>
            ))}
          </div>
          {state.question ? (
            <div className="story-host-question">
              <p className="story-host-question-text">{state.question.text}</p>
              <div className="story-host-options">
                {state.question.options.map(option => (
                  <button
                    key={option.key}
                    type="button"
                    className="story-host-option"
                    disabled={state.answering}
                    onClick={() => void session.choose(option.key)}
                    data-testid={`story-host-option-${option.key}`}
                  >
                    {option.text}
                  </button>
                ))}
              </div>
              {state.answering ? (
                <p className="story-host-wait" aria-live="polite">
                  Saving your answer…
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="story-host-button is-gold"
              onClick={onClose}
              data-testid="story-host-done"
            >
              Back to the city
            </button>
          )}
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

/**
 * After the answer is saved: the closing the server reveals now (the response to that answer, the keepsake, tomorrow's
 * line), read fresh from `tonight` so nothing earned is ever sent before it is earned.
 */
function EarnedClosing({
  client,
  chapterNumber,
  question,
  answered,
  onClose,
}: {
  client: StoryClient;
  chapterNumber: number;
  question: StoryQuestion | null;
  answered: string;
  onClose: () => void;
}) {
  const [closing, setClosing] = useState<StoryClosing | null | undefined>();
  useEffect(() => {
    let active = true;
    void client
      .tonight()
      .then(result => {
        if (active) setClosing((result.enabled && result.chapter?.closing) || null);
      })
      .catch(() => {
        // The saved answer stands; the earned material is on the home once it loads again.
        if (active) setClosing(null);
      });
    return () => {
      active = false;
    };
  }, [client]);
  const chosen = question?.options.find(option => option.key === answered);
  return (
    <div
      className="story-host-closing"
      data-testid="story-host-closing"
      data-loaded={closing !== undefined}
      role="status"
    >
      {chosen ? <p className="story-host-chosen">{chosen.text}</p> : null}
      {closing === undefined ? (
        <p className="story-host-wait">Your answer is saved.</p>
      ) : (
        <>
          <p className="story-host-response">
            {closing?.response ?? "Your answer is saved."}
          </p>
          {closing?.keepsake ? (
            <Keepsake
              chapterNumber={chapterNumber}
              title={closing.keepsake.title}
              text={closing.keepsake.text}
              headingLevel={3}
            />
          ) : null}
          <p className="story-host-tomorrow">
            {closing?.tomorrow ?? "The next chapter opens tomorrow night."}
          </p>
        </>
      )}
      <button
        type="button"
        className="story-host-button is-gold"
        onClick={onClose}
        data-testid="story-host-done"
      >
        Back to the city
      </button>
    </div>
  );
}
