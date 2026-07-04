import { ChevronDown, Swords } from "lucide-react";
import { useState } from "react";
import "./canonical-sections.css";

const ASSET = "/assets/boreslay-sections";

const REPLAY = [
  {
    image: "replay-stake.webp",
    step: "1 · AT STAKE",
    time: "7:02 AM",
    lines: [
      "A former customer has gone quiet.",
      "One invoice is 42 days overdue.",
      "Thursday still has three open service slots.",
    ],
    result: "$640 SITTING UNCOLLECTED",
  },
  {
    image: "replay-deployed.webp",
    step: "2 · MISSION DEPLOYED",
    time: "7:04 AM",
    lines: [
      "Closer sends the win-back offer.",
      "Treasurer follows up on the overdue invoice.",
      "Guardian queues a review request for a recently completed job.",
    ],
    result: "OWNER INPUT: 2 TAPS",
  },
  {
    image: "replay-reply.webp",
    step: "3 · CUSTOMER REPLIES",
    time: "9:41 AM",
    lines: [
      "Customer message:",
      "“Yes! Thursday works.”",
      "The customer is back on the schedule. Closer keeps the thread moving without making the owner chase it.",
    ],
    result: "WIN-BACK BOOKED · +$180",
  },
  {
    image: "replay-payment.webp",
    step: "4 · INVOICE PAID",
    time: "11:15 AM",
    lines: [
      "PAYMENT RECEIVED",
      "Invoice #1047",
      "Money the business already earned is finally in the bank.",
    ],
    result: "+$460 RECOVERED",
  },
  {
    image: "replay-rift.webp",
    step: "5 · BOSS CALL / REALITY RIFT",
    time: "2:15 PM",
    lines: [
      "A valuable conversation needs a human.",
      "BORESLAY calls the owner in with the account history, the objection, and the next line ready.",
      "MEETING SET · THURSDAY",
    ],
    result: "ESTIMATE BACK IN PLAY · $740",
    violet: true,
  },
  {
    image: "replay-complete.webp",
    step: "6 · MISSION COMPLETE",
    time: "6:31 PM",
    lines: [
      "Win-back booked: +$180",
      "Invoice recovered: +$460",
      "Estimate back in play: $740",
      "Meeting scheduled: Thursday",
      "OWNER TIME: 2 TAPS + 1 PHONE CALL · APPROX. 11 MINUTES",
    ],
    result: "BANKED TODAY · $640",
  },
];

const CREW = [
  {
    slug: "closer",
    name: "CLOSER",
    title: "THE DEAL MAKER",
    realm: "LAUNDRY · FLUFF & FOLD",
    intro:
      "Turns warm interest into booked orders. Never tired. Never awkward. Never forgets to follow up.",
    ability: "FOLLOW-THROUGH",
    abilityCopy: "Locks in the jobs everyone else lets drift away.",
    beforeTime: "8:10 AM",
    beforeTitle: "THE MESSAGE LANDS",
    beforeBody:
      "Hi Samantha — it’s been a while since your last pickup. Book this week and we’ll take care of your bedding for free. Want it?",
    beforeTag: "4 MONTHS QUIET",
    beforeCaption:
      "After yoga, Samantha receives a useful offer at exactly the right moment.",
    afterTime: "9:02 AM",
    afterTitle: "NEW ORDER",
    afterBody: "SAMANTHA JUST PLACED AN ORDER · Laundry · Fluff & Fold",
    afterResult: "+$53 BOOKED",
    afterCaption:
      "The operator looks at the screen with the same thought every owner wants to have: That mission actually worked.",
  },
  {
    slug: "treasurer",
    name: "TREASURER",
    title: "THE MONEY KEEPER",
    realm: "COMMERCIAL CLEANING",
    intro:
      "Turns unpaid invoices into collected cash. Separates booked revenue from money that actually reached the bank.",
    ability: "CASH RECOVERY",
    abilityCopy: "Recovers what other businesses quietly give up on.",
    beforeTime: "11:18 AM",
    beforeTitle: "THE REMINDER LANDS",
    beforeBody:
      "Quick note on invoice #1047 for $1,420. It is now 42 days past due. You can review and pay it here: [PAYMENT LINK] Thank you.",
    beforeTag: "42 DAYS OPEN",
    beforeCaption:
      "The office has already been cleaned. The invoice simply slipped through a busy accounts-payable department.",
    afterTime: "1:41 PM",
    afterTitle: "PAYMENT RECEIVED",
    afterBody: "Commercial cleaning · Invoice #1047",
    afterResult: "+$1,420 RECOVERED",
    afterCaption:
      "The commercial-cleaning founder looks at her phone in disbelief. The work was already done. Treasurer made sure the money followed.",
  },
  {
    slug: "guardian",
    name: "GUARDIAN",
    title: "THE REPUTATION PROTECTOR",
    realm: "HVAC SERVICES",
    intro:
      "Turns satisfied customers into visible proof. Builds the reputation that helps the next customer say yes.",
    ability: "REPUTATION ARMOR",
    abilityCopy:
      "Protects your name and compounds the trust you already earned.",
    beforeTime: "6:45 PM",
    beforeTitle: "THE REVIEW REQUEST LANDS",
    beforeBody:
      "JOHN FRANK’S TOP HVAC — Thanks for trusting us today. If we earned it, would you leave an honest review? We’ll donate 10% of our next booking to a charity of your choice. [LEAVE A REVIEW]",
    beforeTag: "PERSONAL. SIMPLE. EASY TO ANSWER.",
    beforeCaption:
      "A stay-at-home mother receives the request while preparing lunch for her children.",
    afterTime: "7:32 PM",
    afterTitle: "NEW 5-STAR REVIEW",
    afterBody:
      "★★★★★ Fast, honest, and fixed it right the first time. Highly recommend. — Samantha R.",
    afterResult: "REPUTATION EARNED. TRUST COMPOUNDED.",
    afterCaption:
      "The HVAC operator sees the review while working on the next customer’s air-conditioning unit.",
  },
];

