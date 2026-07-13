import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { LoginForm } from "@/components/LoginForm";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import "./dayforge-demo-control.css";

// Demo mode must be explicitly enabled via env flag. This page is never
// reachable in a normal production deploy even for authenticated admins.
const DEMO_MODE_ENABLED =
  String(import.meta.env.VITE_DAYFORGE_DEMO_MODE ?? "").toLowerCase() ===
  "true";

const PROVIDER_ORDER = ["google", "stripe", "email", "sms", "print"] as const;

const PROVIDER_LABEL: Record<(typeof PROVIDER_ORDER)[number], string> = {
  google: "Google",
  stripe: "Stripe",
  email: "Email",
  sms: "SMS",
  print: "Print / PDF",
};

// field names must match server/dayforgeDemo router output
type ProviderMode =
  | "LIVE"
  | "TEST"
  | "SIMULATED"
  | "NOT_CONFIGURED"
  | "BROWSER_PDF_FALLBACK";

// field names must match server/dayforgeDemo router output
type DayforgeDemoStatus = {
  mission?: { id: string; name?: string | null } | null;
  pipelineStage?: string | null;
  proposalStatus?: string | null;
  fieldAssignment?: string | null;
  revenueState?: string | null;
  churnState?: string | null;
  providerStatus?: Partial<Record<(typeof PROVIDER_ORDER)[number], ProviderMode>>;
  recentEvents?: Array<{ id: string; label: string; occurredAt: string }>;
  releaseGateHealthy?: boolean | null;
};

type ChecklistStep = {
  label: string;
  href: (missionId: string | null) => string | null;
};

const CHECKLIST: ChecklistStep[] = [
  { label: "Landing page", href: () => "/dayforge" },
  { label: "Map My Territory", href: () => "/territory-preview" },
  { label: "Territory results", href: () => "/territory-preview" },
  { label: "Create Mission 042", href: () => "/commercial-missions" },
  {
    label: "Play BORESLAY",
    href: missionId =>
      missionId ? `/boreslay-rally?missionId=${missionId}` : "/boreslay-rally",
  },
  { label: "Unlock phone mission", href: () => "/commercial-missions" },
  {
    label: "Open DayForge Field",
    href: missionId =>
      missionId ? `/driver/sales-mission/${missionId}` : null,
  },
  { label: "Complete preparation", href: missionId =>
      missionId ? `/driver/sales-mission/${missionId}` : null,
  },
  {
    label: "View approved proposal",
    href: missionId =>
      missionId ? `/commercial-proposal/${missionId}` : null,
  },
  { label: "Record visit outcome", href: missionId =>
      missionId ? `/driver/sales-mission/${missionId}` : null,
  },
  { label: "Mark account won", href: () => "/commercial-missions" },
  { label: "Attribute first paid order", href: () => "/commercial-missions" },
  { label: "Show realized revenue", href: () => "/commercial-pipeline" },
  { label: "Show complete admin timeline", href: () => "/commercial-missions" },
  { label: "Show Churn Radar recovery mission", href: () => "/churn-radar" },
];

function ProviderChip({
  name,
  mode,
}: {
  name: string;
  mode: ProviderMode | "UNKNOWN";
}) {
  return (
    <div className="ddc-provider-chip">
      <span className="ddc-provider-name">{name}</span>
      <span className={`ddc-provider-mode ddc-mode-${mode}`}>{mode}</span>
    </div>
  );
}

