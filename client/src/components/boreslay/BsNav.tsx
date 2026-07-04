export function BsWordmark({ light = false }: { light?: boolean }) {
  return (
    <span
      className="bs-display"
      style={{
        fontSize: 29,
        letterSpacing: "0.02em",
        color: light ? "#F5F0E8" : "var(--bs-ink)",
        display: "flex",
        flexDirection: "column",
        lineHeight: 1.1,
      }}
    >
      <span>
        <span style={{ color: "var(--bs-gold)" }}>⚡</span> BORE
        <span style={{ color: "var(--bs-orange)" }}>SLAY</span>
      </span>
      <span
        className="bs-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          color: light ? "rgba(245,240,232,0.5)" : "var(--bs-ink-soft)",
          fontWeight: 400,
          textTransform: "uppercase",
        }}
      >
        The action RPG for real business growth
      </span>
    </span>
  );
}

export function BsNav({
  onCta,
  subdued = false,
}: {
  onCta: () => void;
  subdued?: boolean;
}) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(4, 13, 23, 0.94)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(224, 210, 177, 0.28)",
      }}
    >
      <div
        className="bs-container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 86,
          width: "calc(100% - 96px)",
          maxWidth: "none",
        }}
      >
        <a
          href="#top"
          style={{ textDecoration: "none" }}
          aria-label="BORESLAY home"
        >
          <BsWordmark light />
        </a>
        <nav className="bs-nav-links" style={{ display: "flex", gap: 38 }}>
          {[
            ["Game Demo", "#top"],
            ["How it works", "#how"],
            ["The Crew", "#crew"],
            ["Real Results", "#truenet"],
            ["Pricing", "#pricing"],
            ["FAQ", "#faq"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              style={{
                color: "rgba(245,240,232,0.72)",
                textDecoration: "none",
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {label.toUpperCase()}
            </a>
          ))}
        </nav>
        <button
          type="button"
          className={`bs-cta bs-nav-cta${subdued ? " is-subdued" : ""}`}
          style={{
            padding: "11px 18px",
            fontSize: 16,
            background: "var(--bs-gold)",
            minWidth: 215,
          }}
          onClick={onCta}
        >
          Join the Expedition
        </button>
      </div>
    </header>
  );
}
