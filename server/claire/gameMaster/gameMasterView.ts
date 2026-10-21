/**
 * Business Memory — the game master view, read-only.
 *
 * Claire is the operator's game master: she must know where the operator is at
 * every stage. JOYSTICK's game is a projection over real business work, and the
 * parts of it that are durable server truth live in these stores:
 *
 *   goldline_kingdoms              every Kingdom row and its lantern status
 *   open_channel Day 1 Ten Doors   the real buildings and recorded field outcomes
 *   Colosseum binding              which five of those are the Greystar Koreatown hunt
 *   goldline_domain_progression    level.colosseum, Rook owned, Brass Republic,
 *                                  Coastal Market Rook hunt, Wayward contact gate
 *   goldline_companion_unlocks     companions earned
 *   goldline_chapter_states        chapter fiction state saved per operator
 *   hidden_game_chapter_unlocks    Lost Property chapters opened
 *
 * Century Park East, Beverly Hills and CHANNEL 382 keep no server-side progress
 * (their state is client-side or operator-reported), so they are reported as
 * "no record" by construction.
 *
 * Every stage is present in the view. An empty or unreadable store is an explicit
 * `{ record: "none" }`, never an omission, and never "done": Claire may only call
 * a stage complete when a row says so.
 *
 * READ ONLY. Kingdom rows come from `listKingdoms`, not `deriveKingdomStatuses`
 * (which may advance a stored lantern status on the way to its read). The same
 * derivation is applied here in memory instead: Kingdom 1 is reported as
 * complete-by-evidence when every Colosseum target has an outcome, even if the
 * stored row has not been advanced yet. Day 1 uses
 * `getDay1TenDoorsMissionReadOnly`, which skips every get-or-create branch.
 *
 * Driver-id split: Day 1 rows exist in production under driver ids "1",
 * "driver-primary" and "adam-admin" (`open_channel_missions.driverId`). This
 * reader looks up by the SIGNED-IN openId (`operatorUserId`, "adam-admin" for
 * Adam), the durable key `day1TenDoorsRouter` and `deriveKingdomStatuses` use.
 * Rows under the other two ids are not merged here; the showrunner briefing passes
 * the operator's alias openIds and keeps the mission with the most recorded visits.
 */

import type { GoldlineKingdom } from "../../goldlineKingdoms/kingdomTypes";
import type { Day1TenDoorsMission } from "../../openChannel/day1TenDoorsService";
import type { Day1TargetOutcome } from "../../../shared/day1TenDoors";
import type { DomainProgressionLookup } from "../../goldlineProgression/progressionStore";
import { colosseumLeadHuntDefinition } from "../../goldlineProgression/colosseumKingdomBinding";

export type NoRecord = { record: "none"; reason: string };

export function isNoRecord(value: unknown): value is NoRecord {
  return Boolean(value && typeof value === "object" && (value as { record?: unknown }).record === "none");
}

export type GameMasterKingdom = {
  kingdomId: string;
  sequence: number;
  title: string;
  /** The stored lantern status. */
  status: GoldlineKingdom["lanternCityStatus"];
  /** Stored status, advanced in memory when real evidence proves it (Kingdom 1 only). */
  derivedStatus: GoldlineKingdom["lanternCityStatus"];
  companionEarnedId: string | null;
};

export type GameMasterTarget = {
  id: string;
  name: string;
  address: string | null;
  isGreystar: boolean;
  outcome: Day1TargetOutcome | null;
};

export type GameMasterView = {
  /** The signed-in openId Day 1 and per-operator rows were read for. */
  driverId: string;
  kingdoms: GameMasterKingdom[] | NoRecord;
  activeKingdom: GameMasterKingdom | null;
  day1TenDoors:
    | {
        missionId: string;
        title: string;
        visitedCount: number;
        totalCount: number;
        isComplete: boolean;
        targets: GameMasterTarget[];
        /** Target ids with no recorded outcome. */
        remaining: string[];
      }
    | NoRecord;
  /** The five-target Greystar Koreatown hunt behind Kingdom 1, reconciled against Day 1. */
  colosseum:
    | {
        targetIds: string[];
        pitched: Array<{ id: string; name: string }>;
        remaining: Array<{ id: string; name: string }>;
        satisfied: boolean;
        /** Day 1 buildings with no outcome that are NOT part of the five. */
        beyond: Array<{ id: string; name: string; isGreystar: boolean }>;
      }
    | NoRecord;
  domainProgression:
    | {
        levelColosseumResolvedAt: string | null;
        companionRookOwnedAt: string | null;
        kingdomBrassRepublicCompletedAt: string | null;
        coastalMarketRookHunt: { startedAt: string; caughtAt: string | null } | NoRecord;
        waywardContactGate: { startedAt: string; completedAt: string | null } | NoRecord;
      }
    | NoRecord;
  companions: Array<{ companionId: string; earnedAt: string; earnedViaKingdomId: string | null }> | NoRecord;
  chapters: Array<{ chapterId: string; revision: number; updatedAt: string }> | NoRecord;
  hiddenGames: Array<{ chapter: number; openedAt: string }> | NoRecord;
  levels: { centuryParkEast: NoRecord; beverlyHills: NoRecord; channel382: NoRecord };
  gaps: string[];
};

