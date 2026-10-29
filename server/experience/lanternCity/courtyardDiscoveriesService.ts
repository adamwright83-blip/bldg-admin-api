/**
 * What Silver Lake's courtyard remembers of Rook's airmail: authored discoveries, the fan's setting, a few counts.
 *
 * Kept on the neighbourhood's existing memory row (lantern_neighborhood_memories.courtyard_discoveries_json), scoped to
 * the business and the neighbourhood, so a discovery made on a phone is there on the laptop. Fiction only: nothing here
 * is a customer, a message or money, and nothing reads it as business evidence. Writes are idempotent (a flight is
 * counted once however often it is sent) and serialised per row.
 */
import { and, eq } from "drizzle-orm";
import { lanternNeighborhoodMemories } from "../../../drizzle/schema";
import { getDb } from "../../db";
import {
  applyObservation,
  normalizeDiscoveries,
  type CourtyardDiscoveries,
  type CourtyardObservation,
} from "../../../shared/courtyardDiscoveries";

const testStore = new Map<string, CourtyardDiscoveries>();
export function _resetCourtyardDiscoveriesTestStore() {
  testStore.clear();
}
function allowTestFallback() {
  return process.env.NODE_ENV === "test" && !process.env.DATABASE_URL;
}
const key = (tenantId: string, territoryId: string) =>
  `${tenantId}::${territoryId}`;

export async function loadCourtyardDiscoveries(input: {
  tenantId: string;
  territoryId?: string;
}): Promise<CourtyardDiscoveries> {
  const territoryId = input.territoryId ?? "silver-lake";
  const db = await getDb();
  if (!db) {
    if (allowTestFallback())
      return normalizeDiscoveries(
        testStore.get(key(input.tenantId, territoryId)) ?? null
      );
    throw new Error(
      "Durable database connection unavailable for courtyard memory"
    );
  }
  const rows = await db
    .select({ json: lanternNeighborhoodMemories.courtyardDiscoveriesJson })
    .from(lanternNeighborhoodMemories)
    .where(
      and(
        eq(lanternNeighborhoodMemories.tenantId, input.tenantId),
        eq(lanternNeighborhoodMemories.territoryId, territoryId)
      )
    )
    .limit(1);
  return normalizeDiscoveries(parse(rows[0]?.json));
}

export async function recordCourtyardObservation(input: {
  tenantId: string;
  territoryId?: string;
  observation: CourtyardObservation;
  now?: Date;
}): Promise<CourtyardDiscoveries> {
  const territoryId = input.territoryId ?? "silver-lake";
  const now = input.now ?? new Date();
  const db = await getDb();
  if (!db) {
    if (!allowTestFallback())
      throw new Error(
        "Durable database connection unavailable for courtyard memory"
      );
    const next = applyObservation(
      normalizeDiscoveries(
        testStore.get(key(input.tenantId, territoryId)) ?? null
      ),
      input.observation,
      now.toISOString()
    );
    testStore.set(key(input.tenantId, territoryId), next);
    return next;
  }
  return db.transaction(async tx => {
    const rows = await tx
      .select({ json: lanternNeighborhoodMemories.courtyardDiscoveriesJson })
      .from(lanternNeighborhoodMemories)
      .where(
        and(
          eq(lanternNeighborhoodMemories.tenantId, input.tenantId),
          eq(lanternNeighborhoodMemories.territoryId, territoryId)
        )
      )
      .limit(1)
      .for("update");
    const next = applyObservation(
      normalizeDiscoveries(parse(rows[0]?.json)),
      input.observation,
      now.toISOString()
    );
    if (rows.length) {
      await tx
        .update(lanternNeighborhoodMemories)
        .set({ courtyardDiscoveriesJson: next, updatedAt: now })
        .where(
          and(
            eq(lanternNeighborhoodMemories.tenantId, input.tenantId),
            eq(lanternNeighborhoodMemories.territoryId, territoryId)
          )
        );
    } else {
      await tx
        .insert(lanternNeighborhoodMemories)
        .values({
          id: `mem_${input.tenantId}_${territoryId}`,
          tenantId: input.tenantId,
          territoryId,
          lastVisitedAt: now,
          visitCount: 1,
          courtyardDiscoveriesJson: next,
          createdAt: now,
          updatedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: { courtyardDiscoveriesJson: next, updatedAt: now },
        });
    }
    return next;
  });
}

function parse(value: unknown): unknown {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}
