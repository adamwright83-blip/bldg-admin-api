export function BsHero({ onPlayDemo }: { onPlayDemo: () => void }) {
  return (
    <section id="top" style={{ background: "var(--bs-dark)", padding: "48px 0 40px" }}>
      <div className="bs-container" style={{ maxWidth: 820 }}>
        <span
          className="bs-mono"
          style={{
            display: "inline-block",
            padding: "6px 14px",
            borderRadius: 999,
            border: "1px solid var(--bs-gold)",
            color: "var(--bs-gold)",
            fontSize: 12.5,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 18,
          }}
        >
          A World First
        </span>

        <h1
          className="bs-display"
          style={{ fontSize: "clamp(32px, 5.2vw, 54px)", color: "var(--bs-cream)", margin: "0 0 26px", lineHeight: 1.08 }}
        >
          The video game that hunts down new business—and calls you in when only a human can win it.
        </h1>

        <div style={{ marginBottom: 22 }}>
          <h2 className="bs-display" style={{ fontSize: "clamp(24px, 3.4vw, 34px)", color: "var(--bs-cream)", margin: "0 0 6px" }}>
            You play.
          </h2>
          <h2 className="bs-display" style={{ fontSize: "clamp(24px, 3.4vw, 34px)", color: "var(--bs-cream)", margin: "0 0 6px" }}>
            Your AI crew does the chasing.
          </h2>
          <h2 className="bs-display" style={{ fontSize: "clamp(24px, 3.4vw, 34px)", color: "var(--bs-gold)", margin: 0 }}>
            When it counts, you step in and close the door behind you.
          </h2>
        </div>

        <p style={{ color: "rgba(245,240,232,0.82)", fontSize: 18.5, margin: "0 0 18px" }}>
          The boring business you skip BBQs to avoid talking about is about to become the game
          you can't put down.
        </p>
        <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 17, margin: "0 0 18px" }}>
          Scout finds the customers, jobs, payments, and opportunities slipping through the
          cracks. Closer handles the repeated follow-up. Sage prepares you for the conversations
          that need an actual owner.
        </p>
        <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 17, margin: "0 0 18px" }}>
          When the mission can run without you, your crew runs it. When your presence can change
          the outcome, BORESLAY gives you the location, the context, the words, and the clock.
        </p>
        <p style={{ color: "var(--bs-cream)", fontWeight: 700, fontSize: 18.5, margin: "0 0 28px" }}>
          BORESLAY turns "I should probably do that someday" into "get dressed—you leave in ten
          minutes."
        </p>

        <button type="button" className="bs-cta" onClick={onPlayDemo} style={{ marginBottom: 10 }}>
          Play Demo Mission
        </button>
        <p className="bs-mono" style={{ fontSize: 13, color: "rgba(245,240,232,0.5)", margin: 0 }}>
          No credit card. No signup. Start playing!
        </p>
      </div>
    </section>
  );
}
