import { useEffect } from "react";
import "./dayforge-landing.css";

const ARTWORK = "/assets/dayforge-arcade/dayforge-arcade-landing.png";

function trackArcadeEvent(event: string, source: string) {
  if (typeof window === "undefined") return;
  const detail = { event, source, page: "dayforge_arcade_landing" };
  const trackedWindow = window as Window & {
    dataLayer?: Array<Record<string, string>>;
  };
  trackedWindow.dataLayer?.push(detail);
  window.dispatchEvent(new CustomEvent("dayforge:conversion", { detail }));
}

function Hotspot({
  className,
  href,
  label,
  source,
}: {
  className: string;
  href: string;
  label: string;
  source: string;
}) {
  return (
    <a
      className={`dfa-hotspot ${className}`}
      href={href}
      aria-label={label}
      onClick={() => trackArcadeEvent("cta_click", source)}
    >
      <span>{label}</span>
    </a>
  );
}

function ExactCopy() {
  return (
    <div className="dfa-copy" aria-label="DayForge landing page copy">
      <section aria-labelledby="dfa-copy-hero">
        <p>
          DayForge — Territory Intelligence System for fluff-and-fold operators.
        </p>
        <p>NEW MISSIONS DAILY</p>
        <h1 id="dfa-copy-hero">
          Stop driving past businesses that could be paying you.
        </h1>
        <p>
          DayForge turns nearby laundry opportunities into playable missions—and
          real revenue.
        </p>
        <p>
          Built on laundry routes first. Designed for every operator whose
          business dies without door-knocking—laundry, pest, HVAC, landscaping,
          &amp; more.
        </p>
        <p>Secure &amp; private · No credit card required</p>
        <h2>BORESLAY Arcade Duel</h2>
        <p>Cash versus Clockhead. Round 1. First to 5.</p>
        <p>Strike. Bank Shot. Butt Bash. Press Start.</p>
        <h2>Victory</h2>
        <p>
          Mission complete. Westview Property Management. 15 buildings. 0.2
          miles. $24,800/year.
        </p>
      </section>

      <section aria-labelledby="dfa-copy-how">
        <h2 id="dfa-copy-how">From game to door in three moves.</h2>
        <ol>
          <li>Play the mission.</li>
          <li>
            Rook calls. Westview Property Management. 15 buildings. Ask for the
            operations manager. I&apos;ll handle the rest.
          </li>
          <li>
            Walk through the door. Start visit. Report back. Estimated
            $24,800/year.
          </li>
        </ol>
      </section>

      <section aria-labelledby="dfa-copy-game">
        <h2 id="dfa-copy-game">Dashboards get ignored. Games get played.</h2>
        <p>
          We built DayForge for the gap between knowing what to do and actually
          doing it. BORESLAY makes intel irresistible. Rook gets you to the
          door. You close.
        </p>
        <p>The game ends on the screen. The mission continues in real life.</p>
        <h3>Meet the players.</h3>
        <dl>
          <div>
            <dt>Cash</dt>
            <dd>Your arcade alter ego.</dd>
          </div>
          <div>
            <dt>Rook</dt>
            <dd>Your field handler.</dd>
          </div>
          <div>
            <dt>Clockhead</dt>
            <dd>Everything telling you to wait.</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="dfa-copy-account">
        <h2 id="dfa-copy-account">Why this account.</h2>
        <ul>
          <li>15+ property portfolio</li>
          <li>Operations contact identified</li>
          <li>0.2 miles from your route</li>
          <li>Estimated annual value: $24,800</li>
        </ul>
        <h2>Founder&apos;s note.</h2>
        <p>
          I run fluff-and-fold routes in Los Angeles. The sales side bored me so
          badly I almost let it kill the business—so I built a game on top of my
          own city and told myself I was playing it instead of doing sales. It
          worked. The accounts were real. DayForge is that game, running on your
          city now.
        </p>
        <p>Every mission you complete makes the next mission smarter.</p>
      </section>

      <section aria-labelledby="dfa-copy-pricing">
        <h2 id="dfa-copy-pricing">DayForge Operator</h2>
        <p>$149/month. Founding operator rate—first 25 laundries only.</p>
        <p>Secure &amp; private · No credit card required</p>
      </section>

      <section aria-labelledby="dfa-copy-faq">
        <h2 id="dfa-copy-faq">FAQ</h2>
        <details>
          <summary>Is this actually a game or actually a sales tool?</summary>
          <p>
            Both. Every playable mission is tied to a real sales opportunity.
          </p>
        </details>
        <details>
          <summary>Do I need sales experience?</summary>
          <p>No. DayForge prepares the account, contact, and next move.</p>
        </details>
        <details>
          <summary>How does pricing work?</summary>
          <p>The founding operator rate is $149 per month.</p>
        </details>
        <details>
          <summary>How are accounts selected?</summary>
          <p>
            DayForge ranks nearby accounts by fit, signals, and route distance.
          </p>
        </details>
        <details>
          <summary>What areas are available?</summary>
          <p>Claim your territory to check availability.</p>
        </details>
        <details>
          <summary>Can I pause or cancel anytime?</summary>
          <p>Yes.</p>
        </details>
      </section>

      <section aria-labelledby="dfa-copy-engine">
        <h2 id="dfa-copy-engine">The intelligence engine.</h2>
        <p>128 nearby accounts</p>
        <p>9 buying signals detected</p>
        <p>87% average fit score</p>
        <p>$486,720 territory impact</p>
        <p>Every mission you run makes the next mission smarter.</p>
        <p>One Westview-sized account can pay for years.</p>
        <h2>Stop hoping. Start hunting.</h2>
      </section>
    </div>
  );
}

