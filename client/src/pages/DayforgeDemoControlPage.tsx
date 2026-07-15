import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Compass,
  Crosshair,
  ExternalLink,
  FileText,
  Gamepad2,
  Loader2,
  LockKeyhole,
  Mail,
  Map,
  Minus,
  Navigation,
  Phone,
  Plus,
  Radar,
  RefreshCw,
  Route,
  ShieldCheck,
  Target,
  Trophy,
  UserRound,
  WalletCards,
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
  "/assets/dayforge-final/july-demo-territory-night.png";

type ProviderMode =
  | "LIVE"
  | "TEST"
  | "SIMULATED"
  | "NOT_CONFIGURED"
  | "BROWSER_PDF_FALLBACK"
  | "CONNECTED";
type ProviderKey = "google" | "stripe" | "email" | "sms" | "print";

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

const STAGE_INDEX: Record<string, number> = {
  candidate: 0,
  selected: 1,
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

const CONTROL_STEPS: Array<{
  label: string;
  short: string;
  icon: IconType;
  href: (missionId: string | null) => string | null;
}> = [
  {
    label: "Scan territory",
    short: "1",
    icon: Radar,
    href: () => "/territory-preview",
  },
  {
    label: "Lock target",
    short: "2",
    icon: Target,
    href: () => "/commercial-missions",
  },
  {
    label: "Enter BORESLAY",
    short: "3",
    icon: Gamepad2,
    href: missionId =>
      missionId ? `/boreslay-rally?missionId=${missionId}` : "/boreslay-rally",
  },
  {
    label: "Mission to phone",
    short: "4",
    icon: Phone,
    href: () => "/commercial-missions",
  },
  {
    label: "Field visit",
    short: "5",
    icon: Navigation,
    href: missionId =>
      missionId ? `/driver/sales-mission/${missionId}` : null,
  },
  {
    label: "Win account",
    short: "6",
    icon: Trophy,
    href: () => "/commercial-missions",
  },
  {
    label: "Record revenue",
    short: "7",
    icon: CircleDollarSign,
    href: () => "/commercial-pipeline",
  },
];

const PROVIDERS: Array<{
  key?: ProviderKey;
  label: string;
  note: string;
  icon: IconType;
  fallback: ProviderMode | "SOMETIMES" | "NOT_CONNECTED";
}> = [
  {
    key: "google",
    label: "Territory data",
    note: "Real world · Fresh",
    icon: Map,
    fallback: "NOT_CONFIGURED",
  },
  {
    key: "stripe",
    label: "Billing",
    note: "Stripe",
    icon: WalletCards,
    fallback: "NOT_CONFIGURED",
  },
  {
    key: "email",
    label: "Email",
    note: "Transactional delivery",
    icon: Mail,
    fallback: "NOT_CONFIGURED",
  },
  {
    key: "sms",
    label: "SMS",
    note: "Twilio",
    icon: Phone,
    fallback: "NOT_CONFIGURED",
  },
  {
    key: "print",
    label: "Proposal output",
    note: "Print / PDF",
    icon: FileText,
    fallback: "BROWSER_PDF_FALLBACK",
  },
  {
    label: "Photos",
    note: "Field capture",
    icon: Camera,
    fallback: "SOMETIMES",
  },
  {
    label: "Accounting export",
    note: "QuickBooks",
    icon: CircleDollarSign,
    fallback: "NOT_CONNECTED",
  },
];

const DEMO_TIMELINE = [
  {
    time: "10:31 AM",
    label: "Mission 042 created",
    note: "Territory radar scan",
    icon: Target,
  },
  {
    time: "10:32 AM",
    label: "Westview Property Management locked as target",
    note: "",
    icon: Building2,
  },
  {
    time: "10:33 AM",
    label: "Mission sent to phone",
    note: "BORESLAY rally armed",
    icon: Phone,
  },
  {
    time: "10:42 AM",
    label: "Visit recorded in field",
    note: "Photo + notes captured",
    icon: Camera,
  },
  {
    time: "11:07 AM",
    label: "Proposal sent",
    note: "Dana R. opened",
    icon: Navigation,
  },
  {
    time: "11:27 AM",
    label: "Account won",
    note: "$24,800 annual potential",
    icon: Trophy,
  },
  {
    time: "11:31 AM",
    label: "Revenue recorded",
    note: "$1,240 booked to July",
    icon: CircleDollarSign,
  },
] as const;

function formatMoney(cents?: number | null) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((cents ?? 2_480_000) / 100);
}

