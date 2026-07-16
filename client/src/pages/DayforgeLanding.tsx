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
  ChevronDown,
  Crosshair,
  Gamepad2,
  LockKeyhole,
  MapPin,
  Navigation,
  Phone,
  Radar,
  Route,
  Settings,
  ShieldCheck,
  Signal,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import arenaBackground from "../assets/boreslay-rally/arena-background.webp";
import bankShot from "../assets/boreslay-rally/p3-browser-proof.png";
import strikeShot from "../assets/boreslay-rally/p5-final-browser-proof.png";
import buttBash from "../assets/boreslay-rally/concept-v2-showpiece.png";
import fieldDoor from "../assets/codex-l-final/owner-westview-entry.jpg";
import victoryArt from "../assets/dayforge-flagship/victory-account.jpg";
import "./dayforge-landing.css";

const TERRITORY_PATH = "/territory-preview";
const GAME_PATH = "/boreslay-rally";

function trackArcadeEvent(event: string, source: string) {
  if (typeof window === "undefined") return;
  const detail = { event, source, page: "dayforge_arcade_landing" };
  const trackedWindow = window as Window & {
    dataLayer?: Array<Record<string, string>>;
  };
  trackedWindow.dataLayer?.push(detail);
  window.dispatchEvent(new CustomEvent("dayforge:conversion", { detail }));
}

function territoryUrl(source: string, address?: string) {
  const params = new URLSearchParams({ placement: source });
  if (address?.trim()) params.set("address", address.trim());
  return `${TERRITORY_PATH}?${params.toString()}`;
}

function Brand() {
  return (
    <a className="dfa2-brand" href="#top" aria-label="DayForge home">
      <span className="dfa2-brand-mark" aria-hidden="true">
        <Settings />
      </span>
      <span>
        <b>DAYFORGE</b>
        <small>Territory Intelligence System</small>
      </span>
    </a>
  );
}

function Cta({
  href,
  source,
  children,
  tone = "orange",
  className = "",
}: {
  href: string;
  source: string;
  children: ReactNode;
  tone?: "orange" | "outline" | "cream";
  className?: string;
}) {
  return (
    <a
      className={`dfa2-cta is-${tone} ${className}`.trim()}
      href={href}
      onClick={() => trackArcadeEvent("cta_click", source)}
    >
      <span>{children}</span>
      <ArrowRight aria-hidden="true" />
    </a>
  );
}

function Header() {
  return (
    <header className="dfa2-header">
      <div className="dfa2-header-inner">
        <Brand />
        <nav aria-label="Primary navigation">
          <a href="#product">Product</a>
          <a href="#how-it-works">How It Works</a>
          <a href="#the-game">The Game</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <Cta
          className="dfa2-header-cta"
          href={territoryUrl("header")}
          source="header_claim"
          tone="outline"
        >
          Claim my territory
        </Cta>
      </div>
    </header>
  );
}