function updateMetadata() {
  const previousTitle = document.title;
  const description = document.querySelector<HTMLMetaElement>(
    'meta[name="description"]'
  );
  const previousDescription = description?.content;
  const target = description ?? document.createElement("meta");
  if (!description) {
    target.name = "description";
    document.head.appendChild(target);
  }
  document.title =
    "DayForge — Stop driving past businesses that could be paying you";
  target.content =
    "DayForge turns nearby laundry opportunities into playable BORESLAY missions—and real revenue.";
  return () => {
    document.title = previousTitle;
    if (description && previousDescription !== undefined) {
      description.content = previousDescription;
    } else {
      target.remove();
    }
  };
}

export default function DayforgeLanding() {
  useEffect(() => updateMetadata(), []);

  return (
    <div className="dfa-page" id="top">
      <a className="dfa-skip" href="#dfa-copy-hero">
        Skip to content
      </a>

      <main className="dfa-poster">
        <img
          className="dfa-artwork"
          src={ARTWORK}
          width={941}
          height={1672}
          alt=""
          aria-hidden="true"
          decoding="sync"
          fetchPriority="high"
          draggable={false}
        />

        <nav className="dfa-nav" aria-label="Primary navigation">
          <a className="dfa-nav-product" href="#product">
            Product
          </a>
          <a className="dfa-nav-how" href="#how-it-works">
            How It Works
          </a>
          <a className="dfa-nav-game" href="#the-game">
            The Game
          </a>
          <a className="dfa-nav-pricing" href="#pricing">
            Pricing
          </a>
          <a className="dfa-nav-faq" href="#faq">
            FAQ
          </a>
        </nav>

        <Hotspot
          className="dfa-header-play"
          href="/boreslay-rally"
          label="Play the first mission"
          source="header_play"
        />
        <Hotspot
          className="dfa-header-claim"
          href="/territory-preview"
          label="Claim my territory"
          source="header_claim"
        />
        <Hotspot
          className="dfa-hero-address"
          href="/territory-preview"
          label="Enter your service address"
          source="hero_address"
        />
        <Hotspot
          className="dfa-hero-play"
          href="/boreslay-rally"
          label="Play the first mission"
          source="hero_play"
        />
        <Hotspot
          className="dfa-hero-claim"
          href="/territory-preview"
          label="Claim my territory"
          source="hero_claim"
        />
        <Hotspot
          className="dfa-victory-claim"
          href="/territory-preview"
          label="Claim territory after mission victory"
          source="victory_claim"
        />
        <Hotspot
          className="dfa-pricing-claim"
          href="/territory-preview"
          label="Claim my territory at the founding operator rate"
          source="pricing_claim"
        />
        <Hotspot
          className="dfa-final-play"
          href="/boreslay-rally"
          label="Play the first mission"
          source="final_play"
        />

        <span className="dfa-anchor dfa-anchor-product" id="product" />
        <span className="dfa-anchor dfa-anchor-how" id="how-it-works" />
        <span className="dfa-anchor dfa-anchor-game" id="the-game" />
        <span className="dfa-anchor dfa-anchor-pricing" id="pricing" />
        <span className="dfa-anchor dfa-anchor-faq" id="faq" />

        <ExactCopy />
      </main>
    </div>
  );
}