export default function DayforgeDemoControlPage() {
  useEffect(() => {
    // Keep this page out of search indexes even if it's ever reachable
    // without the env gate (e.g. a misconfigured deploy).
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

  // field names must match server/dayforgeDemo router output
  const statusQuery = (
    trpc as unknown as {
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
    }
  ).dayforgeDemo.getStatus.useQuery(undefined, {
    enabled: isAuthenticated && DEMO_MODE_ENABLED,
    refetchInterval: 5000,
  });

  const resetMutation = (
    trpc as unknown as {
      dayforgeDemo: {
        reset: {
          useMutation: () => {
            mutateAsync: (input?: unknown) => Promise<unknown>;
            isPending: boolean;
          };
        };
      };
    }
  ).dayforgeDemo.reset.useMutation();

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

  if (authLoading)
    return (
      <main className="ddc-root ddc-center">
        <Loader2 className="ddc-spin" />
      </main>
    );

  if (!isAuthenticated)
    return <LoginForm role="admin" onSuccess={() => window.location.reload()} />;

  const status = statusQuery.data;
  const missionId = status?.mission?.id ?? null;

  const handleReset = async () => {
    setActionError(null);
    setNotice(null);
    try {
      await resetMutation.mutateAsync();
      setNotice("Demo state reset.");
      setConfirmingReset(false);
      await statusQuery.refetch();
    } catch (caught) {
      setActionError(
        caught instanceof Error ? caught.message : "Reset failed"
      );
    }
  };

  const gateHealthy = status?.releaseGateHealthy;
  const gateClass =
    gateHealthy === true
      ? "is-healthy"
      : gateHealthy === false
        ? "is-unhealthy"
        : "is-unknown";
  const gateLabel =
    gateHealthy === true
      ? "Release gate healthy"
      : gateHealthy === false
        ? "Release gate unhealthy"
        : "Release gate unknown";

  return (
    <main className="ddc-root">
      <div className="ddc-shell">
        <header className="ddc-header">
          <div>
            <span className="ddc-kicker">
              <Sparkles /> DAYFORGE DEMO CONTROL
            </span>
            <h1>Run the boss demo without touching devtools.</h1>
            <p>
              Every provider below runs in demo mode. Nothing here reads or
              writes production tenant data.
            </p>
          </div>
          <Link href="/commercial-missions" className="ddc-back">
            <ArrowLeft /> Missions
          </Link>
        </header>

        <div className="ddc-demo-banner">
          <ShieldAlert /> DEMO MODE — Sunset Laundry Demo
        </div>

        {statusQuery.error ? (
          <div className="ddc-alert is-error" role="alert">
            <AlertTriangle />
            Could not load demo status: {statusQuery.error.message}
          </div>
        ) : null}
        {actionError ? (
          <div className="ddc-alert is-error" role="alert">
            <AlertTriangle /> {actionError}
          </div>
        ) : null}
        {notice ? (
          <div className="ddc-alert" role="status">
            <CheckCircle2 /> {notice}
          </div>
        ) : null}

        <section className="ddc-providers">
          {PROVIDER_ORDER.map(key => (
            <ProviderChip
              key={key}
              name={PROVIDER_LABEL[key]}
              mode={status?.providerStatus?.[key] ?? "UNKNOWN"}
            />
          ))}
        </section>

        <div className="ddc-grid">
          <div>
            <div className="ddc-card">
              <h2>
                <Activity /> Presentation checklist
              </h2>
              <ol className="ddc-checklist">
                {CHECKLIST.map((step, index) => {
                  const href = step.href(missionId);
                  return (
                    <li key={step.label}>
                      <span className="ddc-step-index">{index + 1}</span>
                      <span className="ddc-step-label">{step.label}</span>
                      {href ? (
                        <a
                          className="ddc-step-link"
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open <ExternalLink />
                        </a>
                      ) : (
                        <span className="ddc-step-link is-disabled">
                          Needs mission
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>

          <div>
            <div className="ddc-card">
              <h2>
                <Activity /> Live demo status
              </h2>
              {statusQuery.isLoading ? (
                <p className="ddc-empty">Loading status…</p>
              ) : (
                <div className="ddc-status-grid">
                  <div className="ddc-status-item">
                    <span className="ddc-status-label">Mission</span>
                    <span className="ddc-status-value">
                      {status?.mission?.name ?? missionId ?? "None"}
                    </span>
                  </div>
                  <div className="ddc-status-item">
                    <span className="ddc-status-label">Pipeline stage</span>
                    <span className="ddc-status-value">
                      {status?.pipelineStage ?? "Unknown"}
                    </span>
                  </div>
                  <div className="ddc-status-item">
                    <span className="ddc-status-label">Proposal status</span>
                    <span className="ddc-status-value">
                      {status?.proposalStatus ?? "Unknown"}
                    </span>
                  </div>
                  <div className="ddc-status-item">
                    <span className="ddc-status-label">Field assignment</span>
                    <span className="ddc-status-value">
                      {status?.fieldAssignment ?? "Unassigned"}
                    </span>
                  </div>
                  <div className="ddc-status-item">
                    <span className="ddc-status-label">Revenue attribution</span>
                    <span className="ddc-status-value">
                      {status?.revenueState ?? "Unknown"}
                    </span>
                  </div>
                  <div className="ddc-status-item">
                    <span className="ddc-status-label">Churn Radar state</span>
                    <span className="ddc-status-value">
                      {status?.churnState ?? "Unknown"}
                    </span>
                  </div>
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <span className={`ddc-gate ${gateClass}`}>{gateLabel}</span>
              </div>
            </div>

            <div className="ddc-card">
              <h2>
                <Activity /> Recent audit events
              </h2>
              {status?.recentEvents && status.recentEvents.length > 0 ? (
                <ul className="ddc-events">
                  {status.recentEvents.map(event => (
                    <li key={event.id}>
                      <span className="ddc-event-time">
                        {new Date(event.occurredAt).toLocaleTimeString()}
                      </span>
                      {event.label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ddc-empty">No events yet.</p>
              )}
            </div>

            <div className="ddc-card">
              <h2>
                <RefreshCw /> Demo reset
              </h2>
              <p style={{ fontSize: 13, color: "#9fb0c3", marginTop: 0 }}>
                Resets the demo tenant back to its starting state. Cannot be
                undone.
              </p>
              <div className="ddc-reset-row">
                {!confirmingReset ? (
                  <button
                    type="button"
                    className="ddc-btn is-danger"
                    onClick={() => setConfirmingReset(true)}
                  >
                    <RefreshCw /> Reset demo
                  </button>
                ) : (
                  <>
                    <span style={{ fontSize: 13 }}>Are you sure?</span>
                    <button
                      type="button"
                      className="ddc-btn is-confirm"
                      disabled={resetMutation.isPending}
                      onClick={() => void handleReset()}
                    >
                      {resetMutation.isPending ? (
                        <Loader2 className="ddc-spin" />
                      ) : (
                        <RefreshCw />
                      )}
                      Confirm reset
                    </button>
                    <button
                      type="button"
                      className="ddc-btn is-ghost"
                      disabled={resetMutation.isPending}
                      onClick={() => setConfirmingReset(false)}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
