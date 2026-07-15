import { useEffect, useRef, useState, type RefObject } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  LockKeyhole,
  Mail,
  MapPin,
  Radar,
  Route,
  Sparkles,
  Store,
  Target,
  X,
  Zap,
} from "lucide-react";
import missionArt from "@/assets/dayforge-flagship/victory-account.jpg";
import fieldVisit from "/dayforgeflagship/owner-field-visit.jpg";
import { getFlagshipAnalytics, trackCtaClick, type CtaSource } from "./analytics";
import "./dayforge-flagship.css";

const FALLBACK_EMAIL = "adam@bldg.chat";
const RAW_SCHEDULER_URL = import.meta.env.VITE_SCHEDULER_URL?.trim();

function validatedSchedulerUrl(rawUrl = RAW_SCHEDULER_URL): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const SCHEDULER_URL = validatedSchedulerUrl();

function Brand() {
  return <a className="df-brand" href="#top" aria-label="DayForge home"><span><Zap /></span><b>DAYFORGE</b></a>;
}

function Cta({ source, onOpen, secondary = false, children = "MAP MY TERRITORY" }: {
  source: CtaSource;
  onOpen: (trigger: HTMLButtonElement) => void;
  secondary?: boolean;
  children?: React.ReactNode;
}) {
  return <button className={`df-cta${secondary ? " is-secondary" : ""}`} type="button" data-cta-source={source} onClick={event => { trackCtaClick(source); onOpen(event.currentTarget); }}>{children}<ArrowRight /></button>;
}

const accounts = [
  ["Westview Property Management", "$24,800", "15 buildings", "HIGH"],
  ["Harbor Fitness Club", "$18,900", "Gym / Fitness", "HIGH"],
  ["Sunset Hotel", "$16,700", "Hotel", "MEDIUM"],
  ["Luxe Salon Studio", "$14,200", "Salon / Spa", "MEDIUM"],
  ["Pine & Oak Apartments", "$12,600", "Property Mgmt", "LOW"],
];

function TerritoryPanel() {
  return <div className="df-territory-card">
    <div className="df-appbar"><Brand /><span>Territory Overview</span><em>Los Angeles, CA</em></div>
    <div className="df-appbody">
      <aside>{[Radar, Target, Building2, Sparkles, Route].map((Icon, i) => <span className={i === 0 ? "active" : ""} key={i}><Icon /></span>)}</aside>
      <div className="df-account-list">
        <header><b>Nearby opportunities</b><span>EST. ANNUAL VALUE</span></header>
        {accounts.map(([name, value, type, fit], index) => <div className={index === 0 ? "selected" : ""} key={name}><span className="df-building"><Building2 /></span><p><b>{name}</b><small>{type}</small></p><strong>{value}</strong><em className={`fit-${fit.toLowerCase()}`}>{fit}</em></div>)}
      </div>
      <div className="df-map" aria-label="Map of nearby commercial accounts"><span className="df-map-road r1" /><span className="df-map-road r2" /><span className="df-map-road r3" />{["orange","green","orange","gray","orange","green","gray"].map((tone,i)=><i className={`pin-${tone} p${i+1}`} key={i}><MapPin /></i>)}<b><Radar /></b></div>
    </div>
  </div>;
}

function MissionCard({ compact = false }: { compact?: boolean }) {
  return <div className={`df-mission-card${compact ? " compact" : ""}`}>
    <img src={missionArt} alt="A fiery BORESLAY mission with a dragon facing the account challenge" />
    <div className="df-mission-shade" />
    <header><span>MISSION 042</span><em>EXPIRES IN 7H 14M</em></header>
    <div className="df-mission-copy"><small>WESTVIEW PROPERTY MANAGEMENT</small><b>POTENTIAL ANNUAL VALUE</b><strong>$24,800</strong><span>DECISION-MAKER</span><p>Dana R. · Operations Manager</p></div>
    <div className="df-mission-number">042</div>
    <div className="df-mission-path"><span>SCOUT<small>Learn the account</small></span><span>PREPARE<small>Build the pitch</small></span><span>BATTLE<small>Meet the decision-maker</small></span><span>WIN<small>Close the account</small></span></div>
    <button type="button" tabIndex={-1}>SEND TO PHONE</button>
  </div>;
}

function PhonePanel() {
  return <div className="df-phone"><div className="df-phone-notch" /><header><span>9:41</span><b>MISSION 042</b></header><small>WESTVIEW PROPERTY MANAGEMENT</small><p>15 buildings · Property Management</p><div className="df-phone-value"><span>ESTIMATED LAUNDRY VALUE</span><b>$24,800</b></div><dl><div><dt>DECISION-MAKER</dt><dd>Dana R.</dd></div><div><dt>ROLE</dt><dd>Operations Manager</dd></div></dl><section><b>TODAY&apos;S MISSION</b>{["Pick up proposal leave-behind","Ask for Dana R.","Discuss centralized laundry","Present solution & pricing","Schedule next step"].map(item=><span key={item}><i />{item}</span>)}</section><button type="button" tabIndex={-1}>START VISIT</button><footer><span><Store />Home</span><span><Target />This Task</span><span><Route />Progress</span></footer></div>;
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <article className="df-step"><div className="df-step-head"><span>{number}</span><div><b>{title}</b></div></div><div className="df-step-content">{children}</div></article>;
}

