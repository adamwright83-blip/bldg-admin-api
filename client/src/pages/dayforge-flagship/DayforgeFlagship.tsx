import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  Crosshair,
  Database,
  Gauge,
  Layers3,
  LockKeyhole,
  Mail,
  MapPin,
  MessageSquareText,
  Navigation,
  PackageCheck,
  Printer,
  Route,
  ScanLine,
  Send,
  ShieldCheck,
  Store,
  Target,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import bossTheDrain from "@/assets/dayforge-flagship/boss-the-drain.jpg";
import founderTwoWorlds from "@/assets/dayforge-flagship/founder-two-worlds-v2.jpg";
import printedLeaveBehind from "@/assets/dayforge-flagship/printed-leave-behind.jpg";
import victoryAccount from "@/assets/dayforge-flagship/victory-account.jpg";
import {
  getFlagshipAnalytics,
  trackCtaClick,
  trackFaqOpen,
  type CtaSource,
} from "./analytics";
import {
  FAQS,
  PRICING_FEATURES,
  QUIET_CUSTOMERS,
  SAGE_ACCOUNTS,
} from "./content";
import "./dayforge-flagship.css";

const FALLBACK_EMAIL = "adam@bldg.chat";
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const OWNER_FIELD_VISIT = "/dayforgeflagship/owner-field-visit.jpg";

function DayforgeMark() {
  return (
    <a className="ff-mark" href="#top" aria-label="DAYFORGE FOR LAUNDRY">
      <span className="ff-mark-glyph" aria-hidden="true"><Zap /></span>
      <span className="ff-mark-name">DAYFORGE</span>
      <i aria-hidden="true" />
      <span className="ff-mark-edition">FOR LAUNDRY</span>
    </a>
  );
}

