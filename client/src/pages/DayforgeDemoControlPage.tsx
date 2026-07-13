import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileText,
  Gamepad2,
  Gauge,
  Loader2,
  LockKeyhole,
  Map,
  Navigation,
  Phone,
  Radar,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserRound,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import rallyScreenshot from "@/assets/boreslay-rally/p5-final-browser-proof.png";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import "./dayforge-demo-control.css";

const DEMO_MODE_ENABLED =
  String(import.meta.env.VITE_DAYFORGE_DEMO_MODE ?? "").toLowerCase() ===
  "true";

const TERRITORY_MAP_ASSET =
  "/assets/dayforge-final/july-demo-territory-map.svg";

const PROVIDER_ORDER = ["google", "stripe", "email", "sms", "print"] as const;

type ProviderKey = (typeof PROVIDER_ORDER)[number];
type ProviderMode =
  | "LIVE"
  | "TEST"
  | "SIMULATED"
  | "NOT_CONFIGURED"
  | "BROWSER_PDF_FALLBACK"
  | "CONNECTED";

type DayforgeDemoStatus = {
  demoEnabled?: boolean;
  tenantId?: string;
  tenantSlug?: string;
  mission?: {
    id: string;
    name?: string | null;
    status?: string | null;
    assignedTo?: string | null;
    accountName?: string | null;
    decisionMakerName?: string | null;
    estimatedAnnualValueCents?: number | null;
  } | null;
  pipelineStage?: string | null;
  proposalStatus?: string | null;
  fieldAssignment?: string | null;
  revenueState?: string | null;
  churnState?: string | null;
  providerStatus?: Partial<Record<ProviderKey, ProviderMode>>;
  recentEvents?: Array<{ id: string; label: string; occurredAt: string }>;
  releaseGateHealthy?: boolean | null;
};

type IconType = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

type JourneyStep = {
  label: string;
  eyebrow: string;
  href: (missionId: string | null) => string | null;
  icon: IconType;
};

const PROVIDER_META: Record<
  ProviderKey,
  { label: string; note: string; icon: IconType }
> = {
  google: {
    label: "Territory data",
    note: "Google Maps + Places",
    icon: Map,
  },
  stripe: {
    label: "Billing",
    note: "Stripe subscriptions",
    icon: CircleDollarSign,
  },
  email: {
    label: "Email",
    note: "Transactional delivery",
    icon: FileText,
  },
  sms: {
    label: "SMS",
    note: "Twilio outreach",
    icon: Phone,
  },
  print: {
    label: "Proposal output",
    note: "Print / PDF",
    icon: FileText,
  },
};

const JOURNEY_STEPS: JourneyStep[] = [
  {
    label: "Territory intelligence",
    eyebrow: "Find",
    href: () => "/territory-preview",
    icon: Radar,
  },
  {
    label: "Persisted mission",
    eyebrow: "Lock",
    href: () => "/commercial-missions",
    icon: Target,
  },
  {
    label: "BORESLAY Rally",
    eyebrow: "Commit",
    href: missionId =>
      missionId ? `/boreslay-rally?missionId=${missionId}` : "/boreslay-rally",
    icon: Gamepad2,
  },
  {
    label: "Phone unlock",
    eyebrow: "Move",
    href: () => "/commercial-missions",
    icon: Phone,
  },
  {
    label: "Field execution",
    eyebrow: "Act",
    href: missionId =>
      missionId ? `/driver/sales-mission/${missionId}` : null,
    icon: Navigation,
  },
  {
    label: "Revenue attribution",
    eyebrow: "Prove",
    href: () => "/commercial-pipeline",
    icon: Trophy,
  },
];