export type GameMasterReaders = {
  listKingdoms: (input: { tenantId: string }) => Promise<GoldlineKingdom[]>;
  readDay1Mission: (input: { tenantId: string; driverId: string }) => Promise<Day1TenDoorsMission | null>;
  readDomainProgression?: (input: { tenantId: string; operatorId: string }) => Promise<DomainProgressionLookup>;
  listCompanionUnlocks?: (input: { tenantId: string; operatorId: string }) => Promise<
    Array<{ companionId: string; earnedAt: string; earnedViaKingdomId: string | null }>
  >;
  listChapterStates?: (input: { tenantId: string; operatorId: string }) => Promise<
    Array<{ chapterId: string; revision: number; updatedAt: string }>
  >;
  readHiddenGameUnlocks?: (input: { tenantId: string; canonicalOperatorId: string }) => Promise<
    Array<{ chapter: number; openedAt: string }>
  >;
};

const none = (reason: string): NoRecord => ({ record: "none", reason });

const NO_SERVER_STORE = "no server-side progress store for this level";

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function authoredReceipts(value: unknown): {
  coastalMarketHunt?: { startedAt?: string; caughtAt?: string };
  waywardContactGate?: { startedAt?: string; completedAt?: string };
} {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as never) : {};
}

export function projectGameMasterView(input: {
  driverId: string;
  kingdoms: GoldlineKingdom[] | null;
  mission: Day1TenDoorsMission | null;
  domainProgression?: DomainProgressionLookup | null;
  companions?: Array<{ companionId: string; earnedAt: string; earnedViaKingdomId: string | null }> | null;
  chapters?: Array<{ chapterId: string; revision: number; updatedAt: string }> | null;
  hiddenGames?: Array<{ chapter: number; openedAt: string }> | null;
  gaps?: string[];
}): GameMasterView {
  const gaps = [...(input.gaps ?? [])];
  const mission = input.mission;

  const outcomeOf = (id: string): Day1TargetOutcome | null => mission?.outcomes[id] ?? null;
  const targets: GameMasterTarget[] = (mission?.targets ?? []).map(target => ({
    id: target.id,
    name: target.name,
    address: target.address || null,
    isGreystar: target.isGreystar,
    outcome: outcomeOf(target.id),
  }));
  const nameOf = (id: string) => targets.find(target => target.id === id)?.name ?? id;

  const definition = colosseumLeadHuntDefinition();
  const colosseumIds = definition?.targetIds ?? [];
  const colosseum: GameMasterView["colosseum"] =
    mission && colosseumIds.length
      ? {
          targetIds: [...colosseumIds],
          pitched: colosseumIds.filter(id => outcomeOf(id) !== null).map(id => ({ id, name: nameOf(id) })),
          remaining: colosseumIds.filter(id => outcomeOf(id) === null).map(id => ({ id, name: nameOf(id) })),
          satisfied: colosseumIds.every(id => outcomeOf(id) !== null),
          beyond: targets
            .filter(target => target.outcome === null && !colosseumIds.includes(target.id))
            .map(target => ({ id: target.id, name: target.name, isGreystar: target.isGreystar })),
        }
      : none(mission ? "no Colosseum lead-hunt definition" : "no Day 1 mission recorded for this operator");

  const kingdoms: GameMasterKingdom[] | NoRecord =
    input.kingdoms && input.kingdoms.length
      ? [...input.kingdoms]
          .sort((a, b) => a.sequence - b.sequence)
          .map(row => ({
            kingdomId: row.kingdomId,
            sequence: row.sequence,
            title: row.title,
            status: row.lanternCityStatus,
            // Same evidence rule as deriveKingdomStatuses, applied in memory only.
            derivedStatus:
              row.kingdomId === "kingdom-1-colosseum" && !isNoRecord(colosseum) && colosseum.satisfied
                ? "complete"
                : row.lanternCityStatus,
            companionEarnedId: row.companionEarnedId,
          }))
      : none(input.kingdoms ? "no Kingdom rows for this tenant" : "Kingdoms unreadable");
  const activeKingdom = isNoRecord(kingdoms) ? null : kingdoms.find(kingdom => kingdom.derivedStatus === "active") ?? null;

  const lookup = input.domainProgression ?? null;
  let domainProgression: GameMasterView["domainProgression"];
  if (!lookup) domainProgression = none("domain progression not read");
  else if (!lookup.readable) domainProgression = none("domain progression unreadable");
  else if (!lookup.row) domainProgression = none("no domain progression row for this operator");
  else {
    const receipts = authoredReceipts(lookup.row.overworldUnlocksJson);
    domainProgression = {
      levelColosseumResolvedAt: iso(lookup.row.levelColosseumResolvedAt),
      companionRookOwnedAt: iso(lookup.row.companionRookOwnedAt),
      kingdomBrassRepublicCompletedAt: iso(lookup.row.kingdomBrassRepublicCompletedAt),
      coastalMarketRookHunt: receipts.coastalMarketHunt?.startedAt
        ? { startedAt: receipts.coastalMarketHunt.startedAt, caughtAt: receipts.coastalMarketHunt.caughtAt ?? null }
        : none("no Coastal Market Rook hunt receipt"),
      waywardContactGate: receipts.waywardContactGate?.startedAt
        ? { startedAt: receipts.waywardContactGate.startedAt, completedAt: receipts.waywardContactGate.completedAt ?? null }
        : none("no Wayward contact gate receipt"),
    };
  }

  const listOrNone = <T>(rows: T[] | null | undefined, label: string): T[] | NoRecord =>
    rows === undefined ? none(`${label} not read`) : rows === null ? none(`${label} unreadable`) : rows.length ? rows : none(`no ${label} for this operator`);

  return {
    driverId: input.driverId,
    kingdoms,
    activeKingdom,
    day1TenDoors: mission
      ? {
          missionId: mission.missionId,
          title: mission.title,
          visitedCount: mission.visitedCount,
          totalCount: mission.totalCount,
          isComplete: mission.isComplete,
          targets,
          remaining: targets.filter(target => target.outcome === null).map(target => target.id),
        }
      : none("no Day 1 mission recorded for this operator"),
    colosseum,
    domainProgression,
    companions: listOrNone(input.companions, "companion unlocks"),
    chapters: listOrNone(input.chapters, "chapter states"),
    hiddenGames: listOrNone(input.hiddenGames, "hidden game chapter unlocks"),
    levels: {
      centuryParkEast: none(NO_SERVER_STORE),
      beverlyHills: none(NO_SERVER_STORE),
      channel382: none(NO_SERVER_STORE),
    },
    gaps,
  };
}

