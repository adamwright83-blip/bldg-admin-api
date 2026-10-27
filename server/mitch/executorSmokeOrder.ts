import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../db";
import type { MitchWorkOrder } from "../../shared/mitchContracts";
import type { MitchProductionService } from "./mitchService";
import type { IMitchProductionStore } from "./mitchStore";


/**
 * Serializes opt-in smoke seeding from the initial milestone registration through
 * the final order insert. The local FIFO covers concurrent tick callbacks in one
 * worker; MySQL GET_LOCK covers separate Railway replicas/processes.
 *
 * The advisory lock belongs to the connection reserved by this transaction.
 * Always release it on that same connection, including when the seed fails.
 * No protected code path or normal Mitch producer plan is affected when the
 * smoke flag is off.
 */
const localSmokeLocks = new Map<string, Promise<void>>();

/** mysql2 returns [rows, fields] for a raw statement. */
function lockRows(result: unknown): Array<Record<string, unknown>> {
  return ((result as [Array<Record<string, unknown>>])[0] ?? []);
}

export async function withExecutorSmokeSeedLock<T>(
  input: { tenantId: string; gameId: string; enabled: boolean },
  seed: () => Promise<T>
): Promise<T> {
  if (!input.enabled) return seed();

  const identity = JSON.stringify([input.tenantId, input.gameId]);
  const lockName = `mitch-smoke:${createHash("sha256").update(identity).digest("hex").slice(0, 48)}`;
  const previous = localSmokeLocks.get(lockName) ?? Promise.resolve();
  let releaseLocal: () => void = () => {};
  const current = new Promise<void>(resolve => { releaseLocal = resolve; });
  localSmokeLocks.set(lockName, current);
  await previous;
  try {
    const db = await getDb();
    if (!db) return await seed(); // In-memory unit test. Durable worker fails closed in its store.
    return await db.transaction(async tx => {
      const [acquisition] = lockRows(await tx.execute(sql`SELECT GET_LOCK(${lockName}, 15) AS acquired`));
      if (Number(acquisition?.acquired) !== 1)
        throw new Error("Mitch executor smoke seed lock unavailable; no order was created");
      try {
        return await seed();
      } finally {
        const [release] = lockRows(await tx.execute(sql`SELECT RELEASE_LOCK(${lockName}) AS released`));
        if (Number(release?.released) !== 1)
          throw new Error("Mitch executor smoke seed lock release failed");
      }
    });
  } finally {
    releaseLocal();
    if (localSmokeLocks.get(lockName) === current) localSmokeLocks.delete(lockName);
  }
}

/**
 * A deliberately trivial, bounded work order used to prove the executor →
 * handback → independent-review loop end to end. Off unless the producer sets
 * MITCH_EXECUTOR_SMOKE_ORDER=true.
 *
 * It lives on its own milestone (sequence 0) so it never becomes a build of
 * k2_install_boreslay_duel_progression and can never touch the human-blocked
 * k2_author_real_business_binding milestone.
 */
export const KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE = {
  milestoneKey: "k2_executor_smoke_duel_scoring_test",
  sequence: 0,
  title: "Executor smoke: one deterministic Boreslay scoring test",
  desiredPlayerVisibleResult:
    "No player-visible change. A single extra deterministic unit test pins existing Boreslay Rally scoring behavior.",
  acceptanceCriteria: [
    "Exactly one new `it(...)` case is added to client/src/components/boreslay-rally/rallyScoring.test.ts",
    "The new test asserts scoring behavior the file does not already assert and is deterministic (no timers, randomness, or network)",
    "No file other than rallyScoring.test.ts is modified",
    "`pnpm exec vitest run client/src/components/boreslay-rally/rallyScoring.test.ts` passes",
  ],
} as const;

/**
 * Creates the smoke milestone and at most one work order for it, ever. A failed
 * or finished smoke order is never recreated: a failure here is evidence for a
 * human, not something to retry in a loop.
 */
export async function seedExecutorSmokeOrder(input: {
  tenantId: string;
  gameId: string;
  store: IMitchProductionStore;
  service: MitchProductionService;
  baseBranch?: string;
  baseSha?: string;
}): Promise<MitchWorkOrder | null> {
  const def = KINGDOM_TWO_EXECUTOR_SMOKE_MILESTONE;
  await input.service.registerMilestone({
    tenantId: input.tenantId,
    gameId: input.gameId,
    milestoneKey: def.milestoneKey,
    sequence: def.sequence,
    title: def.title,
    desiredPlayerVisibleResult: def.desiredPlayerVisibleResult,
    acceptanceCriteria: [...def.acceptanceCriteria],
  });

  const orders = await input.store.listWorkOrders(input.tenantId, input.gameId);
  if (orders.some(order => order.milestoneKey === def.milestoneKey)) return null;

  const baseSha = input.baseSha?.trim();
  if (!baseSha || !/^[a-f0-9]{40}$/i.test(baseSha))
    throw new Error(
      "MITCH_GAME_BASE_SHA must be an exact 40-character commit before the executor smoke order can dispatch"
    );

  return input.service.createWorkOrder({
    tenantId: input.tenantId,
    gameId: input.gameId,
    milestoneKey: def.milestoneKey,
    title: def.title,
    desiredPlayerVisibleResult: def.desiredPlayerVisibleResult,
    acceptanceCriteria: [...def.acceptanceCriteria],
    canonConstraints: [
      "Test-only change. Do not alter Boreslay Rally scoring, physics, or boss behavior.",
      "Do not touch kingdom binding, campaign, or real-business code.",
    ],
    relevantDependencies: [
      "client/src/components/boreslay-rally/rallyScoring.test.ts",
      "client/src/components/boreslay-rally/rallyEngine.ts",
    ],
    realBusinessEvidenceConstraints: [
      "Mitch must never fabricate business evidence. This order produces none.",
    ],
    baseBranch: input.baseBranch?.trim() || "main",
    baseSha,
    requiredArtifact: "client/src/components/boreslay-rally/rallyScoring.test.ts",
    requiredTests: [
      "pnpm exec vitest run client/src/components/boreslay-rally/rallyScoring.test.ts",
    ],
    requiredEvidence: [
      "Exact implementation branch and 40-character commit SHA",
      "Name of the single added test and the scoring behavior it pins",
      "Confirmation that only rallyScoring.test.ts changed",
    ],
  });
}
