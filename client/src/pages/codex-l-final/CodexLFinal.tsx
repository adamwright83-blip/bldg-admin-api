import {
  useEffect,
  useRef,
  useState,
  type RefObject,
  type SyntheticEvent,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  MapPin,
  Navigation,
  Printer,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from "lucide-react";
import ownerWestviewEntry from "@/assets/codex-l-final/owner-westview-entry.jpg";
import printedLeaveBehind from "@/assets/codex-l-final/printed-leave-behind.jpg";
import rentReaperInterrupt from "@/assets/codex-l-final/rent-reaper-interrupt.jpg";
import rentReaperVictory from "@/assets/codex-l-final/rent-reaper-victory.jpg";
import {
  getCodexLandingAnalytics,
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
import "./codex-l-final.css";

const FALLBACK_EMAIL = "adam@bldg.chat";
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

type TerritoryCtaProps = {
  source: CtaSource;
  onOpen: (trigger: HTMLButtonElement) => void;
  className?: string;
};

function TerritoryCta({ source, onOpen, className = "" }: TerritoryCtaProps) {
  return (
    <button
      className={`clf-cta ${className}`.trim()}
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

function DayForgeMark() {
  return (
    <a className="clf-mark" href="#top" aria-label="D DAYFORGE FOR LAUNDRY">
      <span className="clf-mark-glyph" aria-hidden="true">
        D
      </span>
      <span className="clf-mark-word">DAYFORGE</span>
      <span className="clf-mark-rule" aria-hidden="true" />
      <span className="clf-mark-edition">FOR LAUNDRY</span>
    </a>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <span className="clf-eyebrow">{children}</span>;
}

function HeroPhone() {
  return (
    <div
      className="clf-phone clf-phone-hero"
      aria-label="Today's field mission"
    >
      <div className="clf-phone-speaker" aria-hidden="true" />
      <div className="clf-phone-status">
        <span>09:41</span>
        <span>DAYFORGE</span>
      </div>
      <div className="clf-phone-mission-mark">
        <MapPin aria-hidden="true" />
        TODAY&apos;S FIELD MISSION
      </div>
      <p>Westview Property Management</p>
      <small>15 buildings · 1.4 miles away</small>
      <div className="clf-phone-value">
        <span>EST. ANNUAL CONTRACT</span>
        <strong>$24,800</strong>
      </div>
      <div className="clf-phone-target">
        <span>ASK FOR</span>
        <b>Operations manager</b>
      </div>
      <div className="clf-phone-drive">
        <Navigation aria-hidden="true" />
        PRESS TO DRIVE
      </div>
    </div>
  );
}

function HeroExhibit() {
  return (
    <div
      className="clf-exhibit"
      aria-label="Sage finds a commercial account, BORESLAY turns it into a mission, and the phone guides the owner through the door"
    >
      <div className="clf-exhibit-rail" aria-hidden="true" />
      <div className="clf-exhibit-sage">
        <div className="clf-exhibit-panel-top">
          <span>SAGE</span>
          <b>ACCOUNT RANKING</b>
        </div>
        <div className="clf-exhibit-sage-row is-selected">
          <div>
            <strong>Westview PM</strong>
            <small>15 buildings</small>
          </div>
          <span>HIGH</span>
          <b>$24.8K</b>
        </div>
        <div className="clf-exhibit-sage-row">
          <div>
            <strong>Harborlight</strong>
            <small>44 rooms</small>
          </div>
          <span>HIGH</span>
          <b>$18.2K</b>
        </div>
        <div className="clf-exhibit-sage-row">
          <div>
            <strong>Meridian PT</strong>
            <small>3 locations</small>
          </div>
          <span>MED</span>
          <b>$9.6K</b>
        </div>
      </div>

      <div className="clf-exhibit-game">
        <img
          src={rentReaperInterrupt}
          alt="Concept render of a BORESLAY owner champion facing the Rent Reaper"
          width={1200}
          height={675}
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <div className="clf-exhibit-game-hud">
          <span>MISSION INCOMING</span>
          <strong>THE RENT REAPER</strong>
          <small>WESTVIEW PROPERTY MANAGEMENT</small>
        </div>
      </div>

      <div className="clf-exhibit-phone">
        <HeroPhone />
      </div>

      <div className="clf-exhibit-plinth" aria-hidden="true">
        <span>01 · FIND</span>
        <span>02 · PLAY</span>
        <span>03 · GO</span>
      </div>
    </div>
  );
}

function SageRankingMockup() {
  return (
    <div
      className="clf-sage-window"
      aria-label="Sage commercial account ranking"
    >
      <div className="clf-window-bar">
        <div>
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </div>
        <b>SAGE · COMMERCIAL TERRITORY</b>
        <small>LIVE RANKING</small>
      </div>
      <div className="clf-sage-summary">
        <div>
          <span>ACCOUNTS CHECKED</span>
          <strong>286</strong>
        </div>
        <div>
          <span>WORTH THE DRIVE</span>
          <strong>12</strong>
        </div>
        <div>
          <span>TOP OPPORTUNITY</span>
          <strong>$24.8K</strong>
        </div>
      </div>
      <div className="clf-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Footprint</th>
              <th>Est. annual value</th>
              <th>Who to ask for</th>
              <th>Distance</th>
              <th>Win Probability</th>
            </tr>
          </thead>
          <tbody>
            {SAGE_ACCOUNTS.map((account, index) => (
              <tr key={account.account} className={index === 0 ? "is-top" : ""}>
                <td data-label="Account">
                  <b>{account.account}</b>
                </td>
                <td data-label="Footprint">{account.footprint}</td>
                <td data-label="Est. annual value">{account.annualValue}</td>
                <td data-label="Who to ask for">{account.decisionMaker}</td>
                <td data-label="Distance">{account.distance}</td>
                <td data-label="Win Probability">
                  <span
                    className={`clf-probability is-${account.probability.toLowerCase()}`}
                  >
                    {account.probability}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ol className="clf-callouts" aria-label="Top account callouts">
        <li>
          <span>01</span>15 buildings
        </li>
        <li>
          <span>02</span>Est. $24,800/yr
        </li>
        <li>
          <span>03</span>Ask for the operations manager
        </li>
      </ol>
    </div>
  );
}

function MissionInterruptMockup() {
  return (
    <div className="clf-game-frame clf-game-interrupt">
      <img
        src={rentReaperInterrupt}
        alt="Concept render of the Rent Reaper mission in BORESLAY"
        width={1200}
        height={675}
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />
      <div className="clf-game-topline">
        <span>BORESLAY</span>
        <small>TODAY&apos;S COMMERCIAL MISSION</small>
      </div>
      <div className="clf-mission-interrupt-card">
        <span>MISSION INCOMING</span>
        <h4>THE RENT REAPER</h4>
        <p>
          Westview Property Management — their in-house laundry is draining
          profits. Defeat the boss and win the contract.
        </p>
        <div>
          <b>EST. CONTRACT · $24,800/YR</b>
          <span>ACCEPT MISSION</span>
        </div>
      </div>
    </div>
  );
}

function PrepPhone() {
  return (
    <div className="clf-phone clf-phone-detail">
      <div className="clf-phone-speaker" aria-hidden="true" />
      <div className="clf-phone-status">
        <span>09:41</span>
        <span>PREP · 1 OF 2</span>
      </div>
      <div className="clf-phone-detail-head">
        <span>BEFORE YOU LEAVE</span>
        <h4>Westview is worth showing up ready.</h4>
      </div>
      <ul>
        <li>
          <Check aria-hidden="true" /> Clean polo
        </li>
        <li>
          <Check aria-hidden="true" /> Quote sheet
        </li>
        <li>
          <Check aria-hidden="true" /> Decision-maker brief
        </li>
        <li>
          <Check aria-hidden="true" /> Objection answers
        </li>
      </ul>
      <div className="clf-phone-drive">
        <Navigation aria-hidden="true" /> PRESS TO DRIVE
      </div>
    </div>
  );
}

function PrintStopPhone() {
  return (
    <div className="clf-phone clf-phone-detail is-print">
      <div className="clf-phone-speaker" aria-hidden="true" />
      <div className="clf-phone-status">
        <span>09:46</span>
        <span>ROUTE · STOP 1 OF 2</span>
      </div>
      <div className="clf-print-icon">
        <Printer aria-hidden="true" />
      </div>
      <span className="clf-phone-label">FIRST STOP</span>
      <h4>Pick up your leave-behind.</h4>
      <p>PrintWorks · 0.8 miles</p>
      <div className="clf-pickup-ready">
        <span>READY NOW</span>
        <b>Your services · pricing · name</b>
      </div>
      <div className="clf-phone-drive">
        <Navigation aria-hidden="true" /> KEEP DRIVING
      </div>
    </div>
  );
}

function VisitPrepMockup() {
  return (
    <div className="clf-prep-visual">
      <div className="clf-prep-phones">
        <PrepPhone />
        <PrintStopPhone />
      </div>
      <figure className="clf-collateral-photo">
        <img
          src={printedLeaveBehind}
          alt="Concept photo of a printed laundry-services leave-behind at a print shop"
          width={960}
          height={720}
          loading="eager"
          decoding="async"
        />
        <figcaption>LEAVE-BEHIND · PRINTED &amp; READY</figcaption>
      </figure>
    </div>
  );
}

function FieldVisitMockup() {
  return (
    <div className="clf-field-visual">
      <img
        className="clf-field-photo"
        src={ownerWestviewEntry}
        alt="Concept photo of a laundromat owner walking toward a commercial account with collateral"
        width={1200}
        height={675}
        loading="eager"
        decoding="async"
      />
      <div className="clf-pitch-card">
        <span>AT THE DOOR</span>
        <h4>Westview Property Management</h4>
        <dl>
          <div>
            <dt>ASK FOR</dt>
            <dd>The operations manager</dd>
          </div>
          <div>
            <dt>LEAD WITH</dt>
            <dd>Less staff time lost to in-house laundry</dd>
          </div>
          <div>
            <dt>LEAVE BEHIND</dt>
            <dd>One-page service &amp; pricing sheet</dd>
          </div>
        </dl>
        <b>YOU&apos;RE READY. WALK IN.</b>
      </div>
    </div>
  );
}

function VictoryMockup() {
  return (
    <div className="clf-game-frame clf-game-victory">
      <img
        src={rentReaperVictory}
        alt="Concept render of the Rent Reaper defeated in BORESLAY"
        width={1200}
        height={675}
        loading="eager"
        decoding="async"
      />
      <div className="clf-victory-hud">
        <span>VICTORY</span>
        <h3>CONTRACT SECURED</h3>
        <strong>+$24,800/YR</strong>
        <small>WESTVIEW PROPERTY MANAGEMENT</small>
      </div>
    </div>
  );
}

type SchedulerDialogProps = {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
};

function SchedulerDialog({
  open,
  onClose,
  returnFocusRef,
}: SchedulerDialogProps) {
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
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected) {
          trigger.focus();
          return;
        }
        if (triggerSource) {
          document
            .querySelector<HTMLButtonElement>(
              `button[data-cta-source="${triggerSource}"]`
            )
            ?.focus();
        }
      });
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="clf-scheduler"
      aria-labelledby="clf-scheduler-title"
      onCancel={event => {
        event.preventDefault();
        onClose();
      }}
      onClick={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="clf-scheduler-shell">
        <button
          className="clf-scheduler-close"
          type="button"
          aria-label="Close scheduler"
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
        <div className="clf-scheduler-heading">
          <Eyebrow>15-minute live demo</Eyebrow>
          <h2 id="clf-scheduler-title">
            Let&apos;s map the commercial accounts around your store.
          </h2>
          <p>
            Pick a time that works. We&apos;ll map your territory live on the
            call.
          </p>
        </div>
        {SCHEDULER_URL ? (
          <div className="clf-scheduler-widget">
            <iframe
              src={SCHEDULER_URL}
              title="Schedule your DayForge territory mapping demo"
              loading="eager"
              referrerPolicy="strict-origin-when-cross-origin"
            />
            <a href={SCHEDULER_URL} target="_blank" rel="noreferrer">
              Open scheduler in a new tab <ArrowRight aria-hidden="true" />
            </a>
          </div>
        ) : (
          <div className="clf-scheduler-fallback">
            <MapPin aria-hidden="true" />
            <h3>The live calendar is being connected.</h3>
            <p>Email Adam and we&apos;ll map your territory together.</p>
            <a
              className="clf-cta"
              href={`mailto:${FALLBACK_EMAIL}?subject=Map%20my%20DayForge%20territory`}
            >
              EMAIL {FALLBACK_EMAIL}
              <ArrowRight aria-hidden="true" />
            </a>
          </div>
        )}
      </div>
    </dialog>
  );
}

function updateDocumentMetadata() {
  const previousTitle = document.title;
  const description = document.querySelector<HTMLMetaElement>(
    'meta[name="description"]'
  );
  const previousDescription = description?.content;
  const createdDescription = description ?? document.createElement("meta");

  if (!description) {
    createdDescription.name = "description";
    document.head.appendChild(createdDescription);
  }

  document.title = "DayForge for Laundry — Map the accounts you can win";
  createdDescription.content =
    "DayForge ranks the commercial laundry accounts around your store and turns the best opportunity into a mission that gets you through the door ready to pitch.";

  return () => {
    document.title = previousTitle;
    if (description && previousDescription !== undefined) {
      description.content = previousDescription;
    } else {
      createdDescription.remove();
    }
  };
}

export default function CodexLFinal() {
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [showSticky, setShowSticky] = useState(false);
  const [draftEditable, setDraftEditable] = useState(false);
  const [draftMessage, setDraftMessage] = useState(
    "Hi Maya — we haven't seen you in a while. We've kept your usual wash-and-fold preferences saved. Want us to schedule a pickup this week?"
  );
  const [draftStatus, setDraftStatus] = useState(
    "Draft prepared · Nothing sent"
  );
  const missionEndRef = useRef<HTMLDivElement>(null);
  const faqStartRef = useRef<HTMLElement>(null);
  const lastCtaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => updateDocumentMetadata(), []);

  useEffect(() => {
    void getCodexLandingAnalytics();
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    const updateSticky = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const missionEnd = missionEndRef.current;
        const faqStart = faqStartRef.current;
        if (!missionEnd || !faqStart) return;
        const missionPassed = missionEnd.getBoundingClientRect().top <= 0;
        const faqReached =
          faqStart.getBoundingClientRect().top <= window.innerHeight * 0.92;
        const shouldShow = missionPassed && !faqReached;
        setShowSticky(current =>
          current === shouldShow ? current : shouldShow
        );
      });
    };

    const observer = new IntersectionObserver(updateSticky, {
      threshold: [0, 1],
    });
    if (missionEndRef.current) observer.observe(missionEndRef.current);
    if (faqStartRef.current) observer.observe(faqStartRef.current);
    window.addEventListener("scroll", updateSticky, { passive: true });
    window.addEventListener("resize", updateSticky);
    updateSticky();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", updateSticky);
      window.removeEventListener("resize", updateSticky);
    };
  }, []);

  const openScheduler = (trigger: HTMLButtonElement) => {
    lastCtaRef.current = trigger;
    setSchedulerOpen(true);
  };

  const onFaqToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const details = event.currentTarget;
    if (!details.open) return;
    const questionId = details.dataset.questionId;
    const faq = FAQS.find(item => item.id === questionId);
    if (faq) trackFaqOpen(faq.id);
  };

  return (
    <div className="clf-page" id="top">
      <a className="clf-skip" href="#clf-main">
        Skip to content
      </a>

      <header className="clf-header">
        <DayForgeMark />
        <nav aria-label="Page navigation">
          <a href="#mission">How it works</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </nav>
        <span className="clf-header-status">
          <span aria-hidden="true" /> OPERATOR-BUILT IN LA
        </span>
      </header>

      <main id="clf-main">
        <section
          className="clf-hero"
          data-clf-section="hero"
          aria-labelledby="clf-hero-title"
        >
          <div className="clf-hero-copy">
            <Eyebrow>FOR LAUNDROMAT &amp; FLUFF-AND-FOLD OWNERS</Eyebrow>
            <h1 id="clf-hero-title">
              Stop driving past businesses that could be paying you.
            </h1>
            <p>
              DayForge ranks the local commercial accounts you can realistically
              win — what each could be worth, who to ask for, and what to bring
              — then turns the best one into a game-driven mission that gets you
              through the door ready to pitch.
            </p>
          </div>

          <HeroExhibit />

          <div className="clf-hero-actions">
            <TerritoryCta source="hero" onOpen={openScheduler} />
            <p>
              See the winnable accounts around your store in a 15-minute live
              demo.
            </p>
            <div className="clf-tour-slot" aria-hidden="true" />
            <strong>
              <ShieldCheck aria-hidden="true" /> Built by a laundromat operator.
              Running daily in our own LA stores.
            </strong>
          </div>
        </section>

        <section
          className="clf-credibility"
          data-clf-section="credibility"
          aria-label="DayForge credibility"
        >
          <p>
            <span>BUILT BY A LAUNDROMAT OPERATOR</span>
            <i aria-hidden="true" />
            <span>RUNNING DAILY IN OUR OWN LA STORES</span>
            <i aria-hidden="true" />
            <span>REAL DATA IN</span>
            <i aria-hidden="true" />
            <span>REAL VISITS OUT</span>
          </p>
        </section>

        <section
          className="clf-mission"
          id="mission"
          data-clf-section="mission"
          aria-labelledby="clf-mission-title"
        >
          <div className="clf-section-heading">
            <Eyebrow>ONE MISSION · START TO FINISH</Eyebrow>
            <h2 id="clf-mission-title">
              How does a business on your street become your customer?
            </h2>
            <p>Here&apos;s one mission, start to finish.</p>
          </div>

          <div className="clf-chapters">
            <article className="clf-chapter">
              <div className="clf-chapter-copy">
                <span className="clf-chapter-number">CHAPTER 01</span>
                <h3>Sage picks the account.</h3>
                <p>
                  Sage checks every commercial property near your store. Most
                  aren&apos;t worth your gas. One is: a property management
                  company running 15 buildings — towels, mats, and tenant
                  laundry worth an estimated $24,800 a year. Sage tells you who
                  to ask for and what offer makes sense.
                </p>
              </div>
              <SageRankingMockup />
            </article>

            <article className="clf-chapter">
              <div className="clf-chapter-copy">
                <span className="clf-chapter-number">CHAPTER 02</span>
                <h3>It becomes today&apos;s mission.</h3>
                <p>
                  The opportunity doesn&apos;t go on a list. It lands inside a
                  game on your desktop — and it&apos;s today&apos;s mission to
                  complete.
                </p>
                <div className="clf-chapter-lesson">
                  <Target aria-hidden="true" />
                  <span>
                    <b>The boss is the problem.</b> The win is a real account.
                  </span>
                </div>
              </div>
              <MissionInterruptMockup />
            </article>

            <article className="clf-chapter">
              <div className="clf-chapter-copy">
                <span className="clf-chapter-number">CHAPTER 03</span>
                <h3>DayForge preps the visit.</h3>
                <p className="clf-chapter-short">
                  Clean polo. Quote sheet. Press to drive.
                </p>
                <p>
                  First stop isn&apos;t the account — it&apos;s the print shop.
                  DayForge already sent your leave-behind: your services, your
                  pricing, your name. Pick it up. Keep driving.
                </p>
              </div>
              <VisitPrepMockup />
            </article>

            <article className="clf-chapter">
              <div className="clf-chapter-copy">
                <span className="clf-chapter-number">CHAPTER 04</span>
                <h3>Through the door.</h3>
                <p>
                  Your phone tells you who to ask for, the one benefit to lead
                  with, and what to leave behind. Then you walk in.
                </p>
              </div>
              <FieldVisitMockup />
            </article>
          </div>

          <div className="clf-mission-cta-band">
            <div>
              <Eyebrow>YOUR STREET · YOUR NEXT ACCOUNT</Eyebrow>
              <h3>What businesses are you driving past?</h3>
              <p>
                See the winnable accounts around your store in a 15-minute live
                demo.
              </p>
            </div>
            <TerritoryCta
              source="mission"
              onOpen={openScheduler}
              className="is-light"
            />
          </div>
          <div
            ref={missionEndRef}
            className="clf-sticky-start"
            aria-hidden="true"
          />
        </section>

        <section
          className="clf-why-game"
          data-clf-section="why-game"
          aria-labelledby="clf-game-title"
        >
          <div className="clf-why-copy">
            <Eyebrow>WHY IT&apos;S A GAME</Eyebrow>
            <h2 id="clf-game-title">
              Dashboards get ignored. Games get played.
            </h2>
            <p>
              Every business tool you&apos;ve bought gave you another list of
              things to do. The list lost. Not because you&apos;re lazy —
              because a list has no pull.
            </p>
            <p>
              DayForge is built the other way. Your best opportunity arrives
              inside a game with momentum, progress, and a mission that
              doesn&apos;t end on the screen. You don&apos;t just check
              DayForge. You play it — and the mission walks you out the door.
            </p>
            <div className="clf-boreslay-reveal">
              <span>MEET</span>
              <strong>BORESLAY</strong>
              <p>
                The desktop game that turns DayForge&apos;s best sales
                opportunity into today&apos;s real-world mission.
              </p>
            </div>
          </div>
          <VictoryMockup />
        </section>

        <section
          className="clf-recovery"
          data-clf-section="recovery"
          aria-labelledby="clf-recovery-title"
        >
          <div className="clf-section-heading is-compact">
            <Eyebrow>THE BUSINESS YOU ALREADY HAVE</Eyebrow>
            <h2 id="clf-recovery-title">
              It notices when good customers disappear, too.
            </h2>
            <p>
              Regulars rarely quit out loud. They just stop showing up. DayForge
              catches it early — and writes the first draft of the message that
              brings them back.
            </p>
          </div>

          <div className="clf-recovery-ui">
            <div className="clf-quiet-table">
              <div className="clf-window-bar">
                <div>
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                  <span aria-hidden="true" />
                </div>
                <b>CUSTOMER WATCH</b>
                <small>3 SIGNALS</small>
              </div>
              <div className="clf-quiet-annotation">
                <Sparkles aria-hidden="true" />3 top customers went quiet. No
                complaints filed.
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Monthly value</th>
                    <th>Days quiet</th>
                  </tr>
                </thead>
                <tbody>
                  {QUIET_CUSTOMERS.map(customer => (
                    <tr key={customer.name}>
                      <td>{customer.name}</td>
                      <td>{customer.monthlyValue}</td>
                      <td>{customer.daysQuiet}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="clf-draft-card">
              <header>
                <div>
                  <span>SAGE DRAFT</span>
                  <b>WIN-BACK MESSAGE</b>
                </div>
                <small>{draftStatus}</small>
              </header>
              <label htmlFor="clf-draft-message">Message to Maya</label>
              <textarea
                id="clf-draft-message"
                value={draftMessage}
                readOnly={!draftEditable}
                onChange={event => setDraftMessage(event.target.value)}
              />
              <footer>
                <button
                  type="button"
                  onClick={() => {
                    setDraftEditable(true);
                    setDraftStatus("Editing · Nothing sent");
                    window.requestAnimationFrame(() =>
                      document.getElementById("clf-draft-message")?.focus()
                    );
                  }}
                >
                  EDIT
                </button>
                <button
                  type="button"
                  className="is-send"
                  disabled={!draftEditable}
                  onClick={() => {
                    setDraftEditable(false);
                    setDraftStatus("Ready for your approval");
                  }}
                >
                  SEND
                </button>
              </footer>
            </div>
          </div>

          <p className="clf-human-control">
            <ShieldCheck aria-hidden="true" />
            DayForge investigates and prepares the move. You review it, improve
            it, and decide when it goes out.
          </p>
        </section>

        <section
          className="clf-pricing"
          id="pricing"
          data-clf-section="pricing"
          aria-labelledby="clf-pricing-title"
        >
          <div className="clf-section-heading is-centered">
            <Eyebrow>EXAMPLE MISSION ECONOMICS</Eyebrow>
            <h2 id="clf-pricing-title">
              One account can pay for years of DayForge.
            </h2>
          </div>

          <div className="clf-roi-math">
            <div className="is-account">
              <span>THAT PROPERTY MANAGEMENT ACCOUNT</span>
              <strong>$24,800</strong>
              <small>/ YEAR</small>
            </div>
            <div className="clf-roi-versus" aria-hidden="true">
              VS
            </div>
            <div className="is-dayforge">
              <span>DAYFORGE</span>
              <strong>$2,388</strong>
              <small>/ YEAR · $199/MONTH</small>
            </div>
            <p>
              One closed account <b>≈ 10+ years</b> of DayForge
            </p>
          </div>
          <p className="clf-roi-footnote">
            Illustrative revenue estimate, not profit or a guarantee. Costs and
            results vary.
          </p>

          <div className="clf-price-card">
            <div className="clf-price-card-top">
              <div>
                <Eyebrow>DAYFORGE OPERATOR</Eyebrow>
                <p>Everything. One location, one territory.</p>
              </div>
              <div className="clf-price">
                <strong>$199</strong>
                <span>/month</span>
              </div>
            </div>
            <ul>
              {PRICING_FEATURES.map(feature => (
                <li key={feature}>
                  <Check aria-hidden="true" /> {feature}
                </li>
              ))}
            </ul>
            <div className="clf-founding-offer">
              <Sparkles aria-hidden="true" />
              <span>
                <b>First 25 operators: $149/month,</b> locked for 12 months.
              </span>
            </div>
            <TerritoryCta source="pricing" onOpen={openScheduler} />
            <p className="clf-price-support">
              15-minute demo · No credit card · Cancel anytime, no long
              contracts · We map your territory live on the call.
            </p>
          </div>
          <p className="clf-price-proof">
            Built by a laundromat operator. Running daily in our own LA stores.
          </p>
        </section>

        <section
          ref={faqStartRef}
          className="clf-faq-section"
          id="faq"
          data-clf-section="faq-final"
          aria-labelledby="clf-faq-title"
        >
          <div className="clf-faq-wrap">
            <div className="clf-section-heading is-compact">
              <Eyebrow>NO FINE PRINT · JUST STRAIGHT ANSWERS</Eyebrow>
              <h2 id="clf-faq-title">Fair questions.</h2>
            </div>
            <div className="clf-faq-list">
              {FAQS.map((faq, index) => (
                <details
                  key={faq.id}
                  data-question-id={faq.id}
                  onToggle={onFaqToggle}
                >
                  <summary>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{faq.question}</strong>
                    <ChevronDown aria-hidden="true" />
                  </summary>
                  <div>
                    <p>{faq.answer}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>

          <div className="clf-final-band">
            <div className="clf-final-map" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div>
              <Eyebrow>YOUR NEXT ACCOUNT IS ALREADY OUT THERE</Eyebrow>
              <h2>Stop passing the next account you could win.</h2>
              <p>
                See the winnable commercial accounts around your store in a
                15-minute live demo.
              </p>
            </div>
            <TerritoryCta
              source="final"
              onOpen={openScheduler}
              className="is-light"
            />
          </div>

          <footer className="clf-footer">
            <DayForgeMark />
            <p>Built in Los Angeles for owners who still do the work.</p>
            <a href={`mailto:${FALLBACK_EMAIL}`}>{FALLBACK_EMAIL}</a>
          </footer>
        </section>
      </main>

      {showSticky ? (
        <aside
          className={`clf-sticky${schedulerOpen ? " is-dialog-open" : ""}`}
          aria-label="Map my territory"
        >
          <div>
            <MapPin aria-hidden="true" />
            <span>
              <b>What&apos;s around your store?</b>
              See the accounts worth the drive.
            </span>
          </div>
          <TerritoryCta source="sticky" onOpen={openScheduler} />
        </aside>
      ) : null}

      <SchedulerDialog
        open={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        returnFocusRef={lastCtaRef}
      />
    </div>
  );
}
