import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  Crosshair,
  Mail,
  MapPin,
  Navigation,
  Printer,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import bossTheDrain from "@/assets/dayforge-flagship/boss-the-drain.jpg";
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
const OWNER_FIELD_VISIT = "/dayforgeflagship/owner-field-visit.jpg";
const RAW_SCHEDULER_URL = import.meta.env.VITE_SCHEDULER_URL?.trim();

function validatedSchedulerUrl(): string | undefined {
  if (!RAW_SCHEDULER_URL) return undefined;
  try {
    const candidate = new URL(RAW_SCHEDULER_URL);
    return candidate.protocol === "https:" || candidate.protocol === "http:"
      ? candidate.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

const SCHEDULER_URL = validatedSchedulerUrl();

function DayforgeMark() {
  return (
    <a className="ff-mark" href="#top" aria-label="DAYFORGE FOR LAUNDRY">
      <span className="ff-mark-glyph" aria-hidden="true">
        <Zap />
      </span>
      <span className="ff-mark-name">DAYFORGE</span>
      <i aria-hidden="true" />
      <span className="ff-mark-edition">FOR LAUNDRY</span>
    </a>
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

function HeroConsole() {
  return (
    <div
      className="ff-hero-console"
      aria-label="DayForge turns territory intelligence into a real field mission for Westview Property Management"
    >
      <img
        className="ff-hero-art"
        src={OWNER_FIELD_VISIT}
        alt="Concept photo of a laundromat owner approaching a commercial account with collateral"
        width={1200}
        height={900}
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />
      <div className="ff-hero-shade" aria-hidden="true" />

      <div className="ff-console-topline">
        <div>
          <span className="ff-live-dot" aria-hidden="true" />
          MISSION SYSTEM ONLINE
        </div>
        <span>LOS ANGELES · 09:41</span>
      </div>

      <div className="ff-console-sage">
        <header>
          <span>SAGE / TERRITORY</span>
          <b>286 ACCOUNTS CHECKED</b>
        </header>
        <div className="ff-console-sage-row is-active">
          <span>
            <b>Westview Property Management</b>
            <small>15 buildings · 1.4 mi</small>
          </span>
          <strong>$24.8K</strong>
          <em>HIGH</em>
        </div>
        <div className="ff-console-sage-row">
          <span>
            <b>Harborlight Hotel</b>
            <small>44 rooms · 2.1 mi</small>
          </span>
          <strong>$18.2K</strong>
          <em>HIGH</em>
        </div>
      </div>

      <div className="ff-console-path" aria-hidden="true">
        <span className="is-done"><Check /></span>
        <i />
        <span className="is-live"><Crosshair /></span>
        <i />
        <span><Building2 /></span>
      </div>

      <div className="ff-console-mission">
        <span>BORESLAY · MISSION READY</span>
        <strong className="ff-console-title">WIN WESTVIEW</strong>
        <p>
          Westview Property Management — their in-house laundry is draining
          profits. Defeat the Drain and win the contract.
        </p>
        <div>
          <b>EST. CONTRACT · $24,800/YR</b>
          <em>MISSION ACCEPTED</em>
        </div>
      </div>

      <div className="ff-console-phone">
        <div className="ff-phone-notch" aria-hidden="true" />
        <header><span>09:41</span><b>DAYFORGE</b></header>
        <div className="ff-phone-route"><Navigation /> FIELD MISSION</div>
        <span className="ff-phone-label">YOUR NEXT STOP</span>
        <strong className="ff-phone-title">Westview Property Management</strong>
        <p>15 buildings · 1.4 miles</p>
        <div className="ff-phone-value">
          <span>EST. ANNUAL VALUE</span>
          <b>$24,800</b>
        </div>
        <dl>
          <div><dt>ASK FOR</dt><dd>Operations manager</dd></div>
          <div><dt>LEAD WITH</dt><dd>One invoice for 15 buildings</dd></div>
        </dl>
        <button type="button" tabIndex={-1}><Navigation /> PRESS TO DRIVE</button>
      </div>

      <div className="ff-console-outcome">
        <span>INTELLIGENCE</span><i />
        <span>MISSION</span><i />
        <span>REAL VISIT</span>
      </div>
    </div>
  );
}

function SageProduct() {
  return (
    <div className="ff-product-window">
      <header className="ff-product-bar">
        <span><i /><i /><i /></span>
        <b>SAGE · COMMERCIAL TERRITORY</b>
        <em>LIVE</em>
      </header>
      <div className="ff-product-metrics">
        <div><span>ACCOUNTS CHECKED</span><b>286</b></div>
        <div><span>WORTH THE DRIVE</span><b>12</b></div>
        <div><span>TOP OPPORTUNITY</span><b>$24.8K</b></div>
      </div>
      <div className="ff-product-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th><th>Footprint</th><th>Annual value</th><th>Ask for</th><th>Distance</th><th>Win Probability</th>
            </tr>
          </thead>
          <tbody>
            {SAGE_ACCOUNTS.map((account, index) => (
              <tr key={account.account} className={index === 0 ? "is-top" : ""}>
                <td data-label="Account"><b>{account.account}</b></td>
                <td data-label="Footprint">{account.footprint}</td>
                <td data-label="Annual value">{account.annualValue}</td>
                <td data-label="Ask for">{account.decisionMaker}</td>
                <td data-label="Distance">{account.distance}</td>
                <td data-label="Win Probability"><span>{account.probability}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
        <span><Target /> 15 buildings</span>
        <span><TrendingUp /> Est. $24,800/yr</span>
        <span><Building2 /> Ask for operations</span>
      </footer>
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
          <h2 id="ff-sequence-title">
            How does a business on your street become your customer?
          </h2>
          <p>Here&apos;s one mission, start to finish.</p>
        </div>

        <article className="ff-stage is-intelligence">
          <div className="ff-stage-copy">
            <span className="ff-stage-number">01</span>
            <Eyebrow>SAGE PICKS THE ACCOUNT</Eyebrow>
            <h3>Know which door is worth knocking on.</h3>
            <p>
              Sage checks every commercial property near your store. Most
              aren&apos;t worth your gas. One is: a property management company
              running 15 buildings — towels, mats, and tenant laundry worth an
              estimated $24,800 a year. Sage tells you who to ask for and what
              offer makes sense.
            </p>
          </div>
          <SageProduct />
        </article>

        <article className="ff-stage is-mission">
          <div className="ff-stage-copy">
            <span className="ff-stage-number">02</span>
            <Eyebrow>IT BECOMES TODAY&apos;S MISSION</Eyebrow>
            <h3>The boss is the account.</h3>
            <p>
              The opportunity doesn&apos;t go on a list. It lands inside a game
              on your desktop — and it&apos;s today&apos;s mission to complete.
            </p>
          </div>
          <div className="ff-interrupt">
            <header>
              <span>BORESLAY</span>
              <b>TODAY&apos;S MISSION</b>
              <em>01:30</em>
            </header>
            <div className="ff-interrupt-body">
              <img
                src={bossTheDrain}
                alt="Concept render of The Drain — a BORESLAY boss built of invoices, chains, and padlocks"
                width={560}
                height={620}
                loading="lazy"
                decoding="async"
              />
              <div className="ff-interrupt-brief">
                <span>BOSS · THE DRAIN</span>
                <h4>DEFEAT THE DRAIN</h4>
                <p>
                  Westview Property Management — their in-house laundry is
                  draining profits. Defeat the Drain and win the contract.
                </p>
                <b>EST. CONTRACT · $24,800/YR</b>
                <em>
                  <Send /> SEND TO PHONE
                </em>
              </div>
            </div>
          </div>
        </article>

        <article className="ff-stage is-prep">
          <div className="ff-stage-copy">
            <span className="ff-stage-number">03</span>
            <Eyebrow>DAYFORGE PREPS THE VISIT</Eyebrow>
            <h3>Clean polo. Quote sheet. Press to drive.</h3>
            <p>
              First stop isn&apos;t the account — it&apos;s the print shop.
              DayForge already sent your leave-behind: your services, your
              pricing, your name. Pick it up. Keep driving.
            </p>
          </div>
          <div className="ff-prep-visual">
            <img
              src={printedLeaveBehind}
              alt="Concept photo of a commercial laundry leave-behind being picked up at a print shop"
              width={1200}
              height={900}
              loading="lazy"
              decoding="async"
            />
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
            <p>
              Your phone tells you who to ask for, the one benefit to lead
              with, and what to leave behind. Then you walk in.
            </p>
          </div>
          <div className="ff-field-visual">
            <img
              src={OWNER_FIELD_VISIT}
              alt="Concept photo of a laundromat owner approaching a commercial property with collateral"
              width={1200}
              height={900}
              loading="lazy"
              decoding="async"
            />
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
        <div>
          <Eyebrow>YOUR STREET · YOUR NEXT ACCOUNT</Eyebrow>
          <h2>What businesses are you driving past?</h2>
          <p>We&apos;ll map the accounts around your store live in 15 minutes.</p>
        </div>
        <TerritoryCta source="mission" onOpen={onOpen} tone="ivory" />
      </div>
      <div ref={missionEndRef} className="ff-mission-end" aria-hidden="true" />
    </section>
  );
}

function GamePayoff() {
  return (
    <section className="ff-payoff" aria-labelledby="ff-payoff-title">
      <img
        src={victoryAccount}
        alt="Concept render of a BORESLAY champion defeating a fixed-cost boss as a commercial building opens ahead"
        width={1400}
        height={788}
        loading="lazy"
        decoding="async"
      />
      <div className="ff-payoff-shade" aria-hidden="true" />
      <div className="ff-payoff-copy">
        <Eyebrow>WHY IT&apos;S A GAME</Eyebrow>
        <h2 id="ff-payoff-title">Dashboards get ignored. Games get played.</h2>
        <p>
          Every business tool you&apos;ve bought gave you another list of
          things to do. The list lost. Not because you&apos;re lazy — because
          a list has no pull.
        </p>
        <p>
          DayForge is built the other way. Your best opportunity arrives
          inside a game with momentum, progress, and a mission that
          doesn&apos;t end on the screen. You don&apos;t just check DayForge.
          You play it — and the mission walks you out the door.
        </p>
        <div className="ff-name-reveal">
          <b>MEET BORESLAY</b>
          <p>
            The desktop game that turns DayForge&apos;s best sales opportunity
            into today&apos;s real-world mission.
          </p>
        </div>
        <div className="ff-payoff-thesis">
          <span>THE BOSS IS THE PROBLEM.</span>
          <b>THE WIN IS A REAL ACCOUNT.</b>
        </div>
      </div>
      <div className="ff-victory-card">
        <span>MISSION COMPLETE</span>
        <h3>CONTRACT SECURED</h3>
        <strong>+$24,800/YR</strong>
        <small>WESTVIEW PROPERTY MANAGEMENT</small>
      </div>
    </section>
  );
}

function RecoverySection() {
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState("Draft prepared · Nothing sent");
  const [message, setMessage] = useState(
    "Hi Maya — we haven't seen you in a while. We've kept your usual wash-and-fold preferences saved. Want us to schedule a pickup this week?"
  );

  return (
    <section className="ff-recovery" aria-labelledby="ff-recovery-title">
      <div className="ff-shell ff-recovery-grid">
        <div className="ff-recovery-copy">
          <Eyebrow>PROTECT THE BUSINESS YOU ALREADY WON</Eyebrow>
          <h2 id="ff-recovery-title">
            It notices when good customers disappear, too.
          </h2>
          <p>
            Regulars rarely quit out loud. They just stop showing up. DayForge
            catches it early — and writes the first draft of the message that
            brings them back.
          </p>
          <div className="ff-human-control">
            <ShieldCheck />
            <span>
              <b>DayForge investigates and prepares the move.</b>
              You review it, improve it, and decide when it goes out.
            </span>
          </div>
        </div>

        <div className="ff-recovery-ui">
          <div className="ff-quiet-card">
            <header><Sparkles /> CUSTOMER WATCH <span>3 SIGNALS</span></header>
            <p>Top customers went quiet. No complaints filed.</p>
            <table>
              <thead><tr><th>Name</th><th>Monthly value</th><th>Days quiet</th></tr></thead>
              <tbody>
                {QUIET_CUSTOMERS.map(customer => (
                  <tr key={customer.name}>
                    <td>{customer.name}</td><td>{customer.monthlyValue}</td><td>{customer.daysQuiet}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ff-draft-card">
            <header><span>SAGE DRAFT · WIN-BACK</span><small>{status}</small></header>
            <label htmlFor="ff-winback">Message to Maya</label>
            <textarea
              id="ff-winback"
              value={message}
              readOnly={!editing}
              onChange={event => setMessage(event.target.value)}
            />
            <footer>
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setStatus("Editing · Nothing sent");
                  requestAnimationFrame(() => document.getElementById("ff-winback")?.focus());
                }}
              >EDIT</button>
              <button
                type="button"
                className="is-send"
                onClick={() => {
                  setEditing(false);
                  setStatus("Demo — nothing sends without your approval");
                }}
              >
                <Send /> SEND
              </button>
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
        <div className="ff-section-head is-centered">
          <Eyebrow>THE ECONOMICS</Eyebrow>
          <h2 id="ff-pricing-title">
            One account can pay for years of DayForge.
          </h2>
        </div>

        {/* Big honest type only — no chart, no calculator. The example
            doesn't claim measured precision. */}
        <div className="ff-roi-static">
          <span className="ff-roi-label">EXAMPLE MISSION ECONOMICS</span>
          <div className="ff-roi-big">
            <strong>$24,800</strong>
            <span>That property management account — per year</span>
          </div>
          <em className="ff-roi-vs">compared to</em>
          <div className="ff-roi-lesser">
            <strong>$2,388</strong>
            <span>DayForge — $199 a month, for the year</span>
          </div>
          <b className="ff-roi-equals">
            One closed account ≈ 10+ years of DayForge
          </b>
        </div>
        <p className="ff-roi-footnote">
          Illustrative revenue estimate, not profit or a guarantee. Costs and results vary.
        </p>

        <div className="ff-price-card">
          <div className="ff-price-intro">
            <Eyebrow>DAYFORGE OPERATOR</Eyebrow>
            <h3>Everything. One location, one territory.</h3>
          </div>
          <div className="ff-price-amount"><strong>$199</strong><span>/month</span></div>
          <ul>
            {PRICING_FEATURES.map(feature => <li key={feature}><Check /> {feature}</li>)}
          </ul>
          <div className="ff-founding-offer"><Sparkles /><span><b>First 25 operators: $149/month,</b> locked for 12 months.</span></div>
          <TerritoryCta source="pricing" onOpen={onOpen} />
          <p>15-minute demo · No credit card · Cancel anytime, no long contracts · We map your territory live on the call.</p>
        </div>
        <p className="ff-price-proof">
          Built by a laundromat operator. Running daily in our own LA stores.
        </p>
      </div>
    </section>
  );
}

function FaqSection({
  onOpen,
  faqRef,
}: {
  onOpen: (trigger: HTMLButtonElement) => void;
  faqRef: RefObject<HTMLElement | null>;
}) {
  const onToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open) return;
    const questionId = event.currentTarget.dataset.questionId;
    const faq = FAQS.find(item => item.id === questionId);
    if (faq) trackFaqOpen(faq.id);
  };

  return (
    <section ref={faqRef} className="ff-faq" id="faq" aria-labelledby="ff-faq-title">
      <div className="ff-shell ff-faq-grid">
        <div className="ff-faq-intro">
          <Eyebrow>BEFORE YOU BOOK</Eyebrow>
          <h2 id="ff-faq-title">Fair questions.</h2>
        </div>
        <div className="ff-faq-list">
          {FAQS.map((faq, index) => (
            <details key={faq.id} data-question-id={faq.id} onToggle={onToggle}>
              <summary>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <b>{faq.question}</b>
                <ChevronDown />
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>

      <div className="ff-final" id="final-cta">
        <div className="ff-final-grid" aria-hidden="true" />
        <div>
          <Eyebrow>THE NEXT ACCOUNT IS ALREADY OUT THERE</Eyebrow>
          <h2>Stop passing the next account you could win.</h2>
          <p>See the winnable commercial accounts around your store in a 15-minute live demo.</p>
        </div>
        <TerritoryCta source="final" onOpen={onOpen} tone="ivory" />
      </div>
    </section>
  );
}

function SchedulerDialog({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = returnFocusRef.current;
    const triggerSource = trigger?.dataset.ctaSource;
    dialog.showModal();
    document.body.style.overflow = "hidden";
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

  return (
    <dialog
      ref={dialogRef}
      className="ff-scheduler"
      aria-labelledby="ff-scheduler-title"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="ff-scheduler-shell">
        <button className="ff-scheduler-close" type="button" onClick={onClose} aria-label="Close scheduler"><X /></button>
        <div className="ff-scheduler-copy">
          <Eyebrow>15-MINUTE LIVE DEMO</Eyebrow>
          <h2 id="ff-scheduler-title">Let&apos;s map the commercial accounts around your store.</h2>
          <p>Pick a time that works. We&apos;ll map your territory live on the call.</p>
        </div>
        {SCHEDULER_URL ? (
          <div className="ff-scheduler-widget">
            <iframe src={SCHEDULER_URL} title="Schedule your DayForge territory mapping demo" loading="eager" referrerPolicy="strict-origin-when-cross-origin" />
            <a href={SCHEDULER_URL} target="_blank" rel="noreferrer">Open scheduler in a new tab <ArrowUpRight /></a>
          </div>
        ) : (
          <div className="ff-scheduler-fallback">
            <MapPin />
            <h3>The live calendar is being connected.</h3>
            <p>Email Adam and we&apos;ll map your territory together.</p>
            <a className="ff-cta is-cobalt" href={`mailto:${FALLBACK_EMAIL}?subject=Map%20my%20DayForge%20territory`}>
              <Mail /> EMAIL {FALLBACK_EMAIL}
            </a>
          </div>
        )}
      </div>
    </dialog>
  );
}

function updateMetadata() {
  const previousTitle = document.title;
  const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  const previousDescription = description?.content;
  document.title =
    "DayForge for Laundry — Stop driving past businesses that could be paying you";
  if (description) {
    description.content = "DayForge ranks the local commercial accounts you can realistically win — what each could be worth, who to ask for, and what to bring — then turns the best one into a game-driven mission that gets you through the door ready to pitch.";
  }
  return () => {
    document.title = previousTitle;
    if (description && previousDescription !== undefined) description.content = previousDescription;
  };
}

export default function DayforgeFlagship() {
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  const missionEndRef = useRef<HTMLDivElement>(null);
  const faqRef = useRef<HTMLElement>(null);
  const lastCtaRef = useRef<HTMLButtonElement>(null);
  const posterMode =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("poster") === "1";

  useEffect(() => updateMetadata(), []);
  useEffect(() => { void getFlagshipAnalytics(); }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!missionEndRef.current) return;
        const missionPassed = missionEndRef.current.getBoundingClientRect().top <= 0;
        const finalBand = document.getElementById("final-cta");
        const finalReached = finalBand
          ? finalBand.getBoundingClientRect().top <= window.innerHeight
          : false;
        setShowSticky(missionPassed && !finalReached);
      });
    };
    const observer = new IntersectionObserver(update, { threshold: [0, 1] });
    if (missionEndRef.current) observer.observe(missionEndRef.current);
    if (faqRef.current) observer.observe(faqRef.current);
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
    <div className={`ff-page${posterMode ? " is-poster" : ""}`} id="top">
      <a className="ff-skip" href="#ff-main">Skip to content</a>
      <header className="ff-header">
        <DayforgeMark />
        <nav aria-label="Page navigation">
          <a href="#mission">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <span className="ff-header-proof"><i /> OPERATOR-BUILT IN LA</span>
      </header>

      <main id="ff-main">
        <section className="ff-hero" aria-labelledby="ff-hero-title">
          <div className="ff-hero-copy">
            <Eyebrow>FOR LAUNDROMAT &amp; FLUFF-AND-FOLD OWNERS</Eyebrow>
            <h1 id="ff-hero-title">
              Stop driving past businesses that could be paying you.
            </h1>
            <p>
              DayForge ranks the local commercial accounts you can
              realistically win — what each could be worth, who to ask for,
              and what to bring — then turns the best one into a game-driven
              mission that gets you through the door ready to pitch.
            </p>
            <div className="ff-hero-actions">
              <TerritoryCta source="hero" onOpen={openScheduler} />
              <span><ShieldCheck /> Built by a laundromat operator. Running daily in our own LA stores.</span>
            </div>
          </div>
          <HeroConsole />
          <div className="ff-hero-note">
            <span>ONE STORE</span><i /><span>ONE TERRITORY</span><i /><span>ONE MISSION TODAY</span>
          </div>
        </section>

        {/* Reserved slot: swap the middle segments for the first verified
            customer result the day it exists. */}
        <section className="ff-credline" aria-label="DayForge operating proof">
          <p>
            <span>Built by a laundromat operator</span>
            <i aria-hidden="true">·</i>
            <span>Running daily in our own LA stores</span>
            <i aria-hidden="true">·</i>
            <span>Real data in</span>
            <i aria-hidden="true">·</i>
            <span>Real visits out</span>
          </p>
        </section>

        <MissionSequence onOpen={openScheduler} missionEndRef={missionEndRef} />
        <GamePayoff />
        <RecoverySection />
        <PricingSection onOpen={openScheduler} />
        <FaqSection onOpen={openScheduler} faqRef={faqRef} />
      </main>

      <footer className="ff-footer">
        <DayforgeMark />
        <p>Built in Los Angeles for owners who still do the work.</p>
        <a href={`mailto:${FALLBACK_EMAIL}`}>{FALLBACK_EMAIL}</a>
      </footer>

      {showSticky ? (
        <aside className={`ff-sticky${schedulerOpen ? " is-dialog-open" : ""}`} aria-label="Map my territory">
          <div><Route /><span><b>What&apos;s around your store?</b> See the accounts worth the drive.</span></div>
          <TerritoryCta source="sticky" onOpen={openScheduler} tone="ivory" />
        </aside>
      ) : null}

      <SchedulerDialog open={schedulerOpen} onClose={() => setSchedulerOpen(false)} returnFocusRef={lastCtaRef} />
    </div>
  );
}
