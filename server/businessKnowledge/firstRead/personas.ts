import type { PublicFinding } from "./publicResearch";
import type { Evidence } from "./synthesis";

/**
 * Synthetic owners for the reveal: fictional people, businesses and domains (.example), written to resemble the
 * independent operators JOYSTICK is for. They test the reasoning, not retrieval: their "public" findings stand in for
 * what the public stream would return. Each carries a trap (a namesake, fictional characters, two businesses that
 * must stay separate) and an ambition visible only when private and public evidence meet.
 */

export type Persona = {
  key: string;
  ownerName: string;
  ownerEmail: string;
  today: Date;
  privateEvidence: Evidence[];
  publicFindings: PublicFinding[];
  /** what the identity check threw out (shown in the report, never given to the model) */
  rejectedPublic: Array<{ text: string; why: string }>;
  /** what a perceptive first meeting should land on: for the reviewer, never shown to the model */
  shouldRecognise: string[];
  traps: string[];
};

const at = (iso: string) => new Date(`${iso}T15:00:00Z`);
const mail = (id: string, date: string, to: string, subject: string, text: string, owner: string): Evidence => ({
  id,
  source: "gmail",
  at: at(date),
  dated: "activity",
  byOwner: true,
  title: subject,
  people: `from ${owner} to ${to}`,
  text,
  ref: `synthetic gmail ${id}`,
  url: null,
});
const file = (id: string, date: string, name: string, text: string, owner: string): Evidence => ({
  id,
  source: "drive",
  at: at(date),
  dated: "modified",
  byOwner: true,
  title: name,
  people: `owned by ${owner}; last edited by ${owner}`,
  text,
  ref: `synthetic drive ${id}`,
  url: null,
});
const found = (id: string, source: PublicFinding["source"], signal: string, date: string | null, text: string, url: string): PublicFinding => ({
  id,
  source,
  signal,
  at: date ? at(date) : null,
  text,
  url,
  identity: "certain",
});

const MARISOL = "Marisol Ortiz <marisol@deltalineplumbing.example>";
const DEV = "Dev Raman <dev@spincitylaundry.example>";
const TASHA = "Tasha Greene <tasha@greenecurrent.example>";