function humanize(value?: string | null, fallback = "Candidate") {
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
        {PROVIDERS.map(provider => {
          const Icon = provider.icon;
          const mode = provider.key
            ? (status?.[provider.key] ?? provider.fallback)
            : provider.fallback;
          const label =
            mode === "BROWSER_PDF_FALLBACK"
              ? "SOMETIMES"
              : mode === "NOT_CONFIGURED"
                ? "NOT CONNECTED"
                : mode.replaceAll("_", " ");
          return (
            <div className="ddc-provider-row" key={provider.label}>
              <span className="ddc-provider-icon">
                <Icon aria-hidden />
              </span>
              <span className="ddc-provider-copy">
                <strong>{provider.label}</strong>
                <small>{provider.note}</small>
              </span>
              <span className={`ddc-provider-mode ddc-mode-${mode}`}>
                {label}
              </span>
            </div>
          );
        })}
      </div>
      <a className="ddc-provider-matrix" href="/settings/integrations">
        View full provider matrix
      </a>
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
  const accountName =
    status?.mission?.accountName ?? "Westview Property Management";
  const decisionMaker = status?.mission?.decisionMakerName ?? "Dana R.";
  const annualValue = formatMoney(status?.mission?.estimatedAnnualValueCents);
  const missionStatus =
    status?.mission?.status ?? status?.pipelineStage ?? "game_ready";
  const activeStage = useMemo(() => {
    if (status?.revenueState === "attributed") return 6;
    return STAGE_INDEX[missionStatus] ?? 1;
  }, [missionStatus, status?.revenueState]);
  const realizedRevenue = status?.revenueState === "attributed";

  if (!DEMO_MODE_ENABLED) {
    return (
      <main className="ddc-disabled-page">
        <div>
          <h1>Demo mode is off</h1>
          <p>Set VITE_DAYFORGE_DEMO_MODE=true to reach this page.</p>
        </div>
      </main>
    );
  }
  if (authLoading)
    return (
      <main className="ddc-root ddc-center">
        <Loader2 className="ddc-spin" />
      </main>
    );
  if (!isAuthenticated)
    return (
      <LoginForm role="admin" onSuccess={() => window.location.reload()} />
    );

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

  return (
    <main className="ddc-root">
      <header className="ddc-commandbar">
        <Link href="/dayforge" className="ddc-brand" aria-label="DayForge home">
          <span className="ddc-brand-mark">D</span>
          <span>
            <b>DAYFORGE</b>
            <small>JULY DEMO COMMAND CENTER</small>
          </span>
        </Link>
        <div className="ddc-commandbar-center">
          <span className="ddc-live-dot" /> ISOLATED DEMO TENANT <i /> SAFE TO
          RESET
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
            {statusQuery.error && (
              <div className="ddc-alert is-error">
                <AlertTriangle aria-hidden />
                Could not load demo status: {statusQuery.error.message}
              </div>
            )}
            {actionError && (
              <div className="ddc-alert is-error">
                <AlertTriangle aria-hidden />
                {actionError}
              </div>
            )}
            {notice && (
              <div className="ddc-alert is-success">
                <CheckCircle2 aria-hidden />
                {notice}
              </div>
            )}
          </div>
        )}

        <section className="ddc-hero" aria-labelledby="ddc-title">
          <article className="ddc-mission-panel">
            <span className="ddc-eyebrow">
              <Zap aria-hidden /> CANONICAL REVENUE MISSION
            </span>
            <h1 id="ddc-title">
              {publicMissionCode.split(" ")[0]}
              <br />
              {publicMissionCode.split(" ").slice(1).join(" ")}
            </h1>
            <span className="ddc-stable-code">STABLE PUBLIC CODE</span>
            <p className="ddc-mission-deck">
              <b>Find. Prove. Win.</b>
              <br />
              One nearby business. One real visit.
              <br />
              One recorded result.
            </p>

            <div className="ddc-account-dossier">
              <small>TOP OPPORTUNITY</small>
              <div className="ddc-account-main">
                <span className="ddc-account-icon">
                  <Building2 aria-hidden />
                </span>
                <span>
                  <strong>{accountName}</strong>
                  <small>15 buildings · 0.2 miles</small>
                </span>
                <span className="ddc-account-value">
                  <strong>{annualValue}</strong>
                  <small>Potential value</small>
                </span>
              </div>
              <div className="ddc-confidence">
                <Compass aria-hidden /> High confidence opportunity
              </div>
              <div className="ddc-person-row">
                <span>
                  <UserRound aria-hidden />
                  <small>DECISION MAKER</small>
                  <strong>{decisionMaker}</strong>
                  <em>Operations Manager</em>
                </span>
                <span>
                  <Route aria-hidden />
                  <small>ROUTE FIT</small>
                  <strong>0.2 miles</strong>
                  <em>From current location</em>
                </span>
              </div>
            </div>

            <a className="ddc-primary-action" href="/territory-preview">
              <Crosshair aria-hidden /> Scan territory
            </a>
            <a
              className="ddc-secondary-action"
              href={
                missionId
                  ? `/boreslay-rally?missionId=${missionId}`
                  : "/boreslay-rally"
              }
            >
              <Gamepad2 aria-hidden /> Open BORESLAY
            </a>
            <div className="ddc-continuity-strip">
              <LockKeyhole aria-hidden />
              <span>
                <b>Mission continuity locked.</b>
                <br />
                Internal mission ID may change after reset.
                <br />
                The public code never does.
              </span>
            </div>
          </article>

          <article className="ddc-map-frame">
            <div className="ddc-map-toolbar">
              <span className="ddc-radar-pulse" /> Radar live: scanning 0.5 mi
              radius…
            </div>
            <div className="ddc-map-legend">
              <span>
                <i className="best" />
                Best fit
              </span>
              <span>
                <i className="good" />
                Good
              </span>
              <span>
                <i className="watch" />
                Watch
              </span>
              <span>
                <i className="poor" />
                Not a fit
              </span>
            </div>
            <img
              src={TERRITORY_MAP_ASSET}
              alt="Dark territory map highlighting Westview Property Management"
            />
            <span className="ddc-map-radar" aria-hidden>
              <i />
              <i />
              <i />
              <Building2 />
            </span>
            <span className="ddc-map-route" aria-hidden />
            <span className="ddc-pin pin-62">62</span>
            <span className="ddc-pin pin-48">48</span>
            <span className="ddc-pin pin-18">18</span>
            <span className="ddc-pin pin-72">72</span>
            <span className="ddc-pin pin-38">38</span>
            <span className="ddc-pin pin-26">26</span>
            <span className="ddc-you-pin">
              <Navigation aria-hidden />
            </span>
            <div className="ddc-map-account-card">
              <strong>{accountName}</strong>
              <span>15 buildings · 0.2 mi</span>
              <small>Potential value</small>
              <b>{annualValue}</b>
            </div>
            <div className="ddc-map-controls">
              <button aria-label="Reset map bearing">
                <Compass />
              </button>
              <button aria-label="Zoom in">
                <Plus />
              </button>
              <button aria-label="Zoom out">
                <Minus />
              </button>
            </div>
            <div className="ddc-map-footer">
              <span>
                <small>YOU ARE HERE</small>
                <strong>Los Angeles, CA</strong>
              </span>
              <span>
                <small>BEST NEXT STEP</small>
                <strong>Visit {accountName}</strong>
              </span>
              <a
                href="/territory-preview"
                aria-label="Open territory intelligence"
              >
                <ArrowRight />
              </a>
            </div>
          </article>

          <ProviderRail status={status?.providerStatus} />
        </section>

        <section className="ddc-story-grid">
          <article className="ddc-battle-card">
            <div className="ddc-card-kicker">
              <Zap aria-hidden /> BORESLAY / ACTION ENGINE
            </div>
            <div className="ddc-battle-image">
              <img
                src={rallyScreenshot}
                alt="BORESLAY Spark versus Clockhead mission"
              />
              <div className="ddc-battle-hud">
                <span>SPARK&nbsp; ❤️❤️❤️❤️</span>
                <b>⚡⚡⚡⚡ CLOCKHEAD</b>
              </div>
              <div className="ddc-battle-overlay">
                <span>{publicMissionCode}</span>
                <strong>
                  Beat hesitation before
                  <br />
                  the visit.
                </strong>
                <p>Lock the target. Land the visit. Win the account.</p>
                <div>
                  <a
                    href={
                      missionId
                        ? `/boreslay-rally?missionId=${missionId}`
                        : "/boreslay-rally"
                    }
                  >
                    Enter the battle <ChevronRight />
                  </a>
                  <a className="how" href="/boreslay-rally">
                    How to play
                  </a>
                </div>
              </div>
            </div>
          </article>

          <article className="ddc-phone-card">
            <div className="ddc-card-kicker">
              <Phone aria-hidden /> MISSION ESCAPES TO PHONE
            </div>
            <div className="ddc-phone-shell">
              <span className="ddc-phone-notch" />
              <div className="ddc-phone-time">
                10:31<small>Tuesday, July 15</small>
              </div>
              <div className="ddc-phone-notice">
                <span className="ddc-mini-brand">D</span>
                <small>
                  DAYFORGE <em>now</em>
                </small>
                <strong>
                  {publicMissionCode}
                  <br />
                  Visit {accountName}
                </strong>
              </div>
              <span className="ddc-phone-slide">Slide to open mission</span>
            </div>
          </article>

          <article className="ddc-timeline-card">
            <div className="ddc-card-kicker">
              <Clock3 aria-hidden /> LIVE AUDIT TRAIL
            </div>
            <ol className="ddc-timeline">
              {DEMO_TIMELINE.map((item, index) => {
                const Icon = item.icon;
                const complete = index <= activeStage;
                return (
                  <li
                    className={complete ? "is-complete" : ""}
                    key={item.label}
                  >
                    <span className="ddc-timeline-icon">
                      <Icon />
                    </span>
                    <i />
                    <div>
                      <time>{item.time}</time>
                      <strong>{item.label}</strong>
                      {item.note && <small>{item.note}</small>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </article>

          <article className="ddc-proof-card">
            <div className="ddc-card-kicker">
              <CircleDollarSign aria-hidden /> BUSINESS PROOF
            </div>
            <h2>
              Real business result.
              <br />
              Impossible to fake.
            </h2>
            <div className="ddc-proof-stack">
              <div>
                <small>POTENTIAL CONTRACT VALUE</small>
                <strong>{annualValue}</strong>
                <span>Estimated from 15 buildings</span>
              </div>
              <div>
                <small>PIPELINE STAGE</small>
                <strong>{humanize(status?.pipelineStage, "Customer")}</strong>
                <span>{humanize(status?.proposalStatus, "Proposal sent")}</span>
              </div>
              <div>
                <small>REALIZED REVENUE</small>
                <strong>{realizedRevenue ? "$1,240" : "$0 until paid"}</strong>
                {realizedRevenue && <b>RECORDED</b>}
                <span>
                  {realizedRevenue
                    ? "First month services"
                    : "Awaiting a paid order"}
                </span>
              </div>
            </div>
            <a href="/commercial-pipeline">
              Open revenue pipeline <ExternalLink />
            </a>
          </article>
        </section>

        <nav className="ddc-presenter-controls" aria-label="Presenter controls">
          <span className="ddc-controls-label">PRESENTER CONTROLS</span>
          <div className="ddc-control-flow">
            {CONTROL_STEPS.map((step, index) => {
              const href = step.href(missionId);
              const state =
                index < activeStage
                  ? "is-complete"
                  : index === activeStage
                    ? "is-active"
                    : "";
              const content = (
                <>
                  <span className="ddc-control-number">
                    {index === 0 ? <step.icon /> : step.short}
                  </span>
                  <span>{step.label}</span>
                  {index < CONTROL_STEPS.length - 1 && (
                    <ArrowRight className="ddc-flow-arrow" />
                  )}
                </>
              );
              return href ? (
                <a className={state} href={href} key={step.label}>
                  {content}
                </a>
              ) : (
                <span className={state} key={step.label}>
                  {content}
                </span>
              );
            })}
          </div>
          {!confirmingReset ? (
            <button
              className="ddc-reset-button"
              type="button"
              onClick={() => setConfirmingReset(true)}
            >
              <RefreshCw /> Reset July demo
            </button>
          ) : (
            <div className="ddc-reset-confirm">
              <button
                disabled={resetMutation.isPending}
                onClick={() => void handleReset()}
              >
                {resetMutation.isPending ? (
                  <Loader2 className="ddc-spin" />
                ) : (
                  <Check />
                )}{" "}
                Confirm
              </button>
              <button onClick={() => setConfirmingReset(false)}>Cancel</button>
            </div>
          )}
        </nav>
      </div>
    </main>
  );
}
