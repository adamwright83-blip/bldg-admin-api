export function BsWordmark({ light = false }: { light?: boolean }) {
  return (
    <span
      className="bs-display"
      style={{ fontSize: 26, letterSpacing: "0.02em", color: light ? "#F5F0E8" : "var(--bs-ink)" }}
    >
      BORE<span style={{ color: "var(--bs-orange)" }}>SLAY</span>
    </span>
  );
}

export function BsNav({ onCta }: { onCta: () => void }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: "rgba(250, 247, 242, 0.92)",
        backdropFilter: "blur(8px)",
        borderBottom: "1px solid var(--bs-line)",
      }}
    >
      <div
        className="bs-container"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 68,
        }}
      >
        <a href="#top" style={{ textDecoration: "none" }} aria-label="BORESLAY home">
          <BsWordmark />
        </a>
        <nav className="bs-nav-links" style={{ display: "flex", gap: 26 }}>
          {[
            ["How it works", "#how"],
            ["Pricing", "#pricing"],
            ["FAQ", "#faq"],
          ].map(([label, href]) => (
            <a
              key={href}
              href={href}
              style={{
                color: "var(--bs-ink-soft)",
                textDecoration: "none",
                fontSize: 16,
                fontWeight: 500,
              }}
            >
              {label}
            </a>
          ))}
        </nav>
        <button type="button" className="bs-cta bs-nav-cta" style={{ padding: "11px 18px", fontSize: 16 }} onClick={onCta}>
          Show Me My First Customer Mission
        </button>
      </div>
    </header>
  );
}
