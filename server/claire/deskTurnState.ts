/**
 * Claire Desk conversation state across overlapping requests.
 * Day Line effects are durable on their own; this only keeps one turn from
 * silently overwriting another turn's conversation state.
 */
import { ConversationStateConflictError, type ClaireConversationStateStore } from "./turn/conversationStateStore";

const deskTurnLocks = new Map<string, Promise<void>>();

/** Serializes Desk turns for one conversation within this process. Always release in finally. */
export async function acquireDeskTurnLock(key: string): Promise<() => void> {
  const previous = deskTurnLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>(resolve => (release = resolve));
  const tail = previous.then(() => mine);
  deskTurnLocks.set(key, tail);
  await previous;
  return () => {
    release();
    if (deskTurnLocks.get(key) === tail) deskTurnLocks.delete(key);
  };
}

/**
 * Save Desk state against the version this turn loaded. If another process saved in
 * between, its newer state is kept rather than overwritten; this turn's Day Line
 * effects are already durable either way, and re-running the turn would repeat them.
 */
export async function saveDeskConversationState(
  store: ClaireConversationStateStore,
  key: string,
  owner: { tenantId: string; operatorUserId: string; surface: "text" },
  state: unknown,
  readVersion: number | null,
  ttlMs: number
): Promise<void> {
  if (!store.compareAndSave) {
    await store.save(key, owner, state, ttlMs);
    return;
  }
  try {
    await store.compareAndSave(key, owner, state, ttlMs, readVersion);
  } catch (error) {
    if (!(error instanceof ConversationStateConflictError)) throw error;
    console.warn("[ClaireDesk] conversation state changed during this turn; kept the newer state", { key, readVersion, actualVersion: error.actualVersion });
  }
}
