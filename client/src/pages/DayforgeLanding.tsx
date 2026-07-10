import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Menu,
  MessageCircle,
  Phone,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import "./dayforge-landing.css";

const WORLD_ASSET = "/assets/kingdom";

const NAV_ITEMS = [
  ["Product", "#product"],
  ["Sage", "#sage"],
  ["Revenue Rally", "#rally"],
  ["Custom Worlds", "#worlds"],
  ["Switching", "#switching"],
] as const;

const PIPELINE = [
  { label: "Intake", value: "22", order: "#10234 · Sarah J.", note: "Wash & Fold · 10:15 AM" },
  { label: "Cleaning", value: "76", order: "#10192 · Randy S.", note: "Comforters · Due 4 PM" },
  { label: "Ready", value: "34", order: "#10134 · Priya P.", note: "Texted · awaiting pickup" },
  { label: "Delivery", value: "18", order: "#10120 · Out now", note: "ETA 2:30 PM · Route B" },
] as const;

const QUESTS = [
  ["Collect 50 five-star reviews", "32 / 50"],
  ["Reduce overdue orders by 20%", "12% / 20%"],
  ["Grow revenue this week", "$2,180 / $5,000"],
] as const;

function scrollToSection(id: string) {
  document.querySelector(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DayforgeMark() {
  return (
    <a className="df-mark" href="#top" aria-label="DayForge home">
      <span className="df-mark-star" aria-hidden="true">✦</span>
      <span>DAYFORGE</span>
    </a>
  );
}

function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="df-header">
      <DayforgeMark />
      <nav className="df-desktop-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map(([label, href]) => (
          <a key={href} href={href}>{label}</a>
        ))}
      </nav>
      <a className="df-button df-button-dark df-header-cta" href="#contact">
        Book a demo <ArrowRight size={15} />
      </a>
      <button
        className="df-menu-button"
        type="button"
        aria-expanded={open}
        aria-label={open ? "Close navigation" : "Open navigation"}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X /> : <Menu />}
      </button>
      {open ? (
        <div className="df-mobile-nav">
          {NAV_ITEMS.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>{label}</a>
          ))}
          <a className="df-button df-button-dark" href="#contact" onClick={() => setOpen(false)}>
            Book a demo <ArrowRight size={15} />
          </a>
        </div>
      ) : null}
    </header>
  );
}

function WorldPreview() {
  return (
    <div className="df-world" aria-label="A custom DayForge business world">
      <div className="df-world-sky" />
      <img className="df-world-far" src={`${WORLD_ASSET}/kingdom-far.png`} alt="" />
      <img className="df-world-castle" src={`${WORLD_ASSET}/castle-clouds.png`} alt="" />
      <img className="df-world-island df-world-island-one" src={`${WORLD_ASSET}/island-castle.png`} alt="" />
      <img className="df-world-island df-world-island-two" src={`${WORLD_ASSET}/island-castle.png`} alt="" />
      <img className="df-world-spark" src={`${WORLD_ASSET}/spark-gliding.png`} alt="Spark, the DayForge guide" />

      <div className="df-world-hud">
        <div className="df-world-avatar">DF</div>
        <div><strong>DAYFORGE HQ</strong><span>Demo wash & fold</span></div>
        <div className="df-world-metric"><b>$3,842</b><span>today</span></div>
        <div className="df-world-metric"><b>128</b><span>orders</span></div>
        <div className="df-world-metric"><b>34</b><span>ready</span></div>
        <div className="df-world-level"><span>LEVEL</span><b>28</b></div>
      </div>

      <article className="df-world-sage">
        <div className="df-card-kicker"><Sparkles size={14} /> Sage</div>
        <h3>What is the move today?</h3>
        <p>Revenue is up <b>14.6%</b> over the past seven days. Three regulars have not ordered in 45+ days. I drafted a win-back message for each.</p>
        <div className="df-world-actions">
          <button type="button">Send all 3</button>
          <button type="button">Review first</button>
        </div>
      </article>

      <aside className="df-world-quests">
        <span>QUESTS</span>
        {QUESTS.map(([title, progress]) => (
          <div key={title}>
            <i aria-hidden="true">✦</i>
            <p>{title}<b>{progress}</b></p>
          </div>
        ))}
      </aside>

      <div className="df-world-pipeline">
        {PIPELINE.map((item) => (
          <article key={item.label}>
            <header><span>{item.label}</span><b>{item.value}</b></header>
            <strong>{item.order}</strong>
            <small>{item.note}</small>
          </article>
        ))}
      </div>

      <button className="df-rally-portal" type="button" onClick={() => scrollToSection("#rally") }>
        <span>REVENUE RALLY</span>
        <strong>7-day streak · mission ready</strong>
        <i>Enter arena <ChevronRight size={15} /></i>
      </button>
    </div>
  );
}

