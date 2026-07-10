import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Compass,
  Menu,
  MessageSquareText,
  Phone,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import rallyScreenshot from "@/assets/boreslay-rally/p5-final-browser-proof.png";
import "./dayforge-landing.css";

const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
const BOOKING_URL: string | undefined = import.meta.env.VITE_BOOKING_URL;

const NAV_ITEMS = [
  ["Product", "#product"],
  ["Sage", "#sage"],
  ["BORESLAY", "#boreslay"],
  ["Switching", "#switching"],
] as const;

const MISSION_TYPES = [
  {
    icon: Users,
    title: "Recover disappearing customers",
    body: "Find valuable customers whose normal ordering pattern suddenly stopped.",
  },
  {
    icon: MessageSquareText,
    title: "Follow up with commercial leads",
    body: "Surface businesses that showed interest but never received the next touch.",
  },
  {
    icon: Compass,
    title: "Visit nearby properties",
    body: "Identify apartments, hotels, salons, gyms, spas, and medical offices in your service area.",
  },
  {
    icon: ShieldCheck,
    title: "Protect valuable relationships",
    body: "Catch unresolved complaints, unusual order changes, and accounts showing signs of leaving.",
  },
  {
    icon: Route,
    title: "Fill weak route days",
    body: "Find customers and prospects near underused routes and prepare focused outreach.",
  },
  {
    icon: TrendingUp,
    title: "Increase order value",
    body: "Identify customers likely to use higher-value or recurring services you already offer.",
  },
] as const;

const OPERATING_CAPABILITIES = [
  [
    "Orders and customers",
    "Active orders, customer history, service preferences, notes, payment status, and recurring behavior.",
  ],
  [
    "Pickup and delivery",
    "Routes, drivers, stops, delivery status, customer communication, and service exceptions.",
  ],
  [
    "Revenue and performance",
    "Sales, order value, customer retention, route productivity, and meaningful changes over time.",
  ],
  [
    "Service recovery",
    "Complaints, missed expectations, open issues, follow-ups, and customers at risk.",
  ],
  [
    "Growth activity",
    "Leads, proposals, outreach, visits, outcomes, and the next required action.",
  ],
] as const;

const OUTCOMES = [
  "Customer reactivated",
  "Follow-up scheduled",
  "Offer requested",
  "Wrong contact information",
  "Customer declined",
  "Service problem discovered",
  "New opportunity identified",
] as const;

type LeadForm = {
  businessName: string;
  name: string;
  email: string;
  phone: string;
};

const EMPTY_FORM: LeadForm = {
  businessName: "",
  name: "",
  email: "",
  phone: "",
};