const REALMS = [
  {
    slug: "sunbright",
    name: "SUNBRIGHT ISLES",
    tagline: "Bright. Fast. Opportunity everywhere.",
    engine: "NEW-CUSTOMER ACQUISITION",
    copy: "Scout reads the market like a treasure map: demand, open capacity, referrals, and prospects worth a first move.",
  },
  {
    slug: "wildwood",
    name: "WILDWOOD",
    tagline: "Deep. Untamed. Loyalty is power.",
    engine: "RETENTION & REACTIVATION",
    copy: "Customers rarely leave angry. They drift. The crew notices who disappeared and gives them a reason to return.",
  },
  {
    slug: "clockwork",
    name: "CLOCKWORK DEPTHS",
    tagline: "Precision. Timing. Nothing slips.",
    engine: "ESTIMATES, PAYMENTS & FOLLOW-UP",
    copy: "Every open estimate, overdue invoice, and “let me think about it” keeps moving until it is booked, paid, declined, or handed to you.",
  },
  {
    slug: "void",
    name: "THE VOID",
    tagline: "High stakes. High value. Human judgment required.",
    engine: "HIGH-VALUE PROSPECTS & LIVE CALLS",
    copy: "Some conversations are too important to automate. A Reality Rift opens. You enter. Sage makes sure you never walk in blind.",
  },
];

const FIRST_MISSION = [
  {
    image: "first-clock.webp",
    step: "1 · TEN MINUTES",
    title: "THE SELF-ISSUED CLOCK",
    body: "Clean jeans. Button-up shirt. Blazer. Leave in ten minutes. No villain gave the order. He gave it to himself.",
  },
  {
    image: "first-collateral.webp",
    step: "2 · THE COLLATERAL",
    title: "A BRAND THAT DIDN’T EXIST LAST MONTH",
    body: "He printed Laundry Butler flyers built for luxury high-rises, got in the car, and drove to Century City. The offer was simple: premium laundry and dry cleaning for residents, easy online ordering, and a black ribbon bow on every completed order.",
    tag: "COLLATERAL SECURED",
  },
  {
    image: "first-door.webp",
    step: "3 · ONE LINE. ONE DOOR.",
    title: "THE PITCH",
    body: "“I do revenue-share fluff-and-fold and dry cleaning for luxury high-rises. We tie a black ribbon bow on every order. I’d love to leave this for your property manager.” No perfect pitch. No giant campaign. One line. One door.",
  },
  {
    image: "first-result.webp",
    step: "THE RESULT",
    title: "FOUR WEEKS OF FOLLOW-UP LATER: YES.",
    body: "Residents of that building have placed: One outfit. One line. One door.",
    result: "$1,790 AND COUNTING",
    tag: "REAL REVENUE UNLOCKED",
  },
];