/**
 * Read the view. Each store failing is a coverage gap and a "no record" stage,
 * never a thrown turn: a missing table must not take the evening call down.
 */
export async function readGameMasterView(
  input: { tenantId: string; operatorUserId: string; canonicalOperatorId?: string | null },
  readers: GameMasterReaders
): Promise<GameMasterView> {
  const gaps: string[] = [];
  const attempt = async <T>(label: string, read: (() => Promise<T>) | null): Promise<T | null | undefined> => {
    if (!read) return undefined;
    try {
      return await read();
    } catch {
      gaps.push(`${label} unreadable`);
      return null;
    }
  };
  const operatorId = input.operatorUserId;
  const canonical = input.canonicalOperatorId?.trim() || null;
  const [kingdoms, mission, domainProgression, companions, chapters, hiddenGames] = await Promise.all([
    attempt("kingdoms", () => readers.listKingdoms({ tenantId: input.tenantId })),
    attempt("day 1 mission", () => readers.readDay1Mission({ tenantId: input.tenantId, driverId: operatorId })),
    attempt("domain progression", readers.readDomainProgression ? () => readers.readDomainProgression!({ tenantId: input.tenantId, operatorId }) : null),
    attempt("companion unlocks", readers.listCompanionUnlocks ? () => readers.listCompanionUnlocks!({ tenantId: input.tenantId, operatorId }) : null),
    attempt("chapter states", readers.listChapterStates ? () => readers.listChapterStates!({ tenantId: input.tenantId, operatorId }) : null),
    // Lost Property is keyed by the canonical operator id, which some surfaces do not carry.
    attempt(
      "hidden game unlocks",
      readers.readHiddenGameUnlocks && canonical
        ? () => readers.readHiddenGameUnlocks!({ tenantId: input.tenantId, canonicalOperatorId: canonical })
        : null
    ),
  ]);
  return projectGameMasterView({
    driverId: operatorId,
    kingdoms: kingdoms ?? null,
    mission: mission ?? null,
    domainProgression: domainProgression === undefined ? null : domainProgression ?? { readable: false },
    companions,
    chapters,
    hiddenGames,
    gaps,
  });
}

