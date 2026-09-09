import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import FirstChapter from "@/game/chapters/firstChapter/FirstChapter";
import {
  saveSchema,
  CHAPTER_ID,
  type ChapterSave,
} from "@/game/chapters/firstChapter/model";

const STORAGE_KEY = `goldline:chapter-dev:${CHAPTER_ID}:v1`;

/**
 * Slice 11: the first real, authenticated, provider-wrapped host for the
 * chapter — internal/hidden route, not linked from any nav, following the
 * same pattern as /goldline-effectiveness. Not the final polished player
 * entry point; that's a separate, later decision once art/QA are finished.
 *
 * Server sync is best-effort and additive: it never blocks the local game
 * from starting, and it fails silently (falling back to localStorage-only
 * play) until drizzle/0067_goldline_chapter_states.sql is actually applied
 * to a real database — which has not happened in this session and needs
 * Adam's separate approval. This is the concrete "wire the client" step the
 * earlier Slices 3/5/6/7 work was waiting on; it cannot be end-to-end
 * verified against a live table until that migration runs.
 */
export default function GoldlineChapterHost() {
  const revisionRef = useRef(0);
  const [seeded, setSeeded] = useState(false);
  const utils = trpc.useUtils();
  const stateQuery = trpc.system.goldlineChapterState.get.useQuery(
    { chapterId: CHAPTER_ID },
    { retry: false }
  );
  const saveMutation = trpc.system.goldlineChapterState.save.useMutation();

  // On load: adopt server state if present, otherwise keep whatever is
  // already in localStorage (first visit, or server unavailable/unmigrated).
  useEffect(() => {
    if (stateQuery.isLoading) return;
    if (stateQuery.data) {
      const parsed = saveSchema.safeParse(stateQuery.data.state);
      if (parsed.success) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.data));
        } catch {
          /* localStorage unavailable — game still plays from its in-memory default */
        }
        revisionRef.current = stateQuery.data.revision;
      }
    }
    setSeeded(true);
  }, [stateQuery.isLoading, stateQuery.data]);

  // Push local progress up periodically. Best-effort: a failed save (no live
  // table yet, a revision conflict, or being offline) just gets retried on
  // the next tick against whatever local state exists then.
  useEffect(() => {
    if (!seeded) return;
    let lastPushed = "";
    const interval = setInterval(() => {
      let raw: string | null;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch {
        return;
      }
      if (!raw || raw === lastPushed) return;
      const parsed = saveSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      const toServerState = toPersistedState(parsed.data);
      saveMutation.mutate(
        {
          chapterId: CHAPTER_ID,
          expectedRevision: revisionRef.current,
          state: toServerState,
          requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
        {
          onSuccess: result => {
            if (result.ok) {
              lastPushed = raw!;
              revisionRef.current = result.revision;
            } else if (result.latest) {
              // Server has a newer write (another device) — adopt it rather than overwrite it.
              revisionRef.current = result.latest.revision;
              utils.system.goldlineChapterState.get.invalidate({ chapterId: CHAPTER_ID });
            }
          },
        }
      );
    }, 4000);
    return () => clearInterval(interval);
  }, [seeded, saveMutation, utils]);

  return (
    <main className="fc-host">
      <header>
        <small>INTERNAL · GOLDLINE CHAPTER — THE LAST VALET</small>
      </header>
      {!seeded ? <p>Loading…</p> : <FirstChapter />}
    </main>
  );
}

/** Maps the client's local save shape onto the server's persisted fiction contract. */
function toPersistedState(save: ChapterSave) {
  return {
    chapterId: save.chapterId,
    version: save.version,
    room: save.room,
    checkpoint: { room: save.room, x: 0, y: 0 },
    mechanism: {
      heading: save.heading,
      gardenOpen: save.gardenOpen,
      latchOpen: save.latchOpen,
    },
    cleared: save.cleared,
    completed: save.completed,
    choice: save.choice,
    restored: false,
    secretSeen: save.secretSeen,
    prepared: { armedAt: null, resolvedEventId: null },
    realOutcome: null,
  };
}