function SageGlyph({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`ff-sage-glyph${compact ? " is-compact" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 64 64">
        <path d="M32 5 53 17v25L32 59 11 42V17L32 5Z" />
        <circle cx="32" cy="31" r="12" />
        <path d="m32 13 4.7 12.8L49 31l-12.3 5.2L32 49l-4.7-12.8L15 31l12.3-5.2L32 13Z" />
        <circle cx="32" cy="31" r="3.2" />
      </svg>
    </span>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="ff-eyebrow">{children}</span>;
}

function TerritoryCta({
  source,
  onOpen,
  tone = "cobalt",
}: {
  source: CtaSource;
  onOpen: (trigger: HTMLButtonElement) => void;
  tone?: "cobalt" | "ivory" | "ink";
}) {
  return (
    <button
      className={`ff-cta is-${tone}`}
      type="button"
      data-cta-source={source}
      onClick={event => {
        trackCtaClick(source);
        onOpen(event.currentTarget);
      }}
    >
      <span>MAP MY TERRITORY</span>
      <ArrowRight aria-hidden="true" />
    </button>
  );
}

function HeroSystem() {
  return (
    <div className="ff-hero-system" aria-label="DayForge operating system turns store data into a playable real-world mission">
      <div className="ff-hero-system-top">
        <span><i /> DAYFORGE OS · LIVE</span>
        <b>LOS ANGELES · 09:41</b>
      </div>

      <div className="ff-hero-pos">
        <header><Store /> <span>STORE PULSE</span><em>ON PLAN</em></header>
        <div className="ff-hero-pos-metrics">
          <span><small>ORDERS TODAY</small><b>84</b><em>+12%</em></span>
          <span><small>WASH CAPACITY</small><b>73%</b><em>27% OPEN</em></span>
          <span><small>ROUTE STOPS</small><b>18</b><em>2 GAPS</em></span>
        </div>
        <div className="ff-hero-pos-line">
          <i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i />
        </div>
      </div>

      <div className="ff-hero-sage">
        <SageGlyph compact />
        <div>
          <span>SAGE · NEXT BEST MOVE</span>
          <strong>Westview Property Management</strong>
          <p>Fits open capacity · 1.4 mi · 15 buildings</p>
        </div>
        <b>HIGH FIT</b>
      </div>

      <div className="ff-hero-flow" aria-hidden="true">
        <span>OPERATE</span><i /><span>UNDERSTAND</span><i /><span>ACT</span>
      </div>

      <div className="ff-hero-game">
        <span>BORESLAY · PLAYABLE MISSION</span>
        <strong>DEFEAT THE DRAIN</strong>
        <p>The business problem becomes the boss. The win happens in real life.</p>
        <em>EST. CONTRACT · $24,800/YR</em>
      </div>

      <div className="ff-hero-phone">
        <div className="ff-phone-notch" aria-hidden="true" />
        <header><span>09:41</span><b>DAYFORGE</b></header>
        <div className="ff-phone-route"><Navigation /> FIELD MISSION</div>
        <span className="ff-phone-label">YOUR NEXT STOP</span>
        <strong className="ff-phone-title">Westview Property Management</strong>
        <p>15 buildings · 1.4 miles</p>
        <div className="ff-phone-value"><span>EST. ANNUAL VALUE</span><b>$24,800</b></div>
        <dl>
          <div><dt>ASK FOR</dt><dd>Operations manager</dd></div>
          <div><dt>LEAD WITH</dt><dd>One invoice for 15 buildings</dd></div>
        </dl>
        <button type="button" tabIndex={-1}><Navigation /> PRESS TO DRIVE</button>
      </div>
    </div>
  );
}

function OperatingSystemSection() {
  return (
    <section className="ff-os" id="operating-system" aria-labelledby="ff-os-title">
      <div className="ff-shell">
        <div className="ff-os-intro">
          <div>
            <Eyebrow>THE OPERATING SYSTEM UNDER THE INTELLIGENCE</Eyebrow>
            <h2 id="ff-os-title">First, DayForge learns how your store actually runs.</h2>
          </div>
          <div>
            <p>
              Run the counter on DayForge or connect the tools you already use.
              Orders, customers, services, pricing, routes, and available
              capacity become one live operating picture.
            </p>
            <span><ShieldCheck /> Start connected. Move more of the operation when you&apos;re ready.</span>
          </div>
        </div>

        <div className="ff-os-window" aria-label="DayForge POS and operations command center mockup">
          <aside className="ff-os-sidebar">
            <div className="ff-os-mini-mark"><Zap /><b>DAYFORGE</b></div>
            <div className="ff-os-nav" aria-label="DayForge product areas">
              <span className="is-active"><Activity /> Today</span>
              <span><PackageCheck /> Orders</span>
              <span><Users /> Customers</span>
              <span><Route /> Routes</span>
              <span><Gauge /> Capacity</span>
              <span><CircleDollarSign /> Pricing</span>
              <span><TrendingUp /> Growth</span>
            </div>
            <div className="ff-os-location"><i>LA</i><span><b>DayForge Laundry</b><small>Store 01 · Live</small></span></div>
          </aside>

          <div className="ff-os-main">
            <header className="ff-os-header">
              <div><small>GOOD MORNING, ADAM</small><h3>Your store is ready for the day.</h3></div>
              <span><i /> ALL SYSTEMS LIVE</span>
            </header>

            <div className="ff-os-kpis">
              <article><span>NET SALES TODAY</span><strong>$4,842</strong><em>↑ 18% vs. last Tue</em></article>
              <article><span>ACTIVE ORDERS</span><strong>84</strong><em>31 ready by 4 PM</em></article>
              <article><span>PRODUCTION LOAD</span><strong>73%</strong><em>27% capacity open</em></article>
              <article><span>ROUTE VALUE</span><strong>$1,906</strong><em>18 stops · 2 gaps</em></article>
            </div>

            <div className="ff-os-grid">
              <article className="ff-os-orders">
                <header><div><span>LIVE PRODUCTION</span><b>84 orders moving</b></div><em>View board <ArrowUpRight /></em></header>
                <div className="ff-os-order-head"><span>ORDER</span><span>SERVICE</span><span>DUE</span><span>STATUS</span></div>
                <div className="ff-os-order"><span><b>#1048</b><small>Maya Chen</small></span><span>Wash &amp; fold</span><span>11:30 AM</span><em className="is-washing">WASHING</em></div>
                <div className="ff-os-order"><span><b>#1049</b><small>Westside Spa</small></span><span>Commercial</span><span>1:00 PM</span><em className="is-folding">FOLDING</em></div>
                <div className="ff-os-order"><span><b>#1050</b><small>Luis Ortega</small></span><span>Pickup &amp; delivery</span><span>3:15 PM</span><em className="is-ready">READY</em></div>
              </article>

              <article className="ff-os-capacity">
                <header><span>TODAY&apos;S CAPACITY</span><b>Room to grow</b></header>
                <div className="ff-capacity-ring"><span><strong>27%</strong><small>AVAILABLE</small></span></div>
                <dl>
                  <div><dt>WASH</dt><dd><i /></dd><em>78%</em></div>
                  <div><dt>DRY</dt><dd><i /></dd><em>69%</em></div>
                  <div><dt>FOLD</dt><dd><i /></dd><em>72%</em></div>
                </dl>
                <p><SageGlyph compact /> <span><b>Sage sees sellable room.</b> Enough Tuesday/Thursday capacity for one commercial account.</span></p>
              </article>
            </div>
          </div>
        </div>

        <div className="ff-os-data-line">
          <span><Database /> YOUR OPERATION</span><i />
          <span><SageGlyph compact /> SAGE UNDERSTANDS THE FIT</span><i />
          <span><Target /> THE RIGHT NEXT MOVE</span>
        </div>
      </div>
    </section>
  );
}

function SageBriefing() {
  return (
    <div className="ff-sage-window">
      <header className="ff-sage-header">
        <div><SageGlyph /><span><small>SAGE · OPERATING INTELLIGENCE</small><b>BRIEF 0142</b></span></div>
        <em><i /> LIVE ANALYSIS</em>
      </header>

      <div className="ff-sage-decision">
        <span>TODAY&apos;S BEST MOVE</span>
        <h4>Westview Property Management</h4>
        <p>One account that fits the store you run and the route you already drive.</p>
        <div><b>HIGH WIN PROBABILITY</b><strong>$24,800<small>/YR EST.</small></strong></div>
      </div>

      <div className="ff-sage-evidence">
        <article>
          <header><Store /> FROM YOUR OPERATION</header>
          <ul>
            <li><Check /><span><b>Capacity fits</b>Tuesday + Thursday room available</span></li>
            <li><Check /><span><b>Service fits</b>Commercial wash &amp; fold enabled</span></li>
            <li><Check /><span><b>Route fits</b>Current route passes within 0.6 miles</span></li>
          </ul>
        </article>
        <article>
          <header><MapPin /> FROM YOUR TERRITORY</header>
          <ul>
            <li><Check /><span><b>15-building footprint</b>Recurring towels, mats, tenant laundry</span></li>
            <li><Check /><span><b>Decision-maker found</b>Ask for the operations manager</span></li>
            <li><Check /><span><b>Close enough to serve</b>1.4 miles from your store</span></li>
          </ul>
        </article>
      </div>

      <div className="ff-sage-why">
        <SageGlyph compact />
        <span><small>SAGE SAYS</small><b>Sell the 15-building simplicity: one laundry partner, one invoice, less staff time lost.</b></span>
        <ArrowRight />
      </div>

      <div className="ff-sage-ranking">
        <header><span>SHORTLIST · 286 ACCOUNTS CHECKED</span><em>12 worth the drive</em></header>
        <div className="ff-sage-ranking-head"><span>ACCOUNT</span><span>VALUE</span><span>DISTANCE</span><span>WIN PROBABILITY</span></div>
        {SAGE_ACCOUNTS.map((account, index) => (
          <div key={account.account} className={`ff-sage-rank${index === 0 ? " is-top" : ""}`}>
            <span><b>{account.account}</b><small>{account.footprint} · Ask for {account.decisionMaker.toLowerCase()}</small></span>
            <strong>{account.annualValue}</strong>
            <em>{account.distance}</em>
            <i>{account.probability}</i>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoreslayBridge() {
  return (
    <div className="ff-game-bridge" aria-labelledby="ff-game-bridge-title">
      <div className="ff-game-bridge-copy">
        <Eyebrow>MEET BORESLAY · THE GAME INSIDE DAYFORGE</Eyebrow>
        <h3 id="ff-game-bridge-title">Knowing the next move isn&apos;t the hard part. Making yourself do it is.</h3>
        <p>
          Most software gives you another list. BORESLAY is the short game
          inside DayForge. It turns Sage&apos;s best recommendation into a
          playable mission—then sends the real-world objective to your phone.
        </p>
        <p className="ff-game-bridge-kicker">The escapism creates momentum. The win is still a real customer.</p>
      </div>

      <div className="ff-bore-definition">
        <div><span>BORE</span><i>+</i><span>SLAY</span><b>=</b><strong>BORESLAY</strong></div>
        <p>The gamified cure for the boring gap between knowing what grows the business and actually doing it.</p>
      </div>

      <div className="ff-game-steps">
        <article><span>01</span><SageGlyph compact /><b>SAGE FINDS IT.</b><p>The move most worth making today.</p></article>
        <i aria-hidden="true"><ArrowRight /></i>
        <article><span>02</span><Layers3 /><b>BORESLAY MAKES IT PLAYABLE.</b><p>The business problem becomes the boss.</p></article>
        <i aria-hidden="true"><ArrowRight /></i>
        <article><span>03</span><Navigation /><b>YOU FINISH IT IN REAL LIFE.</b><p>The mission leaves the screen with you.</p></article>
      </div>
    </div>
  );
}

function MissionSequence({
  onOpen,
  missionEndRef,
}: {
  onOpen: (trigger: HTMLButtonElement) => void;
  missionEndRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <section className="ff-sequence" id="mission" aria-labelledby="ff-sequence-title">
      <div className="ff-shell">
        <div className="ff-section-head">
          <Eyebrow>ONE ACCOUNT · ONE COMPLETE MISSION</Eyebrow>
          <h2 id="ff-sequence-title">How does a business on your street become your customer?</h2>
          <p>Here&apos;s one mission, start to finish.</p>
        </div>

        <article className="ff-stage is-sage">
          <div className="ff-stage-copy">
            <span className="ff-stage-number">01</span>
            <Eyebrow>SAGE PICKS THE ACCOUNT</Eyebrow>
            <h3>It sees the business you run—and the market around it.</h3>
            <p>
              Sage combines DayForge&apos;s live view of your operation with
              territory intelligence. It does not hand you a map. It shows
              which account fits, why it fits, who to ask for, and what the
              work could be worth.
            </p>
          </div>
          <SageBriefing />
        </article>

        <BoreslayBridge />

        <article className="ff-stage is-mission">
          <div className="ff-stage-copy">
            <span className="ff-stage-number">02</span>
            <Eyebrow>THE RECOMMENDATION BECOMES A GAME</Eyebrow>
            <h3>Now the business problem becomes the boss.</h3>
            <p>
              Westview handles laundry in-house. That is the revenue problem.
              Inside BORESLAY, it becomes The Drain—a boss you defeat to
              unlock the visit and send the field mission to your phone.
            </p>
          </div>
          <div className="ff-interrupt">
            <header><span>BORESLAY</span><b>TODAY&apos;S MISSION</b><em>01:30</em></header>
            <div className="ff-interrupt-body">
              <img
                src={bossTheDrain}
                alt="Concept render of The Drain, a BORESLAY boss built from the account problem"
                width={560}
                height={620}
                loading="eager"
                decoding="async"
              />
              <div className="ff-interrupt-brief">
                <span>BOSS · THE DRAIN</span>
                <h4>DEFEAT THE DRAIN</h4>
                <p>Westview Property Management—their in-house laundry is draining profits. Defeat the Drain and win the contract.</p>
                <b>EST. CONTRACT · $24,800/YR</b>
                <em><Send /> SEND TO PHONE</em>
              </div>
            </div>
          </div>
          <p className="ff-boss-rule"><span>THE BOSS</span> is their business problem. <b>BEATING IT</b> unlocks the real-world move.</p>
        </article>

        <article className="ff-stage is-prep">
          <div className="ff-stage-copy">
            <span className="ff-stage-number">03</span>
            <Eyebrow>DAYFORGE PREPS THE VISIT</Eyebrow>
            <h3>Clean polo. Quote sheet. Press to drive.</h3>
            <p>
              First stop isn&apos;t the account—it&apos;s the print shop. DayForge
              already sent your leave-behind: your services, pricing, and name.
              Pick it up. Keep driving.
            </p>
          </div>
          <div className="ff-prep-visual">
            <img src={printedLeaveBehind} alt="Concept photo of a premium commercial laundry leave-behind at a print shop" width={1200} height={900} loading="eager" decoding="async" />
            <div className="ff-prep-card">
              <header><Printer /> PRINT STOP · READY NOW</header>
              <h4>Westview visit kit</h4>
              <ul>
                <li><Check /> One-page services sheet</li>
                <li><Check /> Pricing &amp; turnaround</li>
                <li><Check /> 15-building quote</li>
              </ul>
              <b><Navigation /> PICK UP · KEEP DRIVING</b>
            </div>
          </div>
        </article>

        <article className="ff-stage is-field">
          <div className="ff-stage-copy">
            <span className="ff-stage-number">04</span>
            <Eyebrow>THROUGH THE DOOR</Eyebrow>
            <h3>Then it gets you through the door.</h3>
            <p>Your phone tells you who to ask for, the one benefit to lead with, and what to leave behind. Then you walk in.</p>
          </div>
          <div className="ff-field-visual">
            <img src={OWNER_FIELD_VISIT} alt="Concept photo of a laundromat owner approaching a commercial property with collateral" width={1200} height={900} loading="eager" decoding="async" />
            <div className="ff-field-card">
              <span>AT THE DOOR</span>
              <h4>Westview Property Management</h4>
              <dl>
                <div><dt>ASK FOR</dt><dd>The operations manager</dd></div>
                <div><dt>LEAD WITH</dt><dd>Less staff time lost to laundry</dd></div>
                <div><dt>LEAVE</dt><dd>One-page service &amp; pricing sheet</dd></div>
              </dl>
              <b>YOU&apos;RE READY. WALK IN.</b>
            </div>
          </div>
        </article>
      </div>

      <div className="ff-mission-cta">
        <div><Eyebrow>YOUR STREET · YOUR NEXT ACCOUNT</Eyebrow><h2>What businesses are you driving past?</h2><p>We&apos;ll map the accounts around your store live in 15 minutes.</p></div>
        <TerritoryCta source="mission" onOpen={onOpen} tone="ivory" />
      </div>
      <div ref={missionEndRef} className="ff-mission-end" aria-hidden="true" />
    </section>
  );
}

function GamePayoff() {
  return (
    <section className="ff-payoff" id="game-victory" aria-labelledby="ff-payoff-title">
      <div className="ff-payoff-art">
        <img src={victoryAccount} alt="Concept render of a BORESLAY victory opening the way to a real commercial account" width={1400} height={788} loading="eager" decoding="async" />
        <div className="ff-payoff-shade" aria-hidden="true" />
      </div>
      <div className="ff-payoff-copy">
        <Eyebrow>WHY THE GAME EARNS ITS PLACE</Eyebrow>
        <h2 id="ff-payoff-title">Dashboards get ignored. Games get played.</h2>
        <p>BORESLAY never awards points for busywork. Every boss represents a real account or revenue problem. Every mission ends with a move outside the game.</p>
        <div className="ff-payoff-thesis"><span>BEAT THE PROBLEM ON SCREEN.</span><b>WIN THE ACCOUNT IN REAL LIFE.</b></div>
      </div>
      <div className="ff-victory-card" id="contract-secured">
        <span>MISSION COMPLETE</span>
        <h3>CONTRACT SECURED</h3>
        <strong>+$24,800/YR</strong>
        <small>WESTVIEW PROPERTY MANAGEMENT</small>
      </div>
    </section>
  );
}

function FounderSection() {
  return (
    <section className="ff-founder" id="founder-story" aria-labelledby="ff-founder-title">
      <div className="ff-founder-media">
        <img src={founderTwoWorlds} alt="Concept image showing the same founder operating a laundromat and building a cloud game" width={1672} height={941} loading="eager" decoding="async" />
        <div aria-hidden="true" />
      </div>
      <div className="ff-shell ff-founder-content">
        <div className="ff-founder-title">
          <Eyebrow>WHY DAYFORGE EXISTS</Eyebrow>
          <h2 id="ff-founder-title">Two founder lives. One operating system.</h2>
          <p>DayForge was born where the reality of running laundromats collided with the instinct to make difficult things playable.</p>
        </div>
        <div className="ff-founder-duo">
          <article>
            <span>01 · THE LAUNDROMAT OPERATOR</span>
            <h3>Knows the work.</h3>
            <p>The counter, routes, margins, staffing—and the valuable growth work that keeps getting pushed to tomorrow.</p>
          </article>
          <article>
            <span>02 · THE CLOUD-GAMING FOUNDER</span>
            <h3>Knows the pull.</h3>
            <p>Built a cloud-gaming company to <b>$1.6 million in revenue in under 11 months.</b> Knows how missions, progress, and play make hard things easier to start.</p>
          </article>
        </div>
        <div className="ff-founder-reveal">
          <b>SAME FOUNDER.</b>
          <span>Business software knows what should happen. Games know how to make people want to finish. DayForge does both.</span>
        </div>
      </div>
    </section>
  );
}

function RecoverySection() {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("Draft prepared · Nothing sent");
  const [message, setMessage] = useState("Hi Maya—we haven't seen you in a while. We've kept your usual wash-and-fold preferences saved. Want us to schedule a pickup this week?");

  return (
    <section className="ff-recovery" id="customer-recovery" aria-labelledby="ff-recovery-title">
      <div className="ff-shell ff-recovery-grid">
        <div className="ff-recovery-copy">
          <Eyebrow>SAGE PROTECTS THE BUSINESS YOU ALREADY WON</Eyebrow>
          <h2 id="ff-recovery-title">It notices when good customers disappear, too.</h2>
          <p>Regulars rarely quit out loud. They just stop showing up. Sage catches the pattern early—and prepares the first move to bring them back.</p>
          <div className="ff-human-control"><ShieldCheck /><span><b>DayForge investigates and prepares the move.</b>You review it, improve it, and decide when it goes out.</span></div>
        </div>

        <div className="ff-recovery-ui">
          <div className="ff-quiet-card">
            <header><SageGlyph compact /><span>SAGE · CUSTOMER WATCH</span><em>3 SIGNALS</em></header>
            <p>Three valuable regulars broke their normal order rhythm.</p>
            <table>
              <thead><tr><th>Customer</th><th>Normal rhythm</th><th>Monthly value</th><th>Days quiet</th></tr></thead>
              <tbody>{QUIET_CUSTOMERS.map(customer => <tr key={customer.name}><td><b>{customer.name}</b></td><td>Every 7 days</td><td>{customer.monthlyValue}</td><td>{customer.daysQuiet}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="ff-draft-card">
            <header><span>SAGE DRAFT · WIN-BACK</span><small>{status}</small></header>
            <label htmlFor="ff-winback">Message to Maya</label>
            <textarea id="ff-winback" value={message} readOnly={!editing} onChange={event => setMessage(event.target.value)} />
            <footer>
              <button type="button" onClick={() => { setEditing(true); setStatus("Editing · Nothing sent"); requestAnimationFrame(() => document.getElementById("ff-winback")?.focus()); }}>EDIT</button>
              <button type="button" className="is-send" onClick={() => { setEditing(false); setStatus("Demo · Nothing sends without approval"); }}><Send /> SEND</button>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingSection({ onOpen }: { onOpen: (trigger: HTMLButtonElement) => void }) {
  return (
    <section className="ff-pricing" id="pricing" aria-labelledby="ff-pricing-title">
      <div className="ff-shell">
        <div className="ff-section-head is-centered"><Eyebrow>THE ECONOMICS</Eyebrow><h2 id="ff-pricing-title">One account can pay for years of DayForge.</h2></div>
        <div className="ff-roi-static">
          <span className="ff-roi-label">EXAMPLE MISSION ECONOMICS</span>
          <div className="ff-roi-big"><strong>$24,800</strong><span>That property management account · per year</span></div>
          <em className="ff-roi-vs">compared to</em>
          <div className="ff-roi-lesser"><strong>$2,388</strong><span>DayForge · $199 a month, for the year</span></div>
          <b className="ff-roi-equals">One closed account ≈ 10+ years of DayForge</b>
        </div>
        <p className="ff-roi-footnote">Illustrative revenue estimate, not profit or a guarantee. Costs and results vary.</p>

        <div className="ff-price-card">
          <div className="ff-price-intro"><Eyebrow>DAYFORGE OPERATOR</Eyebrow><h3>Everything. One location, one territory.</h3></div>
          <div className="ff-price-amount"><strong>$199</strong><span>/month</span></div>
          <ul>{PRICING_FEATURES.map(feature => <li key={feature}><Check /> {feature}</li>)}</ul>
          <div className="ff-founding-offer"><Zap /><span><b>First 25 operators: $149/month,</b> locked for 12 months.</span></div>
          <TerritoryCta source="pricing" onOpen={onOpen} />
          <p>15-minute demo · No credit card · Cancel anytime, no long contracts · We map your territory live on the call.</p>
        </div>
        <p className="ff-price-proof">Built by a laundromat operator and cloud-gaming founder. Running daily in our own LA stores.</p>
      </div>
    </section>
  );
}

function FaqSection({ onOpen, faqRef }: { onOpen: (trigger: HTMLButtonElement) => void; faqRef: RefObject<HTMLElement | null> }) {
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    const questionId = event.currentTarget.dataset.questionId;
    const faq = FAQS.find(item => item.id === questionId);
    if (faq) trackFaqOpen(faq.id);
  };

  return (
    <section ref={faqRef} className="ff-faq" id="faq" aria-labelledby="ff-faq-title">
      <div className="ff-shell ff-faq-grid">
        <div className="ff-faq-intro"><Eyebrow>BEFORE YOU BOOK</Eyebrow><h2 id="ff-faq-title">Fair questions.</h2><p>No jargon. No mystery. Here&apos;s what owners usually ask.</p></div>
        <div className="ff-faq-list">
          {FAQS.map((faq, index) => (
            <details key={faq.id} data-question-id={faq.id} onToggle={onToggle}>
              <summary><span>{String(index + 1).padStart(2, "0")}</span><b>{faq.question}</b><ChevronDown /></summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
      <div className="ff-final" id="final-cta">
        <div className="ff-final-grid" aria-hidden="true" />
        <div><Eyebrow>THE NEXT ACCOUNT IS ALREADY OUT THERE</Eyebrow><h2>Stop passing the next account you could win.</h2><p>See the winnable commercial accounts around your store in a 15-minute live demo.</p></div>
        <TerritoryCta source="final" onOpen={onOpen} tone="ivory" />
      </div>
    </section>
  );
}

function SchedulerDialog({ open, onClose, returnFocusRef }: { open: boolean; onClose: () => void; returnFocusRef: RefObject<HTMLButtonElement | null> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = returnFocusRef.current;
    const triggerSource = trigger?.dataset.ctaSource;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => emailRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      requestAnimationFrame(() => {
        if (trigger?.isConnected) trigger.focus();
        else if (triggerSource) document.querySelector<HTMLButtonElement>(`button[data-cta-source="${triggerSource}"]`)?.focus();
      });
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status === "submitting") return;
    setStatus("submitting");
    try {
      const response = await fetch(`${API_BASE}/api/leads/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "DayForge territory request",
          building_name: "Laundry owner or operator",
          role: "Laundry owner or operator",
          email: email.trim(),
          number_of_units: "Laundry business",
          source: "dayforge_flagship_territory_popup",
          source_url: window.location.href,
          notes: "Requested a private DayForge territory scan from the flagship landing page.",
        }),
      });
      if (!response.ok) throw new Error(`Lead submission failed (${response.status})`);
      setStatus("success");
    } catch (error) {
      console.error("[DayForge flagship] territory request failed", error);
      setStatus("error");
    }
  };

  return (
    <dialog ref={dialogRef} className="ff-scheduler" aria-labelledby="ff-scheduler-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ff-scheduler-shell">
        <button className="ff-scheduler-close" type="button" onClick={onClose} aria-label="Close scheduler"><X /></button>
        <div className="ff-scheduler-copy"><span className="ff-scheduler-signal"><i /> PRIVATE TERRITORY SCAN</span><h2 id="ff-scheduler-title">Let&apos;s find the accounts hiding on your route.</h2><p>Drop your email. We&apos;ll map the commercial laundry opportunities around your store and show you what&apos;s worth the drive.</p><div className="ff-scheduler-proof"><span><Check /> No credit card</span><span><Check /> Your territory stays private</span></div></div>
        <div className="ff-scheduler-capture">
          {status === "success" ? (
            <div className="ff-scheduler-success" aria-live="polite"><span><MapPin /></span><small>REQUEST RECEIVED</small><h3>Your territory is officially on our radar.</h3><p>Watch your inbox. We&apos;ll reach out to map the best nearby accounts with you.</p><button type="button" onClick={onClose}>BACK TO DAYFORGE <ArrowRight /></button></div>
          ) : (
            <form onSubmit={submit}>
              <span className="ff-scheduler-step">STEP 1 OF 1</span>
              <h3>Where should we send your territory map?</h3>
              <label htmlFor="ff-territory-email">YOUR BEST EMAIL</label>
              <div className="ff-scheduler-email"><Mail /><input ref={emailRef} id="ff-territory-email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="you@yourlaundromat.com" value={email} onChange={event => { setEmail(event.target.value); if (status === "error") setStatus("idle"); }} required /></div>
              {status === "error" && <p className="ff-scheduler-error" role="alert">That didn&apos;t go through. Try again or email <a href={`mailto:${FALLBACK_EMAIL}`}>{FALLBACK_EMAIL}</a>.</p>}
              <button className="ff-scheduler-submit" type="submit" disabled={status === "submitting"}><span>{status === "submitting" ? "SCANNING…" : "SCAN MY TERRITORY"}</span><ArrowRight /></button>
              <small className="ff-scheduler-privacy"><LockKeyhole /> No spam. No shared lists. Just your territory.</small>
            </form>
          )}
        </div>
      </div>
    </dialog>
  );
}