function SchedulerDialog({ open, onClose, returnFocusRef }: { open: boolean; onClose: () => void; returnFocusRef: RefObject<HTMLButtonElement | null> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const old = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = old; if (dialog.open) dialog.close(); returnFocusRef.current?.focus(); };
  }, [open, returnFocusRef]);
  if (!open) return null;
  return <dialog className="df-dialog" ref={dialogRef} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}><div><button className="df-dialog-close" aria-label="Close scheduler" onClick={onClose}><X /></button><span className="df-kicker">15-MINUTE LIVE DEMO</span><h2>Let&apos;s map the commercial accounts around your store.</h2><p>Pick a time that works. We&apos;ll map your territory live on the call.</p>{SCHEDULER_URL ? <section><iframe src={SCHEDULER_URL} title="Schedule your DayForge territory mapping demo" /><a href={SCHEDULER_URL} target="_blank" rel="noreferrer">Open scheduler <ExternalLink /></a></section> : <section className="df-dialog-fallback"><MapPin /><b>The live calendar is being connected.</b><p>Email Adam and we&apos;ll map your territory together.</p><a href={`mailto:${FALLBACK_EMAIL}?subject=Map%20my%20DayForge%20territory`}><Mail /> EMAIL {FALLBACK_EMAIL}</a></section>}</div></dialog>;
}