function ArcadeCabinet() {
  const [started, setStarted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const startGame = () => {
    trackArcadeEvent("game_start", "hero_cabinet");
    if (window.matchMedia("(max-width: 760px)").matches) {
      window.location.assign(GAME_PATH);
      return;
    }
    setStarted(true);
    window.requestAnimationFrame(() => iframeRef.current?.focus());
  };

  return (
    <div className={`dfa2-cabinet${started ? " is-live" : ""}`}>
      <div className="dfa2-cabinet-marquee" aria-label="BORESLAY Arcade Duel">
        <span>BORESLAY</span>
        <small>ARCADE DUEL</small>
      </div>
      <div className="dfa2-cabinet-body">
        <div className="dfa2-cabinet-screen">
          {started ? (
            <iframe
              ref={iframeRef}
              src={GAME_PATH}
              title="Play BORESLAY Arcade Duel"
              allow="autoplay; fullscreen; gamepad"
            />
          ) : (
            <>
              <img
                src={strikeShot}
                alt="Live BORESLAY duel arena with Cash facing Clockhead"
                width={1440}
                height={913}
                decoding="async"
                fetchPriority="high"
              />
              <div className="dfa2-attract-shade" aria-hidden="true" />
              <div className="dfa2-attract-hud" aria-hidden="true">
                <span>
                  CASH <i />
                </span>
                <b>
                  ROUND 1 <strong>FIRST TO 5</strong>
                </b>
                <span>
                  CLOCKHEAD <i />
                </span>
              </div>
              <button
                className="dfa2-press-start"
                type="button"
                onClick={startGame}
              >
                <Gamepad2 aria-hidden="true" />
                <span>PRESS START</span>
                <small>Play the live duel</small>
              </button>
            </>
          )}
        </div>
        <div className="dfa2-move-rail" aria-label="BORESLAY moves">
          <span className="is-strike">STRIKE</span>
          <span className="is-bank">BANK SHOT</span>
          <span className="is-butt">BUTT BASH ↑</span>
        </div>
        <div className="dfa2-control-deck" aria-hidden="true">
          <span className="dfa2-stick is-orange">
            <i />
          </span>
          <span className="dfa2-deck-buttons is-orange">
            <i />
            <i />
            <i />
          </span>
          <span className="dfa2-start-label">REAL GAME · LIVE MISSION</span>
          <span className="dfa2-stick is-purple">
            <i />
          </span>
          <span className="dfa2-deck-buttons is-purple">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
      <div className="dfa2-cabinet-foot">
        <span>
          <i /> Daily mission online
        </span>
        <a href={GAME_PATH}>
          Open full screen <ArrowRight />
        </a>
      </div>
    </div>
  );
}

function Hero() {
  const [address, setAddress] = useState("");

  const submitAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    trackArcadeEvent("territory_address_submit", "hero_address");
    window.location.assign(territoryUrl("hero_address", address));
  };

  return (
    <section className="dfa2-hero" id="product" aria-labelledby="dfa2-title">
      <div
        className="dfa2-hero-backdrop"
        style={{ backgroundImage: `url(${arenaBackground})` }}
        aria-hidden="true"
      />
      <div className="dfa2-shell dfa2-hero-grid">
        <div className="dfa2-hero-copy">
          <span className="dfa2-kicker">
            <i /> NEW MISSIONS DAILY
          </span>
          <h1 id="dfa2-title">
            Stop driving past businesses that could be paying you.
          </h1>
          <p className="dfa2-hero-lead">
            DayForge turns nearby laundry opportunities into playable
            missions—and real revenue.
          </p>
          <p className="dfa2-hero-detail">
            Built on laundry routes first. Designed for every operator whose
            business dies without door-knocking—laundry, pest, HVAC,
            landscaping, &amp; more.
          </p>
          <form className="dfa2-address" onSubmit={submitAddress}>
            <label htmlFor="dfa2-address">Your service address</label>
            <div>
              <MapPin aria-hidden="true" />
              <input
                id="dfa2-address"
                type="text"
                autoComplete="street-address"
                value={address}
                onChange={event => setAddress(event.target.value)}
                placeholder="Enter your service address"
                required
              />
              <button type="submit" aria-label="Map this service address">
                <ArrowRight aria-hidden="true" />
              </button>
            </div>
          </form>
          <div className="dfa2-hero-actions">
            <Cta href={GAME_PATH} source="hero_play">
              Play the first mission
            </Cta>
            <Cta
              href={territoryUrl("hero_claim")}
              source="hero_claim"
              tone="outline"
            >
              Claim my territory
            </Cta>
          </div>
          <p className="dfa2-security">
            <LockKeyhole aria-hidden="true" /> Secure &amp; private
            <i /> No credit card required
          </p>
        </div>
        <div className="dfa2-hero-game">
          <ArcadeCabinet />
          <div className="dfa2-victory-chip">
            <Trophy aria-hidden="true" />
            <span>
              <small>MISSION VALUE</small>
              <b>$24,800/yr</b>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

const GAME_SHOTS = [
  {
    label: "Strike",
    title: "Start with the move in front of you.",
    copy: "Fire the opportunity across the arena. Momentum starts before confidence does.",
    image: strikeShot,
    className: "is-strike",
  },
  {
    label: "Bank Shot",
    title: "Turn resistance into an angle.",
    copy: "Read the wall, change the approach, and hit the target behind the excuse.",
    image: bankShot,
    className: "is-bank",
  },
  {
    label: "Butt Bash",
    title: "Send the excuse back where it came from.",
    copy: "The signature counter. Return the delay, take the point, keep the mission moving.",
    image: buttBash,
    className: "is-butt",
  },
] as const;

function GameplaySection() {
  return (
    <section
      className="dfa2-gameplay"
      id="the-game"
      aria-labelledby="dfa2-gameplay-title"
    >
      <div className="dfa2-shell">
        <div className="dfa2-section-head">
          <span className="dfa2-kicker">REAL GAMEPLAY · REAL VOCABULARY</span>
          <h2 id="dfa2-gameplay-title">The game is the dominant proof.</h2>
          <p>
            This is not a dashboard wearing arcade colors. BORESLAY is a live
            duel built to make the next revenue move hard to ignore.
          </p>
        </div>
        <div className="dfa2-shot-grid">
          {GAME_SHOTS.map(shot => (
            <article className={`dfa2-shot ${shot.className}`} key={shot.label}>
              <div className="dfa2-shot-media">
                <img
                  src={shot.image}
                  alt={`${shot.label} gameplay in BORESLAY`}
                  loading="lazy"
                />
                <span>{shot.label}</span>
              </div>
              <div className="dfa2-shot-copy">
                <h3>{shot.title}</h3>
                <p>{shot.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function RookPhone() {
  return (
    <div className="dfa2-phone" aria-label="Rook field mission call">
      <div className="dfa2-phone-notch" aria-hidden="true" />
      <header>
        <span>08:42 AM</span>
        <b>ROOK CALLING</b>
      </header>
      <div className="dfa2-rook-avatar" aria-hidden="true">
        R
      </div>
      <span className="dfa2-phone-label">TODAY&apos;S FIELD MISSION</span>
      <h3>Westview Property Management</h3>
      <p>15 buildings · 0.2 miles from your route</p>
      <dl>
        <div>
          <dt>ASK FOR</dt>
          <dd>Operations manager</dd>
        </div>
        <div>
          <dt>EST. ANNUAL VALUE</dt>
          <dd>$24,800</dd>
        </div>
      </dl>
      <blockquote>
        “Ask for the operations manager. I&apos;ll handle the rest.”
      </blockquote>
      <button type="button" tabIndex={-1}>
        START VISIT
      </button>
    </div>
  );
}

function HowSection() {
  return (
    <section
      className="dfa2-how"
      id="how-it-works"
      aria-labelledby="dfa2-how-title"
    >
      <div className="dfa2-shell">
        <div className="dfa2-section-head is-light">
          <span className="dfa2-kicker">FROM GAME TO DOOR</span>
          <h2 id="dfa2-how-title">Three moves. One real account.</h2>
          <p>
            The screen creates momentum. The field mission turns it into
            revenue.
          </p>
        </div>
        <div className="dfa2-flow-grid">
          <article>
            <span className="dfa2-step-number is-orange">1</span>
            <div className="dfa2-flow-copy">
              <b>PLAY THE MISSION.</b>
              <p>Beat the delay standing between you and the visit.</p>
            </div>
            <img
              src={strikeShot}
              alt="BORESLAY mission in progress"
              loading="lazy"
            />
          </article>
          <article>
            <span className="dfa2-step-number is-blue">2</span>
            <div className="dfa2-flow-copy">
              <b>ROOK CALLS.</b>
              <p>The account, value, contact, and opening move are ready.</p>
            </div>
            <RookPhone />
          </article>
          <article>
            <span className="dfa2-step-number is-purple">3</span>
            <div className="dfa2-flow-copy">
              <b>WALK THROUGH THE DOOR.</b>
              <p>Follow the route. Ask for the account. Report back.</p>
            </div>
            <img
              src={fieldDoor}
              alt="Operator walking into Westview Property Management"
              loading="lazy"
            />
          </article>
        </div>
        <p className="dfa2-flow-thesis">
          The game ends on the screen.{" "}
          <strong>The mission continues in real life.</strong>
        </p>
      </div>
    </section>
  );
}

function DashboardSection() {
  return (
    <section className="dfa2-dashboard" aria-labelledby="dfa2-dashboard-title">
      <div className="dfa2-dashboard-art">
        <img
          src={victoryArt}
          alt="BORESLAY victory opening the way to a real commercial account"
          loading="lazy"
        />
      </div>
      <div className="dfa2-dashboard-shade" aria-hidden="true" />
      <div className="dfa2-shell dfa2-dashboard-grid">
        <div className="dfa2-dashboard-copy">
          <span className="dfa2-kicker">WHY THE GAME EARNS ITS PLACE</span>
          <h2 id="dfa2-dashboard-title">
            Dashboards get ignored. <em>Games get played.</em>
          </h2>
          <p>
            We built DayForge for the gap between knowing what to do and
            actually doing it. BORESLAY makes intel irresistible. Rook gets you
            to the door. You close.
          </p>
          <div className="dfa2-dashboard-rule">
            <span>BEAT THE PROBLEM ON SCREEN.</span>
            <b>WIN THE ACCOUNT IN REAL LIFE.</b>
          </div>
        </div>
        <div className="dfa2-win-card">
          <Trophy aria-hidden="true" />
          <span>VICTORY</span>
          <h3>MISSION COMPLETE</h3>
          <p>WESTVIEW PROPERTY MGMT</p>
          <dl>
            <div>
              <dt>
                <MapPin /> Footprint
              </dt>
              <dd>15 buildings</dd>
            </div>
            <div>
              <dt>
                <Route /> Distance
              </dt>
              <dd>0.2 miles</dd>
            </div>
          </dl>
          <strong>
            $24,800<small>/yr</small>
          </strong>
        </div>
      </div>
    </section>
  );
}

const METRICS = [
  ["128", "nearby accounts"],
  ["9", "buying signals detected"],
  ["87%", "average fit score"],
  ["$486,720", "territory impact"],
] as const;

function IntelligenceSection() {
  return (
    <section
      className="dfa2-intelligence"
      aria-labelledby="dfa2-intelligence-title"
    >
      <div className="dfa2-shell">
        <div className="dfa2-intro-grid">
          <div>
            <span className="dfa2-engine-icon" aria-hidden="true">
              <Signal />
            </span>
            <span className="dfa2-kicker">THE INTELLIGENCE ENGINE</span>
            <h2 id="dfa2-intelligence-title">
              Every mission makes the next mission smarter.
            </h2>
          </div>
          <p>
            DayForge learns what a real opportunity looks like for your route:
            which accounts fit, which signals matter, which objections appear,
            and which move gets you through the door.
          </p>
        </div>
        <div className="dfa2-metrics">
          {METRICS.map(([value, label]) => (
            <div key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="dfa2-flywheel">
          <span>
            <Radar /> FIND
          </span>
          <i />
          <span>
            <Gamepad2 /> PLAY
          </span>
          <i />
          <span>
            <Navigation /> VISIT
          </span>
          <i />
          <span>
            <Signal /> LEARN
          </span>
        </div>
      </div>
    </section>
  );
}

const CAST = [
  {
    name: "Cash",
    role: "Your arcade alter ego.",
    className: "is-cash",
    copy: "Moves first. Hits hard. Turns the account into something you want to finish.",
  },
  {
    name: "Rook",
    role: "Your field handler.",
    className: "is-rook",
    copy: "Carries the target, talk track, route, and next step out of the game with you.",
  },
  {
    name: "Clockhead",
    role: "Everything telling you to wait.",
    className: "is-clockhead",
    copy: "Delay, excuses, busywork, and every comfortable reason to try again tomorrow.",
  },
] as const;

function CastSection() {
  return (
    <section className="dfa2-cast" aria-labelledby="dfa2-cast-title">
      <div className="dfa2-shell">
        <div className="dfa2-section-head is-centered">
          <span className="dfa2-kicker">MEET THE PLAYERS</span>
          <h2 id="dfa2-cast-title">One mission. Three clear roles.</h2>
        </div>
        <div className="dfa2-cast-grid">
          {CAST.map(character => (
            <article
              className={`dfa2-cast-card ${character.className}`}
              key={character.name}
            >
              <div
                className="dfa2-cast-art"
                role="img"
                aria-label={`${character.name}, ${character.role}`}
              />
              <div>
                <span>{character.role}</span>
                <h3>{character.name}</h3>
                <p>{character.copy}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function FounderSection() {
  return (
    <section className="dfa2-founder" aria-labelledby="dfa2-founder-title">
      <div className="dfa2-shell dfa2-founder-grid">
        <div className="dfa2-founder-copy">
          <span className="dfa2-kicker">FOUNDER&apos;S NOTE</span>
          <h2 id="dfa2-founder-title">
            I built the game I needed to run the business.
          </h2>
          <p>
            I run fluff-and-fold routes in Los Angeles. The sales side bored me
            so badly I almost let it kill the business—so I built a game on top
            of my own city and told myself I was playing it instead of doing
            sales.
          </p>
          <p>
            <strong>It worked. The accounts were real.</strong>
          </p>
          <p>DayForge is that game, running on your city now.</p>
        </div>
        <div className="dfa2-founder-note">
          <span>WHY THIS ACCOUNT</span>
          <ul>
            <li>
              <Check /> 15+ property portfolio
            </li>
            <li>
              <Check /> Operations contact identified
            </li>
            <li>
              <Check /> 0.2 miles from your route
            </li>
            <li>
              <Check /> Estimated annual value
            </li>
          </ul>
          <strong>$24,800</strong>
          <div className="dfa2-founder-stamp">
            <Settings />
            <span>
              DAYFORGE
              <br />
              FOUNDER
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function PricingSection() {
  return (
    <section
      className="dfa2-pricing"
      id="pricing"
      aria-labelledby="dfa2-pricing-title"
    >
      <div className="dfa2-shell dfa2-price-grid">
        <div className="dfa2-price-copy">
          <span className="dfa2-kicker">FOUNDING OPERATOR RATE</span>
          <h2 id="dfa2-pricing-title">
            One Westview-sized account can pay for years.
          </h2>
          <p>
            Get the territory intelligence, playable missions, field handoff,
            and learning loop in one operator system.
          </p>
          <div className="dfa2-economics">
            <span>
              <b>$24,800</b> example annual account value
            </span>
            <i>versus</i>
            <span>
              <b>$1,788</b> first-year DayForge cost
            </span>
          </div>
          <small>
            Illustrative revenue estimate, not profit or a guarantee. Costs and
            results vary.
          </small>
        </div>
        <div className="dfa2-price-card">
          <span>DAYFORGE OPERATOR</span>
          <div className="dfa2-price">
            <strong>$149</strong>
            <small>/month</small>
            <del>$199</del>
          </div>
          <p>Founding operator rate—first 25 laundries only.</p>
          <ul>
            <li>
              <Check /> Private territory intelligence
            </li>
            <li>
              <Check /> Live BORESLAY missions
            </li>
            <li>
              <Check /> Rook field handoff
            </li>
            <li>
              <Check /> Mission learning loop
            </li>
            <li>
              <Check /> No setup fee · Cancel anytime
            </li>
          </ul>
          <Cta href={territoryUrl("pricing")} source="pricing_claim">
            Claim my territory
          </Cta>
          <small>
            <LockKeyhole /> Secure &amp; private · No credit card required
          </small>
        </div>
      </div>
    </section>
  );
}

const FAQS = [
  [
    "Is this actually a game or actually a sales tool?",
    "Both. BORESLAY is a real playable duel, and every mission is tied to a real account or revenue move outside the game.",
  ],
  [
    "Do I need sales experience?",
    "No. DayForge prepares the account, likely decision-maker, value, route, and opening move so you do not walk in cold.",
  ],
  [
    "How does pricing work?",
    "The founding operator rate is $149 per month for the first 25 laundries. The standard rate is $199 per month.",
  ],
  [
    "How are accounts selected?",
    "DayForge combines geography, account footprint, buying signals, route distance, and what it learns from completed missions.",
  ],
  [
    "What areas are available?",
    "Territories are opened operator by operator. Claim yours and we will confirm availability around your service address.",
  ],
  [
    "Can I pause or cancel anytime?",
    "Yes. There is no setup fee and no long-term contract.",
  ],
] as const;

function FaqSection() {
  return (
    <section className="dfa2-faq" id="faq" aria-labelledby="dfa2-faq-title">
      <div className="dfa2-shell dfa2-faq-grid">
        <div className="dfa2-faq-copy">
          <span className="dfa2-kicker">FAQ</span>
          <h2 id="dfa2-faq-title">Fair questions. Straight answers.</h2>
          <p>
            No jargon. No mystery. Here&apos;s what operators usually ask before
            they claim a territory.
          </p>
          <p className="dfa2-faq-proof">
            <ShieldCheck /> Built on real LA laundry routes.
          </p>
        </div>
        <div className="dfa2-faq-list">
          {FAQS.map(([question, answer], index) => (
            <details key={question} open={index === 0}>
              <summary>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <b>{question}</b>
                <ChevronDown />
              </summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="dfa2-final" aria-labelledby="dfa2-final-title">
      <div
        className="dfa2-final-bg"
        style={{ backgroundImage: `url(${arenaBackground})` }}
        aria-hidden="true"
      />
      <div className="dfa2-shell dfa2-final-grid">
        <div>
          <span className="dfa2-kicker">
            THE NEXT ACCOUNT IS ALREADY OUT THERE
          </span>
          <h2 id="dfa2-final-title">
            Stop hoping. <em>Start hunting.</em>
          </h2>
          <p>One Westview-sized account can pay for years.</p>
        </div>
        <div className="dfa2-final-actions">
          <Cta href={GAME_PATH} source="final_play">
            Play the first mission
          </Cta>
          <Cta
            href={territoryUrl("final_claim")}
            source="final_claim"
            tone="cream"
          >
            Claim my territory
          </Cta>
        </div>
      </div>
    </section>
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
    if (description && previousDescription !== undefined)
      description.content = previousDescription;
    else target.remove();
  };
}

export default function DayforgeLanding() {
  useEffect(() => updateMetadata(), []);

  return (
    <div className="dfa2-page" id="top">
      <a className="dfa2-skip" href="#dfa2-title">
        Skip to content
      </a>
      <Header />
      <main>
        <Hero />
        <GameplaySection />
        <HowSection />
        <DashboardSection />
        <IntelligenceSection />
        <CastSection />
        <FounderSection />
        <PricingSection />
        <FaqSection />
        <FinalCta />
      </main>
      <footer className="dfa2-footer">
        <div className="dfa2-shell">
          <Brand />
          <p>Territory intelligence for operators who still do the work.</p>
          <span>© 2026 DayForge</span>
        </div>
      </footer>
    </div>
  );
}
