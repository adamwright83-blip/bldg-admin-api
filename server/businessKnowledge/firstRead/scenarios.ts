import type { PublicFinding } from "./publicResearch";
import type { ReasoningKey } from "./significance";
import type { Evidence } from "./synthesis";

/**
 * Reasoning scenarios: fictional owners (.example domains) whose work has a significance the evidence never states
 * outright. Some run a business that is a proving ground or a means to something else; some run a business that is
 * the whole point; some have a side project with no connection at all; one has almost nothing to go on. Each carries
 * a reviewer's key, used only to grade the reasoning afterwards: it never reaches the reasoning model.
 */

export type Scenario = {
  key: string;
  ownerName: string;
  today: Date;
  privateEvidence: Evidence[];
  publicFindings: PublicFinding[];
  reviewerKey: ReasoningKey;
};

const at = (iso: string) => new Date(`${iso}T15:00:00Z`);
const mail = (id: string, date: string, from: string, to: string, subject: string, text: string): Evidence => ({
  id, source: "gmail", at: at(date), dated: "activity", byOwner: true, title: subject, people: `from ${from} to ${to}`, text, ref: `scenario gmail ${id}`, url: null,
});
const file = (id: string, date: string, owner: string, name: string, text: string): Evidence => ({
  id, source: "drive", at: at(date), dated: "modified", byOwner: true, title: name, people: `owned by ${owner}; last edited by ${owner}`, text, ref: `scenario drive ${id}`, url: null,
});
const pub = (id: string, source: PublicFinding["source"], signal: string, date: string | null, text: string): PublicFinding => ({
  id, source, signal, at: date ? at(date) : null, text, url: `https://example.com/${id}`, identity: "certain",
});

const KOFI = "Kofi Mensah <kofi@mensahair.example>";
const LUCIA = "Lucia Benedetti <lucia@fornobenedetti.example>";
const MARCUS = "Marcus Bell <marcus@bellgrounds.example>";
const HANA = "Hana Sato <hana@onigirihana.example>";
const DEREK = "Derek Owens <derek.owens@mail.example>";
const PRIYA = "Priya Nair <priya.cleans@mail.example>";
const TODAY = at("2026-11-01");

