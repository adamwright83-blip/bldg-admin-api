import { CheckCircle2, Gamepad2, Target } from "lucide-react";

const STEPS = [
  {
    icon: Target,
    title: "Pick a goal",
    body: "More new customers, a busier week, more reviews, or money collected. Three questions, two minutes.",
  },
  {
    icon: Gamepad2,
    title: "BORESLAY builds the mission",
    body: "It chooses who to contact, drafts the campaign, recommends the offer, and estimates what the mission could produce.",
  },
  {
    icon: CheckCircle2,
    title: "You approve. It launches.",
    body: "Nothing sends without your OK. BORESLAY runs the follow-up and tracks responses, bookings, and revenue tied to the mission.",
  },
];

export function BsHowItWorks() {
  return (
    <section id="how" style={{ padding: "16px 0 72px" }}>
      <div className="bs-container">
        <h2 className="bs-display" style={{ fontSize: "clamp(36px, 5vw, 54px)", margin: "0 0 8px" }}>
          How it works
        </h2>
        <p style={{ color: "var(--bs-ink-soft)", fontSize: 18, margin: "0 0 40px" }}>
          You didn't get into this business to do marketing. So don't.
        </p>
        <div className="bs-steps-grid">
          {STEPS.map((step, i) => (
            <div key={step.title}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--bs-navy)",
                    color: "#fff",
                  }}
                >
                  <step.icon size={22} />
                </div>
                <span className="bs-mono" style={{ fontSize: 14, color: "var(--bs-ink-soft)" }}>
                  STEP {i + 1}
                </span>
              </div>
              <h3 className="bs-display" style={{ fontSize: 28, margin: "0 0 8px" }}>
                {step.title}
              </h3>
              <p style={{ color: "var(--bs-ink-soft)", fontSize: 16.5, margin: 0 }}>{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
