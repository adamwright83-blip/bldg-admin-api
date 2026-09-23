import { useEffect, useState } from "react";
import { hasColosseumResolved } from "./waywardProgress";

/**
 * Who travels with Trailblazer, on this device — the one place later
 * sequences (the next kingdom, the Road) ask.
 *
 * FICTION, kept as same-device local continuity: `window.localStorage`, keyed
 * by player identity, recorded at the same boundary as the Wayward unlock
 * (GoldlineDriverController, when the finale resolves after the real campaign
 * is complete). Like the Wayward unlock and the Colosseum resolution it derives
 * from, it is NOT durable, account-level or server state: another device, a
 * cleared browser or a private window will not have it. Party membership never
 * records a visit, sale or revenue, and nothing here can write one.
 *
 * It is not the server's evidence-backed companion unlock
 * (`server/companions/companionService.ts#earnCompanion`), which grants a
 * companion's real product capability only against a completed ops task.
 * Joining the party is the story; that record is the receipt.
 *
 * Rook joins when Kingdom 1 (the Colosseum) resolves: he was never waiting to
 * be rescued — he has been running an illegal communications network through
 * the Republic's clocks the whole time (WORLD_BIBLE §12). A player whose device
 * already holds a Colosseum resolution from before this existed has him too:
 * his membership is derived from that same local resolution.
 */

export type PartyMemberId = "rook";
export type PartyJoinSource = "kingdom-1-colosseum";

export type PartyMember = {
  id: PartyMemberId;
  joinedVia: PartyJoinSource;
  /** When this device recorded it; null when derived from an earlier resolution. */
  joinedAt: string | null;
};

export type GoldlineParty = { members: PartyMember[] };

/** Fired on window whenever this device's party changes. */
export const PARTY_CHANGED_EVENT = "goldline:party-changed";

/**
 * Each companion's in-world mechanic, and the real product capability it
 * stands for (REALITY_BRIDGE.md §6; server/companions/seedCompanions.ts).
 * The fiction may name the mechanic; it may never widen what the real
 * capability is allowed to do.
 */
export const PARTY_COMPANIONS = {
  rook: {
    name: "Rook",
    fullName: "Rook Venn",
    mechanic: "CONTACT",
    mechanicSummary:
      "Rook can reach people, open conversations, and get through social barriers Trailblazer cannot.",
    capabilityId: "rook.outreach_drafting",
    /** WORLD_BIBLE §11: former infamous liar; since the Sunder his voice fails on a direct lie. */
    truth: "Cannot speak a direct lie. Does not have to tell you everything.",
  },
} as const satisfies Record<PartyMemberId, unknown>;

const JOIN_SOURCES: Record<PartyMemberId, PartyJoinSource> = { rook: "kingdom-1-colosseum" };

export function partyKey(identity: string | null) {
  return `goldline:fantasy:party:v1:${identity?.length ? identity : "anon"}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isMemberId(value: unknown): value is PartyMemberId {
  return typeof value === "string" && value in PARTY_COMPANIONS;
}

function readStored(identity: string | null): PartyMember[] {
  try {
    const raw = storage()?.getItem(partyKey(identity));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { members?: unknown };
    if (!Array.isArray(parsed.members)) return [];
    const members: PartyMember[] = [];
    for (const entry of parsed.members) {
      const candidate = entry as Partial<PartyMember>;
      if (!isMemberId(candidate.id) || members.some(member => member.id === candidate.id)) continue;
      members.push({
        id: candidate.id,
        joinedVia: JOIN_SOURCES[candidate.id],
        joinedAt: typeof candidate.joinedAt === "string" ? candidate.joinedAt : null,
      });
    }
    return members;
  } catch {
    return [];
  }
}

export function loadParty(identity: string | null): GoldlineParty {
  const members = readStored(identity);
  // Derived: whoever resolved the Colosseum has Rook, recorded or not.
  if (!members.some(member => member.id === "rook") && hasColosseumResolved(identity)) {
    members.push({ id: "rook", joinedVia: "kingdom-1-colosseum", joinedAt: null });
  }
  return { members };
}

export function isTravelingWith(identity: string | null, id: PartyMemberId): boolean {
  return loadParty(identity).members.some(member => member.id === id);
}

/** Idempotent: joining twice keeps the first record. */
export function joinParty(identity: string | null, id: PartyMemberId, now: Date = new Date()): GoldlineParty {
  const stored = readStored(identity);
  if (!stored.some(member => member.id === id)) {
    stored.push({ id, joinedVia: JOIN_SOURCES[id], joinedAt: now.toISOString() });
    try {
      storage()?.setItem(partyKey(identity), JSON.stringify({ members: stored }));
    } catch {
      // Best-effort fantasy continuity; membership is still derivable from the resolution.
    }
    if (typeof window !== "undefined") {
      try {
        window.dispatchEvent(new CustomEvent(PARTY_CHANGED_EVENT, { detail: { id } }));
      } catch {
        // Event delivery is a courtesy to mounted listeners.
      }
    }
  }
  return loadParty(identity);
}

/** The live party for a player, kept current as members join (on this tab or another). */
export function useGoldlineParty(identity: string | null): GoldlineParty {
  const [party, setParty] = useState(() => loadParty(identity));
  useEffect(() => {
    const refresh = () => setParty(loadParty(identity));
    refresh();
    window.addEventListener(PARTY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(PARTY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [identity]);
  return party;
}