/** Production readers. Every one is a SELECT (see the file header). */
export const productionGameMasterReaders: GameMasterReaders = {
  listKingdoms: async input => {
    const { listKingdoms } = await import("../../goldlineKingdoms/kingdomService");
    return listKingdoms(input);
  },
  readDay1Mission: async input => {
    const { getDay1TenDoorsMissionReadOnly } = await import("../../openChannel/day1TenDoorsService");
    return getDay1TenDoorsMissionReadOnly(input);
  },
  readDomainProgression: async input => {
    const { findDomainProgression } = await import("../../goldlineProgression/progressionStore");
    return findDomainProgression(input);
  },
  listCompanionUnlocks: async input => {
    const { listUnlocks } = await import("../../companions/companionService");
    const rows = await listUnlocks(input);
    return rows.map(row => ({ companionId: row.companionId, earnedAt: row.earnedAt, earnedViaKingdomId: row.earnedViaKingdomId ?? null }));
  },
  listChapterStates: async input => {
    const [{ getDb }, { goldlineChapterStates }, { and, eq }] = await Promise.all([
      import("../../db"),
      import("../../../drizzle/schema"),
      import("drizzle-orm"),
    ]);
    const db = await getDb();
    if (!db) throw new Error("chapter state store unavailable");
    const rows = await db
      .select({
        chapterId: goldlineChapterStates.chapterId,
        revision: goldlineChapterStates.revision,
        updatedAt: goldlineChapterStates.updatedAt,
      })
      .from(goldlineChapterStates)
      .where(and(eq(goldlineChapterStates.tenantId, input.tenantId), eq(goldlineChapterStates.operatorId, input.operatorId)));
    return rows.map(row => ({ chapterId: row.chapterId, revision: row.revision, updatedAt: row.updatedAt.toISOString() }));
  },
  readHiddenGameUnlocks: async input => {
    const { readStoredChapterUnlocks } = await import("../../experience/hiddenGame/lostPropertyChapterUnlock");
    const rows = await readStoredChapterUnlocks({ tenantId: input.tenantId, canonicalOperatorId: input.canonicalOperatorId });
    return rows.map(row => ({ chapter: row.chapter, openedAt: row.openedAt }));
  },
};


const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
export function spokenCount(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

function list(items: string[], conjunction = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items[items.length - 1]}`;
}

/**
 * Where the operator is in the active hunt, reconciled: the Colosseum five are
 * counted on their own, and other unvisited Day 1 buildings are named as beyond
 * it, never folded into one undifferentiated number.
 */
export function speakColosseumPosition(view: GameMasterView): string | null {
  if (isNoRecord(view.colosseum)) return null;
  const c = view.colosseum;
  const kingdom = view.activeKingdom ?? (isNoRecord(view.kingdoms) ? null : view.kingdoms.find(k => k.kingdomId === "kingdom-1-colosseum") ?? null);
  const label = kingdom ? `Kingdom ${kingdom.sequence}, ${kingdom.title}` : "The Colosseum";
  if (c.satisfied) {
    return `${label}: all ${spokenCount(c.targetIds.length)} Greystar targets have a recorded visit.`;
  }
  const beyondGreystar = c.beyond.filter(target => target.isGreystar).length;
  const beyond = c.beyond.length
    ? beyondGreystar === c.beyond.length
      ? `; ${spokenCount(c.beyond.length)} more Greystar buildings beyond it`
      : `; ${spokenCount(c.beyond.length)} more Day 1 buildings beyond it`
    : "";
  return [
    `${label}: you've pitched ${spokenCount(c.pitched.length)} of the ${spokenCount(c.targetIds.length)} Greystar targets${c.pitched.length ? ` (${list(c.pitched.map(t => t.name))})` : ""}.`,
    `${list(c.remaining.map(t => t.name), "or")} next, ${spokenCount(c.remaining.length)} left for the Colosseum${beyond}.`,
  ].join(" ");
}

/** Stages that exist in the game but hold no server record, named so Claire never calls them done. */
export function noRecordStages(view: GameMasterView): string[] {
  const out: string[] = [];
  if (isNoRecord(view.domainProgression)) {
    out.push("the Coastal Market Rook hunt", "the Wayward contact gate");
  } else {
    if (isNoRecord(view.domainProgression.coastalMarketRookHunt)) out.push("the Coastal Market Rook hunt");
    if (isNoRecord(view.domainProgression.waywardContactGate)) out.push("the Wayward contact gate");
  }
  if (isNoRecord(view.companions)) out.push("companions earned");
  return out;
}

export function speakNoRecordStages(view: GameMasterView): string | null {
  const stages = noRecordStages(view);
  return stages.length ? `No record yet for ${list(stages)}.` : null;
}