const PRESENTER_CHECKLIST: Array<{
  label: string;
  href: (missionId: string | null) => string | null;
}> = [
  { label: "Open the DayForge landing page", href: () => "/dayforge" },
  { label: "Map the laundromat territory", href: () => "/territory-preview" },
  { label: "Show ranked nearby accounts", href: () => "/territory-preview" },
  { label: "Open canonical MISSION 042", href: () => "/commercial-missions" },
  {
    label: "Play the real BORESLAY mission",
    href: missionId =>
      missionId ? `/boreslay-rally?missionId=${missionId}` : "/boreslay-rally",
  },
  { label: "Show the one-time phone unlock", href: () => "/commercial-missions" },
  {
    label: "Open DayForge Field",
    href: missionId =>
      missionId ? `/driver/sales-mission/${missionId}` : null,
  },
  {
    label: "Complete preparation and route steps",
    href: missionId =>
      missionId ? `/driver/sales-mission/${missionId}` : null,
  },
  {
    label: "Review the approved proposal",
    href: missionId =>
      missionId ? `/commercial-proposal/${missionId}` : null,
  },
  {
    label: "Record the real-world visit",
    href: missionId =>
      missionId ? `/driver/sales-mission/${missionId}` : null,
  },
  { label: "Move the account to won", href: () => "/commercial-missions" },
  { label: "Attribute the first paid order", href: () => "/commercial-pipeline" },
  { label: "Show realized revenue", href: () => "/commercial-pipeline" },
  { label: "Show the complete event timeline", href: () => "/commercial-missions" },
  { label: "Open the Churn Radar recovery mission", href: () => "/churn-radar" },
];

const STATUS_STAGE: Record<string, number> = {
  candidate: 0,
  selected: 0,
  game_ready: 1,
  game_active: 2,
  game_completed: 2,
  phone_ready: 3,
  preparing: 4,
  en_route: 4,
  arrived: 4,
  visit_completed: 4,
  follow_up: 4,
  won: 5,
  lost: 5,
};

function formatMoney(cents?: number | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents ?? 2_480_000) / 100);
}

