/**
 * Nina's invented sample, as the prototype's two paper artifacts and its invitation. The words are quoted from her
 * fictional example corpus (shared/firstTenMinutesExampleCorpus.json: nina-m05, nina-m06, nina-m18). Nothing here
 * belongs to a real person or business, and nothing is sent anywhere.
 */
export const SAMPLE_LABEL = "Sample: Nina's flower studio, invented for this prototype. No accounts, no real recipients, nothing sent.";

export const THEN_PAPER = {
  heading: "April",
  items: [
    { who: "Elena Ruiz · The Larkspur Hotel", when: "Apr 18", words: "Could you do fresh arrangements every Friday? Lobby and the front desk, something that lasts the weekend." },
    { who: "Nina", when: "Apr 19", words: "We're only doing events at the moment. Ask me again once we have a Friday delivery." },
  ],
} as const;

export const NOW_PAPER = {
  heading: "September",
  items: [
    {
      who: "Nina",
      when: "Sep 3",
      words: "Starting this month, Wildroot has a weekly Friday delivery: fresh arrangements for shops, cafés and hotels, delivered every Friday morning around Silver Lake.",
    },
  ],
} as const;

/** What the desk underlines, each quoted from its paper: April's promise, and September's fact. */
export const PROMISE = "Ask me again once we have a Friday delivery.";
export const FACT = "weekly Friday delivery";

/** The old invitation the courier carries: Elena's April message, which opens once it has made its journey. */
export const INVITATION = { from: "Elena Ruiz · The Larkspur Hotel", when: "Apr 18", subject: "Friday flowers?", words: THEN_PAPER.items[0].words } as const;

/** "Prepare a reply" produces only this, labelled as a sample. */
export const SAMPLE_DRAFT =
  "Hi Elena — you asked earlier this year about Friday flowers. We now have a weekly Friday delivery. Is that still something you're looking for at the hotel?";

export const PLACE_NAMES = {
  letters: { S: "Wildroot Flowers", H: "The Larkspur Hotel" },
  neutral: { S: "Studio", H: "Hotel" },
} as const;
