import { BsIntakeForm } from "./BsIntake";

export function BsIntakeSection() {
  return (
    <section id="start" style={{ background: "var(--bs-dark)", padding: "76px 0" }}>
      <div className="bs-container bs-final-grid">
        <div>
          <h2
            className="bs-display"
            style={{ fontSize: "clamp(34px, 5vw, 52px)", color: "var(--bs-cream)", margin: "0 0 14px" }}
          >
            Your next win starts with one mission.
          </h2>
          <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 18, maxWidth: 460, margin: 0 }}>
            Answer four questions. During the beta, Adam — the operator who built BORESLAY
            inside his own laundry business — reviews your operation, picks the highest-value
            first mission, and walks you through it live. Phone or Zoom. A human, not a funnel.
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
    </section>
  );
}