const MOBILE_CTA_SOURCES = {
  hero: "hero" as CtaSource,
  pitch: "mission" as CtaSource,
  pricing: "pricing" as CtaSource,
  final: "final" as CtaSource,
};

function MobileBrand() {
  return <a className="dfm-brand" href="#mobile-top" aria-label="DayForge home"><span><Zap /></span><b>DAYFORGE</b></a>;
}

function MobileCta({ source, onOpen, children }: {
  source: CtaSource;
  onOpen: (trigger: HTMLButtonElement) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      className="dfm-cta"
      type="button"
      data-cta-source={`mobile-${source}`}
      onClick={event => {
        trackCtaClick(source);
        onOpen(event.currentTarget);
      }}
    >
      <span>{children}</span><ArrowRight />
    </button>
  );
}

function MobileLanding({ onOpen }: { onOpen: (trigger: HTMLButtonElement) => void }) {
  const faqItems = [
    ["How does DayForge find opportunities?", "It combines local territory signals with the services, routes, and capacity you tell us about."],
    ["Is my territory really private?", "Yes. Your territory view and opportunity work stay private to your account."],
    ["How do I get the information?", "DayForge puts the account, decision-maker, pitch, and next step into one field-ready mission."],
    ["Do you guarantee results?", "No. DayForge helps you choose and prepare for better opportunities; you stay in control of every visit."],
    ["Can I cancel anytime?", "Yes. There is no setup fee and no long-term contract."],
  ];

  return (
    <div className="ff-mobile" id="mobile-top">
      <header className="dfm-header">
        <MobileBrand />
        <span><i /> Live in your territory</span>
      </header>

      <main>
        <section className="dfm-hero">
          <div className="dfm-contours" aria-hidden="true" />
          <span className="dfm-kicker">FOR LAUNDROMAT &amp; FLUFF-AND-FOLD OWNERS</span>
          <h1>Your next laundry account is probably on this street.</h1>
          <p>DayForge scans your area for commercial laundry opportunities so you can stop driving past money.</p>
          <MobileCta source={MOBILE_CTA_SOURCES.hero} onOpen={onOpen}>SCAN MY TERRITORY</MobileCta>
          <small><LockKeyhole /> Private territory <i /> No credit card</small>

          <div className="dfm-road" aria-hidden="true">
            <span className="dfm-van"><Store /></span>
            <i className="dfm-route-line" />
            <span className="dfm-radar"><Crosshair /></span>
          </div>
        </section>

        <section className="dfm-opportunity" aria-label="Nearby account opportunity">
          <div className="dfm-map">
            <span>PINE ST</span><span>OAK AVE</span><span>MAPLE DR</span>
            <i className="dfm-map-route" />
            <b><Navigation /></b>
          </div>
          <article>
            <header><Building2 /><span><small>ACCOUNT DETECTED</small><b>Westview Property Management</b></span></header>
            <em><Navigation /> 0.2 MI AWAY</em>
            <div><span><Building2 /><b>15</b><small>BUILDINGS</small></span><span><strong>$24,800</strong><small>EST. / YEAR</small></span></div>
            <footer><span><b>ASK FOR DANA</b><small>OPERATIONS</small></span><ArrowRight /></footer>
          </article>
        </section>

        <section className="dfm-flow">
          <span className="dfm-section-label">FROM EMPTY MILES TO PAYING STOPS</span>
          <div>
            <article><ScanLine /><b>WE SPOT<br />THE FIT</b></article>
            <i><ArrowRight /></i>
            <article><MessageSquareText /><b>WE BUILD<br />THE PITCH</b></article>
            <i><ArrowRight /></i>
            <article><Navigation /><b>YOU WALK<br />IN READY</b></article>
          </div>
        </section>

        <section className="dfm-pitch">
          <div><span>YOUR OPENING LINE</span><blockquote>“Hi Dana, I help properties in your area handle laundry for their residents. I can pick up, wash, fold, and deliver on a schedule that works for you.”</blockquote></div>
          <MobileCta source={MOBILE_CTA_SOURCES.pitch} onOpen={onOpen}><Send /> SEND TO MY PHONE</MobileCta>
        </section>

        <section className="dfm-boreslay-intro">
          <h2>SELLING LAUNDRY SERVICE IS BORING.<br /><span>SO WE TURNED IT INTO A GAME.</span></h2>
          <p><b>Boreslay</b> finds real nearby properties worth pursuing, then turns the work of landing each account into missions you can actually play.</p>
        </section>

        <section className="dfm-boreslay">
          <img src={victoryAccount} alt="BORESLAY Mission 042: a dragon turns the Westview account into a playable field mission" />
          <div className="dfm-boreslay-shade" />
          <div className="dfm-boreslay-copy">
            <span>MISSION 042</span>
            <h2>Boreslay</h2>
            <b>WESTVIEW PROPERTY MANAGEMENT</b>
            <small>15 BUILDINGS · 0.2 MI AWAY</small>
            <strong><i>TARGET VALUE</i>$24,800 <small>/ YEAR</small></strong>
            <p>Defeat the Drain. Claim the route.<br />Build the laundry empire.</p>
          </div>
        </section>

        <section className="dfm-operator">
          <div><img src={OWNER_FIELD_VISIT} alt="A laundromat operator on a commercial laundry route" /></div>
          <article><span>BUILT FOR PEOPLE WHO STILL DO THE ROUTE</span><p>You know this business because you&apos;re out there every day. DayForge uses your open route capacity to find real accounts worth your time.</p><Zap /></article>
        </section>

        <section className="dfm-price" id="mobile-pricing">
          <header><span><Zap /></span><div><small>DAYFORGE OPERATOR</small><b>$199 <i>/ MONTH</i></b><p>One location · One private territory</p></div></header>
          <ul>{["Private territory scan", "Real account opportunities", "Pitch builder & scripts", "Route-fit recommendations", "Cancel anytime"].map(item => <li key={item}><Check />{item}</li>)}</ul>
          <MobileCta source={MOBILE_CTA_SOURCES.pricing} onOpen={onOpen}>MAP MY TERRITORY</MobileCta>
        </section>

        <section className="dfm-faq" id="mobile-faq">
          {faqItems.map(([question, answer]) => <details key={question}><summary><span><Target />{question}</span><ChevronDown /></summary><p>{answer}</p></details>)}
        </section>

        <section className="dfm-final">
          <Gauge />
          <h2>THE NEXT ACCOUNT IS <span>ALREADY OUT THERE.</span></h2>
          <MobileCta source={MOBILE_CTA_SOURCES.final} onOpen={onOpen}>SCAN MY TERRITORY</MobileCta>
          <small><LockKeyhole /> Private territory <i /> No credit card</small>
        </section>
      </main>

      <footer className="dfm-footer"><MobileBrand /><span>Find it. Pitch it. Win it.</span></footer>
    </div>
  );
}