const FAQS = [
  [
    "I’m not technical. Can I actually run this?",
    "Yes. BORESLAY is built for owner-operators, not software teams. The crew turns the system work into clear missions, decisions, and next steps.",
  ],
  [
    "Is this a marketing agency?",
    "No. It is software with an AI crew inside it. You command missions instead of renting an account team.",
  ],
  [
    "What if it doesn’t pay for itself?",
    "The True Net ledger will say so. You see what a mission made, what was collected, and what it cost.",
  ],
  [
    "Do messages send without my approval?",
    "Not unless you explicitly enable that. Sensitive or high-impact outreach can remain gated behind your approval.",
  ],
  [
    "Am I signing a long-term contract?",
    "No. BORESLAY is month to month. The game has to earn next month.",
  ],
  [
    "Is the demo showing real customer activity?",
    "No. The public demo uses simulated threads and outcomes. Connected businesses run on their own live data and activity.",
  ],
  [
    "Will BORESLAY work outside laundromats?",
    "It is being built first in laundromats and service businesses, then expanded to owner-run businesses with the same follow-up, payment, retention, and sales fights.",
  ],
] as const;

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="bsc-header">
      <h2>{title}</h2>
      <p>{sub}</p>
    </header>
  );
}

function MissionReplay() {
  return (
    <section id="how" className="bsc-section bsc-replay">
      <div className="bsc-wide">
        <SectionHeader
          title="MISSION REPLAY: REAL WORK. REAL OUTCOMES."
          sub="One mission. Start to finish."
        />
        <p className="bsc-proof-label">
          SIMULATED WALKTHROUGH · REAL PRODUCT FLOW
        </p>
        <div className="bsc-replay-track">
          {REPLAY.map((beat, index) => (
            <article
              className={`bsc-replay-card${beat.violet ? " is-violet" : ""}`}
              key={beat.step}
            >
              <div className="bsc-card-top">
                <b>{beat.step}</b>
                <time>{beat.time}</time>
              </div>
              <img src={`${ASSET}/${beat.image}`} alt="" loading="lazy" />
              <div className="bsc-card-copy">
                {beat.lines.map(line => (
                  <p key={line}>{line}</p>
                ))}
                <strong>{beat.result}</strong>
              </div>
              {index < REPLAY.length - 1 && (
                <span className="bsc-arrow" aria-hidden="true">
                  →
                </span>
              )}
            </article>
          ))}
        </div>
        <div className="bsc-bottom-rail">
          <b>1 CREW</b>
          <span>·</span>
          <b>6 STEPS</b>
          <span>·</span>
          <b>$640 BANKED</b>
          <span>·</span>
          <b>APPROX. 11 MINUTES OF OWNER TIME</b>
        </div>
        <p className="bsc-closing">
          You never leave the game to go “do marketing.” The game is the doing.
        </p>
      </div>
    </section>
  );
}

function CrewWorkday() {
  return (
    <section id="crew" className="bsc-section bsc-crew">
      <div className="bsc-wide">
        <SectionHeader
          title="YOU JUST WATCHED THEIR WORKDAY. MEET THE CREW."
          sub="Three of them left receipts."
        />
        <p className="bsc-deck">
          Every mission is two phones. You have watched the owner’s. Here is
          what happened on the other one.
        </p>
        <div className="bsc-crew-stack">
          {CREW.map(member => (
            <article
              className={`bsc-crew-row is-${member.slug}`}
              key={member.name}
            >
              <div className="bsc-character-card">
                <img
                  src={`${ASSET}/crew-${member.slug}.webp`}
                  alt={`${member.name}, ${member.title}`}
                  loading="lazy"
                />
                <div className="bsc-character-copy">
                  <h3>{member.name}</h3>
                  <b>{member.title}</b>
                  <span>{member.realm}</span>
                  <p>{member.intro}</p>
                  <strong>ABILITY: {member.ability}</strong>
                  <small>{member.abilityCopy}</small>
                </div>
              </div>
              <WorkdayPanel
                type="BEFORE"
                time={member.beforeTime}
                image={`${member.slug}-before.webp`}
                title={member.beforeTitle}
                body={member.beforeBody}
                result={member.beforeTag}
                caption={member.beforeCaption}
              />
              <WorkdayPanel
                type="AFTER"
                time={member.afterTime}
                image={`${member.slug}-after.webp`}
                title={member.afterTitle}
                body={member.afterBody}
                result={member.afterResult}
                caption={member.afterCaption}
              />
            </article>
          ))}
        </div>
        <div className="bsc-support-rail">
          <b>THE REST OF THE CREW IS ALREADY IN THE FIELD</b>
          <span>
            <strong>SPARK</strong> That is you—the owner who enters when only a
            human can win.
          </span>
          <span>
            <strong>SCOUT</strong> Finds the customers, estimates, capacity, and
            money that went quiet.
          </span>
          <span>
            <strong>SAGE</strong> Gets you ready when a valuable conversation
            requires a human voice.
          </span>
        </div>
        <p className="bsc-closing">
          The crew does not blast strangers with generic messages. It shows up
          in one person’s day, at the right moment, sounding like you.
        </p>
        <p className="bsc-proof-label">SIMULATED THREADS · REAL PRODUCT FLOW</p>
      </div>
    </section>
  );
}

