import { useMemo } from "react";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Mail,
  MapPin,
  Phone,
  Printer,
} from "lucide-react";
import { useLocation, useRoute } from "wouter";
import {
  COMMERCIAL_MISSION_DEMO_STORAGE_KEY,
  DEMO_MISSION,
  type CommercialMission,
} from "@shared/commercialMission";
import {
  buildCommercialLaundryProposal,
  formatProposalMoney,
  type CommercialLaundryStoreProfile,
} from "@shared/commercialProposal";
import "./commercial-proposal-print.css";

const DEMO_STORE: CommercialLaundryStoreProfile = {
  storeName: "Sunset Laundry",
  operatorName: "Adam Wright",
  phone: "(323) 555-0142",
  email: "adam@bldg.chat",
  website: "BORESLAY.com",
  address: "Los Angeles, California",
  commercialPricePerPoundCents: 250,
  minimumOrderCents: 5000,
  turnaroundLabel: "Standard 24–48 hour turnaround",
  pickupScheduleLabel: "Scheduled pickup and delivery twice per week",
  serviceAreaLabel: "Los Angeles service area",
  insuranceLabel: "Commercial service terms available during onboarding",
};

function readMission(): CommercialMission {
  if (typeof window === "undefined") return DEMO_MISSION;
  try {
    const raw = window.localStorage.getItem(
      COMMERCIAL_MISSION_DEMO_STORAGE_KEY
    );
    if (!raw) return DEMO_MISSION;
    const parsed = JSON.parse(raw) as Partial<CommercialMission>;
    if (
      typeof parsed.id !== "number" ||
      typeof parsed.code !== "string" ||
      typeof parsed.accountName !== "string"
    ) {
      return DEMO_MISSION;
    }
    return parsed as CommercialMission;
  } catch {
    return DEMO_MISSION;
  }
}

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
  const mission = useMemo(readMission, []);
  const proposal = useMemo(
    () => buildCommercialLaundryProposal({ mission, store: DEMO_STORE }),
    [mission]
  );

  return (
    <main className="cpp-root">
      <div className="cpp-toolbar" aria-label="Proposal controls">
        <button
          type="button"
          onClick={() =>
            setLocation(`/driver/sales-mission/${params?.missionId ?? mission.id}`)
          }
        >
          <ArrowLeft /> Back to mission
        </button>
        <span>PRINT-READY LEAVE-BEHIND</span>
        <button type="button" className="is-primary" onClick={() => window.print()}>
          <Printer /> Print or save PDF
        </button>
      </div>

      <article className="cpp-page">
        <header className="cpp-header">
          <div className="cpp-brand">
            <span>DF</span>
            <div>
              <b>{proposal.store.storeName}</b>
              <small>Commercial laundry service</small>
            </div>
          </div>
          <div className="cpp-meta">
            <small>{proposal.missionCode}</small>
            <b>Prepared {formatDate(proposal.generatedAt)}</b>
            <span>Valid through {formatDate(proposal.validThrough)}</span>
          </div>
        </header>

        <section className="cpp-hero">
          <span className="cpp-eyebrow">PREPARED FOR</span>
          <h1>{proposal.accountName}</h1>
          {proposal.decisionMakerName ? (
            <p>Attention: {proposal.decisionMakerName}</p>
          ) : null}
          <h2>{proposal.headline}</h2>
          <p>{proposal.summary}</p>
        </section>

        <section className="cpp-value-grid">
          <article>
            <span><CircleDollarSign /></span>
            <small>PLANNING ESTIMATE</small>
            <b>
              {formatProposalMoney(proposal.pricing.estimatedAnnualValueCents)}
              <em>/ year</em>
            </b>
            <p>Illustrative annual service value based on the mission profile.</p>
          </article>
          <article>
            <span><Clock3 /></span>
            <small>TURNAROUND</small>
            <b>{proposal.store.turnaroundLabel}</b>
            <p>Final timing is confirmed with the pickup schedule.</p>
          </article>
          <article>
            <span><Building2 /></span>
            <small>ACCOUNT STRUCTURE</small>
            <b>{mission.accountLocationCount} locations</b>
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
                {formatProposalMoney(proposal.pricing.minimumOrderCents)} minimum
                per scheduled service.
              </p>
            ) : null}
          </div>
          <div>
            <span className="cpp-eyebrow">RECOMMENDED NEXT STEP</span>
            <p>{proposal.nextStep}</p>
          </div>
        </section>

        <section className="cpp-contact">
          <div>
            <span className="cpp-contact-icon"><Phone /></span>
            <small>CALL OR TEXT</small>
            <b>{proposal.store.phone}</b>
          </div>
          <div>
            <span className="cpp-contact-icon"><Mail /></span>
            <small>EMAIL</small>
            <b>{proposal.store.email}</b>
          </div>
          <div>
            <span className="cpp-contact-icon"><MapPin /></span>
            <small>LOCAL OPERATOR</small>
            <b>{proposal.store.address}</b>
          </div>
        </section>

        <footer className="cpp-footer">
          <div>
            <b>{proposal.store.operatorName}</b>
            <span>{proposal.store.storeName} · {proposal.store.website}</span>
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