export const SCENARIOS: Scenario[] = [
  {
    key: "hvac-proving-ground",
    ownerName: "Kofi Mensah",
    today: TODAY,
    privateEvidence: [
      mail("g1", "2026-10-28", KOFI, "Applications <apply@desertlaunch.example>", "Desert Launch cohort 9 application — DispatchPilot", "Attached is our application. I filled in the traction section with what we have so far and will update it before the interview."),
      mail("g2", "2026-10-20", KOFI, "Sam <sam@mensahair.example>", "No more paper tickets", "Sam, starting Monday every call goes through DispatchPilot, including after-hours. If it isn't in the app it didn't happen."),
      mail("g3", "2026-10-09", KOFI, "Dana Ruiz <dana@saasadvisors.example>", "Re: pricing", "Dana, I'd rather charge per technician than per shop. Shops our size have three to five techs."),
      mail("g4", "2026-09-30", KOFI, "Supply House <orders@coolsupply.example>", "Order 4471", "Two condenser fan motors for Monday's jobs, please."),
      file("d1", "2026-10-30", "kofi@mensahair.example", "Mensah Air — callbacks and no-shows by month (sheet)", "Tab “2026”: Month | Jobs | Missed appointments | Callbacks\nJul | 212 | 19 | 14\nAug | 230 | 17 | 12\nSep | 241 | 9 | 7\nOct | 238 | 6 | 5"),
      file("d2", "2026-10-25", "kofi@mensahair.example", "DispatchPilot — roadmap (doc)", "Q4: route optimisation, customer texting, technician time tracking. Goal: 25 paying shops by June."),
      file("d3", "2026-08-02", "kofi@mensahair.example", "Mensah Air — service agreement template (doc)", "Annual maintenance agreement: two tune-ups, priority scheduling, 10% off repairs."),
      file("d4", "2026-10-27", "kofi@mensahair.example", "Mensah Air — 2026 budget notes (doc)", "DispatchPilot hosting and the contract developer come out of Mensah Air's margin. The shop runs near break-even until DispatchPilot has paying shops."),
    ],
    publicFindings: [
      pub("p1", "places", "listing", null, "Mensah Air (HVAC contractor), Phoenix, AZ, rated 4.8 from 167 reviews"),
      pub("p2", "x", "repost", "2026-10-15", "@kofimensah reposted a thread: 'the best vertical SaaS founders ran the business first — dogfood it until the numbers speak'."),
      pub("p3", "web", "press", "2026-09-12", "Local business journal: Phoenix HVAC owner Kofi Mensah among finalists for a trades-tech pitch night."),
    ],
    reviewerKey: {
      ultimateObjective: "Build DispatchPilot into a software company selling to other HVAC shops (getting into the accelerator, paying shops, likely funding).",
      roles: ["Mensah Air: income and the proving ground where DispatchPilot is tested", "DispatchPilot: the end goal"],
      keyResult: "Mensah Air's missed appointments / callbacks falling since DispatchPilot took over dispatch: proof for the accelerator's traction section and paying shops.",
      mustNot: ["say he is closing or selling Mensah Air", "state funding as certain or as a feeling", "say Mensah Air is losing money, in debt or failing"],
      businessIsTheEnd: false,
    },
  },
  {
    key: "bakery-end-in-itself",
    ownerName: "Lucia Benedetti",
    today: TODAY,
    privateEvidence: [
      mail("g1", "2026-10-26", LUCIA, "Tom Reyes <tom@harborcafes.example>", "Wholesale — eight cafés", "Tom, we can do the cannoli and the sfogliatelle for all eight locations, delivered Tuesdays and Fridays. Gina will run the wholesale side."),
      mail("g2", "2026-10-15", LUCIA, "Atty. Moretti <moretti@moretti-law.example>", "Transfer of ownership", "Ralph, let's set up the gradual transfer of Forno Benedetti to Gina over five years, the way we discussed."),
      mail("g3", "2026-10-04", LUCIA, "Deck Ovens Inc <sales@deckovens.example>", "Second deck oven lease", "We'll take the 36-month lease on the second oven if delivery can be before Thanksgiving."),
      file("d1", "2026-10-29", "lucia@fornobenedetti.example", "Forno — monthly P&L 2026 (sheet)", "Tab “P&L”: Month | Retail | Wholesale | Margin\nAug | 41,200 | 6,100 | 14%\nSep | 39,800 | 7,400 | 15%\nOct | 40,500 | 9,900 | 17%"),
      file("d2", "2026-09-18", "lucia@fornobenedetti.example", "Holiday orders 2026 (doc)", "Christmas Eve: 340 panettone pre-orders. Feast of the Seven Fishes: 60 trays."),
      file("d3", "2026-07-02", "lucia@fornobenedetti.example", "Recipes — Nonna's binder (doc)", "Sfogliatelle dough: rest overnight. Never rush the lard."),
    ],
    publicFindings: [
      pub("p1", "places", "listing", null, "Forno Benedetti (bakery), Providence, RI, rated 4.9 from 812 reviews, open since 2004"),
      pub("p2", "web", "post", "2026-10-20", "Forno Benedetti's Instagram: photo of Lucia and her daughter Gina at the counter, 'twenty-two years and the second generation is here'."),
    ],
    reviewerKey: {
      ultimateObjective: "Keep Forno Benedetti thriving and hand it to her daughter Gina.",
      roles: ["Forno Benedetti: the end in itself", "wholesale to Harbor Cafés: growth that makes the bakery strong enough to support the next generation (Gina runs it)"],
      keyResult: "Wholesale revenue and margin growing (Aug→Oct) so the bakery can carry Gina, ahead of the five-year transfer.",
      mustNot: ["invent a tech product, a startup, fundraising or an exit", "call the recipe binder a business"],
      businessIsTheEnd: true,
    },
  },
  {
    key: "landscaper-unrelated-band",
    ownerName: "Marcus Bell",
    today: TODAY,
    privateEvidence: [
      mail("g1", "2026-10-27", MARCUS, "Luis Ortega <luis.o@mail.example>", "Foreman position", "Luis, the foreman job is yours if you want it. You'd run the second crew starting in March."),
      mail("g2", "2026-10-18", MARCUS, "Trailer Depot <sales@trailerdepot.example>", "Second enclosed trailer", "Quote looks good. We'll finance the 7x16 for the second crew."),
      mail("g3", "2026-10-11", MARCUS, "Jess <jess@thelowtide.example>", "Saturday gig", "Load-in is at 7 at the Dockside. I'll bring the bass amp."),
      mail("g4", "2026-09-29", MARCUS, "Greenway HOA <board@greenwayhoa.example>", "Re: grounds contract renewal", "Thanks for renewing for 2027. We'll add the leaf removal you asked for."),
      file("d1", "2026-10-30", "marcus@bellgrounds.example", "Bell Grounds — crews and accounts (sheet)", "Tab “Accounts”: Crew | Accounts | Weekly hours\nCrew 1 | 38 | 52\nCrew 2 (March) | 0 | 0\nWaitlist | 14 | —"),
      file("d2", "2026-10-12", "marcus@bellgrounds.example", "The Low Tide — setlist (doc)", "Fall setlist: 14 songs, two originals."),
    ],
    publicFindings: [
      pub("p1", "places", "listing", null, "Bell Grounds (landscaper), Charlotte, NC, rated 4.7 from 88 reviews"),
      pub("p2", "web", "listing", "2026-10-10", "The Low Tide (cover band) playing the Dockside, Charlotte, Saturday."),
    ],
    reviewerKey: {
      ultimateObjective: "Grow Bell Grounds: a second crew by March to serve the waitlist.",
      roles: ["Bell Grounds: the end in itself", "The Low Tide: a personal side interest with no shown connection to the business"],
      keyResult: "Second crew running in March to clear the 14-account waitlist (foreman hired, trailer financed).",
      mustNot: ["connect the band to the business (marketing, funding, customers)", "invent a hidden ambition beyond the business"],
      businessIsTheEnd: true,
    },
  },
  {
    key: "food-truck-means",
    ownerName: "Hana Sato",
    today: TODAY,
    privateEvidence: [
      mail("g1", "2026-10-24", HANA, "Beth Kim <beth@pdxretail.example>", "Re: 1,100 sq ft on Alberta St", "Beth, could the landlord hold it until February? I'll have the rest of the down payment by then."),
      mail("g2", "2026-10-16", HANA, "Events <events@techco.example>", "Catering — 120 people", "Yes to the Friday lunch, 120 onigiri boxes. Deposit invoice attached."),
      mail("g3", "2026-10-02", HANA, "Mom <yoko.sato@mail.example>", "the counter", "Mom, I measured — Grandpa's counter would fit along the window if we get the Alberta space."),
      file("d1", "2026-10-31", "hana@onigirihana.example", "Restaurant fund (sheet)", "Tab “Savings”: Month | Truck profit | Catering | Saved | Total\nJul | 3,100 | 900 | 3,400 | 18,200\nAug | 3,400 | 1,800 | 4,600 | 22,800\nSep | 2,900 | 2,600 | 4,900 | 27,700\nOct | 3,200 | 4,100 | 6,500 | 34,200\nTarget: 52,000"),
      mail("g4", "2026-10-30", HANA, "Rose City Commissary <billing@rosecitycommissary.example>", "October", "Truck profit this month covers my own pay but not the commissary fee and propane, so I'm paying both from the restaurant fund this once. Payment sent today."),
      file("d2", "2026-09-20", "hana@onigirihana.example", "Onigiri Hana — truck schedule (doc)", "Tue/Thu: Pioneer Square. Sat: farmers market. Catering on request."),
    ],
    publicFindings: [
      pub("p1", "places", "listing", null, "Onigiri Hana (food truck), Portland, OR, rated 4.9 from 241 reviews"),
      pub("p2", "web", "post", "2026-10-22", "Onigiri Hana's Instagram: 'Catering season is here — book us for your office!'"),
    ],
    reviewerKey: {
      ultimateObjective: "Open a brick-and-mortar Onigiri Hana restaurant (the Alberta St space).",
      roles: ["the food truck: the means (funds the restaurant, builds the following)", "catering: the fastest-growing source of savings"],
      keyResult: "Reaching the $52,000 down payment by February (34,200 as of Oct 31); catering is what is accelerating it.",
      mustNot: ["say she wants to close the truck", "state family feelings as fact", "say any bill is unpaid or that she owes money"],
      businessIsTheEnd: false,
    },
  },
  {
    key: "rideshare-to-real-estate",
    ownerName: "Derek Owens",
    today: TODAY,
    privateEvidence: [
      mail("g1", "2026-10-29", DEREK, "Exam Services <exams@psiexams.example>", "Re: exam date", "Confirming my real estate salesperson exam on November 18 at 9am."),
      mail("g2", "2026-10-21", DEREK, "Carla Diaz <carla@sunbeltrealty.example>", "Coffee next week?", "Carla, thanks for offering to talk about joining Sunbelt once I'm licensed. Tuesday works."),
      mail("g3", "2026-10-14", DEREK, "Mrs. Patel <patel.home@mail.example>", "Fence repair", "I can fix the fence panels Saturday morning, $180 including materials."),
      file("d1", "2026-10-30", "derek.owens@mail.example", "Weekly earnings (sheet)", "Tab “Oct”: Week | Rideshare | Handyman | Total\n1 | 640 | 180 | 820\n2 | 590 | 360 | 950\n3 | 610 | 0 | 610\n4 | 520 | 240 | 760"),
      file("d2", "2026-10-27", "derek.owens@mail.example", "RE exam flashcards (doc)", "Agency, fiduciary duties, contracts, Texas Real Estate Commission rules — 412 cards."),
    ],
    publicFindings: [],
    reviewerKey: {
      ultimateObjective: "Become a licensed real estate agent (joining Sunbelt Realty).",
      roles: ["rideshare and handyman work: income while he transitions"],
      keyResult: "Passing the November 18 exam (then joining Sunbelt).",
      mustNot: ["treat the handyman work as his main ambition", "state he hates driving or similar feelings as fact"],
      businessIsTheEnd: false,
    },
  },
  {
    key: "thin-evidence-cleaner",
    ownerName: "Priya Nair",
    today: TODAY,
    privateEvidence: [
      mail("g1", "2026-10-25", PRIYA, "Mrs. Lin <lin.family@mail.example>", "Thursday", "I can come Thursday at 10 instead of Wednesday."),
      mail("g2", "2026-10-18", PRIYA, "Joe <joe.k@mail.example>", "Invoice", "Here's October's invoice, four cleans at $120."),
      file("d1", "2026-10-30", "priya.cleans@mail.example", "Clients (sheet)", "Tab “Clients”: Name | Day | Rate\nLin | Wed | 120\nKowalski | Fri | 120\nOkafor | alt Mon | 140"),
    ],
    publicFindings: [],
    reviewerKey: {
      ultimateObjective: "Unknown from the evidence: she runs a small residential cleaning practice; no larger objective is shown.",
      roles: ["the cleaning work: her business; whether it is the end or a means is not shown"],
      keyResult: "Unclear; at most keeping her regular clients scheduled. Should say the evidence is thin.",
      mustNot: ["invent an ambition, an expansion plan, a side project or fundraising"],
      businessIsTheEnd: true,
    },
  },
];
