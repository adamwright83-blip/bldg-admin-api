import React from "react";

export type AttributionItem = {
  text: string;
  uri?: string;
};

export function GoogleAttributionSafeZone({
  visible,
  providerAttributions = [],
  className = "",
}: {
  visible: boolean;
  providerAttributions?: AttributionItem[];
  className?: string;
}) {
  if (!visible) return null;

  return (
    <footer className={`cr-google-attribution-safezone ${className}`} aria-label="Provider attribution safe zone">
      <div className="cr-google-third-party-credits">
        {providerAttributions.length > 0 ? (
          providerAttributions.map((item, idx) => (
            <span key={idx}>
              {item.uri ? (
                <a
                  href={item.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="cr-attribution-link"
                >
                  {item.text}
                </a>
              ) : (
                <span>{item.text}</span>
              )}
              {idx < providerAttributions.length - 1 ? " · " : ""}
            </span>
          ))
        ) : null}
      </div>
    </footer>
  );
}
