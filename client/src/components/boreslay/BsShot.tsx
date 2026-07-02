import { useState } from "react";

/**
 * Product screenshot with a graceful fallback: if the capture isn't in
 * /public/boreslay yet, render a labeled placeholder card instead of a
 * broken-image icon so the page stays presentable.
 */
export function BsShot({
  src,
  alt,
  ratio = "16 / 10",
  focus = "50% 0%",
}: {
  src: string;
  alt: string;
  ratio?: string;
  focus?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt}
        style={{
          aspectRatio: ratio,
          borderRadius: 14,
          border: "1px solid rgba(201, 169, 110, 0.35)",
          background:
            "linear-gradient(150deg, var(--bs-dark-elev) 0%, var(--bs-dark) 70%)",
          display: "grid",
          placeItems: "center",
          padding: 20,
        }}
      >
        <span
          className="bs-mono"
          style={{ color: "var(--bs-gold)", fontSize: 13, textAlign: "center" }}
        >
          {alt}
        </span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      style={{
        width: "100%",
        aspectRatio: ratio,
        objectFit: "cover",
        objectPosition: focus,
        borderRadius: 14,
        border: "1px solid rgba(201, 169, 110, 0.35)",
        display: "block",
        background: "var(--bs-dark)",
      }}
    />
  );
}