export default function DayforgeFlagship() {
  const [open, setOpen] = useState(false);
  const lastCtaRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { void getFlagshipAnalytics(); }, []);
  const openScheduler = (trigger: HTMLButtonElement) => { lastCtaRef.current = trigger; setOpen(true); };
  return <div className="df-page" id="top">
    <a href="#main" className="df-skip">Skip to content</a>
    <header className="df-header"><Brand /><nav><a href="#product">Product</a><a href="#how">How It Works</a><a href="#boreslay">Boreslay</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><a href="#about">About</a></nav><Cta source="sticky" onOpen={openScheduler} /></header>
    <main id="main">
      <section className="df-hero" id="product"><div className="df-hero-copy"><span className="df-kicker">FOR LAUNDROMAT &amp; FLUFF-AND-FOLD OWNERS</span><h1>Stop driving past businesses that could be paying you.</h1><p>DayForge turns the streets around your store into a live fluff-and-fold pipeline. It spots nearby hotels, property managers, gyms, salons and other commercial accounts worth pursuing, tells you who to ask for and what to say, then turns the best opportunity into today&apos;s mission—first on your screen, then in the real world.</p><div className="df-hero-actions"><Cta source="hero" onOpen={openScheduler} /><Cta source="mission" onOpen={openScheduler} secondary>BOOK A 15-MIN DEMO</Cta></div><div className="df-safe"><span><LockKeyhole />Secure &amp; private</span><span><Copy />No credit card</span><span><Clock3 />See results in 60 seconds</span></div></div><div className="df-product-preview"><span className="df-preview-label">PRODUCT PREVIEW</span><TerritoryPanel /><MissionCard /><PhonePanel /><div className="df-alert"><Building2 /><span><small>NEW HIGH-VALUE BUSINESS NEARBY</small><b>Westview Property Management</b><em>15 buildings just 0.2 miles from your route.</em></span><i>NOW</i></div></div></section>

      <section className="df-how" id="how"><div className="df-how-title"><span>HOW IT WORKS</span><h2>How does a business near you become your fluff-and-fold customer?</h2></div><div className="df-steps"><Step number="1" title="The right account appears on your radar.">DayForge compares nearby businesses with your services, routes and capacity. The best-fit, highest-value accounts rise to the top.<TerritoryPanel /></Step><Step number="2" title="DayForge prepares the laundry pitch.">It identifies the likely decision-maker, estimates the account&apos;s laundry value and gives you the strongest opening based on the business&apos;s actual operation.<div className="df-pitch"><span>MISSION 042</span><b>WESTVIEW PROPERTY</b><small>15 buildings · Property expansion</small><strong>STRONG OPENING</strong><p>“I noticed your team recently expanded to 15 buildings. Who handles laundry service across the portfolio?”</p></div></Step><Step number="3" title="The opportunity becomes a Boreslay mission.">The account, value and objective stay visible while you play. Complete the preparation moves, beat the hesitation standing between you and the visit, then send Mission 042 to your phone.<div className="df-talk"><b>TALK TRACK</b>{["Opening","Who to Ask For","Discovery Question","Laundry currently being handled across the properties?"].map(x=><span key={x}>{x}</span>)}</div></Step><Step number="4" title="You walk in ready.">Pick up the printed proposal, follow the talk track and ask for the recurring fluff-and-fold account.<div className="df-field"><img src={fieldVisit} alt="A laundromat owner walking into a commercial property prepared for a sales visit" /><span><Check /><b>ACCOUNT WON</b><strong>$24,800 / year</strong><small>Fluff-and-fold contract</small></span></div></Step></div></section>

      <section className="df-dark" id="boreslay"><article className="df-dark-intro"><span>BORESLAY</span><h2>Dashboards get ignored.<br />Games get played.</h2><p>Boreslay turns the exact account on your radar into a playable mission.</p><p>Escape the screen. Prepare the pitch. Beat the delay, hesitation and status quo standing between you and the visit.</p><b>The game ends on the screen.<br />The mission continues in real life.</b></article><article className="df-dark-game"><MissionCard compact /></article><article className="df-churn"><header><span>CHURN RADAR</span><em>ACTIVITY LOG</em></header><h3>It notices when good customers go quiet, too.</h3><p>DayForge detects the pattern changing before the revenue disappears.</p>{["Order frequency dropping","Lower pounds per week","Unresolved complaint","Missed pickups","Competitor entering conversation"].map((x,i)=><span key={x}><i className={i<2?"hot":""} />{x}</span>)}</article><article className="df-intel"><header>INTELLIGENCE ENGINE</header><h3>DayForge learns what a real opportunity looks like for you.</h3><p>Choose the signals that matter to your laundry business. DayForge watches them in real time, combines them with geography, account fit and your mission results—then shows you who is ready, why now and how to win.</p><ul>{["New hotel or apartment opening","Property portfolio expansion","Gym or salon adding locations","Hiring for housekeeping / operations","Nearby revenue change","Estimated weekly laundry volume","Your available capacity & pricing"].map(x=><li key={x}><Check />{x}</li>)}</ul></article></section>

      <section className="df-bottom" id="pricing"><article className="df-testimonial" id="about"><span>REAL RESULTS. REAL LAUNDRIES.</span><div><img src={fieldVisit} alt="Laundromat operator" /><p>“DayForge shows us who&apos;s ready. We walk in knowing why now, who to ask for and what to say. We&apos;ve landed more commercial accounts in the last 90 days than the previous two years combined.”<b>— Mike Valencia<br />West Central Laundry<br />Los Angeles, CA</b><em>★★★★★</em></p></div></article><article className="df-compare"><div><b>THE DAYFORGE WAY</b>{["Real-time local laundry signals","Territory-based account targeting","Game-driven follow-through","Laundry-focused talk tracks","More conversations that close","A system that learns from every mission"].map(x=><span key={x}><Check />{x}</span>)}</div><div><b>THE OLD WAY</b>{["Cold calling & bought lists","No local context","Dashboards nobody uses","Generic pitches","Opportunities slip through the cracks","Silence"].map(x=><span key={x}><X />{x}</span>)}</div></article><article className="df-cost"><h3>What did the account you drove past today cost you?</h3><p>You will never see that number. DayForge makes sure you don&apos;t have to keep wondering.</p><Cta source="pricing" onOpen={openScheduler} /></article><article className="df-price"><span>DAYFORGE OPERATOR</span><p>Everything you need to run and grow your fluff-and-fold laundry.</p><strong>$199<small>/month</small></strong>{["See the signals, POS, orders, routes, capacity","Grow the laundry: missions, pitches, proposals","Churn radar & win-back tools","CRM integrations & reporting","Cancel anytime. No setup fee. No contracts."].map(x=><i key={x}><Check />{x}</i>)}</article><article className="df-faq" id="faq"><span>FAQ</span>{["Where does the data come from?","Is my territory private?","Do I need a sales team?","Will this work for my store size?","What is Boreslay?"].map(q=><details key={q}><summary>{q}<ChevronDown /></summary><p>DayForge combines your operating signals with local territory intelligence, then keeps you in control of every action.</p></details>)}</article><article className="df-final"><h3>Stop driving past the next account you could win.</h3><Cta source="final" onOpen={openScheduler} /><p><LockKeyhole /> Secure &amp; private<br />No credit card required</p></article></section>
    </main>
    <footer className="df-footer"><Brand /><nav><a href="#product">Product</a><a href="#how">How It Works</a><a href="#boreslay">Boreslay</a><a href="#pricing">Pricing</a><a href="#faq">FAQ</a><a href="#about">About</a><a href={`mailto:${FALLBACK_EMAIL}`}>Contact</a></nav><span>Privacy&nbsp;&nbsp;&nbsp; Terms&nbsp;&nbsp;&nbsp; © 2026 DayForge. All rights reserved.</span></footer>
    <SchedulerDialog open={open} onClose={() => setOpen(false)} returnFocusRef={lastCtaRef} />
  </div>;
}