function WorkdayPanel({
  type,
  time,
  image,
  title,
  body,
  result,
  caption,
}: {
  type: string;
  time: string;
  image: string;
  title: string;
  body: string;
  result: string;
  caption: string;
}) {
  return (
    <div className="bsc-workday">
      <div className="bsc-card-top">
        <b>{type}</b>
        <time>{time}</time>
      </div>
      <div className="bsc-workday-image">
        <img src={`${ASSET}/${image}`} alt="" loading="lazy" />
        <div className="bsc-notification">
          <b>{title}</b>
          <p>{body}</p>
          <strong>{result}</strong>
        </div>
      </div>
      <p className="bsc-caption">{caption}</p>
    </div>
  );
}

function Realms() {
  return (
    <section className="bsc-section bsc-realms">
      <div className="bsc-wide">
        <SectionHeader
          title="EXPLORE REALMS. UNLOCK GROWTH."
          sub="Four worlds. Four business engines. Every realm you clear turns on another part of the machine."
        />
        <div className="bsc-realm-grid">
          {REALMS.map(realm => (
            <article key={realm.name}>
              <img
                src={`${ASSET}/realm-${realm.slug}.webp`}
                alt={`${realm.name} fantasy realm`}
                loading="lazy"
              />
              <div>
                <h3>{realm.name}</h3>
                <p>{realm.tagline}</p>
                <span>ENGINE UNLOCKED</span>
                <b>{realm.engine}</b>
                <small>{realm.copy}</small>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FirstMission() {
  return (
    <section className="bsc-section bsc-first">
      <div className="bsc-wide">
        <SectionHeader
          title="THE FIRST MISSION"
          sub="Run by hand, before the game existed."
        />
        <div className="bsc-first-meta">
          <b>MISSION 000 · RE-STAGED BY THE FOUNDER</b>
          <span>
            The original run had no camera. The mission was real. The game came
            afterward.
          </span>
        </div>
        <p className="bsc-deck">
          Before BORESLAY could give anyone a mission, its founder had to run
          one with no game, no crew, and no villain feeding him lines. There was
          only the avoidance every operator knows—and an opportunity sitting on
          the other side of one uncomfortable door.
        </p>
        <div className="bsc-first-grid">
          {FIRST_MISSION.map(beat => (
            <article key={beat.step}>
              <div className="bsc-card-top">
                <b>{beat.step}</b>
              </div>
              <img src={`${ASSET}/${beat.image}`} alt="" loading="lazy" />
              <div>
                <h3>{beat.title}</h3>
                <p>{beat.body}</p>
                {beat.result && (
                  <strong className="bsc-big-result">{beat.result}</strong>
                )}
                {beat.tag && <span>{beat.tag}</span>}
              </div>
            </article>
          ))}
        </div>
        <div className="bsc-first-closing">
          <p>
            Then Adam did the obvious next thing for someone who never wanted to
            bet the business on willpower again:{" "}
            <strong>He turned the mission into a game.</strong>
          </p>
          <p>
            The ten-minute clock. The destination. The materials. The exact
            words. The crew handling the follow-up afterward.
          </p>
          <b>
            BORESLAY is the system he wished had been commanding him that day.
          </b>
        </div>
      </div>
    </section>
  );
}

function Commerce({ onCta }: { onCta: () => void }) {
  return (
    <section id="truenet" className="bsc-section bsc-commerce">
      <div className="bsc-commerce-grid">
        <Ledger />
        <Pricing onCta={onCta} />
        <Faq />
        <Intake onCta={onCta} />
      </div>
    </section>
  );
}

function Ledger() {
  const rows = [
    ["Booked revenue", "$3,420"],
    ["Collected revenue", "$2,580"],
    ["Labor and payroll", "−$380"],
    ["Advertising", "−$680"],
    ["Tools and software", "−$140"],
    ["Transaction fees", "−$78"],
  ];
  return (
    <article className="bsc-paper" id="ledger">
      <h2>THE LEDGER IS REAL</h2>
      <p>We show you the true net.</p>
      <p>
        Most software shows revenue and calls it winning. BORESLAY subtracts
        what it actually cost to produce.
      </p>
      <b className="bsc-paper-rule">
        BOOKED IS PROMISE. COLLECTED IS CASH. COSTS ARE REAL. TRUE NET IS WHAT’S
        LEFT.
      </b>
      <h3>ILLUSTRATIVE TRUE NET LEDGER</h3>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="bsc-net">
        <span>TRUE NET PROFIT</span>
        <strong>$1,302</strong>
      </div>
      <small>
        Illustrative example. Actual results and costs vary by business.
      </small>
    </article>
  );
}

function Pricing({ onCta }: { onCta: () => void }) {
  const included = [
    "Spark, Scout, Closer, Sage, Treasurer, and Guardian",
    "All current realms and mission types",
    "Playable business missions",
    "Customer reactivation",
    "Estimate follow-up",
    "Payment-reminder missions",
    "Review and reputation missions",
    "True Net tracking",
    "New-customer opportunities where supported",
    "Live Sage coaching during Reality Rifts when available",
    "Human support from the BORESLAY team",
  ];
  return (
    <article id="pricing" className="bsc-paper">
      <h2>SIMPLE PRICING</h2>
      <p>One crew. Every current realm.</p>
      <div className="bsc-price">
        <strong>$299</strong>
        <span>/ MONTH</span>
      </div>
      <p>
        A complete business-growth crew inside a game you will actually want to
        play.
      </p>
      <p>Month to month. Cancel anytime.</p>
      <ul>
        {included.map(item => (
          <li key={item}>✓ {item}</li>
        ))}
      </ul>
      <button className="bsc-gold-button" onClick={onCta}>
        CONNECT MY BUSINESS
      </button>
      <small>One recovered invoice can cover the month.</small>
    </article>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <article id="faq" className="bsc-paper">
      <h2>FAIR QUESTIONS</h2>
      <div className="bsc-faq-list">
        {FAQS.map(([q, a], i) => (
          <div key={q}>
            <button
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
            >
              <span>{q}</span>
              <ChevronDown size={15} />
            </button>
            {open === i && <p>{a}</p>}
          </div>
        ))}
      </div>
    </article>
  );
}

function Intake({ onCta }: { onCta: () => void }) {
  const [selected, setSelected] = useState("Laundromat / Wash & Fold");
  const options = [
    "Laundromat / Wash & Fold",
    "Landscaping",
    "Plumbing",
    "Contracting / Handyman",
    "Cleaning",
    "Auto Detailing",
    "Other",
  ];
  return (
    <article id="start" className="bsc-paper bsc-intake">
      <h2>YOUR NEXT WIN STARTS WITH ONE MISSION</h2>
      <p>Answer four questions.</p>
      <p>
        During the beta, Adam—the operator who built BORESLAY inside his own
        laundry business—reviews your operation, selects the highest-value first
        mission, and walks you through it live.
      </p>
      <b>Phone or Zoom. A human, not a funnel.</b>
      <div className="bsc-intake-form">
        <span>1 / 4</span>
        <h3>WHAT KIND OF BUSINESS DO YOU RUN?</h3>
        <div className="bsc-intake-options">
          {options.map(option => (
            <button
              key={option}
              type="button"
              data-selected={selected === option}
              onClick={() => setSelected(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <button type="button" className="bsc-gold-button" onClick={onCta}>
          START MY MISSION
        </button>
      </div>
      <small>No spam. Just your first mission.</small>
    </article>
  );
}

function FinalCta({ onPlayFirst }: { onPlayFirst: () => void }) {
  return (
    <section className="bsc-final">
      <div className="bsc-final-copy">
        <span>THE BUSINESS IS ALREADY A GAME</span>
        <h2>
          YOUR NEXT WIN
          <br />
          STARTS WITH ONE MISSION.
        </h2>
        <p>
          Press play. Run your first mission.
          <br />
          See what your crew can do while you keep running the business.
        </p>
      </div>
      <div className="bsc-final-action">
        <button onClick={onPlayFirst}>
          <Swords size={19} />
          PLAY THE FIRST MISSION
        </button>
        <p>No signup. No credit card.</p>
        <small>Start playing now and see how the mission works.</small>
      </div>
    </section>
  );
}

export function BsCanonicalSections({
  onCta,
  onPlayFirst,
}: {
  onCta: () => void;
  onPlayFirst: () => void;
}) {
  return (
    <>
      <MissionReplay />
      <CrewWorkday />
      <Realms />
      <FirstMission />
      <Commerce onCta={onCta} />
      <FinalCta onPlayFirst={onPlayFirst} />
    </>
  );
}
