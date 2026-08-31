import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { worldDayPhase } from "./worldDepth";

function losAngelesHour(now: Date): number {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now).find(item => item.type === "hour")?.value;
  return Number(part ?? 0);
}

export function WorldDayPhaseIndicator() {
  const [now, setNow] = useState(() => new Date());
  const atmosphereQuery = trpc.system.google.atmosphere.useQuery(undefined, {
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const phase = atmosphereQuery.data?.dayPhase ?? worldDayPhase(losAngelesHour(now));
  const label = atmosphereQuery.data?.statusBadge ?? `LA WORLD · ${phase.toUpperCase()}`;

  return (
    <div
      className={`cr-day-phase is-${phase}`}
      aria-label={`One World atmosphere: ${label}`}
    >
      <i aria-hidden />
      {label}
    </div>
  );
}