function scrollToSection(selector: string) {
  document
    .querySelector(selector)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DayforgeMark() {
  return (
    <a className="df2-mark" href="#top" aria-label="DayForge home">
      <span className="df2-mark-glyph" aria-hidden="true">
        <Zap />
      </span>
      <span>DAYFORGE</span>
    </a>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="df2-eyebrow">{children}</span>;
}

function DemoButton({
  onClick,
  className = "",
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={`df2-button df2-button-primary ${className}`}
      type="button"
      onClick={onClick}
    >
      Book a 15-minute demo <ArrowRight />
    </button>
  );
}

function Header({ onDemo }: { onDemo: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="df2-announcement">
        <Sparkles /> Now onboarding founding laundry operators
      </div>
      <header className="df2-header">
        <DayforgeMark />
        <nav className="df2-nav" aria-label="Primary navigation">
          {NAV_ITEMS.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>
        <DemoButton onClick={onDemo} className="df2-header-cta" />
        <button
          className="df2-menu"
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {open ? <X /> : <Menu />}
        </button>
        {open ? (
          <nav className="df2-mobile-nav" aria-label="Mobile navigation">
            {NAV_ITEMS.map(([label, href]) => (
              <a key={href} href={href} onClick={() => setOpen(false)}>
                {label}
              </a>
            ))}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onDemo();
              }}
            >
              Book a demo
            </button>
          </nav>
        ) : null}
      </header>
    </>
  );
}

function SageAnalysis() {
  return (
    <div
      className="df2-analysis"
      aria-label="Example Sage analysis of a revenue decline"
    >
      <header className="df2-analysis-header">
        <span className="df2-sage-avatar">S</span>
        <div>
          <strong>Sage</strong>
          <span>Investigating your business now</span>
        </div>
        <b>Example business analysis</b>
      </header>
      <div className="df2-analysis-body">
        <div className="df2-metric-row">
          <article>
            <span>Revenue — this month</span>
            <strong>$28,420</strong>
            <small className="is-down">
              <TrendingDown />
              40% vs. two months ago
            </small>
          </article>
          <article>
            <span>Repeat orders</span>
            <strong>−37%</strong>
            <small className="is-down">Largest negative change</small>
          </article>
          <article>
            <span>Average order value</span>
            <strong>$48.70</strong>
            <small className="is-stable">Stable</small>
          </article>
        </div>
        <div className="df2-sage-message">
          <span>Sage</span>
          <strong>
            Revenue is down 40% from two months ago. I’m checking what changed.
          </strong>
        </div>
        <div className="df2-checked">
          <span>What I checked</span>
          <div>
            <b>
              <Check /> Routes normal
            </b>
            <b>
              <Check /> Order value stable
            </b>
            <b>
              <Check /> New customers stable
            </b>
            <b className="is-alert">! Repeat orders down 37%</b>
          </div>
        </div>
        <article className="df2-root-cause">
          <span>I found the main cause.</span>
          <h3>18 high-value customers haven’t ordered in 60+ days.</h3>
          <div>
            <b>
              <strong>$14,860</strong> prior 90-day revenue
            </b>
            <b>
              <strong>12</strong> no open service issues
            </b>
            <b>
              <strong>8</strong> best targets ranked
            </b>
          </div>
          <footer>
            <p>I drafted a personal follow-up for every target.</p>
            <button
              type="button"
              onClick={() => scrollToSection("#mission-ready")}
            >
              Review customers
            </button>
            <a href="/boreslay-rally">
              Start mission <ArrowRight />
            </a>
          </footer>
        </article>
      </div>
    </div>
  );
}

function DemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

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
          name: form.name.trim(),
          building_name: form.businessName.trim(),
          role: "Laundry owner or operator",
          email: form.email.trim(),
          phone: form.phone.trim(),
          number_of_units: "Laundry business",
          source: "dayforge_landing_final",
          source_url: window.location.href,
          notes:
            "Requested a 15-minute DayForge demo focused on finding recoverable revenue.",
        }),
      });
      if (!response.ok)
        throw new Error(`Lead submission failed (${response.status})`);
      setStatus("success");
    } catch (error) {
      console.error("[DayForge] demo request failed", error);
      setStatus("error");
    }
  };

  return (
    <div
      className="df2-modal-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="df2-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="df2-modal-title"
      >
        <button
          ref={closeRef}
          className="df2-modal-close"
          type="button"
          aria-label="Close demo form"
          onClick={onClose}
        >
          <X />
        </button>
        {status === "success" ? (
          <div className="df2-modal-success" aria-live="polite">
            <CheckCircle2 />
            <Eyebrow>Your request is in</Eyebrow>
            <h2 id="df2-modal-title">
              Let’s find the revenue hiding in your business.
            </h2>
            <p>
              We’ll use the information you sent to make the conversation about
              your operation—not a canned sales deck.
            </p>
            {BOOKING_URL ? (
              <a
                className="df2-button df2-button-primary"
                href={BOOKING_URL}
                target="_blank"
                rel="noreferrer"
              >
                Choose your 15-minute time <ArrowRight />
              </a>
            ) : (
              <p className="df2-modal-note">
                Adam will follow up directly to choose a time.
              </p>
            )}
          </div>
        ) : (
          <>
            <Eyebrow>See DayForge on your business</Eyebrow>
            <h2 id="df2-modal-title">Book a focused 15-minute demo.</h2>
            <p>
              Tell us where to reach you. We’ll show how Sage can find a real
              opportunity and turn it into a mission.
            </p>
            <form onSubmit={submit}>
              <label>
                Business name
                <input
                  required
                  minLength={2}
                  autoComplete="organization"
                  value={form.businessName}
                  onChange={event =>
                    setForm(value => ({
                      ...value,
                      businessName: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Your name
                <input
                  required
                  minLength={2}
                  autoComplete="name"
                  value={form.name}
                  onChange={event =>
                    setForm(value => ({ ...value, name: event.target.value }))
                  }
                />
              </label>
              <div>
                <label>
                  Email
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={event =>
                      setForm(value => ({
                        ...value,
                        email: event.target.value,
                      }))
                    }
                  />
                </label>
                <label>
                  Phone
                  <input
                    required
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    minLength={10}
                    value={form.phone}
                    onChange={event =>
                      setForm(value => ({
                        ...value,
                        phone: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
              {status === "error" ? (
                <p className="df2-form-error" role="alert">
                  That did not go through. Please try once more or email{" "}
                  <a href="mailto:adam@bldg.chat">adam@bldg.chat</a>.
                </p>
              ) : null}
              <button
                className="df2-button df2-button-primary"
                type="submit"
                disabled={status === "submitting"}
              >
                {status === "submitting" ? "Sending…" : "Request my demo"}
                <ArrowRight />
              </button>
              <small>Direct follow-up only. No spam or list-selling.</small>
            </form>
          </>
        )}
      </section>
    </div>
  );
}

function PhoneMission() {
  return (
    <div className="df2-phone-wrap">
      <div className="df2-phone">
        <header>
          <span>DAYFORGE DRIVER</span>
          <b>MISSION 1 OF 8</b>
        </header>
        <div className="df2-phone-progress">
          <i />
        </div>
        <Eyebrow>Recover customer</Eyebrow>
        <h3>Sarah Johnson</h3>
        <dl>
          <div>
            <dt>Previous value</dt>
            <dd>$1,240 / 6 months</dd>
          </div>
          <div>
            <dt>Last order</dt>
            <dd>74 days ago</dd>
          </div>
          <div>
            <dt>Known issue</dt>
            <dd>None</dd>
          </div>
        </dl>
        <article>
          <span>Recommended action</span>
          <p>
            Call Sarah and ask whether her pickup schedule changed. Mention that
            Tuesday evening service is now available in her area.
          </p>
        </article>
        <blockquote>
          “Hi Sarah, this is Adam from Sunset Laundry. I noticed it has been a
          little while since your last pickup…”
        </blockquote>
        <button type="button">
          <Phone /> Start call
        </button>
        <a href="#product">View customer history</a>
      </div>
      <aside>
        <Sparkles />
        <span>Prepared by Sage</span>
        <b>No blank page. No searching for what to say.</b>
      </aside>
    </div>
  );
}

export default function DayforgeLanding() {
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute("content") ?? null;
    document.title = "DayForge — Find the revenue you’re missing";
    meta?.setAttribute(
      "content",
      "DayForge helps laundry operators find recoverable revenue, understand what changed, and turn the next growth action into a BORESLAY mission built for completion."
    );
    return () => {
      document.title = previousTitle;
      if (meta && previousDescription !== null)
        meta.setAttribute("content", previousDescription);
    };
  }, []);

  return (
    <div className="df2-root" id="top">
      <a className="df2-skip" href="#main">
        Skip to content
      </a>
      <Header onDemo={() => setDemoOpen(true)} />
      <main id="main">
        <section className="df2-hero">
          <div className="df2-hero-copy">
            <Eyebrow>DayForge for laundry</Eyebrow>
            <h1>
              Find the revenue you’re missing.
              <br />
              <em>Then go get it.</em>
            </h1>
            <p>
              DayForge runs the day. Sage finds what changed and why. BORESLAY
              turns the next move into a mission you actually complete.
            </p>
            <div className="df2-hero-actions">
              <DemoButton onClick={() => setDemoOpen(true)} />
              <button
                className="df2-button df2-button-secondary"
                type="button"
                onClick={() => scrollToSection("#story")}
              >
                Watch the product story <ChevronRight />
              </button>
            </div>
            <div className="df2-proof-list" aria-label="Product proof points">
              <span>
                <Check /> Laundry-built
              </span>
              <span>
                <Check /> Real business data
              </span>
              <span>
                <Check /> Real-world actions
              </span>
            </div>
            <div className="df2-story-steps">
              <b>One hero. One continuous sales story.</b>
              <ol>
                <li>Sage spots the revenue drop.</li>
                <li>Sage proves the cause.</li>
                <li>BORESLAY gets the recovery done.</li>
              </ol>
            </div>
          </div>
          <div className="df2-hero-visual">
            <SageAnalysis />
            <a
              className="df2-rally-peek"
              href="/boreslay-rally"
              aria-label="Open the real BORESLAY Rally game"
            >
              <img
                src={rallyScreenshot}
                alt="Real BORESLAY Rally game showing Spark battling Clockhead"
                width={1440}
                height={913}
                decoding="async"
              />
              <span>
                <b>Real in-game capture</b> Open BORESLAY Rally <ArrowRight />
              </span>
            </a>
          </div>
        </section>

        <div className="df2-proof-bar">
          <span>Built from inside a working laundry business</span>
          <b>Orders</b>
          <b>Customers</b>
          <b>Routes</b>
          <b>Revenue</b>
          <b>Follow-through</b>
        </div>

        <section className="df2-problem" id="story">
          <div>
            <Eyebrow>Your software records what happened</Eyebrow>
            <h2>But it does not make sure you do something about it.</h2>
          </div>
          <div className="df2-problem-copy">
            <p>
              A customer stops ordering. A profitable route begins shrinking. A
              commercial lead goes untouched.
            </p>
            <p>
              A promising follow-up gets postponed until tomorrow, then
              disappears beneath another full day of work.
            </p>
            <p>
              The information may already exist inside your business. The
              missing piece is turning that information into the right
              action—and getting that action completed.
            </p>
            <strong>DayForge was built to close that gap.</strong>
          </div>
        </section>

        <section className="df2-sage-section" id="sage">
          <div className="df2-section-copy">
            <Eyebrow>Meet Sage</Eyebrow>
            <h2>Sage watches the business you are too busy running.</h2>
            <p>
              Sage reads your orders, customers, routes, revenue, service
              history, and operating patterns. It does not simply show you
              another dashboard.
            </p>
            <p>
              It notices when something important changes, investigates the
              cause, and explains what deserves your attention.
            </p>
            <ul className="df2-checks">
              <li>
                <X /> No digging through reports
              </li>
              <li>
                <X /> No guessing which number matters
              </li>
              <li>
                <X /> No generic list of recommendations
              </li>
              <li>
                <X /> No chatbot waiting for the perfect question
              </li>
            </ul>
            <strong className="df2-closing">
              Sage begins with the problem, then works backward to the cause.
            </strong>
          </div>
          <div className="df2-chat-card">
            <header>
              <span className="df2-sage-avatar">S</span>
              <div>
                <b>Sage</b>
                <small>Business investigation</small>
              </div>
            </header>
            <article>
              <span>Signal detected</span>
              <p>Revenue is 40% lower than it was two months ago.</p>
            </article>
            <div>
              <i>1</i>
              <p>Checking order value and new-customer volume…</p>
            </div>
            <div>
              <i>2</i>
              <p>Comparing route performance and service problems…</p>
            </div>
            <div>
              <i>3</i>
              <p>Reviewing repeat-order behavior…</p>
            </div>
            <footer>
              <Sparkles /> Finding the cause before recommending the action
            </footer>
          </div>
        </section>

        <section className="df2-diagnostic" id="product">
          <div className="df2-section-heading">
            <Eyebrow>From alert to answer</Eyebrow>
            <h2>“Revenue is down” is not useful enough.</h2>
            <p>
              A decline could come from lower order values, route problems, lost
              accounts, unresolved complaints, or customers quietly
              disappearing. Sage checks the evidence first.
            </p>
          </div>
          <div className="df2-diagnostic-grid">
            <div className="df2-diagnostic-checks">
              <article>
                <Route />
                <span>Routes</span>
                <b>Operating normally</b>
                <CheckCircle2 />
              </article>
              <article>
                <CircleDollarSign />
                <span>Average order value</span>
                <b>Stable</b>
                <CheckCircle2 />
              </article>
              <article>
                <Users />
                <span>New customers</span>
                <b>No material change</b>
                <CheckCircle2 />
              </article>
              <article className="is-problem">
                <TrendingDown />
                <span>Repeat orders</span>
                <b>Down 37%</b>
                <TrendingDown />
              </article>
            </div>
            <article className="df2-conclusion">
              <Eyebrow>I found the main cause</Eyebrow>
              <h3>
                18 valuable customers have not ordered in more than 60 days.
              </h3>
              <p>
                These customers generated <strong>$14,860</strong> during the
                previous 90-day period.
              </p>
              <div>
                <span>
                  <b>12</b>No unresolved service issue
                </span>
                <span>
                  <b>8</b>Strong recovery candidates
                </span>
              </div>
              <footer>
                Now you know what changed, why it changed, and where the fastest
                recoverable revenue may be hiding.
              </footer>
            </article>
          </div>
        </section>

        <section className="df2-preparation" id="mission-ready">
          <div className="df2-section-copy">
            <Eyebrow>Not another to-do list</Eyebrow>
            <h2>Sage does the preparation before asking you to act.</h2>
            <p>
              Finding the opportunity is only half the work. Sage organizes the
              targets, reviews the history, identifies possible objections, and
              prepares the next action for each customer.
            </p>
            <div className="df2-inline-actions">
              <button
                className="df2-button df2-button-secondary"
                type="button"
                onClick={() => scrollToSection("#driver-mission")}
              >
                Review customers
              </button>
              <a className="df2-button df2-button-green" href="/boreslay-rally">
                Turn this into a BORESLAY mission <ArrowRight />
              </a>
            </div>
          </div>
          <div className="df2-plan-card">
            <header>
              <Target />
              <div>
                <Eyebrow>Customer recovery plan ready</Eyebrow>
                <h3>Eight targets, ranked and prepared</h3>
              </div>
            </header>
            <div className="df2-plan-columns">
              <article>
                <span>Ranked by</span>
                <ul>
                  <li>Previous revenue</li>
                  <li>Time since last order</li>
                  <li>Service history</li>
                  <li>Order frequency</li>
                  <li>Likelihood of returning</li>
                </ul>
              </article>
              <article>
                <span>Prepared for each</span>
                <ul>
                  <li>Personal reason to reach out</li>
                  <li>Relevant order history</li>
                  <li>Recommended offer or message</li>
                  <li>Call, text, or follow-up action</li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="df2-handoff" id="boreslay">
          <div>
            <Eyebrow>This is where normal software stops</Eyebrow>
            <h2>Knowing the next move is not the same as making it.</h2>
          </div>
          <div>
            <p>
              Business owners rarely fail because nobody told them that sales
              matter. They fail because the uncomfortable action gets delayed.
            </p>
            <p>
              The call feels awkward. The visit feels inconvenient. The
              follow-up loses to the emergency already happening inside the
              store.
            </p>
            <strong>
              BORESLAY turns Sage’s recommendation into a mission with urgency,
              stakes, progress, and a clear finish line.
            </strong>
          </div>
          <footer>
            <span>Sage finds the opportunity.</span>
            <ArrowRight />
            <b>BORESLAY gets you to act on it.</b>
          </footer>
        </section>

        <section className="df2-game-section">
          <div className="df2-section-heading is-light">
            <Eyebrow>The business mission enters the match</Eyebrow>
            <h2>Your next sales action becomes part of the fight.</h2>
            <p>
              You are in the middle of a BORESLAY match. Spark is battling
              Clockhead. The game is not a reward pasted onto the software—the
              live business opportunity becomes part of the game itself.
            </p>
          </div>
          <div className="df2-game-frame">
            <img
              src={rallyScreenshot}
              alt="Live BORESLAY Rally gameplay with Spark returning an attack to Clockhead"
              width={1440}
              height={913}
              loading="lazy"
              decoding="async"
            />
            <article>
              <Eyebrow>Sage mission interrupts the match</Eyebrow>
              <h3>Reactivate 8 high-value customers</h3>
              <p>Estimated revenue at risk</p>
              <strong>$12,400</strong>
              <a href="/boreslay-rally">
                Open mission <ArrowRight />
              </a>
            </article>
          </div>
          <div className="df2-closer-line">
            <span>Closer:</span> “I can hold this off for 20 seconds. Sage found
            a revenue recovery mission. Check your phone now.”
          </div>
        </section>

        <section className="df2-driver" id="driver-mission">
          <div className="df2-section-copy">
            <Eyebrow>From the game to the real world</Eyebrow>
            <h2>The mission tells you exactly what to do next.</h2>
            <p>
              The DayForge Driver app opens with the first prepared action. You
              are not handed “do more sales.” You receive a specific person,
              account, destination, message, or objective.
            </p>
            <strong className="df2-closing">
              The blank page is gone. The next move is ready.
            </strong>
          </div>
          <PhoneMission />
        </section>

        <section className="df2-progress">
          <div className="df2-section-heading">
            <Eyebrow>Complete the work. Continue the fight.</Eyebrow>
            <h2>Every completed action changes what happens next.</h2>
            <p>
              Record the outcome immediately after the call, visit, text, or
              follow-up. DayForge updates the customer record. Sage determines
              the next step. BORESLAY rewards completed action and resumes the
              match.
            </p>
          </div>
          <div className="df2-outcomes">
            {OUTCOMES.map(outcome => (
              <span key={outcome}>
                <Check />
                {outcome}
              </span>
            ))}
          </div>
          <article className="df2-reward">
            <Zap />
            <div>
              <Eyebrow>Mission complete</Eyebrow>
              <h3>Success Rock earned. Triple-Power counterattack unlocked.</h3>
            </div>
            <b>+1</b>
          </article>
          <p className="df2-center-closing">
            The reward is not for opening a report. It is for completing the
            business action.
          </p>
        </section>

        <section className="df2-missions">
          <div className="df2-section-heading">
            <Eyebrow>Missions based on the business you actually run</Eyebrow>
            <h2>
              Sage can turn different opportunities into different missions.
            </h2>
            <p>
              The mission changes because the opportunity changes. The system
              remains the same: find it, prepare it, complete it, record the
              result.
            </p>
          </div>
          <div className="df2-mission-grid">
            {MISSION_TYPES.map(({ icon: Icon, title, body }, index) => (
              <article key={title}>
                <span>0{index + 1}</span>
                <Icon />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="df2-expedition">
          <div className="df2-section-copy">
            <Eyebrow>Some sales cannot happen from a desk</Eyebrow>
            <h2>DayForge can send you out the door prepared.</h2>
            <p>
              For high-value local opportunities, Sage can build a complete
              field mission: research, pitch, leave-behind, route, and a clear
              definition of success.
            </p>
            <strong className="df2-closing">
              It does not merely advise you to pursue local partnerships. It
              prepares the pursuit and helps carry it through.
            </strong>
          </div>
          <article className="df2-expedition-card">
            <header>
              <Compass />
              <div>
                <Eyebrow>Win the building</Eyebrow>
                <h3>The Marlowe Apartments</h3>
              </div>
            </header>
            <div className="df2-expedition-stats">
              <span>
                <b>42</b>potential recurring customers
              </span>
              <span>
                <b>Luxury residential</b>pickup partnership
              </span>
            </div>
            <ol>
              <li>Review the property briefing</li>
              <li>Open the prepared manager pitch</li>
              <li>Pick up the printed leave-behind</li>
              <li>Navigate to the building</li>
              <li>Ask for resident services</li>
              <li>Record the result before leaving</li>
            </ol>
            <button type="button" onClick={() => scrollToSection("#contact")}>
              Begin expedition <ArrowRight />
            </button>
          </article>
        </section>

        <section className="df2-operating">
          <div className="df2-section-heading is-light">
            <Eyebrow>The operating system beneath the missions</Eyebrow>
            <h2>
              Sales intelligence is only useful when it understands the
              operation.
            </h2>
            <p>
              DayForge brings the daily business into one operating view so Sage
              can reason from what is actually happening.
            </p>
          </div>
          <div className="df2-capability-grid">
            {OPERATING_CAPABILITIES.map(([title, body], index) => (
              <article key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <footer>
            <b>DayForge runs the business.</b>
            <b>Sage understands the business.</b>
            <b>BORESLAY gets the growth work completed.</b>
          </footer>
        </section>

        <section className="df2-operators">
          <div className="df2-section-copy">
            <Eyebrow>Useful on the first day</Eyebrow>
            <h2>
              You should not need an analyst to understand your own business.
            </h2>
            <p>
              DayForge is designed for owners moving between customers,
              employees, machines, routes, problems, and sales opportunities.
            </p>
          </div>
          <div className="df2-operator-points">
            <p>
              <CheckCircle2 />
              <span>
                <b>Plain language</b>Sage explains what it sees without
                analyst-speak.
              </span>
            </p>
            <p>
              <CheckCircle2 />
              <span>
                <b>Evidence attached</b>Every recommendation connects to the
                business record.
              </span>
            </p>
            <p>
              <CheckCircle2 />
              <span>
                <b>Defined action</b>Every mission has a clear finish line.
              </span>
            </p>
            <p>
              <CheckCircle2 />
              <span>
                <b>Closed loop</b>Every result returns to the operating record.
              </span>
            </p>
          </div>
        </section>

        <section className="df2-switching" id="switching">
          <div className="df2-section-heading">
            <Eyebrow>
              You do not have to rebuild the business to improve it
            </Eyebrow>
            <h2>Start with the data and workflow you already have.</h2>
            <p>
              The goal is not disruption for its own sake. The goal is a clearer
              business and more completed growth actions.
            </p>
          </div>
          <div className="df2-switch-steps">
            <article>
              <b>01</b>
              <h3>Connect or import the history</h3>
              <p>
                Bring in the customer, order, route, and revenue data needed for
                a baseline.
              </p>
            </article>
            <article>
              <b>02</b>
              <h3>Confirm how the operation works</h3>
              <p>
                Define services, operating areas, route patterns, and actions
                your team can perform.
              </p>
            </article>
            <article>
              <b>03</b>
              <h3>Let Sage establish the baseline</h3>
              <p>
                Identify meaningful changes, risks, and opportunities from
                normal behavior.
              </p>
            </article>
            <article>
              <b>04</b>
              <h3>Launch the first mission</h3>
              <p>
                Choose a contained opportunity, complete the action, and measure
                the result.
              </p>
            </article>
          </div>
        </section>

        <section className="df2-comparison">
          <div className="df2-section-heading">
            <Eyebrow>Software usually ends at the recommendation</Eyebrow>
            <h2>DayForge is built around completion.</h2>
          </div>
          <div className="df2-comparison-table">
            <div>
              <span>Traditional dashboard</span>
              <p>Here is what happened.</p>
              <b>Sage</b>
              <strong>
                Here is what changed, why it changed, and what may be
                recoverable.
              </strong>
            </div>
            <div>
              <span>Traditional CRM</span>
              <p>Here is a list of people you should contact.</p>
              <b>Sage</b>
              <strong>
                Here are the strongest targets, the evidence, and the prepared
                action.
              </strong>
            </div>
            <div>
              <span>Traditional task manager</span>
              <p>Remember to follow up.</p>
              <b>BORESLAY</b>
              <strong>
                Complete this specific action now to advance the mission.
              </strong>
            </div>
            <div>
              <span>Traditional business game</span>
              <p>Play to earn fictional progress.</p>
              <b>BORESLAY</b>
              <strong>Real business progress changes the game.</strong>
            </div>
          </div>
          <p className="df2-center-closing">
            Operating data becomes understanding. Understanding becomes a
            mission. The mission becomes completed work.
          </p>
        </section>

        <section className="df2-worlds">
          <div className="df2-world-art" aria-hidden="true">
            <img
              src="/assets/boreslay-sections/final-panorama.webp"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <img
              src="/assets/boreslay-hero/spark-reference.png"
              alt=""
              loading="lazy"
              decoding="async"
            />
            <span>YOUR BUSINESS. YOUR WORLD.</span>
          </div>
          <div className="df2-section-copy">
            <Eyebrow>
              Your business does not have to look like every other dashboard
            </Eyebrow>
            <h2>
              The operating system can live inside a world your team wants to
              enter.
            </h2>
            <p>
              DayForge can present the business through a custom visual world
              built around your company, team, goals, and game experience.
            </p>
            <p>
              The world does not replace the operating truth beneath it. It
              gives that truth a more engaging place to live.
            </p>
            <div className="df2-world-chips">
              <span>Custom characters</span>
              <span>Company environments</span>
              <span>Branded missions</span>
              <span>Team progress</span>
              <span>Business milestones</span>
            </div>
          </div>
        </section>

        <section className="df2-founder">
          <div className="df2-founder-mark">
            <span>AW</span>
            <small>
              Founder-built
              <br />
              operator-tested
            </small>
          </div>
          <div>
            <Eyebrow>Built from inside a working laundry business</Eyebrow>
            <h2>DayForge was not imagined from a conference room.</h2>
            <p>
              It was shaped inside pickups, deliveries, customer problems, route
              pressure, staff communication, revenue questions, commercial
              sales, and the constant conflict between urgent work and important
              growth.
            </p>
            <p>
              An owner rarely needs one more screen explaining that sales should
              happen. The owner needs the opportunity identified, the work
              prepared, and a system that helps make the action happen before
              the day consumes it.
            </p>
            <strong>
              Built for the operator who knows what must be done—and needs a
              better system for actually getting it done.
            </strong>
          </div>
        </section>

        <section className="df2-final" id="contact">
          <div>
            <Eyebrow>
              Your next opportunity may already be inside your business
            </Eyebrow>
            <h2>
              Let Sage find it.
              <br />
              <em>Let BORESLAY get it done.</em>
            </h2>
            <p>
              See how DayForge can read your operating data, explain what
              deserves attention, and turn the next growth action into a mission
              built for completion.
            </p>
            <div>
              <DemoButton onClick={() => setDemoOpen(true)} />
              <button
                className="df2-button df2-button-inverse"
                type="button"
                onClick={() => scrollToSection("#story")}
              >
                See the product story <ChevronRight />
              </button>
            </div>
            <small>
              <Check /> 15 focused minutes <Check /> Built around your operation{" "}
              <Check /> No generic sales deck
            </small>
          </div>
        </section>
      </main>

      <footer className="df2-footer">
        <DayforgeMark />
        <p>
          DayForge runs the day. Sage finds the opportunity. BORESLAY gets you
          to act.
        </p>
        <a href="mailto:adam@bldg.chat">adam@bldg.chat</a>
      </footer>
      <button
        className="df2-mobile-cta"
        type="button"
        onClick={() => setDemoOpen(true)}
      >
        Book a 15-minute demo <ArrowRight />
      </button>
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
