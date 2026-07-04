import { BsWordmark } from "./BsNav";

export function BsFinalCta({ onCta }: { onCta: () => void }) {
  return (
    <section style={{ background: "var(--bs-dark)", padding: "16px 0 60px" }}>
      <div className="bs-container" style={{ maxWidth: 720, textAlign: "center" }}>
        <h2
          className="bs-display"
          style={{ fontSize: "clamp(32px, 4.8vw, 48px)", color: "var(--bs-cream)", margin: "0 0 18px" }}
        >
          The business is already a game.
        </h2>
        <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 17, margin: "0 0 14px" }}>
          You've been playing it for years. Customers move. Revenue swings. Problems attack from
          off-screen. And you've been running it solo — no crew, no map, no HUD, every boss
          fight barehanded.
        </p>
        <p style={{ color: "rgba(245,240,232,0.72)", fontSize: 17, margin: "0 0 14px" }}>
          BORESLAY turns missed sales, forgotten follow-ups, unpaid invoices, and lost customers
          into missions that put more money in the bank.
        </p>
        <p style={{ color: "var(--bs-cream)", fontWeight: 700, fontSize: 18, margin: "0 0 26px" }}>
          The game gives you the momentum. Your AI crew does the chasing. The business gets the
          win.
        </p>
        <button type="button" className="bs-cta" onClick={onCta}>
          Connect My Business
        </button>
      </div>
      <footer
        className="bs-container"
        style={{
          marginTop: 64,
          paddingTop: 24,
          borderTop: "1px solid rgba(245,240,232,0.14)",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <BsWordmark light />
        </div>
        <p style={{ color: "rgba(245,240,232,0.55)", fontSize: 14, margin: 0 }}>
          A game that grows the business. © {new Date().getFullYear()} BORESLAY. All rights reserved.
        </p>
      </footer>
    </section>
  );
}
