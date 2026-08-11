import type {
  ObjectionArchetype,
  SalesIntelChannel,
} from "../../../../shared/salesIntel";
import type { ArmoryWeapon } from "../../../../server/armory/armoryTypes";
import type { PlayableMission } from "../state/GameState";

export type { ObjectionArchetype, SalesIntelChannel, ArmoryWeapon };

/**
 * Outcome of the *game* layer only. This never asserts anything about the
 * business — every encounter routes through a business-resolution gate before
 * real state can change.
 */
export type EncounterPerformance = "pending" | "clean" | "partial" | "missed";

export type EncounterResolution = {
  performance: EncounterPerformance;
  /** Player-facing description of what happened mechanically. */
  feedback: string;
};

export type EncounterProps = {
  mission: PlayableMission;
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
  weapons: ArmoryWeapon[];
  isLoadingWeapons: boolean;
  trainerIntelligenceAvailable: boolean;
  onSelectWeapon: (weapon: ArmoryWeapon) => void;
  /** Fires once the physical mechanic resolves. */
  onResolved: (resolution: EncounterResolution) => void;
  /** Opens the real business surface where an outcome can be logged. */
  onOpenBusinessAction: () => void;
  onClose: () => void;
};

/**
 * Derives the channel from the mission's real state rather than asking the
 * player. A mission that has never been contacted is a phone approach; one
 * with a live follow-up is a follow-up; one with a proposal out is a proposal.
 */
export function channelForMission(mission: PlayableMission): SalesIntelChannel {
  if (mission.state === "contested" || mission.state === "recovery_active") {
    return "follow_up";
  }
  if (mission.state === "watching") return "follow_up";
  if (mission.phoneUrl && !mission.address) return "phone";
  if (mission.address) return "in_person";
  return "phone";
}

/**
 * Chooses which objection this encounter presents, from real world state only.
 *
 * Each non-default archetype requires positive evidence. In particular, a
 * missing decision-maker phone number is NOT evidence of a gatekeeper — it is
 * just missing data. A gatekeeper is inferred only when the account is already
 * being actively worked and we still have no decision-maker contact, which is
 * a real "we tried and are still blocked" signal.
 *
 * Absent any such evidence the encounter stays the ANCHOR, which is also the
 * Run-1 behaviour.
 */
export function archetypeForMission(input: {
  mission: PlayableMission;
  hasDecisionMakerContact: boolean;
  now?: Date;
}): ObjectionArchetype {
  const { mission } = input;
  const now = input.now ?? new Date();

  // A real committed date: ahead of us is a delay, already missed is silence.
  if (mission.contestedUntil) {
    const due = new Date(mission.contestedUntil);
    if (Number.isFinite(due.getTime())) {
      return due.getTime() > now.getTime() ? "STALLER" : "GHOST";
    }
  }

  if (mission.state === "contested" || mission.state === "recovery_active") {
    return "GHOST";
  }

  // Actively engaged and still no route to whoever decides.
  if (mission.state === "active" && !input.hasDecisionMakerContact) {
    return "GATEKEEPER";
  }

  return "ANCHOR";
}

export const ARCHETYPE_COPY: Record<
  ObjectionArchetype,
  { label: string; situation: string; objective: string }
> = {
  ANCHOR: {
    label: "THE ANCHOR",
    situation: "They already have a company",
    objective: "Create a reason to reconsider",
  },
  GATEKEEPER: {
    label: "THE GATEKEEPER",
    situation: "You are not through to the decision maker",
    objective: "Find a route, a name, or a time",
  },
  GHOST: {
    label: "THE GHOST",
    situation: "The signal went quiet after contact",
    objective: "Re-establish contact — or close it honestly",
  },
  STALLER: {
    label: "THE STALLER",
    situation: "The decision keeps moving",
    objective: "Find out which delay this really is",
  },
};

export const CHANNEL_LABEL: Record<SalesIntelChannel, string> = {
  phone: "PHONE",
  in_person: "IN PERSON",
  follow_up: "FOLLOW-UP",
  proposal: "PROPOSAL",
};
