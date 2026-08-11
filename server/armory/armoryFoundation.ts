/**
 * Foundation weapons — the product's own baseline loadout.
 *
 * These exist so all four encounters are playable before any trainer corpus is
 * ingested. They are explicitly `foundation` provenance: they are NOT trainer
 * doctrine, carry no attribution, and make no effectiveness claim. The three
 * ANCHOR entries are the ones Run 1 already shipped, kept stable so existing
 * behavior does not change.
 *
 * Each entry states an objective and a move. None asserts a statistic, a
 * conversion rate, or that a response "works".
 */
import type { ObjectionArchetype, SalesIntelChannel } from "../../shared/salesIntel";

export type FoundationWeapon = {
  id: string;
  archetype: ObjectionArchetype;
  /** Channels this baseline move is appropriate for. */
  channels: SalesIntelChannel[];
  title: string;
  responseFamily: string;
  spokenLine: string | null;
  discoveryQuestion: string | null;
  principle: string;
  sourceReference: string;
};

export const FOUNDATION_WEAPONS: FoundationWeapon[] = [
  // ---- ANCHOR (unchanged from Run 1) ----
  {
    id: "foundation:fast-response",
    archetype: "ANCHOR",
    channels: ["phone", "in_person", "follow_up", "proposal"],
    title: "FAST RESPONSE",
    responseFamily: "differentiate_on_responsiveness",
    spokenLine:
      "Totally fair — most properties already have a company. The difference is response time.",
    discoveryQuestion: null,
    principle:
      "Acknowledge the incumbent rather than attacking it, and name one concrete difference.",
    sourceReference: "armory:foundation:anchor:fast-response",
  },
  {
    id: "foundation:no-risk-trial",
    archetype: "ANCHOR",
    channels: ["in_person", "proposal", "follow_up"],
    title: "NO-RISK TRIAL",
    responseFamily: "reduce_switching_risk",
    spokenLine: "Try us on one run. If we don't outperform, don't switch.",
    discoveryQuestion: null,
    principle:
      "Switching cost is the real objection; shrink the size of the decision.",
    sourceReference: "armory:foundation:anchor:no-risk-trial",
  },
  {
    id: "foundation:social-proof",
    archetype: "ANCHOR",
    channels: ["phone", "in_person", "proposal"],
    title: "SOCIAL PROOF",
    responseFamily: "relevant_proof",
    spokenLine: "We already handle buildings like yours nearby.",
    discoveryQuestion: null,
    principle: "Proof is only persuasive when it is recognisably similar.",
    sourceReference: "armory:foundation:anchor:social-proof",
  },

  // ---- GATEKEEPER: the objective is access, information, or a route ----
  {
    id: "foundation:state-purpose",
    archetype: "GATEKEEPER",
    channels: ["phone", "in_person"],
    title: "STATE PURPOSE PLAINLY",
    responseFamily: "transparent_purpose",
    spokenLine:
      "I handle commercial laundry for properties nearby — who looks after that here?",
    discoveryQuestion: "Who looks after that here?",
    principle:
      "A gatekeeper routes people. Being clear and unhurried makes routing easy.",
    sourceReference: "armory:foundation:gatekeeper:state-purpose",
  },
  {
    id: "foundation:ask-timing",
    archetype: "GATEKEEPER",
    channels: ["phone", "in_person"],
    title: "ASK FOR TIMING",
    responseFamily: "seek_callback_window",
    spokenLine: null,
    discoveryQuestion: "When is a better time to reach them?",
    principle:
      "A time is easier to give than a person, and it is a real, recordable fact.",
    sourceReference: "armory:foundation:gatekeeper:ask-timing",
  },
  {
    id: "foundation:ask-route",
    archetype: "GATEKEEPER",
    channels: ["phone", "follow_up"],
    title: "ASK FOR THE ROUTE",
    responseFamily: "seek_alternate_route",
    spokenLine: null,
    discoveryQuestion:
      "Is there a better way to get this in front of them — email, or someone else?",
    principle:
      "If the front door is closed, ask which door is open instead of pushing.",
    sourceReference: "armory:foundation:gatekeeper:ask-route",
  },

  // ---- GHOST: the objective is re-establishing contact, not pressure ----
  {
    id: "foundation:change-channel",
    archetype: "GHOST",
    channels: ["follow_up", "phone"],
    title: "CHANGE THE CHANNEL",
    responseFamily: "channel_switch",
    spokenLine: null,
    discoveryQuestion: null,
    principle:
      "Silence on one channel is not refusal. Try a different one before assuming an answer.",
    sourceReference: "armory:foundation:ghost:change-channel",
  },
  {
    id: "foundation:single-question",
    archetype: "GHOST",
    channels: ["follow_up", "proposal"],
    title: "ONE EASY QUESTION",
    responseFamily: "low_effort_reply",
    spokenLine: null,
    discoveryQuestion: "Is this still something you're looking at, yes or no?",
    principle:
      "Lower the cost of replying. A one-word answer is easier to give than a decision.",
    sourceReference: "armory:foundation:ghost:single-question",
  },
  {
    id: "foundation:close-the-loop",
    archetype: "GHOST",
    channels: ["follow_up"],
    title: "CLOSE THE LOOP",
    responseFamily: "permission_to_close",
    spokenLine: null,
    discoveryQuestion:
      "Should I close this out, or keep it open for later?",
    principle:
      "Offering to stop is honest, and it often surfaces the real status.",
    sourceReference: "armory:foundation:ghost:close-the-loop",
  },

  // ---- STALLER: the objective is finding out which delay this actually is ----
  {
    id: "foundation:isolate-the-delay",
    archetype: "STALLER",
    channels: ["phone", "in_person", "follow_up", "proposal"],
    title: "ISOLATE THE DELAY",
    responseFamily: "isolate_concern",
    spokenLine: null,
    discoveryQuestion:
      "Is it the timing specifically, or is something about the offer unresolved?",
    principle:
      "A delay can be timing, an unspoken objection, or a polite no. They need different responses.",
    sourceReference: "armory:foundation:staller:isolate-the-delay",
  },
  {
    id: "foundation:what-must-be-true",
    archetype: "STALLER",
    channels: ["in_person", "proposal", "follow_up"],
    title: "WHAT HAS TO BE TRUE",
    responseFamily: "surface_conditions",
    spokenLine: null,
    discoveryQuestion: "What would have to be true for this to be worth doing?",
    principle:
      "Naming the conditions turns a vague delay into a checkable list.",
    sourceReference: "armory:foundation:staller:what-must-be-true",
  },
  {
    id: "foundation:specific-date",
    archetype: "STALLER",
    channels: ["phone", "in_person", "follow_up"],
    title: "GET A SPECIFIC DATE",
    responseFamily: "specific_next_date",
    spokenLine: null,
    discoveryQuestion: "What date should I come back to you on?",
    principle:
      "A specific date is a real commitment that can be recorded; 'later' is not.",
    sourceReference: "armory:foundation:staller:specific-date",
  },
];

export function foundationWeaponsFor(input: {
  archetype: ObjectionArchetype;
  channel: SalesIntelChannel;
}): FoundationWeapon[] {
  return FOUNDATION_WEAPONS.filter(
    weapon =>
      weapon.archetype === input.archetype &&
      weapon.channels.includes(input.channel)
  );
}
