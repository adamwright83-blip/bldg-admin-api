import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Flame,
  Gauge,
  Hand,
  MapPin,
  Navigation,
  PackageCheck,
  Pencil,
  Plus,
  Printer,
  Route,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
  TrendingUp,
  User,
  Users,
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
        capture_pageleave: true,
        autocapture: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_performance: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        person_profiles: "never",
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
  "See the commercial accounts worth pursuing around your store in a 15-minute live demo.";
const PROOF_LINE =
  "Built by a laundromat operator. Running daily in our own LA stores.";

type CtaSource = "hero" | "mission" | "sticky" | "pricing" | "final";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

/* Sage's sigil: compass ticks + watching eye. Not a sparkle. */
function SageGlyph({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`lf-sage-glyph${compact ? " is-compact" : ""}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 64 64" fill="none">
        <circle cx="32" cy="32" r="25" stroke="currentColor" strokeWidth="4" />
        <path
          d="M32 3v8M32 53v8M3 32h8M53 32h8"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <path
          d="M19 32c4.5-7.5 9-11 13-11s8.5 3.5 13 11c-4.5 7.5-9 11-13 11s-8.5-3.5-13-11Z"
          stroke="currentColor"
          strokeWidth="3.5"
        />
        <circle cx="32" cy="32" r="4.5" fill="currentColor" />
      </svg>
    </span>
  );
}

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
  onOpen: (source: CtaSource) => void;
  note?: string | null;
}) {
  return (
    <div>
      <button
        className="lf-btn"
        type="button"
        onClick={() => {
          track("cta_click", { source });
          onOpen(source);
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
      <div className="lf-sage-head" aria-hidden="true">
        <SageGlyph />
        <span>
          <small>Sage · Operating intelligence</small>
          <b>Territory briefing</b>
        </span>
        <em>
          <i /> Live
        </em>
      </div>
      {!mini ? (
        <div className="lf-sage-evidence" aria-hidden="true">
          <article>
            <header>
              <Store /> From your operation
            </header>
            <ul>
              <li>Capacity fits — Tue + Thu room open</li>
              <li>Commercial wash &amp; fold enabled</li>
              <li>Your route passes within 0.6 mi</li>
            </ul>
          </article>
          <article>
            <header>
              <MapPin /> From your territory
            </header>
            <ul>
              <li>247 commercial properties checked</li>
              <li>Decision-maker identified</li>
              <li>Westview is 1.4 mi from your store</li>
            </ul>
          </article>
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
      {!mini ? (
        <div className="lf-sage-says" aria-hidden="true">
          <SageGlyph compact />
          <span>
            <small>Sage says</small>
            <b>
              Sell one invoice for all 15 buildings — less staff time lost to
              laundry.
            </b>
          </span>
        </div>
      ) : null}
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

/* Printed leave-behind, photographed at the print shop */

function CollateralPhoto() {
  return (
    <div className="lf-collateral-photo lf-shot">
      <img
        src="/landingfinal/collateral.jpg"
        alt="Concept photo of the printed commercial laundry leave-behind at the print shop"
        width={1200}
        height={900}
        loading="lazy"
      />
      <span className="lf-photo-tag">Concept photo</span>
      <div className="lf-kit-chip" aria-hidden="true">
        <Printer /> Westview visit kit — printed &amp; paid
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The operating system underneath (POS / operations mockup)           */
/* ------------------------------------------------------------------ */

function OsSection() {
  return (
    <section className="lf-os" id="os">
      <div className="lf-wrap">
        <div className="lf-os-head">
          <div>
            <span className="lf-eyebrow">The operating system underneath</span>
            <h2>First, DayForge learns how your store actually runs.</h2>
          </div>
          <div>
            <p>
              Run the counter on DayForge or connect the tools you already
              use. Orders, customers, services, pricing, routes, and open
              capacity become one live picture — that is what Sage uses to
              decide which opportunities actually fit your business.
            </p>
            <span className="lf-os-note">
              <ShieldCheck /> Start connected. Move more of the operation when
              you’re ready.
            </span>
          </div>
        </div>

        <div
          className="lf-os-window lf-shot"
          role="img"
          aria-label="DayForge point-of-sale and operations dashboard: today's sales, live production, and open capacity"
        >
          <aside className="lf-os-side" aria-hidden="true">
            <span className="lf-os-mark">
              <Zap /> DAYFORGE
            </span>
            <nav>
              <b className="is-active">
                <Activity /> Today
              </b>
              <b>
                <PackageCheck /> Orders
              </b>
              <b>
                <Users /> Customers
              </b>
              <b>
                <Route /> Routes
              </b>
              <b>
                <Gauge /> Capacity
              </b>
              <b>
                <CircleDollarSign /> Pricing
              </b>
              <b>
                <TrendingUp /> Growth
              </b>
            </nav>
            <div className="lf-os-loc">
              <i>LA</i>
              <span>
                <b>Sunset Wash</b>
                <small>Store 01 · Live</small>
              </span>
            </div>
          </aside>

          <div className="lf-os-main" aria-hidden="true">
            <header>
              <div>
                <small>Good morning, Adam</small>
                <b>Your store is ready for the day.</b>
              </div>
              <em>All systems live</em>
            </header>
            <div className="lf-os-kpis">
              <article>
                <span>Net sales today</span>
                <b>$4,842</b>
                <em>↑ 18% vs. last Tue</em>
              </article>
              <article>
                <span>Active orders</span>
                <b>84</b>
                <em>31 ready by 4 PM</em>
              </article>
              <article>
                <span>Production load</span>
                <b>73%</b>
                <em>27% capacity open</em>
              </article>
              <article>
                <span>Route value</span>
                <b>$1,906</b>
                <em>18 stops · 2 gaps</em>
              </article>
            </div>
            <div className="lf-os-panels">
              <article className="lf-os-orders">
                <header>
                  <b>Live production</b>
                  <span>84 orders moving</span>
                </header>
                <div className="lf-os-row is-head">
                  <span>Order</span>
                  <span>Service</span>
                  <span>Due</span>
                  <span>Status</span>
                </div>
                <div className="lf-os-row">
                  <span>
                    <b>#1048</b> Maya Chen
                  </span>
                  <span>Wash &amp; fold</span>
                  <span>11:30 AM</span>
                  <i className="is-wash">WASHING</i>
                </div>
                <div className="lf-os-row">
                  <span>
                    <b>#1049</b> Westside Spa
                  </span>
                  <span>Commercial</span>
                  <span>1:00 PM</span>
                  <i className="is-fold">FOLDING</i>
                </div>
                <div className="lf-os-row">
                  <span>
                    <b>#1050</b> Luis Ortega
                  </span>
                  <span>Pickup &amp; delivery</span>
                  <span>3:15 PM</span>
                  <i className="is-ready">READY</i>
                </div>
              </article>
              <article className="lf-os-capacity">
                <header>
                  <b>Today’s capacity</b>
                  <span>Room to grow</span>
                </header>
                <div className="lf-os-ring">
                  <b>27%</b>
                  <small>open</small>
                </div>
                <div className="lf-os-says">
                  <SageGlyph compact />
                  <span>
                    <b>Sage sees sellable room.</b> Enough Tue/Thu capacity for
                    one commercial account.
                  </span>
                </div>
              </article>
            </div>
          </div>
        </div>

        <div className="lf-os-groups" aria-label="What DayForge covers">
          <article>
            <b>Run the store</b>
            <span>
              Orders &amp; customers · Services &amp; pricing · Production
              &amp; capacity · Pickup routes
            </span>
          </article>
          <article>
            <b>Grow the store</b>
            <span>
              Commercial-account ranking · Field missions · Lapsed-customer
              recovery · Mission results &amp; follow-up
            </span>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Founder story                                                       */
/* ------------------------------------------------------------------ */

function FounderSection() {
  return (
    <section className="lf-founder" id="founder">
      <div className="lf-wrap lf-founder-grid">
        <div className="lf-founder-media">
          <img
            className="lf-shot"
            src="/landingfinal/founder.jpg"
            alt="The same founder shown working the laundromat floor and building a cloud game"
            width={1672}
            height={941}
            loading="lazy"
          />
        </div>
        <div className="lf-founder-copy">
          <span className="lf-eyebrow">Why DayForge exists</span>
          <h2>One founder. Two operating worlds.</h2>
          <div className="lf-founder-duo">
            <article>
              <span>01 · The laundry operator</span>
              <b>Knows the work.</b>
              <p>
                Knows the counter, the routes, the margins — and the growth
                work that keeps getting pushed to tomorrow.
              </p>
            </article>
            <article>
              <span>02 · The cloud-gaming founder</span>
              <b>Knows the pull.</b>
              <p>
                Built a cloud-gaming company to{" "}
                <strong>$1.6 million in revenue in under 11 months</strong>.
                Knows how missions, progression, and rewards make difficult
                work easier to begin and finish.
              </p>
            </article>
          </div>
          <p className="lf-founder-reveal">
            <b>Same founder.</b> One side knows what the business needs. The
            other knows how to make the work happen. DayForge combines both.
          </p>
        </div>
      </div>
    </section>
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
          Choose a time for your 15-minute live territory session — you keep
          what you see either way.
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
    a: "You don’t have to be a gamer. BORESLAY is a short, simple game inside DayForge. It turns the next action into something you start now instead of another task you save for later.",
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
    a: "Sage combines your services, pricing, capacity, routes, and customer patterns with territory signals such as business type, distance, likely laundry demand, decision-maker, and estimated value. It ranks the fit and shows you why.",
  },
  {
    id: "field-mission",
    q: "What happens on a field mission?",
    a: "Your phone gives you the route, the prep, the person to ask for, the pitch, and the leave-behind. You drive, walk in, and ask for the business. Printed collateral is paid directly to the print shop at cost — it isn’t marked up or bundled into the subscription.",
  },
  {
    id: "pos-replacement",
    q: "Do I have to replace my current POS?",
    a: "No. You can begin by connecting the tools you already use and move more of the operation into DayForge when you’re ready.",
  },
  {
    id: "mission-length",
    q: "How long does a field mission take?",
    a: "It’s built to fit a working owner’s day — one drive, one print-shop stop, one walk-in visit. Most missions fit inside an hour, door to door.",
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
                if (!isOpen) track("faq_open", { question_id: id });
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

  const openTerritoryPreview = useCallback((source: CtaSource) => {
    const destination = new URL("/territory-preview", window.location.origin);
    destination.searchParams.set("placement", source);
    window.location.assign(destination.toString());
  }, []);

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
                DayForge ranks the local commercial accounts worth pursuing —
                what each could be worth, who to ask for, and what to bring —
                then turns the best one into a game-driven mission that gets
                you through the door ready to pitch.
              </p>
              <div className="lf-hero-cta">
                {/* The 90-second tour button joins lf-hero-actions when the
                    video exists. */}
                <div className="lf-hero-actions">
                  <MapCta source="hero" onOpen={openTerritoryPreview} />
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
                    src="/landingfinal/owner-walkup.jpg"
                    alt="Owner walking toward a commercial building entrance with printed collateral in hand"
                    width={1200}
                    height={900}
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
                  src="/landingfinal/owner-walkup.jpg"
                  alt="Owner walking toward a commercial building entrance"
                  width={1200}
                  height={900}
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
                  DayForge compares nearby commercial properties with your
                  services, pricing, routes, and open capacity. It surfaces
                  the account worth pursuing first — and explains why.
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
                <p className="lf-support-line">
                  Westview fits your service, falls inside an existing route,
                  and fills capacity you already have available.
                </p>
              </div>
            </div>

            <div className="lf-chapter is-flip">
              <div className="lf-ch-copy">
                <span className="lf-ch-kicker">
                  <b>2</b> It becomes today’s mission.
                </span>
                <h3>The boss is the problem standing between you and the account.</h3>
                <p>
                  The opportunity doesn’t go on a list. It lands inside a game
                  on your desktop — and it’s today’s mission to complete.
                </p>
              </div>
              <div className="lf-ch-visual">
                {/* Handholding before any fantasy art: define BORESLAY first. */}
                <div className="lf-bridge">
                  <div className="lf-bridge-eq" aria-hidden="true">
                    <span>BORE</span>
                    <i>+</i>
                    <span>SLAY</span>
                    <b>=</b>
                    <strong>BORESLAY</strong>
                  </div>
                  <p>
                    The game inside DayForge for slaying business boredom.
                    Sage’s pick becomes a playable mission — the boss is the
                    account’s problem. The win is a signed customer.
                  </p>
                </div>
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
                  Who to ask for. What to say. What to bring. Your quote and
                  leave-behind are prepared, printed, and waiting on the
                  route.
                </p>
              </div>
              <div className="lf-ch-visual lf-ch3-visual">
                <PhonePrep />
                <PhonePrintStop />
                <CollateralPhoto />
              </div>
            </div>

            <div className="lf-chapter is-flip">
              <div className="lf-ch-copy">
                <span className="lf-ch-kicker">
                  <b>4</b> Through the door.
                </span>
                <h3>You walk in ready.</h3>
                <p>
                  Your phone tells you who to ask for, the strongest benefit
                  to lead with, and what to leave behind. You arrive prepared
                  to start the conversation.
                </p>
              </div>
              <div className="lf-ch-visual">
                <div className="lf-photo-major lf-shot">
                  <img
                    src="/landingfinal/owner-walkup.jpg"
                    alt="Owner, collateral in hand, walking toward a commercial building entrance"
                    width={1200}
                    height={900}
                    loading="lazy"
                  />
                  <span className="lf-photo-tag">Concept photo</span>
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
              <MapCta source="mission" onOpen={openTerritoryPreview} />
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
                Most business tools hand you another list of tasks. The list
                loses — not because you’re lazy, but because a list has no
                pull.
              </p>
              <p>
                DayForge turns the best opportunity into a playable mission
                with momentum, progress, and a real-world finish line. The
                game does not replace the work. It gets the work started.
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
                Good customers rarely announce that they’re leaving. They just
                stop ordering. DayForge notices when a valuable regular goes
                quiet, checks for unresolved problems, and drafts a message
                for you to review.
              </p>
            </div>
            <div className="lf-watch-grid">
              <div
                className="lf-quiet-card lf-shot"
                role="img"
                aria-label="DayForge table showing three top customers who went quiet with no complaints filed"
              >
                <div className="lf-card-head" aria-hidden="true">
                  <SageGlyph compact /> Sage — regulars gone unusually quiet
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
                    <SageGlyph compact /> Sage — draft ready for your review
                  </div>
                  <div className="lf-draft-msg" aria-hidden="true">
                    <small>Draft · win-back text · Marisol V.</small>
                    Hi Marisol — it’s Adam at Sunset Wash. It’s been a few
                    weeks since your last pickup and I wanted to check in.
                    Want me to hold your usual Thursday spot this week?
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

        {/* ======== THE OPERATING SYSTEM UNDERNEATH ======== */}
        <OsSection />

        {/* ======== FOUNDER STORY ======== */}
        <FounderSection />

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
              <span className="lf-plan-group">Run the business</span>
              <ul className="lf-plan-list">
                <li>
                  <Check /> POS, orders &amp; customer management
                </li>
                <li>
                  <Check /> Services, pricing &amp; capacity
                </li>
                <li>
                  <Check /> Pickup routes &amp; field operations
                </li>
              </ul>
              <span className="lf-plan-group">Grow the business</span>
              <ul className="lf-plan-list">
                <li>
                  <Check /> Sage account ranking &amp; operating intelligence
                </li>
                <li>
                  <Check /> BORESLAY desktop missions
                </li>
                <li>
                  <Check /> Phone-guided sales visits
                </li>
                <li>
                  <Check /> Pitch prep &amp; printed leave-behinds
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
                    openTerritoryPreview("pricing");
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
            <MapCta source="final" onOpen={openTerritoryPreview} />
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
        <span>See the commercial accounts worth pursuing around your store.</span>
        <button
          className="lf-btn"
          type="button"
          tabIndex={stickyVisible ? 0 : -1}
          aria-hidden={!stickyVisible}
          onClick={() => {
            track("cta_click", { source: "sticky" });
            openTerritoryPreview("sticky");
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
