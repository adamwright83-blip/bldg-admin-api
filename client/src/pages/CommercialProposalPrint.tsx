import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Printer,
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { LoginForm } from "@/components/LoginForm";
import { trpc } from "@/lib/trpc";
import { formatProposalMoney } from "@shared/commercialProposal";
import "./commercial-proposal-print.css";

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function CommercialProposalPrint() {
  const [, params] = useRoute("/commercial-proposal/:missionId");
  const [, setLocation] = useLocation();
  const missionId = Number(params?.missionId);
  const validMissionId = Number.isInteger(missionId) && missionId > 0;
  const { loading: authLoading, isAuthenticated, user } = useAuth();
  const [printError, setPrintError] = useState<string | null>(null);
  const hostname = window.location.hostname.toLowerCase();
  const loginRole =
    hostname === "admin.bldg.chat" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
      ? "admin"
      : "driver";
  const proposalQuery = trpc.system.commercialProposal.forMission.useQuery(
    { missionId: validMissionId ? missionId : 1 },
    { enabled: isAuthenticated && validMissionId, retry: false }
  );
  const printMutation =
    trpc.system.commercialProposal.recordBrowserPrint.useMutation();

  if (authLoading)
    return (
      <main className="cpp-root grid place-items-center">
        <Loader2 className="animate-spin" />
      </main>
    );
  if (!isAuthenticated)
    return (
      <LoginForm role={loginRole} onSuccess={() => window.location.reload()} />
    );
  if (!validMissionId)
    return (
      <main className="cpp-root grid place-items-center">
        Invalid mission ID.
      </main>
    );
  if (proposalQuery.isLoading)
    return (
      <main className="cpp-root grid place-items-center">
        <Loader2 className="animate-spin" />
      </main>
    );
  if (proposalQuery.error || !proposalQuery.data)
    return (
      <main className="cpp-root grid place-items-center">
        <div className="cpp-notice">
          {proposalQuery.error?.message ??
            "No approved proposal is available for this mission."}
        </div>
      </main>
    );

  const proposalRecord = proposalQuery.data;
  const proposal = proposalRecord.snapshot;
  const approved = proposalRecord.status === "approved";

  const print = async () => {
    if (!approved) return;
    setPrintError(null);
    try {
      await printMutation.mutateAsync({
        missionId,
        proposalId: proposalRecord.id,
        requestId: crypto.randomUUID(),
      });
      window.print();
    } catch (error) {
      setPrintError(
        error instanceof Error
          ? error.message
          : "DayForge could not open the print workflow."
      );
    }
  };

  return (
    <main className="cpp-root">
      <div className="cpp-toolbar" aria-label="Proposal controls">
        <button
          type="button"
          onClick={() =>
            setLocation(
              user?.role === "admin"
                ? "/commercial-missions"
                : `/driver/sales-mission/${missionId}`
            )
          }
        >
          <ArrowLeft /> Back to{" "}
          {user?.role === "admin" ? "missions" : "mission"}
        </button>
        <span>VERSION {proposalRecord.version} · PRINT-READY LEAVE-BEHIND</span>
        <button
          type="button"
          className="is-primary"
          disabled={!approved || printMutation.isPending}
          onClick={() => void print()}
        >
          {printMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Printer />
          )}
          Print / Save PDF
        </button>
      </div>

      {!approved ? (
        <div className="cpp-notice" role="status">
          This is an internal draft. Approve this version before printing or
          giving it to the account.
        </div>
      ) : null}

      {printError ? (
        <div className="cpp-notice is-error" role="alert">
          {printError}
        </div>
      ) : null}

      <article className={`cpp-page${approved ? "" : " is-draft"}`}>
        <header className="cpp-header">
          <div className="cpp-brand">
            {proposal.store.logoUrl ? (
              <img
                src={proposal.store.logoUrl}
                alt={`${proposal.store.storeName} logo`}
              />
            ) : (
              <span>DF</span>
            )}
            <div>
              <b>{proposal.store.storeName}</b>
              <small>Commercial laundry service</small>
            </div>
          </div>
          <div className="cpp-meta">
            <span className={`cpp-status${approved ? "" : " is-draft"}`}>
              {proposalRecord.status}
            </span>
            <small>{proposal.missionCode}</small>
            <b>Prepared {formatDate(proposal.generatedAt)}</b>
            <span>Valid through {formatDate(proposal.validThrough)}</span>
          </div>
        </header>

        <section className="cpp-hero">
          <span className="cpp-eyebrow">PREPARED FOR</span>
          <h1>{proposal.account.name}</h1>
          {proposal.account.decisionMakerName ? (
            <p>
              Attention: {proposal.account.decisionMakerName}
              {proposal.account.decisionMakerTitle
                ? ` · ${proposal.account.decisionMakerTitle}`
                : ""}
            </p>
          ) : null}
          <h2>{proposal.headline}</h2>
          <p>{proposal.summary}</p>
        </section>

        <section className="cpp-value-grid">
          <article>
            <span>
              <CircleDollarSign />
            </span>
            <small>
              PLANNING ESTIMATE · {proposal.pricing.estimateConfidence}{" "}
              CONFIDENCE
            </small>
            <b>
              {formatProposalMoney(proposal.pricing.estimatedAnnualValueCents)}
              <em>/ year</em>
            </b>
            <p>
              Illustrative annual service value based on the persisted mission
              profile.
            </p>
          </article>
          <article>
            <span>
              <Clock3 />
            </span>
            <small>TURNAROUND</small>
            <b>{proposal.store.turnaroundLabel}</b>
            <p>Final timing is confirmed with the pickup schedule.</p>
          </article>
          <article>
            <span>
              <Building2 />
            </span>
            <small>ACCOUNT STRUCTURE</small>
            <b>{proposal.account.locationCount} locations</b>
            <p>One local laundry partner and one point of accountability.</p>
          </article>
        </section>

        <div className="cpp-columns">
          <section>
            <h3>What we can handle</h3>
            <ul>
              {proposal.services.map(service => (
                <li key={service}>
                  <CheckCircle2 /> {service}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3>Proposed operating plan</h3>
            <ul>
              {proposal.operatingPlan.map(item => (
                <li key={item}>
                  <CheckCircle2 /> {item}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="cpp-pricing">
          <div>
            <span className="cpp-eyebrow">COMMERCIAL PRICING</span>
            <h3>
              {formatProposalMoney(proposal.pricing.pricePerPoundCents)}
              <small> / lb</small>
            </h3>
            {proposal.pricing.minimumOrderCents ? (
              <p>
                {formatProposalMoney(proposal.pricing.minimumOrderCents)}{" "}
                minimum per scheduled service.
              </p>
            ) : (
              <p>No minimum order is configured for this proposal.</p>
            )}
          </div>
          <div>
            <span className="cpp-eyebrow">RECOMMENDED NEXT STEP</span>
            <p>{proposal.nextStep}</p>
            {proposal.store.insuranceLabel ? (
              <p>{proposal.store.insuranceLabel}</p>
            ) : null}
          </div>
        </section>

        <section className="cpp-contact">
          <div>
            <span className="cpp-contact-icon">
              <Phone />
            </span>
            <small>CALL OR TEXT</small>
            <b>{proposal.store.phone}</b>
          </div>
          <div>
            <span className="cpp-contact-icon">
              <Mail />
            </span>
            <small>EMAIL</small>
            <b>{proposal.store.email}</b>
          </div>
          <div>
            <span className="cpp-contact-icon">
              <MapPin />
            </span>
            <small>LOCAL OPERATOR</small>
            <b>{proposal.store.address}</b>
          </div>
        </section>

        <footer className="cpp-footer">
          <div>
            <b>{proposal.store.operatorName}</b>
            <span>
              {proposal.store.storeName} · {proposal.store.website}
            </span>
          </div>
          <ol>
            {proposal.disclaimers.map(disclaimer => (
              <li key={disclaimer}>{disclaimer}</li>
            ))}
          </ol>
        </footer>
      </article>
    </main>
  );
}
