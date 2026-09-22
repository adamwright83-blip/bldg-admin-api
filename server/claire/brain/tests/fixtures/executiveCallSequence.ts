/**
 * Sanitized, deterministic replay of the production Claire call that opened
 * around 2026-09-22 08:50 AM PDT (conversation b9938fe9-ae81-4500-a535-223fcea3fbe7).
 *
 * Operator turns only. Claire's live replies are not reproduced: this fixture
 * drives Brain V2 cognition. It does not call Railway, the ledger, or a tenant row.
 * Names that appear here are fixture data. They must not be copied into generic
 * classifiers, task-set kinds, or grant classes.
 */

export const PRODUCTION_CALL_ID = "b9938fe9-ae81-4500-a535-223fcea3fbe7";

/** Pending item Claire was still holding when the operator changed subjects. */
export const STALE_PENDING_TITLE =
  "Drop Century Park East order for Ryan off at the dry cleaner";

export const EXECUTIVE_CALL_TURNS = {
  dropOff: "I am on my way to drop off an order for John.",
  centuryPark: "And then I have to go to Century Park East.",
  hem: "To pick up an order I dropped off last night because it was processed incorrectly by my dry cleaner. So I have to take it back to them and get it hemmed.",
  tuesdayRun:
    "And then I'm picking up before I go back to my dry cleaner, once I'm at the York East, I'm gonna go to Kitts Treats on Rodeo Drive to pick up the aprons that I do every Tuesday, and then I'm gonna go to Opus LA in Koreatown to pick up Jim Powell's, which I do every Tuesday, Thursday, and Saturday.",
  confirmStops: "Yes",
  ryanStop:
    "And then after all that, I have to obviously drop the Century Park East order for Ryan off at the dry cleaner.",
  metaFragment:
    "In East Hollywood then after that, I'm going home to Los Feliz to continue work on publishing a meta ad, and I want this meta ad",
  missionContinuation: "considered as my mission today.",
  missionRepair: "No. I'm telling you that today, I have a mission that I need you to be aware of.",
  listen: "No. Listen to me.",
  postAd: "I have to post a meta ad for Instagram. I have to post an ad.",
} as const;
