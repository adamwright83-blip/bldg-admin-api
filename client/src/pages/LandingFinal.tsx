import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Flame,
  Hand,
  MapPin,
  Navigation,
  Pencil,
  Plus,
  Printer,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  Wind,
  X,
  Zap,
} from "lucide-react";
import arenaBg from "@/assets/boreslay-rally/arena-background.webp";
import clocklordArt from "@/assets/boreslay-rally/clockhead-villain.webp";
import sparkBreath from "@/assets/landing-final/spark-breath.png";
import sparkVictory from "@/assets/landing-final/spark-victory.png";
import "./landing-final.css";

/**
 * DayForge for Laundry — final landing page (/landingfinal).
 * Forked from the shared DayForge landing; /dayforge is untouched.
 *
 * Env (set in Vercel, then redeploy — Vite inlines at build time):
 *   VITE_SCHEDULER_URL  — booking widget embedded in the MAP MY TERRITORY modal
 *   VITE_POSTHOG_KEY    — PostHog project key (analytics disabled when absent)
 *   VITE_POSTHOG_HOST   — optional, defaults to https://us.i.posthog.com
 */

const SCHEDULER_URL: string | undefined = import.meta.env.VITE_SCHEDULER_URL;
const POSTHOG_KEY: string | undefined = import.meta.env.VITE_POSTHOG_KEY;
const POSTHOG_HOST: string =
  import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

type PosthogLike = {
  capture: (event: string, properties?: Record<string, unknown>) => void;
};

let posthogClient: PosthogLike | null = null;
let posthogLoading = false;

function initAnalytics() {
  if (!POSTHOG_KEY || posthogClient || posthogLoading) return;
  posthogLoading = true;
  import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        defaults: "2025-05-24",
        capture_pageview: true,
        autocapture: true,
        person_profiles: "identified_only",
      });
      posthogClient = posthog;
    })
    .catch(error => {
      posthogLoading = false;
      console.error("[LandingFinal] PostHog failed to load", error);
    });
}

function track(event: string, properties: Record<string, unknown> = {}) {
  posthogClient?.capture(event, properties);
}

const CTA_LABEL = "MAP MY TERRITORY";
const CTA_NOTE =
  "See the winnable accounts around your store in a 15-minute live demo.";
const PROOF_LINE =
  "Built by a laundromat operator. Running daily in our own LA stores.";

type CtaSource = "hero" | "mission" | "sticky" | "pricing" | "final";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

function DayforgeMark() {
  return (
    <a className="lf-mark" href="#top" aria-label="DayForge home">
      <span className="lf-mark-glyph" aria-hidden="true">
        <Zap />
      </span>
      <span>DAYFORGE</span>
    </a>
  );
}

