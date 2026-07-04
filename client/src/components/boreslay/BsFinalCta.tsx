import { BsIntakeForm } from "./BsIntake";
import { BsWordmark } from "./BsNav";

export function BsFinalCta() {
  return (
    <section id="start" style={{ background: "var(--bs-dark)", padding: "76px 0 60px" }}>
      <div className="bs-container bs-final-grid">
        <div>
          <h2
            className="bs-display"
            style={{ fontSize: "clamp(34px, 5vw, 52px)", color: "var(--bs-cream)", margin: "0 0 14px" }}
          >
            Your next win is one mission away.
          </h2>
          <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 18, maxWidth: 460, margin: 0 }}>
            Answer three questions. Adam will build your crew's first mission around your actual
            business and walk you through it — phone or Zoom, whenever suits you.
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
          A game that grows your business. © {new Date().getFullYear()} BORESLAY.
        </p>
      </footer>
    </section>
  );
}
