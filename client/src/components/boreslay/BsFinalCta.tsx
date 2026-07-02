import { BsIntakeForm } from "./BsIntake";
import { BsWordmark } from "./BsNav";

export function BsFinalCta() {
  return (
    <section id="start" style={{ background: "var(--bs-dark)", padding: "76px 0 60px" }}>
      <div className="bs-container bs-final-grid">
        <div>
          <h2
            className="bs-display"
            style={{ fontSize: "clamp(38px, 5.5vw, 60px)", color: "var(--bs-cream)", margin: "0 0 14px" }}
          >
            See where BORESLAY can find revenue in your business.
          </h2>
          <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 18, maxWidth: 460, margin: "0 0 14px" }}>
            Answer three questions. Adam will build your first mission around your actual customers,
            unfinished follow-up, and current goals.
          </p>
          <p className="bs-mono" style={{ color: "rgba(245,240,232,0.55)", fontSize: 13.5, margin: 0 }}>
            15 minutes · phone or Zoom · no sales pitch
          </p>
        </div>
        <div
          style={{
            borderRadius: 18,
            background: "var(--bs-dark-elev)",
            border: "1px solid rgba(201, 169, 110, 0.25)",
            padding: "26px 24px",
          }}
        >
          <BsIntakeForm dark />
        </div>
      </div>
      <footer className="bs-container" style={{ marginTop: 64, paddingTop: 24, borderTop: "1px solid rgba(245,240,232,0.14)", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <BsWordmark light />
        <p style={{ color: "rgba(245,240,232,0.55)", fontSize: 14, margin: 0 }}>
          Built in Los Angeles by an operator, for operators. © {new Date().getFullYear()} BORESLAY.
        </p>
      </footer>
    </section>
  );
}
