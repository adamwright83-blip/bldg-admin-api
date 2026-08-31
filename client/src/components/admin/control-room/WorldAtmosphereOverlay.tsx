import React, { useMemo } from "react";
import type { WorldAtmosphereProjection } from "@shared/worldAtmosphere";

export function WorldAtmosphereOverlay({
  atmosphere,
  className = "",
}: {
  atmosphere: WorldAtmosphereProjection | null;
  className?: string;
}) {
  const cssVars = useMemo(() => {
    if (!atmosphere?.cssVariables) return {};
    return atmosphere.cssVariables as React.CSSProperties;
  }, [atmosphere]);

  if (!atmosphere) return null;

  const isRaining = Number(atmosphere.cssVariables["--world-rain-density"] ?? "0") > 0.1;
  const hasCloud = Number(atmosphere.cssVariables["--world-cloud"] ?? "0") > 0.2;
  const hasHaze = Number(atmosphere.cssVariables["--world-haze"] ?? "0") > 0.1;

  return (
    <div
      className={`cr-world-atmosphere-root ${className}`}
      style={cssVars}
      aria-hidden="true"
    >
      {/* Sky lighting wash */}
      <div className="cr-atmo-lighting-layer" />

      {/* Cloud shadows / cover */}
      {hasCloud ? <div className="cr-atmo-cloud-layer" /> : null}

      {/* Distance haze (air quality / fog) */}
      {hasHaze ? <div className="cr-atmo-haze-layer" /> : null}

      {/* Rain animation if active */}
      {isRaining ? (
        <div className="cr-atmo-rain-layer">
          <div className="cr-rain-streak r1" />
          <div className="cr-rain-streak r2" />
          <div className="cr-rain-streak r3" />
        </div>
      ) : null}
    </div>
  );
}
