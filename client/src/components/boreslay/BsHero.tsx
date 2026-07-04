export function BsHero({ onPlayDemo }: { onPlayDemo: () => void }) {
  return (
    <section id="top" style={{ background: "var(--bs-dark)", padding: "48px 0 40px" }}>
      <div className="bs-container" style={{ maxWidth: 780 }}>
        <h1
          className="bs-display"
          style={{ fontSize: "clamp(40px, 6vw, 68px)", color: "var(--bs-cream)", margin: "0 0 22px", lineHeight: 1.04 }}
        >
          Play the game.
          <br />
          Command the crew.
          <br />
          <span style={{ color: "var(--bs-gold)" }}>Grow your business.</span>
        </h1>

        <p style={{ color: "rgba(245,240,232,0.82)", fontSize: 18.5, margin: "0 0 18px" }}>
          BORESLAY is an action RPG wired into a real service business — with an AI crew built
          in. Not your employees. Software specialists who chase, remind, track, and follow
          through.
        </p>
        <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 17.5, margin: "0 0 18px" }}>
          The people you forgot to call back. The jobs you priced but never landed. The
          customers who quietly disappeared. The invoices still sitting unpaid. In here,
          they're the enemy.
        </p>
        <p style={{ color: "rgba(245,240,232,0.82)", fontSize: 18.5, margin: "0 0 8px" }}>
          You fight the boss. The crew executes. Every real-world win comes back as power.
        </p>
        <p style={{ color: "rgba(245,240,232,0.82)", fontSize: 18.5, fontWeight: 700, margin: "0 0 28px" }}>
          You bring the judgment and the human voice. The crew brings everything else.
        </p>

        <button type="button" className="bs-cta" onClick={onPlayDemo} style={{ marginBottom: 10 }}>
          Play Demo Mission
        </button>
        <p className="bs-mono" style={{ fontSize: 13, color: "rgba(245,240,232,0.5)", margin: 0 }}>
          No credit card. No signup. Just a boss that's had it coming.
        </p>
      </div>
    </section>
  );
}
