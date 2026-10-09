/* LEGACY DAYFORGE COMPATIBILITY: route literal retained for the existing tenant-provisioning endpoint; customer-facing product is JOYSTICK. */
import { useEffect } from "react";
import "./joystick-landing.css";
import { captureProductEvent } from "@/lib/posthog";

const START_PATH = "/joystick-start";

export default function JoystickLanding() {
  useEffect(() => {
    captureProductEvent("landing_page_visited", {
      path: typeof window !== "undefined" ? window.location.pathname : "/joystick",
      source: "joystick_landing",
    });
  }, []);

  return (
    <main className="joystick-landing">
      <div
        className="joystick-desktop"
        aria-label="Joystick — Play the work you hate"
      >
        <img
          className="joystick-desktop__art"
          src="/joystick/joystick-landing.png"
          alt="Joystick turns sales, follow-ups, and business administration into an adventure game."
        />

        <nav className="joystick-desktop__nav" aria-label="Joystick navigation">
          <a href="#how-it-works" aria-label="How it works">
            <span className="sr-only">How it works</span>
          </a>
          <a href="#industries" aria-label="Industries">
            <span className="sr-only">Industries</span>
          </a>
          <a href="#examples" aria-label="Examples">
            <span className="sr-only">Examples</span>
          </a>
        </nav>

        <div className="joystick-desktop__terms" data-testid="landing-commercial-terms">
          <span className="joystick-terms-pill">7-day trial</span>
          <span className="joystick-terms-pill">$49/month</span>
          <span className="joystick-terms-pill">Card required</span>
          <span className="joystick-terms-pill">Cancel anytime</span>
        </div>

        <a
          className="joystick-desktop__cta joystick-desktop__cta--header"
          href={START_PATH}
          onClick={() => captureProductEvent("joystick_start_clicked", { source: "landing" })}
        >
          <span className="sr-only">Start playing</span>
        </a>
        <a
          className="joystick-desktop__cta joystick-desktop__cta--hero"
          href={START_PATH}
          onClick={() => captureProductEvent("joystick_start_clicked", { source: "landing" })}
        >
          <span className="sr-only">Start playing</span>
        </a>
      </div>

      <section className="joystick-mobile">
        <header className="joystick-mobile__header">
          <div className="joystick-mobile__brand">
            <span className="joystick-mobile__compass" aria-hidden="true">
              ✦
            </span>
            JOYSTICK
          </div>
          <a className="joystick-mobile__mini-cta" href={START_PATH} onClick={() => captureProductEvent("joystick_start_clicked", { source: "landing_header" })}>
            START
          </a>
        </header>

        <div className="joystick-mobile__copy">
          <p className="joystick-mobile__eyebrow">
            REAL BUSINESS · REAL PROGRESS · REAL ADVENTURE
          </p>
          <h1>
            PLAY THE
            <br />
            WORK YOU HATE.
          </h1>
          <p className="joystick-mobile__lede">
            The sales, follow-ups and admin you keep avoiding become missions
            that move your actual business.
          </p>
          <a className="joystick-mobile__cta" href={START_PATH} onClick={() => captureProductEvent("joystick_start_clicked", { source: "landing_hero" })}>
            START PLAYING <span aria-hidden="true">→</span>
          </a>
          <div className="joystick-mobile__terms" data-testid="mobile-commercial-terms">
            <span className="joystick-mobile__terms-badge">7-day trial · $49/month</span>
            <span className="joystick-mobile__terms-sub">Card required · Cancel anytime</span>
          </div>
          <p className="joystick-mobile__tagline">
            THE MONSTERS ARE FAKE.
            <br />
            THE MONEY ISN’T.
          </p>
        </div>

        <div className="joystick-mobile__mission" aria-hidden="true">
          <span>MISSION</span>
          <strong>CEDAR HOLLOW</strong>
          <em>FIELD INTEL READY</em>
          <ul>
            <li>Visit homeowner</li>
            <li>Learn the need</li>
            <li>Book next step</li>
          </ul>
        </div>
      </section>

      <section id="how-it-works" className="joystick-briefing-section" data-testid="section-how-it-works">
        <div className="joystick-section__inner">
          <p className="joystick-section__kicker">SYSTEM BRIEFING</p>
          <h2>HOW JOYSTICK WORKS</h2>
          <div className="joystick-grid-3">
            <div className="joystick-card">
              <span className="joystick-card__num">01</span>
              <h3>IDENTIFY THE DREAD</h3>
              <p>Tell Claire what you’ve been avoiding — quote follow-ups, stale leads, overdue invoices, or customer calls.</p>
            </div>
            <div className="joystick-card">
              <span className="joystick-card__num">02</span>
              <h3>TRANSMUTE INTO MISSIONS</h3>
              <p>Claire converts high-friction administrative work into tactical missions with target coordinates, talking points, and clear win conditions.</p>
            </div>
            <div className="joystick-card">
              <span className="joystick-card__num">03</span>
              <h3>DEFEAT REAL-WORLD GUARDIANS</h3>
              <p>Log verified field actions, defeat territory guardians, advance your Day Line, and bank genuine cashflow for your business.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="industries" className="joystick-briefing-section" data-testid="section-industries">
        <div className="joystick-section__inner">
          <p className="joystick-section__kicker">DEPLOYED SECTORS</p>
          <h2>WHO PLAYS JOYSTICK</h2>
          <div className="joystick-grid-4">
            <div className="joystick-card">
              <div className="joystick-card__badge">TRADES & SERVICES</div>
              <h3>Carpet & Floor Restoration</h3>
              <p>Reclaim idle commercial accounts and turn cold annual quotes into active multi-facility service contracts.</p>
            </div>
            <div className="joystick-card">
              <div className="joystick-card__badge">MOBILE FLEETS</div>
              <h3>Mobile Detailing & Grooming</h3>
              <p>Fill route voids, reactivate churned regulars, and automate post-service Google review collection.</p>
            </div>
            <div className="joystick-card">
              <div className="joystick-card__badge">FIELD CONTRACTING</div>
              <h3>HVAC, Plumbing & Electrical</h3>
              <p>Follow up on silent high-ticket replacement bids within 48 hours to seal lucrative installs before competitors call.</p>
            </div>
            <div className="joystick-card">
              <div className="joystick-card__badge">BOUTIQUE FITNESS</div>
              <h3>Studios, Gyms & Coaches</h3>
              <p>Convert drop-in attendees into recurring monthly members with personalized, high-touch reactivation missions.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="examples" className="joystick-briefing-section" data-testid="section-examples">
        <div className="joystick-section__inner">
          <p className="joystick-section__kicker">FIELD ARCHIVE</p>
          <h2>REAL MISSIONS. REAL REVENUE.</h2>
          <div className="joystick-grid-3">
            <div className="joystick-card joystick-card--mission">
              <div className="joystick-card__mission-header">
                <span className="joystick-card__tag">TACTICAL MISSION</span>
                <span className="joystick-card__xp">+200 XP</span>
              </div>
              <h3>The Silent Estimate</h3>
              <p className="joystick-card__desc">Direct follow-up on unaccepted proposals sent over 48 hours ago using Claire’s objection-handling script.</p>
              <div className="joystick-card__reward"><strong>Result:</strong> 1 Closed Contract ($3,400)</div>
            </div>
            <div className="joystick-card joystick-card--mission">
              <div className="joystick-card__mission-header">
                <span className="joystick-card__tag">REPUTATION RAID</span>
                <span className="joystick-card__xp">+75 XP</span>
              </div>
              <h3>The Review Harvest</h3>
              <p className="joystick-card__desc">Deliver SMS review invites to yesterday’s 5-star completed tickets with pre-filled satisfaction prompts.</p>
              <div className="joystick-card__reward"><strong>Result:</strong> +4 Verified 5-Star Reviews</div>
            </div>
            <div className="joystick-card joystick-card--mission">
              <div className="joystick-card__mission-header">
                <span className="joystick-card__tag">TERRITORY EXPEDITION</span>
                <span className="joystick-card__xp">+150 XP</span>
              </div>
              <h3>The Cold Reconnect</h3>
              <p className="joystick-card__desc">Re-engage 5 past commercial clients who haven’t ordered in 90 days with seasonal equipment inspection offers.</p>
              <div className="joystick-card__reward"><strong>Result:</strong> 2 Rebooked Recurring Routes</div>
            </div>
          </div>

          <div className="joystick-pricing-card" data-testid="landing-pricing-card">
            <div className="joystick-pricing-card__terms">
              <p className="joystick-pricing-kicker">READY TO TAKE COMMAND?</p>
              <h3>7-Day Free Trial, Then $49/Month</h3>
              <p className="joystick-pricing-meta">Card required · One comprehensive tier · Cancel anytime</p>
            </div>
            <a
              className="joystick-pricing-cta"
              href={START_PATH}
              onClick={() => captureProductEvent("joystick_start_clicked", { source: "landing_footer" })}
            >
              START 7-DAY TRIAL →
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