export const PERSONAS: Persona[] = [
  {
    key: "plumber",
    ownerName: "Marisol Ortiz",
    ownerEmail: "marisol@deltalineplumbing.example",
    today: at("2026-10-31"),
    privateEvidence: [
      mail("g1", "2026-10-22", "Ken Alvarez <kalvarez@harlanpg.example>", "Repipe proposal — Harlan Property Group, Fair Oaks units", "Ken, attached is the repipe proposal for the 14 Fair Oaks units. We can start the week of Nov 10 with two crews and finish before Thanksgiving.", MARISOL),
      mail("g2", "2026-10-14", "Ruben Ortiz <ruben@deltalineplumbing.example>", "Truck 2 schedule", "Ruben, I moved the Carmichael water heater to Thursday so you can take the apprentice on the Harlan walkthrough.", MARISOL),
      mail("g3", "2026-09-30", "SBA desk <sba@goldenonecu.example>", "SBA 7(a) pre-qualification — Delta Line Plumbing", "Following up on the 7(a) pre-qualification. The use of funds is a third service truck and buildout of a training bay at our Rancho Cordova shop.", MARISOL),
      mail("g4", "2026-10-03", "Coach Alvarez <galvarez@riocosumnes-hs.example>", "Career day — thank you", "Thank you for having me at career day. Four of your seniors asked about apprenticeships; I'd like to set up a summer pre-apprentice program with you.", MARISOL),
      mail("g5", "2024-05-12", "Sac Home Show <booth@sachomeshow.example>", "Booth renewal", "We won't be renewing the booth this year; it didn't bring in enough leads.", MARISOL),
      file("d1", "2026-10-28", "Delta Line Trade School — program outline (doc)", "Delta Line Trade School. A 16-week pre-apprentice program in our Rancho Cordova training bay: pipe fitting, water heaters, drain cleaning, safety. First cohort: 6 students, summer 2027.", "marisol@deltalineplumbing.example"),
      file("d2", "2026-10-30", "Jobs Oct 2026 (sheet)", "Tab “October”: Date | Customer | Job | Tech | Amount\n10/28 | Harlan PG | Repipe walkthrough | Ruben | 0\n10/29 | Carmichael | Water heater | Ruben | 2,450\n10/30 | Fair Oaks | Slab leak | Marisol | 3,900", "marisol@deltalineplumbing.example"),
      file("d3", "2023-02-09", "Hydro-jetting side business plan (doc)", "Plan for a separate hydro-jetting company, Sierra Jetting, with its own truck and website.", "marisol@deltalineplumbing.example"),
    ],
    publicFindings: [
      found("p1", "places", "listing", null, "Delta Line Plumbing (plumber), Rancho Cordova, CA, rated 4.9 from 318 reviews, website deltalineplumbing.example", "https://maps.example/delta-line"),
      found("p2", "web", "self-description", null, "Delta Line Plumbing's site: family-owned since 2015, two trucks, serving Sacramento County.", "https://deltalineplumbing.example"),
      found("p3", "web", "post", "2026-10-05", "Delta Line Plumbing's Facebook page: \"We're hiring an apprentice. No experience needed — we'll teach you.\"", "https://facebook.example/deltaline/posts/1"),
      found("p4", "web", "press", "2026-10-04", "Rio Cosumnes High School newsletter: local plumber Marisol Ortiz spoke at career day about apprenticeships for women in the trades.", "https://riocosumnes-hs.example/news"),
      found("p5", "web", "post", "2026-09-18", "Delta Line Plumbing reshared a state announcement of new apprenticeship grants for small contractors.", "https://facebook.example/deltaline/posts/2"),
    ],
    rejectedPublic: [{ text: "Marisol Ortiz, realtor, Sacramento (Coldwell listing)", why: "same name, no shared anchor" }],
    shouldRecognise: [
      "She runs Delta Line Plumbing (two trucks, Ruben on the second) and is landing a 14-unit repipe for Harlan Property Group.",
      "The thing she is really building is a trade school: Delta Line Trade School, first cohort summer 2027, a training bay in Rancho Cordova.",
      "The SBA loan is about the school and a third truck, not just growth; apprenticeship grants and the career day point the same way.",
    ],
    traps: ["a namesake realtor", "the old hydro-jetting plan is past, not current", "Ruben is family and staff, not a separate business"],
  },
  {
    key: "laundromat",
    ownerName: "Dev Raman",
    ownerEmail: "dev@spincitylaundry.example",
    today: at("2026-10-31"),
    privateEvidence: [
      mail("g1", "2026-10-25", "Priya Shah <priya@northloopstudio.example>", "FoldRun pilot — Bellaire store", "Priya, let's run the FoldRun pickup pilot at the Bellaire store first. Twenty households, two drivers, starting Nov 15.", DEV),
      mail("g2", "2026-10-19", "Marco <marco@dexterservice.example>", "Dryers 7 and 9 again", "Marco, dryers 7 and 9 at Westheimer are down again. Third time this month. Can you come Tuesday?", DEV),
      mail("g3", "2026-10-08", "Lena Cho <lcho@gulfcoastbizbrokers.example>", "Re: what would the two stores sell for", "Lena, thanks for the numbers. I'm not selling yet. I want to see what the stores are worth with pickup and delivery running first.", DEV),
      mail("g4", "2026-09-12", "Coach Patel <coach@bellairecricket.example>", "Jerseys", "The SpinCity jerseys are paid for. Good luck Saturday.", DEV),
      file("d1", "2026-10-29", "FoldRun — product spec v3 (doc)", "FoldRun: a pickup-and-delivery app for independent laundromats. Pilot at SpinCity Bellaire, then license to other owners at $299 a month.", "dev@spincitylaundry.example"),
      file("d2", "2026-10-21", "SpinCity valuation (sheet)", "Tab “Multiples”: Store | Revenue | Multiple | Value\nWestheimer | 412,000 | 3.1 | 1,277,200\nBellaire | 368,000 | 3.1 | 1,140,800\nTab “With delivery”: Bellaire | 498,000 | 3.6 | 1,792,800", "dev@spincitylaundry.example"),
      file("d3", "2025-03-02", "Food truck idea (doc)", "Notes on a dosa food truck. Parked.", "dev@spincitylaundry.example"),
    ],
    publicFindings: [
      found("p1", "places", "listing", null, "SpinCity Laundry Westheimer (laundromat), Houston, TX, rated 3.9 from 211 reviews", "https://maps.example/spincity-westheimer"),
      found("p2", "places", "listing", null, "SpinCity Laundry Bellaire (laundromat), Houston, TX, rated 4.6 from 154 reviews", "https://maps.example/spincity-bellaire"),
      found("p3", "web", "review", "2026-10-20", "A Yelp review of SpinCity Westheimer: \"half the dryers were out again.\"", "https://yelp.example/spincity-westheimer"),
      found("p4", "x", "repost", "2026-10-17", "@devraman reposted a thread on private equity firms rolling up independent laundromats at 4x+ multiples.", "https://x.example/devraman/status/1"),
      found("p5", "x", "repost", "2026-09-29", "@devraman reposted a post about vertical SaaS for laundromats being an overlooked market.", "https://x.example/devraman/status/2"),
      found("p6", "web", "profile", null, "Instagram @spincitylaundry: sponsor of the Bellaire youth cricket team.", "https://instagram.example/spincitylaundry"),
    ],
    rejectedPublic: [{ text: "Dev Raman, software engineer, Seattle (GitHub)", why: "same name, no shared anchor" }],
    shouldRecognise: [
      "He owns two SpinCity laundromats in Houston; Westheimer is the problem child (dryers keep failing, the reviews show it).",
      "He is quietly building FoldRun, a pickup app he plans to license to other laundromat owners, piloting at Bellaire with Priya's studio.",
      "He's working out what the stores are worth with delivery on (and has a broker's numbers); an exit or a raise is on his mind, but he says not yet.",
    ],
    traps: ["a namesake engineer", "the food truck is parked, not current", "FoldRun and the laundromats connect only through the Bellaire pilot"],
  },
  {
    key: "electrician",
    ownerName: "Tasha Greene",
    ownerEmail: "tasha@greenecurrent.example",
    today: at("2026-10-31"),
    privateEvidence: [
      mail("g1", "2026-10-27", "Partnerships <partners@chargewell.example>", "Re: sponsored install series", "Happy to do the six-episode install series. My rate is $4,500 an episode and I keep editorial control.", TASHA),
      mail("g2", "2026-10-16", "Jerome Watts <jerome@greenecurrent.example>", "Monday jobs", "Jerome, you've got the panel upgrade in Decatur and the EV charger in Kirkwood. I'm filming Monday.", TASHA),
      mail("g3", "2026-10-02", "Atlanta Tech College <ce@atlantatech.example>", "Continuing-ed course proposal", "Attached is my proposal for an 8-week EV charger installation course for licensed electricians.", TASHA),
      file("d1", "2026-10-30", "Charge Ready Academy — course outline (doc)", "Charge Ready Academy: an online course for electricians moving into EV charger installs. 12 modules, launch March 2027, $397.", "tasha@greenecurrent.example"),
      file("d2", "2026-10-25", "Sparky Finds the Breaker — draft (doc)", "A picture book. Sparky, a small spark, gets lost in a house's wiring; Volta the owl teaches him to find the breaker.", "tasha@greenecurrent.example"),
      file("d3", "2026-10-29", "Jobs & filming calendar (sheet)", "Tab “Nov”: Date | Job | Crew | Filming\n11/3 | Decatur panel | Jerome | no\n11/3 | Kirkwood EV | Jerome | yes", "tasha@greenecurrent.example"),
    ],
    publicFindings: [
      found("p1", "places", "listing", null, "Greene Current Electric (electrician), Atlanta, GA, rated 4.8 from 96 reviews", "https://maps.example/greene-current"),
      found("p2", "web", "profile", null, "YouTube channel Greene Current: 41,000 subscribers, EV charger installation tutorials.", "https://youtube.example/greenecurrent"),
      found("p3", "x", "post", "2026-10-21", "@greenecurrent posted a thread of tips for passing the Georgia electrical licensing exam.", "https://x.example/greenecurrent/status/1"),
      found("p4", "x", "repost", "2026-10-12", "@greenecurrent reposted a creator-economy thread on turning a YouTube audience into a paid course.", "https://x.example/greenecurrent/status/2"),
      found("p5", "x", "repost", "2026-09-26", "@greenecurrent reposted a post on burnout among tradespeople who still do every job themselves.", "https://x.example/greenecurrent/status/3"),
    ],
    rejectedPublic: [{ text: "Tasha Greene, nurse practitioner, Atlanta (hospital profile)", why: "same name, no shared anchor" }],
    shouldRecognise: [
      "She runs Greene Current Electric with Jerome doing more of the field work, while she films.",
      "Her real move is from wiring houses to teaching: Charge Ready Academy (March 2027), the Atlanta Tech course, the sponsored series.",
      "She is also writing a picture book, Sparky Finds the Breaker (Sparky and Volta are its characters, not people).",
    ],
    traps: ["a namesake nurse", "Sparky and Volta are fiction inside the book", "don't call burnout a fact about her feelings"],
  },
];
