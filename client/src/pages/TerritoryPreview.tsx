import { trpc } from "@/lib/trpc";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Gamepad2,
  Info,
  MapPin,
  Navigation,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import "./territory-preview.css";

const SCHEDULER_URL: string | undefined = import.meta.env.VITE_SCHEDULER_URL;
const PREVIEW_SESSION_KEY = "dayforge_public_territory_preview";
const EXECUTION_LEASE_RETRY_MS = 130_000;

type PreviewCredentials = { sessionId: string; token: string };
type PreviewStatus =
  | "running"
  | "completed"
  | "failed"
  | "converted"
  | "expired";
type EvidenceClassification =
  | "sourced_fact"
  | "operator_input"
  | "deterministic_estimate"
  | "ai_inference";
type PreviewEvidence = {
  field: string;
  value: unknown;
  classification: EvidenceClassification;
  sourceName: string;
  sourceUrl: string | null;
  capturedAt: string;
  confidence: "low" | "medium" | "high";
};
type PreviewOpportunity = {
  candidateKey: string;
  account: {
    name: string;
    accountType: string;
    address: string;
    latitude: number;
    longitude: number;
    locationCount: number;
    decisionMaker: { name: string | null; title: string | null };
  };
  score: {
    score: number;
    grade: "low" | "medium" | "high";
    estimatedAnnualValueCents: number;
    reasons: string[];
    risks: string[];
  };
  primarySignal: string;
  distanceMiles: number;
  evidence: PreviewEvidence[];
};
type MapCenter = { lat: number; lng: number; formattedAddress?: string };

const PROVENANCE_LABELS: Record<EvidenceClassification, string> = {
  sourced_fact: "Sourced fact",
  operator_input: "Operator input",
  deterministic_estimate: "Estimate",
  ai_inference: "AI inference",
};

