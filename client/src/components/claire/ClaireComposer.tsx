import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  claireComposerErrorCopy,
  claireComposerStorageKey,
  freshConversation,
  markUnanswered,
  parseStoredConversation,
  serializeConversation,
  type ClaireComposerConversation,
} from "./claireComposerModel";
import "./claireComposer.css";

function readStored(key: string | null): ClaireComposerConversation | null {
  if (!key) return null;
  try {
    return parseStoredConversation(window.localStorage.getItem(key), Date.now());
  } catch {
    return null;
  }
}

// Private mode or blocked storage: the conversation still works, it just won't survive a reload.
function writeStored(key: string | null, conversation: ClaireComposerConversation) {
  // An empty conversation is never written, so a fresh one can't overwrite a stored one
  // while the signed-in user is still resolving.
  if (!key || !conversation.lines.length) return;
  try {
    window.localStorage.setItem(key, serializeConversation(conversation));
  } catch {}
}

function clearStored(key: string | null) {
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}

/**
 * Typed conversation with Claire — the same runtime as her phone calls
 * (`system.claire.talk`: Brain V2 when enabled, one durable state per
 * conversation). Shared by the Admin Claire Desk and the Driver app.
 */
export function ClaireComposer({
  variant = "desk",
  autoFocus = false,
  onTurn,
}: {
  variant?: "desk" | "sheet";
  autoFocus?: boolean;
  /** Called after every answered turn so the host surface can re-read anything Claire changed. */
  onTurn?: () => void;
}) {
  const talk = trpc.system.claire.talk.useMutation();
  const { user } = useAuth();
  const storageKey = user?.openId ? claireComposerStorageKey(user.openId) : null;
  const [conversation, setConversation] = useState<ClaireComposerConversation>(
    () => readStored(storageKey) ?? freshConversation(Date.now())
  );
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /** Advances on "New conversation" so a late reply can't land in the new one. */
  const epoch = useRef(0);
  const pending = talk.isPending;

  // The signed-in user can resolve after first render; pick up their stored conversation then.
  useEffect(() => {
    const stored = readStored(storageKey);
    if (stored) setConversation(stored);
  }, [storageKey]);

  useEffect(() => {
    writeStored(storageKey, conversation);
  }, [storageKey, conversation]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [conversation.lines.length, pending]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    const mine = epoch.current;
    const conversationId = conversation.conversationId;
    const sentAt = Date.now();
    setDraft("");
    setError(null);
    setConversation(c => ({ ...c, lines: [...c.lines, { who: "you", text, at: sentAt }] }));
    try {
      const r = await talk.mutateAsync({ utterance: text, conversationId });
      if (epoch.current !== mine) return;
      setConversation(c =>
        c.conversationId === conversationId
          ? { ...c, lines: [...c.lines, { who: "claire", text: r.reply, at: Date.now() }] }
          : c
      );
    } catch (err) {
      if (epoch.current !== mine) return;
      setConversation(c => (c.conversationId === conversationId ? markUnanswered(c, sentAt) : c));
      setError(
        claireComposerErrorCopy({
          code: err instanceof TRPCClientError ? (err.data?.code as string | undefined) : undefined,
          message: err instanceof Error ? err.message : null,
        })
      );
      // Keep what they typed so they can decide whether to resend it.
      setDraft(current => current || text);
    } finally {
      // Even a failed request may have saved work; let the host re-read.
      if (epoch.current === mine) onTurn?.();
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  }

  function startOver() {
    epoch.current += 1;
    setError(null);
    clearStored(storageKey);
    setConversation(freshConversation(Date.now()));
    inputRef.current?.focus();
  }

  const empty = conversation.lines.length === 0;

  return (
    <section className={`cc-root cc-${variant}`} aria-label="Message Claire" data-testid="claire-composer">
      {empty && !pending ? (
        <p className="cc-empty" data-testid="claire-composer-empty">
          Type to Claire — the same Claire as your calls. Ask what she's seeing, change the plan, or report what happened.
        </p>
      ) : (
        <ol className="cc-log" ref={logRef} aria-live="polite" data-testid="claire-composer-log">
          {conversation.lines.map((line, i) => (
            <li key={`${line.at}-${i}`} className={`cc-line cc-line-${line.who}`} data-who={line.who}>
              <span className="cc-who">{line.who === "you" ? "You" : "Claire"}</span>
              <p>{line.text}</p>
              {line.unanswered ? (
                <small className="cc-unanswered" data-testid="claire-composer-unanswered">
                  No reply arrived. Check before resending — it may have saved.
                </small>
              ) : null}
            </li>
          ))}
          {pending ? (
            <li className="cc-line cc-line-claire cc-thinking" data-testid="claire-composer-thinking">
              <span className="cc-who">Claire</span>
              <p>
                <span className="cc-dots" aria-hidden>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="cc-sr">Claire is thinking…</span>
              </p>
            </li>
          ) : null}
        </ol>
      )}
      {error ? (
        <p role="alert" className="cc-error" data-testid="claire-composer-error">
          {error}
        </p>
      ) : null}
      <form className="cc-form" onSubmit={e => void send(e)}>
        <label htmlFor={`cc-input-${variant}`} className="cc-sr">
          Message Claire
        </label>
        <textarea
          id={`cc-input-${variant}`}
          ref={inputRef}
          value={draft}
          rows={2}
          maxLength={4000}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Claire"
          data-testid="claire-composer-input"
        />
        <button type="submit" disabled={!draft.trim() || pending} data-testid="claire-composer-send">
          {pending ? "…" : "Send"}
        </button>
      </form>
      {!empty ? (
        <button type="button" className="cc-new" onClick={startOver} disabled={pending} data-testid="claire-composer-new">
          New conversation
        </button>
      ) : null}
    </section>
  );
}