function humanize(value?: string | null, fallback = "Not started") {
  if (!value) return fallback;
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function ProviderRail({
  status,
}: {
  status?: DayforgeDemoStatus["providerStatus"];
}) {
  return (
    <aside className="ddc-provider-rail" aria-label="Provider readiness">
      <div className="ddc-panel-heading">
        <div>
          <span>PROVIDER TRUTH</span>
          <strong>No fake green lights.</strong>
        </div>
        <ShieldCheck aria-hidden />
      </div>
      <div className="ddc-provider-list">
        {PROVIDER_ORDER.map(key => {
          const meta = PROVIDER_META[key];
          const Icon = meta.icon;
          const mode = status?.[key] ?? "NOT_CONFIGURED";
          return (
            <div className="ddc-provider-row" key={key}>
              <div className="ddc-provider-icon">
                <Icon aria-hidden />
              </div>
              <div>
                <strong>{meta.label}</strong>
                <small>{meta.note}</small>
              </div>
              <span className={`ddc-provider-mode ddc-mode-${mode}`}>
                {mode.replaceAll("_", " ")}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

export default function DayforgeDemoControlPage() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  const { loading: authLoading, isAuthenticated } = useAuth();
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const statusQuery = (
    trpc as unknown as {
      system: {
        dayforgeDemo: {
          getStatus: {
            useQuery: (
              input: undefined,
              opts: { enabled: boolean; refetchInterval?: number }
            ) => {
              data: DayforgeDemoStatus | undefined;
              isLoading: boolean;
              error: { message: string } | null;
              refetch: () => Promise<unknown>;
            };
          };
          reset: {
            useMutation: () => {
              mutateAsync: (input?: unknown) => Promise<unknown>;
              isPending: boolean;
            };
          };
        };
      };
    }
  ).system.dayforgeDemo.getStatus.useQuery(undefined, {
    enabled: isAuthenticated && DEMO_MODE_ENABLED,
    refetchInterval: 5000,
  });

  const resetMutation = (
    trpc as unknown as {
      system: {
        dayforgeDemo: {
          reset: {
            useMutation: () => {
              mutateAsync: (input?: unknown) => Promise<unknown>;
              isPending: boolean;
            };
          };
        };
      };
    }
  ).system.dayforgeDemo.reset.useMutation();

  const status = statusQuery.data;
  const missionId = status?.mission?.id ?? null;
  const publicMissionCode = status?.mission?.name ?? "MISSION 042";
  const accountName = status?.mission?.accountName ?? "Westview Property Management";
  const decisionMaker = status?.mission?.decisionMakerName ?? "Dana R.";
  const annualValue = formatMoney(status?.mission?.estimatedAnnualValueCents);
  const missionStatus = status?.mission?.status ?? status?.pipelineStage ?? "game_ready";
  const activeStage = useMemo(() => {
    if (status?.revenueState === "attributed") return 5;
    return STATUS_STAGE[missionStatus] ?? 1;
  }, [missionStatus, status?.revenueState]);

  if (!DEMO_MODE_ENABLED) {
    return (
      <main className="ddc-disabled-page">
        <div>
          <h1>Demo mode is off</h1>
          <p>
            Set VITE_DAYFORGE_DEMO_MODE=true to reach this page. It is never
            available in a normal production deploy.
          </p>
        </div>
      </main>
    );
  }

  if (authLoading) {
    return (
      <main className="ddc-root ddc-center">
        <Loader2 className="ddc-spin" />
      </main>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;
  }

  const handleReset = async () => {
    setActionError(null);
    setNotice(null);
    try {
      await resetMutation.mutateAsync({ confirm: true });
      setNotice("Demo reset complete. Public code remains MISSION 042.");
      setConfirmingReset(false);
      await statusQuery.refetch();
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "Reset failed");
    }
  };

  const gateHealthy = status?.releaseGateHealthy;
  const gateLabel =
    gateHealthy === true
      ? "Release gate healthy"
      : gateHealthy === false
        ? "Release gate needs attention"
        : "Release gate awaiting provider configuration";

  return (
    <main className="ddc-root">
      <div className="ddc-ambient ddc-ambient-one" aria-hidden />
      <div className="ddc-ambient ddc-ambient-two" aria-hidden />

      <header className="ddc-commandbar">
        <Link href="/dayforge" className="ddc-brand" aria-label="DayForge home">
          <span className="ddc-brand-mark">D</span>
          <span>
            <b>DAYFORGE</b>
            <small>JULY DEMO COMMAND CENTER</small>
          </span>
        </Link>
        <div className="ddc-commandbar-center">
          <span className="ddc-live-dot" />
          <span>Isolated demo tenant</span>
          <span className="ddc-command-divider" />
          <span>Safe to reset</span>
        </div>
        <div className="ddc-commandbar-actions">
          <span className="ddc-mode-badge">DEMO MODE</span>
          <Link href="/commercial-missions" className="ddc-header-link">
            Mission admin <ArrowRight aria-hidden />
          </Link>
        </div>
      </header>

      <div className="ddc-shell">
        {(statusQuery.error || actionError || notice) && (
          <div className="ddc-alert-stack" aria-live="polite">
            {statusQuery.error ? (
              <div className="ddc-alert is-error" role="alert">
                <AlertTriangle aria-hidden />
                Could not load demo status: {statusQuery.error.message}
              </div>
            ) : null}
            {actionError ? (
              <div className="ddc-alert is-error" role="alert">
                <AlertTriangle aria-hidden /> {actionError}
              </div>
            ) : null}
            {notice ? (
              <div className="ddc-alert is-success" role="status">
                <CheckCircle2 aria-hidden /> {notice}
              </div>
            ) : null}
          </div>
        )}

        <section className="ddc-hero" aria-labelledby="ddc-title">
          <div className="ddc-hero-copy">
            <span className="ddc-eyebrow">
              <Sparkles aria-hidden /> CANONICAL REVENUE MISSION
            </span>
            <div className="ddc-mission-code-row">
              <h1 id="ddc-title">{publicMissionCode}</h1>
              <span>STABLE PUBLIC CODE</span>
            </div>
            <p className="ddc-hero-deck">
              Watch one nearby business move from territory intelligence to a
              real field visit—and keep the same mission identity the whole way.
            </p>

            <div className="ddc-account-dossier">
              <div className="ddc-account-icon">
                <Building2 aria-hidden />
              </div>
              <div className="ddc-account-name">
                <small>TOP-RANKED COMMERCIAL ACCOUNT</small>
                <strong>{accountName}</strong>
                <span>15 buildings · Property management</span>
              </div>
              <div className="ddc-account-value">
                <small>POTENTIAL ANNUAL VALUE</small>
                <strong>{annualValue}</strong>
                <span>High-confidence opportunity</span>
              </div>
            </div>

            <div className="ddc-person-row">
              <div>
                <UserRound aria-hidden />
                <span>
                  <small>DECISION-MAKER</small>
                  <strong>{decisionMaker}</strong>
                  <em>Operations Manager</em>
                </span>
              </div>
              <div>
                <Route aria-hidden />
                <span>
                  <small>ROUTE FIT</small>
                  <strong>0.2 miles</strong>
                  <em>From the active route</em>
                </span>
              </div>
            </div>

            <div className="ddc-hero-actions">
              <a className="ddc-primary-action" href="/territory-preview">
                <Radar aria-hidden /> Open territory intelligence
                <ArrowRight aria-hidden />
              </a>
              <a
                className="ddc-secondary-action"
                href={
                  missionId
                    ? `/boreslay-rally?missionId=${missionId}`
                    : "/boreslay-rally"
                }
              >
                <Gamepad2 aria-hidden /> Play BORESLAY
              </a>
            </div>

            <div className="ddc-continuity-strip">
              <LockKeyhole aria-hidden />
              <span>
                <b>Mission continuity locked.</b> Internal mission ID {missionId ?? "—"}
                may change after reset. The public code never does.
              </span>
            </div>
          </div>

          <div className="ddc-map-stage">
            <div className="ddc-map-frame">
              <img
                src={TERRITORY_MAP_ASSET}
                alt="DayForge territory map highlighting Westview Property Management near the active laundry route"
              />
              <div className="ddc-map-ribbon">
                <span className="ddc-map-radar-dot" />
                Radar found the account before you drove past it.
              </div>
              <div className="ddc-map-legend">
                <span><i className="is-green" /> Best-fit opportunity</span>
                <span><i className="is-orange" /> Nearby prospects</span>
                <span><i className="is-route" /> Active route</span>
              </div>
            </div>
          </div>

          <ProviderRail status={status?.providerStatus} />
        </section>

        <section className="ddc-journey-rail" aria-label="DayForge mission journey">
          <div className="ddc-journey-line" aria-hidden>
            <span style={{ width: `${(activeStage / (JOURNEY_STEPS.length - 1)) * 100}%` }} />
          </div>
          {JOURNEY_STEPS.map((step, index) => {
            const Icon = step.icon;
            const href = step.href(missionId);
            const state = index < activeStage ? "is-complete" : index === activeStage ? "is-active" : "is-upcoming";
            const content = (
              <>
                <span className="ddc-journey-icon"><Icon aria-hidden /></span>
                <small>{step.eyebrow}</small>
                <strong>{step.label}</strong>
                {index < activeStage ? <Check className="ddc-journey-check" aria-hidden /> : null}
              </>
            );
            return href ? (
              <a className={`ddc-journey-step ${state}`} href={href} key={step.label}>
                {content}
              </a>
            ) : (
              <div className={`ddc-journey-step ${state}`} key={step.label}>
                {content}
              </div>
            );
          })}
        </section>

        <section className="ddc-showcase-grid">
          <article className="ddc-showcase-card ddc-battle-card">
            <div className="ddc-card-kicker">
              <Zap aria-hidden /> BORESLAY / ACTION ENGINE
            </div>
            <div className="ddc-battle-image">
              <img src={rallyScreenshot} alt="The real BORESLAY Rally game" />
              <div className="ddc-battle-overlay">
                <span>{publicMissionCode}</span>
                <strong>Beat hesitation before the visit.</strong>
                <p>
                  Spark vs. Clockhead turns the account into a commitment you can
                  act on now—not another dashboard card you ignore.
                </p>
                <a href={missionId ? `/boreslay-rally?missionId=${missionId}` : "/boreslay-rally"}>
                  Enter the battle <ArrowRight aria-hidden />
                </a>
              </div>
            </div>
          </article>

          <article className="ddc-showcase-card ddc-phone-card">
            <div className="ddc-card-kicker">
              <Phone aria-hidden /> DAYFORGE FIELD
            </div>
            <div className="ddc-phone-layout">
              <div className="ddc-phone-shell" aria-label="Mission 042 phone preview">
                <div className="ddc-phone-speaker" />
                <div className="ddc-phone-screen">
                  <div className="ddc-phone-topline">
                    <span>9:41</span>
                    <span>MISSION LIVE</span>
                  </div>
                  <small>{publicMissionCode}</small>
                  <h3>{accountName}</h3>
                  <strong>{annualValue}</strong>
                  <div className="ddc-phone-divider" />
                  <ul>
                    <li><Check aria-hidden /> Pick up approved proposal</li>
                    <li><Check aria-hidden /> Ask for {decisionMaker}</li>
                    <li><Check aria-hidden /> Lead with centralized laundry</li>
                    <li><Check aria-hidden /> Record the real outcome</li>
                  </ul>
                  <a href={missionId ? `/driver/sales-mission/${missionId}` : "/commercial-missions"}>
                    Start field mission
                  </a>
                </div>
              </div>
              <div className="ddc-phone-copy">
                <span>THE MISSION LEAVES THE SCREEN</span>
                <h2>From “I should go” to “I’m on the way.”</h2>
                <p>
                  The phone carries the same account, value, decision-maker,
                  proposal, and mission code into the real-world visit.
                </p>
                <dl>
                  <div><dt>Assignment</dt><dd>{status?.fieldAssignment ?? "Demo Driver"}</dd></div>
                  <div><dt>Proposal</dt><dd>{humanize(status?.proposalStatus, "Ready to generate")}</dd></div>
                  <div><dt>Mission state</dt><dd>{humanize(missionStatus)}</dd></div>
                </dl>
              </div>
            </div>
          </article>

          <article className="ddc-showcase-card ddc-proof-card">
            <div className="ddc-card-kicker">
              <Gauge aria-hidden /> BUSINESS PROOF
            </div>
            <h2>Make the business result impossible to fake.</h2>
            <div className="ddc-proof-stack">
              <div>
                <span>Potential contract value</span>
                <strong>{annualValue}</strong>
                <small>Estimated from the ranked opportunity</small>
              </div>
              <div>
                <span>Pipeline state</span>
                <strong>{humanize(status?.pipelineStage, "Mission created")}</strong>
                <small>Updated by real mission events</small>
              </div>
              <div>
                <span>Realized revenue</span>
                <strong>{status?.revenueState === "attributed" ? "Attributed" : "$0 until paid"}</strong>
                <small>No invented revenue before a paid order</small>
              </div>
            </div>
            <a className="ddc-proof-link" href="/commercial-pipeline">
              Open the revenue pipeline <ExternalLink aria-hidden />
            </a>
          </article>
        </section>

        <section className="ddc-operations-grid">
          <article className="ddc-operations-card ddc-presenter-card">
            <div className="ddc-section-heading">
              <div>
                <span>PRESENTER PATH</span>
                <h2>Tell the whole story in fifteen clean moves.</h2>
              </div>
              <div className="ddc-progress-chip">
                <Activity aria-hidden /> {humanize(missionStatus)}
              </div>
            </div>
            <ol className="ddc-presenter-list">
              {PRESENTER_CHECKLIST.map((step, index) => {
                const href = step.href(missionId);
                return (
                  <li key={step.label}>
                    <span className="ddc-presenter-index">{String(index + 1).padStart(2, "0")}</span>
                    <span>{step.label}</span>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer">
                        Open <ChevronRight aria-hidden />
                      </a>
                    ) : (
                      <em>Needs mission</em>
                    )}
                  </li>
                );
              })}
            </ol>
          </article>

          <aside className="ddc-side-stack">
            <article className="ddc-operations-card ddc-continuity-card">
              <div className="ddc-section-heading compact">
                <div>
                  <span>MISSION CONTINUITY</span>
                  <h2>One public story. One real database identity.</h2>
                </div>
                <LockKeyhole aria-hidden />
              </div>
              <div className="ddc-continuity-grid">
                <div>
                  <small>PUBLIC CODE</small>
                  <strong>{publicMissionCode}</strong>
                  <span>Stable across resets</span>
                </div>
                <div>
                  <small>INTERNAL ID</small>
                  <strong>{missionId ?? "—"}</strong>
                  <span>Database identity only</span>
                </div>
                <div>
                  <small>ACCOUNT</small>
                  <strong>{accountName}</strong>
                  <span>Same on every surface</span>
                </div>
                <div>
                  <small>TENANT</small>
                  <strong>{status?.tenantSlug ?? "sunset-laundry-demo"}</strong>
                  <span>Isolated demo data</span>
                </div>
              </div>
            </article>

            <article className="ddc-operations-card ddc-events-card">
              <div className="ddc-section-heading compact">
                <div>
                  <span>LIVE AUDIT TRAIL</span>
                  <h2>Every handoff leaves evidence.</h2>
                </div>
                <Clock3 aria-hidden />
              </div>
              {statusQuery.isLoading ? (
                <div className="ddc-loading-row"><Loader2 className="ddc-spin" /> Loading mission events…</div>
              ) : status?.recentEvents?.length ? (
                <ul className="ddc-events">
                  {status.recentEvents.slice(0, 8).map(event => (
                    <li key={event.id}>
                      <span className="ddc-event-dot" />
                      <div>
                        <strong>{event.label}</strong>
                        <time>{new Date(event.occurredAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ddc-empty">Reset the demo, then launch Mission 042 to populate the timeline.</p>
              )}
            </article>

            <article className="ddc-operations-card ddc-reset-card">
              <div>
                <span>RESETTABLE, ISOLATED, SAFE</span>
                <h2>Start fresh without touching production tenants.</h2>
                <p>
                  Reset creates a new internal mission ID and restores the same
                  public MISSION 042 story.
                </p>
              </div>
              <div className="ddc-reset-actions">
                {!confirmingReset ? (
                  <button type="button" onClick={() => setConfirmingReset(true)}>
                    <RefreshCw aria-hidden /> Reset July demo
                  </button>
                ) : (
                  <div className="ddc-reset-confirm">
                    <strong>Reset the isolated demo tenant?</strong>
                    <div>
                      <button
                        type="button"
                        className="is-confirm"
                        disabled={resetMutation.isPending}
                        onClick={() => void handleReset()}
                      >
                        {resetMutation.isPending ? <Loader2 className="ddc-spin" /> : <RefreshCw aria-hidden />}
                        Confirm reset
                      </button>
                      <button
                        type="button"
                        className="is-cancel"
                        disabled={resetMutation.isPending}
                        onClick={() => setConfirmingReset(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className={`ddc-release-gate ${gateHealthy === true ? "is-healthy" : gateHealthy === false ? "is-warning" : "is-neutral"}`}>
                <ShieldCheck aria-hidden /> {gateLabel}
              </div>
            </article>
          </aside>
        </section>
      </div>
    </main>
  );
}
