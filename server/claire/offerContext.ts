/**
 * PR1 Claire Intelligence Repair -- corrective pass 3 (real-exam finding).
 *
 * WHY THIS EXISTS
 *
 * The post-corrective real exam had Claire coaching the operator to ask
 * whether a property's laundry is "in-house, third party, or coin-op they
 * own outright", to handle price objections "if they're comparing to
 * in-unit machines", and to "ask when it renews" if there's a contract in
 * place. That is the sales model of a laundry EQUIPMENT / route vendor
 * placing machines in a building's laundry room. It is not this business.
 *
 * Root cause, established by dumping the actual assembled system prompt
 * the production path builds (not by reading code and assuming): the
 * prompt contained ZERO grounding about what Goldline actually sells --
 * no occurrence of "wash", "fold", "pickup", "delivery", "resident",
 * "amenity", or "offer" anywhere in 10,475 characters.
 * `formatCapabilityBriefing()` describes Goldline's SOFTWARE actions
 * (dayline.create, commercial.visit_outcome.record, ...), not the
 * commercial offer. `MissionSalesBrief` carries an approach
 * (primaryObjective / questionsToAsk / thingsToAvoid) but never states
 * the offer either -- and it only exists when a missionId is in play.
 * With nothing telling her otherwise, the model filled the gap from
 * pretraining with a generic laundry-industry sales model.
 *
 * WHAT IS ASSERTED HERE, AND ON WHAT EVIDENCE
 *
 * Every line below is derived from verifiable artifacts in this repo, not
 * from inference about the business:
 *  - `serviceType: "wash_fold"` is the default service on a resident order
 *    (server/agents/tools/createLaundryOrderTool.ts).
 *  - Same-day return in a 7-9 PM delivery window is stated as authoritative
 *    in that same tool, in a comment citing a real production defect
 *    ("Laundry Butler returns SAME DAY, 7-9 PM").
 *  - The order carries a resident's own address, unit, name, phone and
 *    Stripe payment method -- i.e. the INDIVIDUAL RESIDENT is the paying
 *    customer, not the building.
 *  - Orders carry a `buildingSlug`, and the macro goal is counted in
 *    "active customers" (residents), not buildings or installed machines.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED
 *
 * Pricing, contract terms, exclusivity, revenue share, and the exact
 * commercial arrangement offered to a property are NOT stated here,
 * because they are not established anywhere this module can verify. They
 * are explicitly marked unknown so Claire asks instead of inventing -- the
 * same truth boundary the rest of the system already enforces. This module
 * closes an invention gap; it does not launder unverified business terms
 * into the prompt.
 *
 * ADAM: the offer summary below is derived from code, not from you. If any
 * of it is wrong or incomplete, correct it here -- it is now load-bearing
 * for what Claire says on a real commercial visit.
 */
export const GOLDLINE_OFFER_CONTEXT = [
  "Goldline/Laundry Butler is a per-resident wash-and-fold laundry service with pickup and return.",
  "The paying customer is the individual resident. The business does not sell, lease, install, or service laundry machines.",
  "The arrangement offered to a property is NOT established in your context. Do not invent terms or coach equipment discovery.",
].join(" ");