function ProductDashboard() {
  return (
    <div className="df-dashboard-shell">
      <aside>
        <DayforgeMark />
        {['Overview', 'Orders', 'Customers', 'Pickup & Delivery', 'Payments', 'Revenue Rally', 'Reports'].map((item, index) => (
          <span key={item} className={index === 0 ? "is-active" : ""}>{item}</span>
        ))}
        <small>DEMO STORE<br />Los Angeles, CA</small>
      </aside>
      <main>
        <header>
          <div><span>Tuesday, May 13</span><small>Last updated 2 min ago</small></div>
          <button type="button">+ New order</button>
        </header>
        <div className="df-dashboard-metrics">
          <article><b>$3,842</b><span>Collected today</span></article>
          <article><b>128</b><span>Orders today</span></article>
          <article><b>76</b><span>In cleaning</span></article>
          <article><b>34</b><span>Ready for pickup</span></article>
        </div>
        <article className="df-dashboard-sage">
          <div>
            <span><Sparkles size={14} /> Sage insight</span>
            <p>Revenue is up <b>14.6%</b> over the prior seven days. Saturday was strongest. Three customers are ready for a win-back offer.</p>
            <button type="button">Review the three</button>
          </div>
          <svg viewBox="0 0 260 90" role="img" aria-label="Revenue rising over seven days">
            <path d="M4 76 L35 62 L68 68 L99 42 L130 52 L162 29 L194 38 L226 13 L256 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        </article>
        <div className="df-dashboard-pipeline">
          {PIPELINE.map((item) => (
            <article key={item.label}>
              <header><span>{item.label}</span><b>{item.value}</b></header>
              <strong>{item.order}</strong>
              <small>{item.note}</small>
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

function SageSection() {
  return (
    <section className="df-section df-sage-section" id="sage">
      <div className="df-section-copy">
        <span className="df-eyebrow">Meet Sage</span>
        <h2>Ask anything.<br /><em>Get a useful answer.</em></h2>
        <p>Sage reads sales, orders, payments, customers, and open work. Ask in plain English. Get the number, the reason, and the next action without digging through five reports.</p>
        <ul className="df-check-list">
          <li><Check /> “Who has not ordered in 60 days?”</li>
          <li><Check /> “Which invoices are overdue?”</li>
          <li><Check /> “What should I do today to make money?”</li>
        </ul>
      </div>
      <div className="df-chat-demo" aria-label="Example conversation with Sage">
        <div className="df-chat-user">Who has not ordered in 60 days?</div>
        <div className="df-chat-sage">14 customers. The top three by lifetime value are Sarah Johnson, Mike Chen, and Lisa Patel. Want me to draft each a personal win-back offer?</div>
        <div className="df-chat-user">Yes — 15% off the next order.</div>
        <div className="df-chat-done"><span>READY</span>Three messages are drafted. Review them or send all three.</div>
      </div>
    </section>
  );
}

function RallySection() {
  return (
    <section className="df-rally-section" id="rally">
      <div className="df-rally-copy">
        <span className="df-eyebrow">Revenue Rally</span>
        <h2>One real action.<br /><em>Back in the game.</em></h2>
        <p>The game you reach for after work can now move the business during it. Play a one-minute match. When Sage finds a real opportunity, complete the mission to unlock the save, counterattack, or power move.</p>
        <div className="df-rally-benefits">
          <span><Phone /> Real leads from your business</span>
          <span><TrendingUp /> Revenue tied to completed missions</span>
          <span><MessageCircle /> Sage prepares the call or follow-up</span>
        </div>
        <a className="df-button df-button-gold" href="/boreslay-rally">Play Revenue Rally <ArrowRight size={16} /></a>
      </div>
      <div className="df-rally-stage">
        <div className="df-game-browser">
          <div className="df-browser-bar"><i /><i /><i /><span>Revenue Rally · live game preview</span></div>
          <iframe
            src="/boreslay-rally?seed=77"
            title="Revenue Rally game preview"
            loading="lazy"
            tabIndex={-1}
          />
          <a href="/boreslay-rally" aria-label="Open Revenue Rally in full screen">Open full game</a>
        </div>
        <article className="df-rally-mission">
          <span>MISSION READY</span>
          <h3>Call Sarah Johnson</h3>
          <p>45 days since last order · average order $236</p>
          <strong>Reward: Triple Power Counter</strong>
          <a href="/boreslay-rally">Accept mission</a>
        </article>
        <div className="df-rally-stats">
          <span><b>7</b>day streak</span>
          <span><b>24</b>calls this week</span>
          <span><b>$2,180</b>demo revenue influenced</span>
        </div>
      </div>
    </section>
  );
}

function WorldsSection() {
  return (
    <section className="df-section df-worlds-section" id="worlds">
      <div className="df-worlds-heading">
        <span className="df-eyebrow">Custom Worlds</span>
        <h2>Professional by default.<br /><em>Unmistakably yours when you want it.</em></h2>
        <p>Every operator starts with a clean, fast interface. Your account can also become a custom world built around your brand, your team, and the way your brain likes to work.</p>
      </div>
      <div className="df-world-options">
        <article className="df-world-option df-world-option-clean">
          <span>DEFAULT UI</span>
          <h3>Calm, familiar, ready immediately.</h3>
          <div className="df-mini-dashboard">
            <i /><i /><i /><i />
            <strong>Sage found three customers to win back.</strong>
          </div>
        </article>
        <article className="df-world-option df-world-option-custom">
          <span>CUSTOM WORLD</span>
          <h3>Adult game energy without sacrificing clarity.</h3>
          <div className="df-mini-world">
            <img src={`${WORLD_ASSET}/kingdom-far.png`} alt="" />
            <img src={`${WORLD_ASSET}/spark-gliding.png`} alt="" />
            <strong>QUEST READY</strong>
          </div>
        </article>
      </div>
      <div className="df-customization-list">
        {[
          "Colors, typography, icons, and motion",
          "Sage character and voice",
          "Revenue Rally arena and reward system",
          "Navigation names and dashboard layout",
          "Team quests, streaks, and sound intensity",
        ].map((item) => <span key={item}><Check />{item}</span>)}
      </div>
    </section>
  );
}

function SwitchingSection() {
  return (
    <section className="df-switching" id="switching">
      <div>
        <span className="df-eyebrow">Switching</span>
        <h2>Leaving CleanCloud or Cents?<br /><em>Keep running while we move you.</em></h2>
        <p>Send an export. We rebuild customers, pricing, routes, and order history with you. Your existing system can stay live until the DayForge setup is verified.</p>
      </div>
      <div className="df-switching-steps">
        <article><b>01</b><h3>Send the export</h3><p>Customers, pricing, order history, and any route data you have.</p></article>
        <article><b>02</b><h3>Verify the rebuild</h3><p>We review the store setup together before staff touches live work.</p></article>
        <article><b>03</b><h3>Choose the go-live</h3><p>Parallel-run as long as needed. Your data remains exportable.</p></article>
      </div>
    </section>
  );
}

function ContactSection() {
  return (
    <section className="df-contact" id="contact">
      <div>
        <span className="df-eyebrow">Founding operators</span>
        <h2>See your store inside DayForge.</h2>
        <p>A focused walkthrough of operations, Sage, Revenue Rally, and the custom-world options. No generic sales deck.</p>
      </div>
      <a className="df-button df-button-gold" href="mailto:adam@bldg.chat?subject=DayForge%20demo">Book a 15-minute demo <ArrowRight size={17} /></a>
    </section>
  );
}

export default function DayforgeLanding() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "DayForge — Run the business in your own world";
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute("content") ?? null;
    meta?.setAttribute(
      "content",
      "DayForge runs orders, customers, payments, pickup and delivery, answers business questions through Sage, and turns real sales actions into Revenue Rally missions."
    );
    return () => {
      document.title = previousTitle;
      if (meta && previousDescription !== null) meta.setAttribute("content", previousDescription);
    };
  }, []);

  return (
    <div className="df-root" id="top">
      <Header />
      <main>
        <section className="df-hero">
          <div className="df-hero-copy">
            <span className="df-eyebrow">For wash & fold operators</span>
            <h1>Run the business<br />in your <em>own world.</em></h1>
            <p>DayForge runs the work, Sage reads the business, and Revenue Rally turns the sales actions people avoid into one-minute missions they want to finish.</p>
            <div className="df-hero-actions">
              <a className="df-button df-button-dark" href="#contact">Book a 15-minute demo <ArrowRight size={16} /></a>
              <button className="df-button df-button-light" type="button" onClick={() => scrollToSection("#product")}>Explore the product</button>
            </div>
            <div className="df-hero-proof">
              <span><Sparkles /> Sage answers and acts</span>
              <span><TrendingUp /> Revenue Rally drives follow-through</span>
              <span><Check /> Clean default or custom world</span>
            </div>
          </div>
          <WorldPreview />
        </section>

        <section className="df-proof-strip">
          <span>One platform</span>
          <b>Orders</b><b>Customers</b><b>Payments</b><b>Pickup & delivery</b><b>Sage</b><b>Revenue Rally</b>
        </section>

        <section className="df-product-section" id="product">
          <div className="df-product-heading">
            <span className="df-eyebrow">The operating system underneath the world</span>
            <h2>Every order visible.<br /><em>Every next move clear.</em></h2>
            <p>The fantasy layer is optional. The operational layer is not. DayForge starts with a fast, familiar system for daily store work.</p>
          </div>
          <ProductDashboard />
        </section>

        <SageSection />
        <RallySection />
        <WorldsSection />
        <SwitchingSection />
        <ContactSection />
      </main>
      <footer className="df-footer">
        <DayforgeMark />
        <p>Operations, answers, and action for owner-run businesses.</p>
        <a href="mailto:adam@bldg.chat">adam@bldg.chat</a>
      </footer>
    </div>
  );
}
