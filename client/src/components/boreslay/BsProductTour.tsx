import { BsShot } from "./BsShot";

type TourShot = {
  src: string;
  title: string;
  caption: string;
  alt: string;
  focus?: string;
};

const SHOTS: TourShot[] = [
  {
    src: "/boreslay/cockpit.jpg",
    title: "True Net Cockpit",
    caption:
      "Know what the business actually kept after labor, fuel, vendors, and other operating costs — not just what came through the register.",
    alt: "True Net Cockpit — profit dashboard screenshot",
  },
  {
    src: "/boreslay/missions.jpg",
    title: "Mission Board",
    caption:
      "The highest-value action to take next, right now — without studying another dashboard.",
    alt: "Mission Board — daily revenue missions screenshot",
    focus: "62% 50%",
  },
  {
    src: "/boreslay/sage.jpg",
    title: "SAGE Outreach",
    focus: "50% 50%",
    caption:
      "When a mission needs customer contact, SAGE writes the texts, emails, and printed campaigns in your voice — banned from sounding like a marketer — and stages them for your approval.",
    alt: "SAGE outreach battle screenshot",
  },
];

export function BsProductTour() {
  return (
    <section id="tour" style={{ background: "var(--bs-dark)", padding: "76px 0" }}>
      <div className="bs-container">
        <p
          className="bs-mono"
          style={{ color: "var(--bs-gold)", fontSize: 13, letterSpacing: "0.14em", textTransform: "uppercase", margin: "0 0 10px" }}
        >
          Real product screenshots — not AI renders
        </p>
        <h2 className="bs-display" style={{ fontSize: "clamp(36px, 5vw, 54px)", color: "var(--bs-cream)", margin: "0 0 8px" }}>
          Built like a game. Accountable like a ledger.
        </h2>
        <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 18, maxWidth: 620, margin: "0 0 40px" }}>
          It looks like a video game. The score is booked revenue.
        </p>
        <div className="bs-tour-grid">
          {SHOTS.map(shot => (
            <figure key={shot.title} style={{ margin: 0 }}>
              <BsShot src={shot.src} alt={shot.alt} focus={shot.focus} />
              <figcaption style={{ marginTop: 14 }}>
                <span className="bs-display" style={{ display: "block", fontSize: 24, color: "var(--bs-cream)" }}>
                  {shot.title}
                </span>
                <span style={{ color: "rgba(245,240,232,0.72)", fontSize: 15.5 }}>{shot.caption}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