function MapCta({
  source,
  onOpen,
  note = CTA_NOTE,
}: {
  source: CtaSource;
  onOpen: () => void;
  note?: string | null;
}) {
  return (
    <div>
      <button
        className="lf-btn"
        type="button"
        onClick={() => {
          track("cta_click", { source });
          onOpen();
        }}
      >
        {CTA_LABEL} <ArrowRight />
      </button>
      {note ? <p className="lf-btn-note">{note}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Concept-render game scene (composed from BORESLAY concept art)      */
/* ------------------------------------------------------------------ */

function GameScene({
  mode,
  compact = false,
}: {
  mode: "interrupt" | "victory";
  compact?: boolean;
}) {
  const label =
    mode === "interrupt"
      ? "BORESLAY concept scene: the dragon faces the Clocklord as today's mission arrives — Westview Property Management, worth $24,800 a year"
      : "BORESLAY concept scene: victory over the Clocklord — contract secured, $24,800 a year";
  return (
    <div
      className={`lf-scene lf-shot${mode === "victory" ? " is-victory" : ""}${compact ? " is-compact" : ""}`}
      role="img"
      aria-label={label}
    >
      <img
        className="lf-scene-bg"
        src={arenaBg}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <div className="lf-scene-hud" aria-hidden="true">
        <span className="lf-hud-title">BORESLAY</span>
        <span className="lf-hud-meter">
          <i style={{ width: mode === "victory" ? "96%" : "58%" }} />
        </span>
        <span className="lf-hud-timer">
          {mode === "victory" ? "00:07" : "01:30"}
        </span>
      </div>
      <img
        className="lf-scene-dragon"
        src={mode === "victory" ? sparkVictory : sparkBreath}
        alt=""
        loading="lazy"
        decoding="async"
      />
      <img
        className="lf-scene-boss"
        src={clocklordArt}
        alt=""
        loading="lazy"
        decoding="async"
      />
      {mode === "interrupt" ? (
        <div className="lf-plaque" aria-hidden="true">
          <div className="lf-plaque-kicker">Today’s mission</div>
          <div className="lf-plaque-title">Defeat the Clocklord</div>
          <p className="lf-plaque-body">
            Westview Property Management — their in-house laundry is draining
            profits. Defeat the Clocklord and win the contract.
          </p>
          <span className="lf-plaque-cta">
            Send to phone <Send />
          </span>
        </div>
      ) : (
        <div className="lf-victory-banner" aria-hidden="true">
          <div className="lf-victory-word">Victory</div>
          <div className="lf-victory-plaque">
            Contract secured · <b>+$24,800/yr</b>
          </div>
        </div>
      )}
      <div className="lf-scene-abilities" aria-hidden="true">
        <span className="lf-ability">
          <i>
            <Flame />
          </i>
          Breath
        </span>
        <span className="lf-ability">
          <i>
            <Wind />
          </i>
          Dash
        </span>
        <span className="lf-ability">
          <i>
            <ScrollText />
          </i>
          Red tape
        </span>
        <span className="lf-ability">
          <i>
            <Hand />
          </i>
          Hard no
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sage desktop mockup                                                 */
/* ------------------------------------------------------------------ */

function SageWindow({ mini = false }: { mini?: boolean }) {
  return (
    <div
      className="lf-sage-window lf-shot"
      role="img"
      aria-label="Sage ranking table: Westview Property Management ranked first at an estimated $24,800 a year with high win probability"
    >
      <div className="lf-sage-titlebar">
        <span className="lf-sage-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <b>Sage — Commercial territory · 3 miles around your store</b>
      </div>
      {!mini ? (
        <div className="lf-sage-summary">
          <Sparkles />
          <span>
            Checked <b>247</b> commercial properties near you ·{" "}
            <b>4 worth a visit</b>
          </span>
        </div>
      ) : null}
      <table className="lf-sage-table">
        <thead>
          <tr>
            <th>Business</th>
            <th>Est. value / yr</th>
            <th>Win probability</th>
          </tr>
        </thead>
        <tbody>
          <tr className="lf-row-hot">
            <td>
              <b>Westview Property Management</b>
              <small>15 buildings · towels, mats, tenant laundry</small>
            </td>
            <td className="lf-num">$24,800</td>
            <td>
              <span className="lf-chip lf-chip-high">HIGH</span>
            </td>
          </tr>
          <tr>
            <td>
              <b>Harbor Inn &amp; Suites</b>
              <small>40-room hotel · linens</small>
            </td>
            <td className="lf-num">$18,200</td>
            <td>
              <span className="lf-chip lf-chip-high">HIGH</span>
            </td>
          </tr>
          {!mini ? (
            <>
              <tr>
                <td>
                  <b>Glow Salon Group</b>
                  <small>3 locations · towel service</small>
                </td>
                <td className="lf-num">$6,900</td>
                <td>
                  <span className="lf-chip lf-chip-med">MEDIUM</span>
                </td>
              </tr>
              <tr>
                <td>
                  <b>Iron Tide Gym</b>
                  <small>Member towels · daily volume</small>
                </td>
                <td className="lf-num">$4,300</td>
                <td>
                  <span className="lf-chip lf-chip-med">MEDIUM</span>
                </td>
              </tr>
            </>
          ) : null}
          <tr className="lf-row-dim">
            <td colSpan={3}>243 more nearby — not worth your gas.</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Phone mockups                                                       */
/* ------------------------------------------------------------------ */

function PhoneFrame({
  children,
  ariaLabel,
}: {
  children: ReactNode;
  ariaLabel: string;
}) {
  return (
    <div className="lf-phone lf-shot" role="img" aria-label={ariaLabel}>
      <div className="lf-phone-screen">
        <div className="lf-phone-status" aria-hidden="true">
          <i>9:41</i>
          <i>LTE ▪▪▪</i>
        </div>
        <div className="lf-phone-app" aria-hidden="true">
          <span className="lf-phone-glyph">
            <Zap />
          </span>
          <b>DAYFORGE</b>
          <small>Mission live</small>
        </div>
        {children}
      </div>
    </div>
  );
}

function PhoneMission() {
  return (
    <PhoneFrame ariaLabel="DayForge phone screen: today's field mission — Westview Property Management, estimated $24,800 annual contract, press to drive">
      <div className="lf-phone-body" aria-hidden="true">
        <span className="lf-phone-kicker">Today’s field mission</span>
        <div className="lf-mission-card">
          <h4>Westview Property Management</h4>
          <small>Property management · 15 buildings · 1.8 mi</small>
          <div className="lf-mission-value">
            <b>$24,800</b>
            <span>est. annual contract</span>
          </div>
          <span className="lf-chip lf-chip-high">WIN PROBABILITY: HIGH</span>
        </div>
        <div className="lf-mission-card">
          <div className="lf-mission-row">
            <User />
            <span>
              Ask for <b>Dana R.</b> — operations manager
            </span>
          </div>
          <div className="lf-mission-row">
            <FileText />
            <span>Bring: quote sheet + printed one-pager</span>
          </div>
          <div className="lf-mission-row">
            <MapPin />
            <span>Stop first: print shop (leave-behind is ready)</span>
          </div>
        </div>
        <span className="lf-phone-drive">
          <Navigation /> Press to drive
        </span>
      </div>
    </PhoneFrame>
  );
}

function PhonePrep() {
  return (
    <PhoneFrame ariaLabel="DayForge phone screen: mission prep checklist — clean polo, quote sheet, leave-behind waiting at the print shop">
      <div className="lf-phone-body" aria-hidden="true">
        <span className="lf-phone-kicker">Mission prep</span>
        <div className="lf-check-list">
          <div className="lf-check-item">
            <CheckCircle2 />
            <span>
              Clean polo
              <small>You represent the store today.</small>
            </span>
          </div>
          <div className="lf-check-item">
            <CheckCircle2 />
            <span>
              Quote sheet
              <small>Priced for 15 buildings — ready.</small>
            </span>
          </div>
          <div className="lf-check-item">
            <Printer />
            <span>
              Leave-behind
              <small>Sent to QuickPrint. Pick up on the way.</small>
            </span>
          </div>
        </div>
        <span className="lf-phone-drive">
          <Navigation /> Press to drive
        </span>
      </div>
    </PhoneFrame>
  );
}

function PhonePrintStop() {
  return (
    <PhoneFrame ariaLabel="DayForge phone screen: stop one of two — pick up the printed leave-behind at the print shop, then keep driving">
      <div className="lf-phone-body" aria-hidden="true">
        <span className="lf-phone-kicker">Stop 1 of 2</span>
        <div className="lf-stop-map">
          <svg viewBox="0 0 260 96" aria-hidden="true">
            <rect width="260" height="96" fill="#e6ecdf" />
            <path
              d="M-4 62 L92 58 L150 40 L264 34"
              stroke="#fff"
              strokeWidth="10"
              fill="none"
            />
            <path
              d="M60 100 L70 44 L84 -4"
              stroke="#fff"
              strokeWidth="7"
              fill="none"
            />
            <path
              d="M-4 62 L92 58 L150 40 L264 34"
              stroke="#e8590c"
              strokeWidth="3.5"
              strokeDasharray="7 5"
              fill="none"
            />
            <circle cx="92" cy="58" r="8" fill="#e8590c" />
            <circle cx="92" cy="58" r="3.5" fill="#fff" />
            <rect x="216" y="22" width="22" height="22" rx="5" fill="#2e4260" />
          </svg>
        </div>
        <div className="lf-stop-card">
          <span className="lf-stop-tag">Already sent by DayForge</span>
          <b>QuickPrint · 0.6 mi</b>
          <small>
            Your leave-behind is printed and paid: your services, your pricing,
            your name. Ask for the DayForge pickup.
          </small>
        </div>
        <span className="lf-phone-drive is-gold">
          Picked up — keep driving <ArrowRight />
        </span>
      </div>
    </PhoneFrame>
  );
}

/* Printed leave-behind, shown as a designed one-pager */

function CollateralCard() {
  return (
    <div
      className="lf-collateral"
      role="img"
      aria-label="The printed leave-behind: a one-page flyer with the store's commercial services, pricing, and owner's name"
    >
      <div className="lf-collateral-head" aria-hidden="true">
        <i>
          <Zap />
        </i>
        SUNSET WASH
      </div>
      <h5 aria-hidden="true">Commercial laundry for your buildings</h5>
      <small aria-hidden="true">Towels · mats · linens · tenant laundry</small>
      <ul aria-hidden="true">
        <li>Pickup and delivery on your schedule</li>
        <li>One invoice for all 15 buildings</li>
        <li>Next-day turnaround, tracked by the pound</li>
      </ul>
      <div className="lf-collateral-foot" aria-hidden="true">
        <span>Adam · Owner</span>
        <span>(213) 555-0114</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scheduler modal — MAP MY TERRITORY opens this directly              */
/* ------------------------------------------------------------------ */

function SchedulerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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

  return (
    <div
      className="lf-modal-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="lf-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lf-modal-title"
      >
        <button
          ref={closeRef}
          className="lf-modal-close"
          type="button"
          aria-label="Close scheduler"
          onClick={onClose}
        >
          <X />
        </button>
        <h2 id="lf-modal-title">
          Let’s map the commercial accounts around your store.
        </h2>
        <p className="lf-modal-sub">
          Pick a time below. 15 minutes, live on a screen share — you keep what
          you see either way.
        </p>
        {SCHEDULER_URL ? (
          <div className="lf-modal-frame">
            <iframe
              src={SCHEDULER_URL}
              title="Book your 15-minute territory mapping demo"
              loading="eager"
            />
          </div>
        ) : (
          <div className="lf-modal-fallback">
            <p>
              The calendar is being connected. Email{" "}
              <a href="mailto:adam@bldg.chat?subject=Map%20my%20territory">
                adam@bldg.chat
              </a>{" "}
              with your store’s address and we’ll map your territory on the
              call.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

const FAQS: Array<{ id: string; q: string; a: ReactNode }> = [
  {
    id: "lead-list",
    q: "Is this just a lead list or a map?",
    a: "No. A map shows every business. DayForge tells you which one is worth your time, what it’s worth, who to ask for, and what to bring — then gets you there.",
  },
  {
    id: "play-game",
    q: "Do I have to play the game?",
    a: "The game is how missions arrive — it’s what makes them actually happen instead of sitting on a list. Sessions are short and built for a working owner’s day.",
  },
  {
    id: "not-sales",
    q: "What if I’m not good at sales?",
    a: "Most owners aren’t. That’s why DayForge does the prep — who to ask for, what to lead with, answers to the usual objections, and a leave-behind that says it for you. You show up prepared, not slick.",
  },
  {
    id: "approval",
    q: "Does it contact anyone without my approval?",
    a: "Never. DayForge prepares every message and every visit. You review, edit, and decide. Nothing moves without you.",
  },
  {
    id: "ranking",
    q: "How does DayForge decide an account is worth pursuing?",
    a: "It weighs distance, business type, likely laundry demand, and estimated contract value, and ranks what’s realistically winnable for a store your size.",
  },
  {
    id: "field-mission",
    q: "What happens on a field mission?",
    a: "Your phone gives you the route, the prep, the person to ask for, the pitch, and the leave-behind. You drive, walk in, and ask for the business. Printed collateral is paid directly to the print shop at cost — it isn’t marked up or bundled into the subscription.",
  },
  {
    id: "only-laundromats",
    q: "Is it only for laundromats?",
    a: "DayForge for Laundry is built for fluff & fold and laundromat operators. More trades are coming.",
  },
  {
    id: "demo",
    q: "What happens in the 15-minute demo?",
    a: "We pull up your address and map the winnable commercial accounts around your store, live. You keep what you see either way.",
  },
];

function FaqList() {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="lf-faq-list">
      {FAQS.map(({ id, q, a }) => {
        const isOpen = openId === id;
        return (
          <div key={id} className={`lf-faq-item${isOpen ? " is-open" : ""}`}>
            <button
              className="lf-faq-q"
              type="button"
              aria-expanded={isOpen}
              onClick={() => {
                setOpenId(current => (current === id ? null : id));
                if (!isOpen) track("faq_open", { question: id });
              }}
            >
              {q}
              <Plus aria-hidden="true" />
            </button>
            <div className="lf-faq-a">{a}</div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function LandingFinal() {
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [stickyVisible, setStickyVisible] = useState(false);

  const openScheduler = useCallback(() => setSchedulerOpen(true), []);

  useEffect(() => {
    initAnalytics();
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute("content") ?? null;
    document.title =
      "DayForge for Laundry — Stop driving past businesses that could be paying you";
    meta?.setAttribute(
      "content",
      "DayForge ranks the local commercial accounts you can realistically win, then turns the best one into a game-driven mission that gets you through the door ready to pitch."
    );
    return () => {
      document.title = previousTitle;
      if (meta && previousDescription !== null)
        meta.setAttribute("content", previousDescription);
    };
  }, []);

  /* Scroll-depth events (PostHog also captures scroll on pageleave). */
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
          track("scroll_depth", { percent: threshold });
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  /* Sticky bar: activates after Section 3, retires at the final band. */
  useEffect(() => {
    const update = () => {
      const gameSection = document.getElementById("why-game");
      const finalBand = document.getElementById("final-cta");
      if (!gameSection || !finalBand) return;
      const activated =
        gameSection.getBoundingClientRect().top < window.innerHeight * 0.7;
      const retired =
        finalBand.getBoundingClientRect().top < window.innerHeight;
      setStickyVisible(activated && !retired);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div className="lf-root" id="top">
      <a className="lf-skip" href="#main">
        Skip to content
      </a>

      <div className="lf-wrap">
        <header className="lf-topbar">
          <DayforgeMark />
          <span className="lf-topbar-tag">For laundry operators</span>
        </header>
      </div>

      <main id="main">
        {/* ======== SECTION 1 — HERO ======== */}
        <section className="lf-hero">
          <div className="lf-wrap lf-hero-grid">
            <div className="lf-hero-copy">
              <span className="lf-eyebrow">
                For laundromat &amp; fluff-and-fold owners
              </span>
              <h1>Stop driving past businesses that could be paying you.</h1>
              <p className="lf-hero-sub">
                DayForge ranks the local commercial accounts you can
                realistically win — what each could be worth, who to ask for,
                and what to bring — then turns the best one into a game-driven
                mission that gets you through the door ready to pitch.
              </p>
              <div className="lf-hero-cta">
                {/* The 90-second tour button joins lf-hero-actions when the
                    video exists. */}
                <div className="lf-hero-actions">
                  <MapCta source="hero" onOpen={openScheduler} />
                </div>
                <p className="lf-proofline">
                  <ShieldCheck /> {PROOF_LINE}
                </p>
              </div>
            </div>

            {/* Mobile: compact vertical chain (game → phone → door). */}
            <div className="lf-hero-chain" aria-label="How DayForge works">
              <div className="lf-chain-step">
                <span className="lf-chain-label">Mission incoming</span>
                <div className="lf-chain-game">
                  <GameScene mode="interrupt" compact />
                </div>
              </div>
              <div className="lf-chain-arrow" aria-hidden="true">
                <ArrowDown />
              </div>
              <div className="lf-chain-step">
                <span className="lf-chain-label">Press to drive</span>
                <PhoneMission />
              </div>
              <div className="lf-chain-arrow" aria-hidden="true">
                <ArrowDown />
              </div>
              <div className="lf-chain-step">
                <span className="lf-chain-label">Then you walk in</span>
                <div className="lf-chain-photo">
                  <img
                    className="lf-shot"
                    style={{ borderRadius: 16 }}
                    src="/landingfinal/owner-walkup.svg"
                    alt="Owner walking toward a commercial building entrance with printed collateral in hand"
                    width={1600}
                    height={1200}
                  />
                </div>
              </div>
            </div>

            {/* Desktop: museum diorama — Sage → game → phone (largest). */}
            <div className="lf-hero-diorama" aria-label="How DayForge works">
              <div className="lf-exhibit lf-exhibit-sage">
                <span className="lf-exhibit-caption">1 · Sage ranks your territory</span>
                <SageWindow mini />
              </div>
              <div className="lf-exhibit lf-exhibit-game">
                <span className="lf-exhibit-caption">2 · The best one becomes a mission</span>
                <GameScene mode="interrupt" compact />
              </div>
              <div className="lf-exhibit lf-exhibit-phone">
                <span className="lf-exhibit-caption">3 · Your phone takes you there</span>
                <PhoneMission />
              </div>
              <div className="lf-exhibit lf-exhibit-photo">
                <img
                  className="lf-shot"
                  style={{ borderRadius: 16 }}
                  src="/landingfinal/owner-walkup.svg"
                  alt="Owner walking toward a commercial building entrance"
                  width={1600}
                  height={1200}
                />
              </div>
              <span className="lf-diorama-flow lf-flow-1" aria-hidden="true">
                <ArrowDown />
              </span>
              <span className="lf-diorama-flow lf-flow-2" aria-hidden="true">
                <ArrowDown />
              </span>
            </div>
          </div>
        </section>

        {/* ======== SECTION 2 — CREDIBILITY BAND ======== */}
        {/* Reserved: swap the middle segments for the first verified
            customer result the day it exists. */}
        <div className="lf-credband">
          <div className="lf-wrap lf-credband-line">
            <span>Built by a laundromat operator</span>
            <i>·</i>
            <span>Running daily in our own LA stores</span>
            <i>·</i>
            <span>Real data in</span>
            <i>·</i>
            <span>Real visits out</span>
          </div>
        </div>

        {/* ======== SECTION 3 — THE MISSION ======== */}
        <section className="lf-mission" id="mission">
          <div className="lf-wrap">
            <div className="lf-section-head">
              <span className="lf-eyebrow">The mission</span>
              <h2>How does a business on your street become your customer?</h2>
              <p className="lf-lede">Here’s one mission, start to finish.</p>
            </div>

            <div className="lf-chapter">
              <div className="lf-ch-copy">
                <span className="lf-ch-kicker">
                  <b>1</b> Sage picks the account.
                </span>
                <h3>Most aren’t worth your gas. One is.</h3>
                <p>
                  Sage checks every commercial property near your store. Most
                  aren’t worth your gas. One is: a property management company
                  running 15 buildings — towels, mats, and tenant laundry worth
                  an estimated $24,800 a year. Sage tells you who to ask for
                  and what offer makes sense.
                </p>
              </div>
              <div className="lf-ch-visual">
                <SageWindow />
                <div className="lf-callouts" aria-hidden="true">
                  <span className="lf-callout">15 buildings</span>
                  <span className="lf-callout">Est. $24,800/yr</span>
                  <span className="lf-callout">
                    Ask for the operations manager
                  </span>
                </div>
              </div>
            </div>

            <div className="lf-chapter is-flip">
              <div className="lf-ch-copy">
                <span className="lf-ch-kicker">
                  <b>2</b> It becomes today’s mission.
                </span>
                <h3>The boss is the account.</h3>
                <p>
                  The opportunity doesn’t go on a list. It lands inside a game
                  on your desktop — and it’s today’s mission to complete.
                </p>
              </div>
              <div className="lf-ch-visual">
                <GameScene mode="interrupt" />
              </div>
            </div>

            <div className="lf-chapter">
              <div className="lf-ch-copy">
                <span className="lf-ch-kicker">
                  <b>3</b> DayForge preps the visit.
                </span>
                <h3>Clean polo. Quote sheet. Press to drive.</h3>
                <p>
                  First stop isn’t the account — it’s the print shop. DayForge
                  already sent your leave-behind: your services, your pricing,
                  your name. Pick it up. Keep driving.
                </p>
              </div>
              <div className="lf-ch-visual lf-ch3-visual">
                <PhonePrep />
                <PhonePrintStop />
                <CollateralCard />
              </div>
            </div>

            <div className="lf-chapter is-flip">
              <div className="lf-ch-copy">
                <span className="lf-ch-kicker">
                  <b>4</b> Through the door.
                </span>
                <h3>You walk in ready.</h3>
                <p>
                  Your phone tells you who to ask for, the one benefit to lead
                  with, and what to leave behind. Then you walk in.
                </p>
              </div>
              <div className="lf-ch-visual">
                <div className="lf-photo-major lf-shot">
                  <img
                    src="/landingfinal/owner-walkup.svg"
                    alt="Owner, collateral in hand, walking toward a commercial building entrance"
                    width={1600}
                    height={1200}
                    loading="lazy"
                  />
                  <span className="lf-photo-tag">Concept render</span>
                  <div className="lf-photo-inset" aria-hidden="true">
                    <em>Through the door</em>
                    <b>Ask for: Dana R., operations manager</b>
                    <span>
                      Lead with: one invoice for all 15 buildings. Leave your
                      printed one-pager.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Mid-page CTA — the peak-intent moment. */}
          <div className="lf-midcta">
            <div className="lf-wrap">
              <h2>What businesses are you driving past?</h2>
              <MapCta source="mission" onOpen={openScheduler} />
            </div>
          </div>
        </section>

        {/* ======== SECTION 4 — WHY IT'S A GAME ======== */}
        <section className="lf-game" id="why-game">
          <div className="lf-wrap lf-game-grid">
            <div>
              <span className="lf-eyebrow">The twist</span>
              <h2>Dashboards get ignored. Games get played.</h2>
              <p>
                Every business tool you’ve bought gave you another list of
                things to do. The list lost. Not because you’re lazy — because
                a list has no pull.
              </p>
              <p>
                DayForge is built the other way. Your best opportunity arrives
                inside a game with momentum, progress, and a mission that
                doesn’t end on the screen. You don’t just check DayForge. You
                play it — and the mission walks you out the door.
              </p>
              <div className="lf-name-reveal">
                <b>MEET BORESLAY</b>
                <p>
                  The desktop game that turns DayForge’s best sales opportunity
                  into today’s real-world mission.
                </p>
              </div>
            </div>
            <div>
              <GameScene mode="victory" />
            </div>
          </div>
        </section>

        {/* ======== SECTION 5 — IT WATCHES THE BUSINESS ======== */}
        <section className="lf-watch" id="retention">
          <div className="lf-wrap">
            <div className="lf-watch-head">
              <span className="lf-eyebrow">Already-won business</span>
              <h2>It notices when good customers disappear, too.</h2>
              <p>
                Regulars rarely quit out loud. They just stop showing up.
                DayForge catches it early — and writes the first draft of the
                message that brings them back.
              </p>
            </div>
            <div className="lf-watch-grid">
              <div
                className="lf-quiet-card lf-shot"
                role="img"
                aria-label="DayForge table showing three top customers who went quiet with no complaints filed"
              >
                <div className="lf-card-head" aria-hidden="true">
                  <Sparkles /> Regulars — unusual quiet
                </div>
                <table className="lf-quiet-table" aria-hidden="true">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Monthly value</th>
                      <th>Days quiet</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Marisol V.</td>
                      <td className="lf-num">$412</td>
                      <td className="lf-quiet-days">21</td>
                    </tr>
                    <tr>
                      <td>Ben T.</td>
                      <td className="lf-num">$355</td>
                      <td className="lf-quiet-days">19</td>
                    </tr>
                    <tr>
                      <td>Grand Oak Dental</td>
                      <td className="lf-num">$290</td>
                      <td className="lf-quiet-days">26</td>
                    </tr>
                  </tbody>
                </table>
                <span className="lf-watch-note" aria-hidden="true">
                  <Sparkles /> 3 top customers went quiet. No complaints filed.
                </span>
              </div>
              <div>
                <div
                  className="lf-draft-card lf-shot"
                  role="img"
                  aria-label="Sage's editable draft win-back message with edit and send buttons"
                >
                  <div className="lf-card-head" aria-hidden="true">
                    <Sparkles /> Sage — draft ready for your review
                  </div>
                  <div className="lf-draft-msg" aria-hidden="true">
                    <small>Draft · win-back text · Marisol V.</small>
                    Hi Marisol — it’s Adam at Sunset Wash. It’s been a few
                    weeks since your last pickup and I wanted to check in.
                    Want me to hold your usual Thursday spot this week? First
                    bag’s on us.
                  </div>
                  <div className="lf-draft-actions" aria-hidden="true">
                    <span className="lf-draft-btn">
                      <Pencil /> Edit
                    </span>
                    <span className="lf-draft-btn is-send">
                      <Send /> Send
                    </span>
                  </div>
                </div>
                <p className="lf-watch-caption">
                  DayForge investigates and prepares the move.{" "}
                  <strong>
                    You review it, improve it, and decide when it goes out.
                  </strong>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ======== SECTION 6 — ROI + PRICING ======== */}
        <section className="lf-roi" id="pricing">
          <div className="lf-wrap">
            <div className="lf-roi-head">
              <span className="lf-eyebrow">The math</span>
              <h2>One account can pay for years of DayForge.</h2>
            </div>
            <span className="lf-roi-label">Example mission economics</span>
            <div className="lf-roi-math">
              <div className="lf-roi-big">
                $24,800
                <small>That property management account — per year</small>
              </div>
              <div className="lf-roi-vs">compared to</div>
              <div className="lf-roi-small">
                $2,388
                <small>DayForge — $199 a month, for the year</small>
              </div>
              <div className="lf-roi-equals">
                One closed account ≈ 10+ years of DayForge
              </div>
            </div>
            <p className="lf-roi-footnote">
              Illustrative revenue estimate, not profit or a guarantee. Costs
              and results vary.
            </p>

            <div className="lf-plan">
              <div className="lf-plan-head">
                <b>DayForge Operator</b>
                <div className="lf-plan-price">
                  <strong>$199</strong>
                  <span>/ month</span>
                </div>
                <small>Everything. One location, one territory.</small>
              </div>
              <ul className="lf-plan-list">
                <li>
                  <Check /> Sage account ranking &amp; business intelligence
                </li>
                <li>
                  <Check /> BORESLAY desktop missions
                </li>
                <li>
                  <Check /> Phone-guided field visits
                </li>
                <li>
                  <Check /> Pitch prep, quote sheets &amp; printed
                  leave-behinds
                </li>
                <li>
                  <Check /> Lapsed-customer recovery
                </li>
                <li>
                  <Check /> Onboarding included
                </li>
              </ul>
              <div className="lf-founding">
                First 25 operators: <b>$149/month, locked for 12 months.</b>
              </div>
              <div className="lf-plan-cta">
                <button
                  className="lf-btn"
                  type="button"
                  onClick={() => {
                    track("cta_click", { source: "pricing" });
                    openScheduler();
                  }}
                >
                  {CTA_LABEL} <ArrowRight />
                </button>
                <small>
                  15-minute demo · No credit card · Cancel anytime, no long
                  contracts · We map your territory live on the call.
                </small>
              </div>
            </div>
            <p className="lf-roi-proof">{PROOF_LINE}</p>
          </div>
        </section>

        {/* ======== SECTION 7 — FAQ + FINAL CTA ======== */}
        <section className="lf-faq" id="faq">
          <div className="lf-wrap">
            <h2>Fair questions.</h2>
            <FaqList />
          </div>
        </section>

        <section className="lf-finalband" id="final-cta">
          <div className="lf-wrap">
            <h2>Stop passing the next account you could win.</h2>
            <MapCta
              source="final"
              onOpen={openScheduler}
              note="See the winnable commercial accounts around your store in a 15-minute live demo."
            />
          </div>
        </section>
      </main>

      <footer className="lf-footer">
        <div className="lf-wrap lf-footer-inner">
          <DayforgeMark />
          <p>{PROOF_LINE}</p>
          <a href="mailto:adam@bldg.chat">adam@bldg.chat</a>
        </div>
      </footer>

      {/* Sticky CTA bar — active between Section 3 and the final band. */}
      <div className={`lf-sticky${stickyVisible ? " is-visible" : ""}`}>
        <span>See the winnable accounts around your store.</span>
        <button
          className="lf-btn"
          type="button"
          tabIndex={stickyVisible ? 0 : -1}
          aria-hidden={!stickyVisible}
          onClick={() => {
            track("cta_click", { source: "sticky" });
            openScheduler();
          }}
        >
          {CTA_LABEL} <ArrowRight />
        </button>
      </div>

      <SchedulerModal
        open={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
      />
    </div>
  );
}
