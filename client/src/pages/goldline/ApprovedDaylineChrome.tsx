import "./approved-dayline-chrome.css";

const REFERENCE = "/goldline/dayline-v2/ui/approved-reference.png";

/** A viewport onto the approved artwork; the source pixels stay unchanged. */
function ReferenceCrop({
  box,
  className,
  label,
}: {
  box: readonly [number, number, number, number];
  className?: string;
  label?: string;
}) {
  return (
    <svg
      className={className}
      viewBox={box.join(" ")}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
      focusable="false"
    >
      <image href={REFERENCE} width="941" height="1672" />
    </svg>
  );
}

/** Claire's approved head, the same pixels as the Day Line header badge. */
export function ClairePortrait({ className }: { className?: string }) {
  return <ReferenceCrop box={[805, 76, 102, 103]} className={className} />;
}

function dateLabel(businessDate: string) {
  const [year, month, day] = businessDate.split("-").map(Number);
  return new Date(year, month - 1, day)
    .toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .toUpperCase();
}

export function ApprovedDaylineHeader({
  businessDate,
  navigationOpen,
  onToggleNavigation,
  onCallClaire,
}: {
  businessDate: string;
  navigationOpen: boolean;
  onToggleNavigation: () => void;
  onCallClaire: () => void;
}) {
  return (
    <header className="gdp-approved-header" aria-label="Goldline Day Line">
      <ReferenceCrop
        box={[46, 80, 128, 124]}
        className="gdp-approved-profile"
        label="Explorer profile"
      />
      <ReferenceCrop
        box={[184, 85, 330, 98]}
        className="gdp-approved-logo"
        label="GOLDLINE · DAY LINE"
      />
      <div className="gdp-approved-date">
        <span className="gdp-approved-sun-space" aria-hidden="true" />
        <time dateTime={businessDate}>{dateLabel(businessDate)}</time>
      </div>
      <button
        type="button"
        className="gdp-approved-map"
        onClick={onToggleNavigation}
        aria-label="Open Navigation Menu"
        aria-expanded={navigationOpen}
        aria-controls="goldline-world-navigation"
      >
        <ReferenceCrop box={[710, 87, 80, 82]} />
      </button>
      <button
        type="button"
        className="gdp-approved-claire"
        onClick={onCallClaire}
        aria-label="Claire, AI Guide"
        data-testid="claire-lantern-badge"
      >
        <ReferenceCrop box={[801, 72, 110, 111]} />
        <span>CLAIRE</span>
      </button>
    </header>
  );
}

export function ApprovedDaylineDock({
  navigationOpen,
  onLanternCity,
  onDayLine,
  onCollection,
  onBriefings,
}: {
  navigationOpen: boolean;
  onLanternCity: () => void;
  onDayLine: () => void;
  onCollection: () => void;
  onBriefings: () => void;
}) {
  return (
    <nav className="gdp-approved-dock" aria-label="Goldline Navigation">
      <ReferenceCrop
        box={[0, 1508, 941, 128]}
        className="gdp-approved-dock-art"
      />
      <ReferenceCrop
        box={[325, 1485, 102, 101]}
        className="gdp-approved-dock-compass"
      />
      <button type="button" onClick={onLanternCity}>
        <span>LANTERN CITY</span>
      </button>
      <button type="button" onClick={onDayLine} aria-current="page">
        <span>DAY LINE</span>
      </button>
      <button type="button" onClick={onCollection}>
        <span>COLLECTION</span>
      </button>
      <button
        type="button"
        onClick={onBriefings}
        aria-expanded={navigationOpen}
        aria-controls="goldline-world-navigation"
      >
        <span>BRIEFINGS</span>
      </button>
    </nav>
  );
}
