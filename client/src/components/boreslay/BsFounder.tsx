import { useState } from "react";

export function BsFounder() {
  const [photoFailed, setPhotoFailed] = useState(false);

  return (
    <section style={{ padding: "26px 0", borderTop: "1px solid var(--bs-line)", borderBottom: "1px solid var(--bs-line)", background: "var(--bs-surface)" }}>
      <div
        className="bs-container"
        style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}
      >
        {photoFailed ? (
          <div
            aria-hidden
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              flexShrink: 0,
              display: "grid",
              placeItems: "center",
              background: "var(--bs-navy)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 24,
            }}
          >
            AW
          </div>
        ) : (
          <img
            src="/boreslay/founder.webp"
            alt="Adam Wright, BORESLAY founder"
            onError={() => setPhotoFailed(true)}
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
              border: "2px solid var(--bs-line)",
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 260 }}>
          <p className="bs-serif" style={{ fontSize: 19, fontStyle: "italic", color: "var(--bs-ink)", margin: "0 0 6px", maxWidth: 720 }}>
            "I built BORESLAY inside my own laundromat to fill slow days. Now I'm opening it to 20
            other operators."
          </p>
          <p style={{ fontSize: 15, color: "var(--bs-ink-soft)", margin: 0 }}>
            <strong style={{ color: "var(--bs-ink)" }}>Adam Wright</strong> · Founder and laundromat operator
          </p>
        </div>
      </div>
    </section>
  );
}
