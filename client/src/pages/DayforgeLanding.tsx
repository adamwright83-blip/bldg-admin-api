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
import "./dayforge-hero-unified.css";

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

function trackLandingEvent(
  event: string,
  details: Record<string, string | number> = {}
) {
  if (typeof window === "undefined") return;
  const payload = { event, page: "dayforge_landing_final", ...details };
  const trackedWindow = window as Window & {
    dataLayer?: Array<Record<string, unknown>>;
  };
  trackedWindow.dataLayer?.push(payload);
  window.dispatchEvent(
    new CustomEvent("dayforge:conversion", { detail: payload })
  );
}

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
  source = "page",
  className = "",
}: {
  onClick: () => void;
  source?: string;
  className?: string;
}) {
  return (
    <button
      className={`df2-button df2-button-primary ${className}`}
      type="button"
      onClick={() => {
        trackLandingEvent("demo_cta_click", { source });
        onClick();
      }}
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
        <DemoButton
          onClick={onDemo}
          source="header"
          className="df2-header-cta"
        />
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

function HeroSystemVisual() {
  return (
    <div
      className="df3-hero-system"
      aria-label="Live business data flows through Sage into a BORESLAY mission and completed real-world action"
    >
      <img
        className="df3-hero-art"
        src="/assets/dayforge-final/unified-revenue-machine-hero.png"
        alt="A single connected DayForge machine where live business data enters Sage, Sage finds missed revenue, BORESLAY starts a mission, the mission arrives on a phone, and action leads to a laundry visit"
        width={1672}
        height={941}
        decoding="async"
      />
      <a
        className="df3-hero-game-hotspot"
        href="/boreslay-rally"
        aria-label="Play the BORESLAY Rally game shown in the hero"
        title="Play BORESLAY Rally"
      />
    </div>
  );
}

function MissionFlowSection() {
  return (
    <section className="df3-flow-section" id="driver-mission">
      <div className="df3-flow-heading">
        <Eyebrow>How DayForge works</Eyebrow>
        <h2>From live business data to completed action.</h2>
        <p>
          How a real opportunity becomes a completed sales visit—in three steps.
        </p>
      </div>
      <div className="df3-flow-stage">
        <img
          className="df3-flow-art"
          src="/assets/dayforge-final/screen-to-street.png"
          alt="A glass pipeline connecting a desktop game, a mobile mission, and a real-world laundry visit"
          width={1672}
          height={941}
          loading="lazy"
          decoding="async"
        />
        <div className="df3-flow-labels">
          <article>
            <span>1</span>
            <div>
              <b>Start on desktop</b>
              <p>
                Sage finds a missed opportunity and drops it into the game as a
                mission worth real money.
              </p>
            </div>
          </article>
          <article>
            <span>2</span>
            <div>
              <b>Check your phone</b>
              <p>
                See who to contact, what to offer, and exactly what the account
                may be worth.
              </p>
            </div>
          </article>
          <article>
            <span>3</span>
            <div>
              <b>Drive. Meet. Win.</b>
              <p>
                Make the visit, record the outcome, and move the business
                forward.
              </p>
            </div>
          </article>
        </div>
        <a
          className="df3-flow-game"
          href="/boreslay-rally"
          aria-label="Play the real BORESLAY Rally game"
        >
          <img
            src={rallyScreenshot}
            alt="Real BORESLAY Rally gameplay"
            width={1440}
            height={913}
            loading="lazy"
          />
        </a>
        <div
          className="df3-flow-phone"
          aria-label="Example prepared mobile mission"
        >
          <small>New mission</small>
          <b>Sunrise Suites</b>
          <span>40-room hotel</span>
          <strong>$24,800</strong>
          <i>Press to drive</i>
        </div>
      </div>
      <div className="df3-flow-mobile">
        <article>
          <span>1</span>
          <h3>Start on desktop</h3>
          <p>
            Sage finds the opportunity and turns it into a mission inside
            BORESLAY.
          </p>
          <img src={rallyScreenshot} alt="Real BORESLAY Rally gameplay" />
        </article>
        <article>
          <span>2</span>
          <h3>Check your phone</h3>
          <p>The target, value, message, and next move are already prepared.</p>
          <div className="df3-mobile-phone">
            <small>New mission</small>
            <b>Sunrise Suites</b>
            <strong>$24,800 annual value</strong>
            <i>Press to drive</i>
          </div>
        </article>
        <article>
          <span>3</span>
          <h3>Drive. Meet. Win.</h3>
          <p>
            Complete the visit, record the result, and let Sage determine what
            happens next.
          </p>
          <Route />
        </article>
      </div>
      <p className="df3-flow-statement">
        Insight without action does not change the business.{" "}
        <strong>Completed action does.</strong>
      </p>
    </section>
  );
}

function DemoModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState<LeadForm>(EMPTY_FORM);
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const closeRef = useRef<HTMLButtonElement>(null);
  const formStartedRef = useRef(false);

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
    trackLandingEvent("demo_form_submit");
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
      trackLandingEvent("demo_form_complete");
    } catch (error) {
      console.error("[DayForge] demo request failed", error);
      setStatus("error");
      trackLandingEvent("demo_form_error");
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
            <form
              onSubmit={submit}
              onFocusCapture={() => {
                if (formStartedRef.current) return;
                formStartedRef.current = true;
                trackLandingEvent("demo_form_start");
              }}
            >
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

export default function DayforgeLanding() {
  const [demoOpen, setDemoOpen] = useState(false);
  const [showMobileCta, setShowMobileCta] = useState(false);

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

  useEffect(() => {
    const reached = new Set<number>();
    const thresholds = [25, 50, 75, 90];
    const onScroll = () => {
      const maxScroll =
        document.documentElement.scrollHeight - window.innerHeight;
      if (maxScroll <= 0) return;
      const depth = Math.round((window.scrollY / maxScroll) * 100);
      thresholds.forEach(threshold => {
        if (depth >= threshold && !reached.has(threshold)) {
          reached.add(threshold);
          trackLandingEvent("scroll_depth", { percent: threshold });
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const hero = document.querySelector(".df3-hero");
    if (!hero) return;
    const observer = new IntersectionObserver(
      entries => {
        const entry = entries[0];
        if (entry) setShowMobileCta(!entry.isIntersecting);
      },
      { threshold: 0.05 }
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="df2-root" id="top">
      <a className="df2-skip" href="#main">
        Skip to content
      </a>
      <Header onDemo={() => setDemoOpen(true)} />
      <main id="main">
        <section className="df3-hero">
          <HeroSystemVisual />
          <div className="df3-hero-copy">
            <Eyebrow>DayForge for laundry</Eyebrow>
            <h1>
              Find the revenue you’re missing.
              <br />
              <em>Then go get it.</em>
            </h1>
            <p>
              DayForge watches your store’s data, finds the revenue you are
              missing, and turns the next move into a mission you actually
              complete.
            </p>
            <div className="df3-hero-actions">
              <DemoButton onClick={() => setDemoOpen(true)} source="hero" />
              <button
                className="df2-button df2-button-secondary"
                type="button"
                onClick={() => {
                  trackLandingEvent("product_story_click", { source: "hero" });
                  scrollToSection("#driver-mission");
                }}
              >
                See how it works <ChevronRight />
              </button>
            </div>
            <div className="df3-proof-list" aria-label="Product proof points">
              <span>
                <ShieldCheck /> Built for laundry
              </span>
              <span>
                <CircleDollarSign /> Real business data
              </span>
              <span>
                <Target /> Real-world actions
              </span>
            </div>
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

        <MissionFlowSection />

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
              <DemoButton onClick={() => setDemoOpen(true)} source="final" />
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
        className={`df2-mobile-cta${showMobileCta ? " is-visible" : ""}`}
        type="button"
        onClick={() => {
          trackLandingEvent("demo_cta_click", { source: "mobile_sticky" });
          setDemoOpen(true);
        }}
      >
        Book a 15-minute demo <ArrowRight />
      </button>
      <DemoModal open={demoOpen} onClose={() => setDemoOpen(false)} />
    </div>
  );
}