function readCredentials(): PreviewCredentials | null {
  try {
    const value = sessionStorage.getItem(PREVIEW_SESSION_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PreviewCredentials>;
    return parsed.sessionId && parsed.token
      ? { sessionId: parsed.sessionId, token: parsed.token }
      : null;
  } catch {
    return null;
  }
}

function saveCredentials(credentials: PreviewCredentials | null): void {
  if (credentials) {
    sessionStorage.setItem(PREVIEW_SESSION_KEY, JSON.stringify(credentials));
  } else {
    sessionStorage.removeItem(PREVIEW_SESSION_KEY);
  }
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function readableAccountType(value: string): string {
  return value
    .split("_")
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function attributionFromLocation(): {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  placement?: string;
} {
  const params = new URLSearchParams(window.location.search);
  const compact = (key: string) =>
    params.get(key)?.trim().slice(0, 120) || undefined;
  return {
    source: compact("utm_source") ?? "dayforge_landing",
    medium: compact("utm_medium") ?? "owned_web",
    campaign: compact("utm_campaign"),
    content: compact("utm_content"),
    placement: compact("placement"),
  };
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "The territory preview could not be loaded.";
}

function messageFromFailure(failure: unknown): string | null {
  if (typeof failure === "string") return failure;
  if (!failure || typeof failure !== "object") return null;
  const message = (failure as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

function safeExternalUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function sampleMissionDetails(
  mission: unknown,
  opportunity: PreviewOpportunity
) {
  const value =
    mission && typeof mission === "object"
      ? (mission as Record<string, unknown>)
      : {};
  const account =
    value.account && typeof value.account === "object"
      ? (value.account as Record<string, unknown>)
      : {};
  const missionOpportunity =
    value.opportunity && typeof value.opportunity === "object"
      ? (value.opportunity as Record<string, unknown>)
      : {};
  const brief =
    value.brief && typeof value.brief === "object"
      ? (value.brief as Record<string, unknown>)
      : {};
  const decisionMaker =
    account.decisionMaker && typeof account.decisionMaker === "object"
      ? (account.decisionMaker as Record<string, unknown>)
      : {};

  return {
    code: typeof value.code === "string" ? value.code : "SAMPLE MISSION",
    accountName:
      typeof account.name === "string"
        ? account.name
        : typeof value.accountName === "string"
          ? value.accountName
          : opportunity.account.name,
    annualValueCents:
      typeof missionOpportunity.estimatedAnnualValueCents === "number"
        ? missionOpportunity.estimatedAnnualValueCents
        : typeof value.estimatedAnnualValueCents === "number"
          ? value.estimatedAnnualValueCents
          : opportunity.score.estimatedAnnualValueCents,
    decisionMaker:
      typeof decisionMaker.name === "string"
        ? decisionMaker.name
        : opportunity.account.decisionMaker.name,
    salesAngle:
      typeof brief.salesAngle === "string"
        ? brief.salesAngle
        : typeof value.salesAngle === "string"
          ? value.salesAngle
          : "Lead with a local recurring pickup plan sized to this account's likely laundry demand.",
    openingLine:
      typeof brief.openingLine === "string"
        ? brief.openingLine
        : typeof value.openingLine === "string"
          ? value.openingLine
          : `Who is the right person to discuss recurring laundry service for ${opportunity.account.name}?`,
  };
}

function OpportunityCard({
  opportunity,
  active,
  onSelect,
}: {
  opportunity: PreviewOpportunity;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`tp-opportunity${active ? " is-active" : ""}`}
      type="button"
      onClick={onSelect}
      aria-pressed={active}
    >
      <span className="tp-opportunity-icon" aria-hidden="true">
        <Building2 />
      </span>
      <span className="tp-opportunity-copy">
        <strong>{opportunity.account.name}</strong>
        <small>
          {readableAccountType(opportunity.account.accountType)} ·{" "}
          {opportunity.distanceMiles} mi
        </small>
        <em>{opportunity.primarySignal}</em>
      </span>
      <span className={`tp-grade is-${opportunity.score.grade}`}>
        {opportunity.score.grade}
      </span>
      <span className="tp-opportunity-score">
        <b>{opportunity.score.score}</b>
        <small>fit score</small>
      </span>
      <span className="tp-opportunity-value">
        <b>{formatCurrency(opportunity.score.estimatedAnnualValueCents)}</b>
        <small>est. annual value</small>
      </span>
    </button>
  );
}

function pinPosition(
  opportunity: PreviewOpportunity,
  center: MapCenter | null | undefined,
  index: number
): { left: string; top: string } {
  if (!center) {
    const positions = [
      [68, 24],
      [27, 30],
      [76, 72],
      [31, 76],
      [54, 18],
      [17, 58],
    ];
    const [left, top] = positions[index % positions.length]!;
    return { left: `${left}%`, top: `${top}%` };
  }
  const latitudeDelta = opportunity.account.latitude - center.lat;
  const longitudeDelta = opportunity.account.longitude - center.lng;
  const left = Math.max(9, Math.min(91, 50 + longitudeDelta * 1_250));
  const top = Math.max(9, Math.min(91, 50 - latitudeDelta * 1_250));
  return { left: `${left}%`, top: `${top}%` };
}

function TerritoryMap({
  selectedKey,
  opportunities,
  center,
  onSelect,
}: {
  selectedKey: string;
  opportunities: PreviewOpportunity[];
  center?: MapCenter | null;
  onSelect: (candidateKey: string) => void;
}) {
  return (
    <section className="tp-map" aria-label="Opportunity map">
      <div className="tp-map-grid" aria-hidden="true" />
      <span className="tp-road tp-road-one" aria-hidden="true" />
      <span className="tp-road tp-road-two" aria-hidden="true" />
      <span className="tp-road tp-road-three" aria-hidden="true" />
      <span className="tp-store-pin" aria-hidden="true">
        <span>YOUR STORE</span>
        <MapPin />
      </span>
      {opportunities.slice(0, 8).map((opportunity, index) => (
        <button
          key={opportunity.candidateKey}
          className={`tp-map-pin${selectedKey === opportunity.candidateKey ? " is-active" : ""}`}
          style={pinPosition(opportunity, center, index)}
          type="button"
          aria-label={`Select ${opportunity.account.name}, fit score ${opportunity.score.score}`}
          onClick={() => onSelect(opportunity.candidateKey)}
        >
          <i>{opportunity.score.score}</i>
          <b>{opportunity.account.name}</b>
        </button>
      ))}
      <span className="tp-map-note">
        {center
          ? "Provider result positions"
          : "Relative opportunity positions"}
      </span>
    </section>
  );
}

function EvidencePanel({ opportunity }: { opportunity: PreviewOpportunity }) {
  const evidence = opportunity.evidence ?? [];
  return (
    <section className="tp-evidence" aria-labelledby="tp-evidence-title">
      <div>
        <span className="tp-kicker">WHY THIS RANKING</span>
        <h3 id="tp-evidence-title">
          Facts, inputs, and estimates stay distinct.
        </h3>
      </div>
      <div className="tp-evidence-list">
        {evidence.map(item => (
          <article key={`${item.field}-${item.classification}`}>
            <span className={`tp-provenance is-${item.classification}`}>
              {PROVENANCE_LABELS[item.classification]}
            </span>
            <b>{item.field.replaceAll("_", " ")}</b>
            <small>
              {item.sourceName} · {item.confidence} confidence
            </small>
            {safeExternalUrl(item.sourceUrl) ? (
              <a
                href={safeExternalUrl(item.sourceUrl) ?? undefined}
                target="_blank"
                rel="noreferrer"
              >
                View source <ExternalLink />
              </a>
            ) : null}
          </article>
        ))}
        {evidence.length === 0 ? (
          <p>No supporting evidence was returned for this opportunity.</p>
        ) : null}
      </div>
    </section>
  );
}

function SampleMission({
  mission,
  opportunity,
  previewSessionId,
  converting,
  conversionError,
  onBack,
  onConvert,
}: {
  mission: unknown;
  opportunity: PreviewOpportunity;
  previewSessionId: string;
  converting: boolean;
  conversionError: string | null;
  onBack: () => void;
  onConvert: () => void;
}) {
  const details = sampleMissionDetails(mission, opportunity);
  const onboardingUrl = `/dayforge-onboarding?preview=${encodeURIComponent(previewSessionId)}&returnTo=${encodeURIComponent("/dayforge-today")}`;
  const demoUrl =
    SCHEDULER_URL ?? "mailto:adam@bldg.chat?subject=Map%20my%20territory";

  return (
    <section
      className="tp-mission"
      aria-labelledby="tp-mission-title"
      data-testid="territory-sample-mission"
    >
      <button className="tp-back" type="button" onClick={onBack}>
        <ArrowLeft /> Back to territory
      </button>
      <div className="tp-mission-header">
        <span className="tp-kicker">NON-PERSISTED SAMPLE</span>
        <h1 id="tp-mission-title">{details.code}</h1>
        <p>
          This sample shows how one account continues through DayForge,
          BORESLAY, and the field mission. It is not saved to any operator
          workspace yet.
        </p>
      </div>

      <div className="tp-continuity" aria-label="Sample mission continuity">
        <article>
          <span className="tp-stage-icon">
            <Sparkles />
          </span>
          <small>DAYFORGE RADAR</small>
          <b>{details.accountName}</b>
          <em>
            {formatCurrency(details.annualValueCents)} estimated annual value
          </em>
          <p>{opportunity.primarySignal}</p>
        </article>
        <ArrowRight className="tp-continuity-arrow" aria-hidden="true" />
        <article className="is-game">
          <span className="tp-stage-icon">
            <Gamepad2 />
          </span>
          <small>BORESLAY</small>
          <b>{details.code}</b>
          <em>{details.accountName}</em>
          <p>Beat the hesitation. Unlock the real-world visit.</p>
        </article>
        <ArrowRight className="tp-continuity-arrow" aria-hidden="true" />
        <article>
          <span className="tp-stage-icon">
            <Smartphone />
          </span>
          <small>DAYFORGE FIELD</small>
          <b>{details.accountName}</b>
          <em>Ask for {details.decisionMaker ?? "the decision-maker"}</em>
          <p>{details.salesAngle}</p>
        </article>
      </div>

      <div className="tp-mission-grid">
        <article className="tp-mission-panel">
          <span className="tp-panel-label">WHY THIS ACCOUNT</span>
          <ul>
            {opportunity.score.reasons.map(reason => (
              <li key={reason}>
                <CheckCircle2 /> {reason}
              </li>
            ))}
          </ul>
        </article>
        <article className="tp-mission-panel">
          <span className="tp-panel-label">OPENING LINE</span>
          <blockquote>“{details.openingLine}”</blockquote>
          <span className="tp-panel-label">BEST ANGLE</span>
          <p>{details.salesAngle}</p>
        </article>
      </div>

      <div className="tp-value-gate">
        <div>
          <span className="tp-kicker">KEEP THE REAL MISSION</span>
          <h2>Save it only when you are ready.</h2>
          <p>
            Start an operator workspace, book a live territory session, or add
            this opportunity to the workspace you already use.
          </p>
        </div>
        <div className="tp-value-actions">
          <a className="tp-primary" href={onboardingUrl}>
            Start operator setup <ArrowRight />
          </a>
          <a
            className="tp-secondary"
            href={demoUrl}
            target={SCHEDULER_URL ? "_blank" : undefined}
            rel={SCHEDULER_URL ? "noreferrer" : undefined}
          >
            Book a 15-min demo
          </a>
          <button
            className="tp-link-button"
            type="button"
            disabled={converting}
            onClick={onConvert}
          >
            {converting
              ? "Adding mission…"
              : "Already use DayForge? Add this mission"}
          </button>
        </div>
        {conversionError ? (
          <p className="tp-inline-error" role="alert">
            {conversionError}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default function TerritoryPreview() {
  const [credentials, setCredentials] = useState<PreviewCredentials | null>(
    () => readCredentials()
  );
  const [address, setAddress] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [sampleMission, setSampleMission] = useState<unknown>(null);
  const [showMission, setShowMission] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const executionAttemptRef = useRef<{
    sessionId: string;
    attemptedAt: number;
  } | null>(null);

  const start = trpc.system.publicTerritory.start.useMutation();
  const execute = trpc.system.publicTerritory.execute.useMutation();
  const openOpportunity =
    trpc.system.publicTerritory.openOpportunity.useMutation();
  const createSampleMission =
    trpc.system.publicTerritory.createSampleMission.useMutation();
  const convertPreview =
    trpc.system.publicTerritory.convertPreview.useMutation();
  const statusCheck = trpc.system.publicTerritory.status.useMutation();

  const status = statusCheck.data?.status as PreviewStatus | undefined;
  const opportunities = (statusCheck.data?.opportunities ??
    []) as PreviewOpportunity[];
  const center = (statusCheck.data?.center ?? null) as MapCenter | null;
  const selectedOpportunity = useMemo(
    () =>
      opportunities.find(item => item.candidateKey === selectedKey) ??
      opportunities[0],
    [opportunities, selectedKey]
  );

  useEffect(() => {
    const serverSelection = statusCheck.data?.selectedCandidateKey;
    if (selectedKey || !opportunities.length) return;
    setSelectedKey(serverSelection ?? opportunities[0]!.candidateKey);
  }, [opportunities, selectedKey, statusCheck.data?.selectedCandidateKey]);

  useEffect(() => {
    if (!statusCheck.data?.sampleMission || sampleMission) return;
    setSampleMission(statusCheck.data.sampleMission);
  }, [sampleMission, statusCheck.data?.sampleMission]);

  useEffect(() => {
    const sessionId = credentials?.sessionId;
    const token = credentials?.token;
    if (!sessionId || !token) return;

    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await statusCheck.mutateAsync({ sessionId, token });
        if (!cancelled && result.status === "running") {
          const attempt = executionAttemptRef.current;
          if (
            !attempt ||
            attempt.sessionId !== sessionId ||
            Date.now() - attempt.attemptedAt >= EXECUTION_LEASE_RETRY_MS
          ) {
            executionAttemptRef.current = {
              sessionId,
              attemptedAt: Date.now(),
            };
            void execute
              .mutateAsync({ sessionId, token })
              .catch((error: unknown) => {
                if (!cancelled) setActionError(messageFromError(error));
              });
          }
          timer = window.setTimeout(poll, 1_500);
        }
      } catch (error) {
        if (!cancelled) setActionError(messageFromError(error));
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    credentials?.sessionId,
    credentials?.token,
    execute.mutateAsync,
    statusCheck.mutateAsync,
  ]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Map My Territory | DayForge";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  async function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanAddress = address.trim();
    if (cleanAddress.length < 5) return;
    setActionError(null);
    setSampleMission(null);
    setShowMission(false);
    setSelectedKey("");
    try {
      const result = await start.mutateAsync({
        address: cleanAddress,
        attribution: attributionFromLocation(),
      });
      const next = { sessionId: result.sessionId, token: result.token };
      saveCredentials(next);
      setCredentials(next);
    } catch (error) {
      setActionError(messageFromError(error));
    }
  }

  function resetPreview() {
    saveCredentials(null);
    setCredentials(null);
    setAddress("");
    setSelectedKey("");
    setSampleMission(null);
    setShowMission(false);
    setActionError(null);
    executionAttemptRef.current = null;
    statusCheck.reset();
  }

  async function selectOpportunity(candidateKey: string) {
    setSelectedKey(candidateKey);
    setActionError(null);
    if (!credentials) return;
    try {
      await openOpportunity.mutateAsync({ ...credentials, candidateKey });
    } catch (error) {
      setActionError(messageFromError(error));
    }
  }

  async function buildSampleMission() {
    if (!credentials || !selectedOpportunity) return;
    setActionError(null);
    try {
      const result = await createSampleMission.mutateAsync({
        ...credentials,
        candidateKey: selectedOpportunity.candidateKey,
      });
      setSampleMission(result.mission);
      setShowMission(true);
    } catch (error) {
      setActionError(messageFromError(error));
    }
  }

  async function convertToMission() {
    if (!credentials || !selectedOpportunity) return;
    setActionError(null);
    try {
      const result = await convertPreview.mutateAsync({
        ...credentials,
        candidateKey: selectedOpportunity.candidateKey,
      });
      window.location.assign(
        `/commercial-missions?missionId=${encodeURIComponent(result.missionId)}`
      );
    } catch (error) {
      const message = messageFromError(error);
      if (/log in|login|unauth|authorized/i.test(message)) {
        window.location.assign(
          `/dayforge-login?preview=${encodeURIComponent(credentials.sessionId)}`
        );
        return;
      }
      setActionError(message);
    }
  }

  if (credentials && showMission && sampleMission && selectedOpportunity) {
    return (
      <main className="tp-root" data-testid="dayforge-territory-preview">
        <header className="tp-nav">
          <a
            href="/landingfinal"
            className="tp-brand"
            aria-label="DayForge landing page"
          >
            <span>D</span> DAYFORGE
          </a>
          <span className="tp-preview-chip">TERRITORY PREVIEW</span>
        </header>
        <SampleMission
          mission={sampleMission}
          opportunity={selectedOpportunity}
          previewSessionId={credentials.sessionId}
          converting={convertPreview.isPending}
          conversionError={actionError}
          onBack={() => setShowMission(false)}
          onConvert={convertToMission}
        />
      </main>
    );
  }

  const isRunning =
    start.isPending ||
    execute.isPending ||
    status === "running" ||
    (Boolean(credentials) && !status && statusCheck.isPending);
  const failureMessage =
    messageFromFailure(statusCheck.data?.failure) ??
    (statusCheck.error ? messageFromError(statusCheck.error) : null) ??
    actionError;

  return (
    <main className="tp-root" data-testid="dayforge-territory-preview">
      <header className="tp-nav">
        <a
          href="/landingfinal"
          className="tp-brand"
          aria-label="DayForge landing page"
        >
          <span>D</span> DAYFORGE
        </a>
        <span className="tp-preview-chip">TERRITORY PREVIEW</span>
      </header>

      <section className="tp-shell">
        <div className="tp-intro">
          <span className="tp-kicker">
            FOR LAUNDROMAT &amp; FLUFF-AND-FOLD OWNERS
          </span>
          <h1>See the commercial laundry accounts around your store.</h1>
          <p>
            Enter a store address. DayForge checks business-data provider
            results, ranks recurring laundry opportunities, and explains what is
            sourced, estimated, or inferred before you decide what to do next.
          </p>
        </div>

        {!credentials ? (
          <form className="tp-address" onSubmit={submitAddress}>
            <label htmlFor="territory-address">
              Store address or business name
            </label>
            <div>
              <MapPin aria-hidden="true" />
              <input
                id="territory-address"
                value={address}
                onChange={event => setAddress(event.target.value)}
                placeholder="922 N Alvarado St, Los Angeles"
                autoComplete="street-address"
                minLength={5}
                maxLength={512}
                required
              />
              <button
                type="submit"
                disabled={address.trim().length < 5 || start.isPending}
              >
                {start.isPending ? (
                  <Clock3 className="is-spinning" />
                ) : (
                  <Search />
                )}
                {start.isPending ? "Starting…" : "Map my territory"}
              </button>
            </div>
            <small>
              <ShieldCheck /> Private preview. No business is contacted and no
              tenant mission is created.
            </small>
            {actionError ? (
              <p className="tp-inline-error" role="alert">
                {actionError}
              </p>
            ) : null}
          </form>
        ) : null}

        {!credentials && !start.isPending ? (
          <div className="tp-empty-state">
            <Navigation />
            <h2>Your territory starts with your store.</h2>
            <p>
              DayForge uses your address only to run this short-lived preview.
              If the provider cannot return results, the page says so plainly.
            </p>
          </div>
        ) : null}

        {isRunning ? (
          <div className="tp-scanning" aria-live="polite" aria-busy="true">
            <div className="tp-radar" aria-hidden="true">
              <i />
            </div>
            <h2>Scanning the streets around your store</h2>
            <p>
              Checking nearby account types, likely laundry demand, route fit,
              and estimated value. You can refresh this page without losing the
              scan.
            </p>
          </div>
        ) : null}

        {credentials &&
        (status === "failed" ||
          status === "expired" ||
          Boolean(statusCheck.error)) ? (
          <section className="tp-failure" role="alert">
            <TriangleAlert />
            <div>
              <span className="tp-kicker">
                {status === "expired"
                  ? "PREVIEW EXPIRED"
                  : "SCAN NOT COMPLETED"}
              </span>
              <h2>We do not have trustworthy territory results to show.</h2>
              <p>
                {failureMessage ??
                  "The business-data provider did not complete this scan."}
              </p>
              <button
                className="tp-primary"
                type="button"
                onClick={resetPreview}
              >
                <RefreshCw /> Try a new scan
              </button>
            </div>
          </section>
        ) : null}

        {credentials &&
        (status === "completed" || status === "converted") &&
        opportunities.length === 0 ? (
          <section className="tp-failure" role="status">
            <Info />
            <div>
              <span className="tp-kicker">NO RANKED ACCOUNTS</span>
              <h2>The provider returned no opportunities for this area.</h2>
              <p>
                Try another store address or book a live session for a closer
                look.
              </p>
              <button
                className="tp-primary"
                type="button"
                onClick={resetPreview}
              >
                <RefreshCw /> Change address
              </button>
            </div>
          </section>
        ) : null}

        {credentials &&
        (status === "completed" || status === "converted") &&
        opportunities.length > 0 ? (
          <div className="tp-results" data-testid="territory-preview-results">
            <div className="tp-results-head">
              <div>
                <span className="tp-kicker">PROVIDER-BACKED PREVIEW</span>
                <h2>{opportunities.length} accounts worth examining first.</h2>
                <p>
                  Ranked around{" "}
                  <b>{statusCheck.data?.addressDisplay ?? "your store"}</b>.
                  Select an account to inspect the evidence and estimate.
                </p>
              </div>
              <button className="tp-reset" type="button" onClick={resetPreview}>
                Change address
              </button>
            </div>

            <div className="tp-results-layout">
              <div
                className="tp-opportunity-list"
                aria-label="Ranked opportunities"
              >
                {opportunities.map(opportunity => (
                  <OpportunityCard
                    key={opportunity.candidateKey}
                    opportunity={opportunity}
                    active={
                      opportunity.candidateKey ===
                      selectedOpportunity?.candidateKey
                    }
                    onSelect={() => selectOpportunity(opportunity.candidateKey)}
                  />
                ))}
              </div>
              <TerritoryMap
                selectedKey={selectedOpportunity?.candidateKey ?? ""}
                opportunities={opportunities}
                center={center}
                onSelect={selectOpportunity}
              />
            </div>

            {selectedOpportunity ? (
              <>
                <aside className="tp-selected">
                  <div>
                    <span className="tp-kicker">BEST NEXT MOVE</span>
                    <h2>{selectedOpportunity.account.name}</h2>
                    <p>{selectedOpportunity.score.reasons.join(" · ")}</p>
                  </div>
                  <div className="tp-selected-value">
                    <strong>
                      {formatCurrency(
                        selectedOpportunity.score.estimatedAnnualValueCents
                      )}
                    </strong>
                    <small>
                      deterministic estimate · {selectedOpportunity.score.grade}{" "}
                      confidence
                    </small>
                  </div>
                  <button
                    className="tp-primary"
                    type="button"
                    disabled={createSampleMission.isPending}
                    onClick={buildSampleMission}
                  >
                    {createSampleMission.isPending
                      ? "Building sample…"
                      : "Turn this into a sample mission"}
                    <ArrowRight />
                  </button>
                </aside>
                <EvidencePanel opportunity={selectedOpportunity} />
              </>
            ) : null}

            {actionError ? (
              <p className="tp-inline-error" role="alert">
                {actionError}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  );
}