function updateMetadata() {
  const previousTitle = document.title;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const previousDescription = description?.content;
  document.title = "DayForge for Laundry — Stop driving past businesses that could be paying you";
  if (description) description.content = "DayForge runs your fluff-and-fold operation, Sage finds the best next move, and BORESLAY turns it into a playable mission you finish in real life.";
  return () => {
    document.title = previousTitle;
    if (description && previousDescription !== undefined) description.content = previousDescription;
  };
}

export default function DayforgeFlagship() {
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const missionEndRef = useRef<HTMLDivElement>(null);
  const founderRef = useRef<HTMLDivElement>(null);
  const faqRef = useRef<HTMLElement>(null);
  const lastCtaRef = useRef<HTMLButtonElement>(null);
  const posterMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("poster") === "1";

  useEffect(() => updateMetadata(), []);
  useEffect(() => { void getFlagshipAnalytics(); }, []);

  useEffect(() => {
    const syncForcedMobileViewport = () => {
      const page = pageRef.current;
      if (!page) return;
      const deviceWidth = Math.max(1, window.screen.width);
      page.style.setProperty("--dfm-device-width", `${deviceWidth}px`);
      page.style.setProperty("--dfm-force-scale", String(window.innerWidth / deviceWidth));
    };
    syncForcedMobileViewport();
    addEventListener("resize", syncForcedMobileViewport);
    return () => removeEventListener("resize", syncForcedMobileViewport);
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!missionEndRef.current) return;
        const missionPassed = missionEndRef.current.getBoundingClientRect().top <= 0;
        const founderReached = founderRef.current ? founderRef.current.getBoundingClientRect().top <= window.innerHeight : false;
        setShowSticky(missionPassed && !founderReached);
      });
    };
    const observer = new IntersectionObserver(update, { threshold: [0, 1] });
    if (missionEndRef.current) observer.observe(missionEndRef.current);
    if (founderRef.current) observer.observe(founderRef.current);
    addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      removeEventListener("scroll", update);
      removeEventListener("resize", update);
    };
  }, []);

  const openScheduler = (trigger: HTMLButtonElement) => {
    lastCtaRef.current = trigger;
    setSchedulerOpen(true);
  };

  return (
    <div ref={pageRef} className={`ff-page${posterMode ? " is-poster" : ""}`} id="top">
      <div className="ff-desktop">
      <a className="ff-skip" href="#ff-main">Skip to content</a>
      <header className="ff-header">
        <DayforgeMark />
        <nav aria-label="Page navigation"><a href="#operating-system">The OS</a><a href="#mission">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a></nav>
        <span className="ff-header-proof"><i /> BUILT &amp; RUN IN LA</span>
      </header>

      <main id="ff-main">
        <section className="ff-hero" aria-labelledby="ff-hero-title">
          <div className="ff-hero-copy">
            <Eyebrow>FOR LAUNDROMAT &amp; FLUFF-AND-FOLD OWNERS</Eyebrow>
            <h1 id="ff-hero-title">Stop driving past businesses that could be paying you.</h1>
            <p>
              DayForge runs your fluff-and-fold operation and learns where the
              profit is. Sage finds your next best move. Then BORESLAY—our
              game for slaying business boredom—turns it into a playable
              mission you finish in the real world.
            </p>
            <div className="ff-hero-actions">
              <TerritoryCta source="hero" onOpen={openScheduler} />
              <span><ShieldCheck /> See the winnable accounts around your store in 15 minutes.</span>
            </div>
            <div className="ff-hero-proof"><b>BUILT WHERE TWO FOUNDER LIVES COLLIDED</b><span>Laundromat operations × cloud gaming</span></div>
          </div>
          <HeroSystem />
          <div className="ff-hero-note"><span>RUN THE STORE</span><i /><span>FIND THE MOVE</span><i /><span>PLAY THE MISSION</span><i /><span>WIN IN REAL LIFE</span></div>
        </section>

        <section className="ff-credline" aria-label="DayForge operating proof">
          <p><span>Built by a laundromat operator</span><i>·</i><span>Built by a cloud-gaming founder</span><i>·</i><span>Running daily in our own LA stores</span><i>·</i><span>Real data in</span><i>·</i><span>Real visits out</span></p>
        </section>

        <OperatingSystemSection />
        <MissionSequence onOpen={openScheduler} missionEndRef={missionEndRef} />
        <GamePayoff />
        <div ref={founderRef}><FounderSection /></div>
        <RecoverySection />
        <PricingSection onOpen={openScheduler} />
        <FaqSection onOpen={openScheduler} faqRef={faqRef} />
      </main>

      <footer className="ff-footer"><DayforgeMark /><p>Built in Los Angeles for owners who still do the work.</p><a href={`mailto:${FALLBACK_EMAIL}`}>{FALLBACK_EMAIL}</a></footer>

      {showSticky ? (
        <aside className={`ff-sticky${schedulerOpen ? " is-dialog-open" : ""}`} aria-label="Map my territory">
          <div><Route /><span><b>What&apos;s around your store?</b><small>See the accounts worth the drive.</small></span></div>
          <TerritoryCta source="sticky" onOpen={openScheduler} tone="ivory" />
        </aside>
      ) : null}
      </div>

      <MobileLanding onOpen={openScheduler} />

      <SchedulerDialog open={schedulerOpen} onClose={() => setSchedulerOpen(false)} returnFocusRef={lastCtaRef} />
    </div>
  );
}
