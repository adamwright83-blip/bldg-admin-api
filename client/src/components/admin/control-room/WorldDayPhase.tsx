import { useEffect, useState } from "react";
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
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const phase = worldDayPhase(losAngelesHour(now));
  return <div className={`cr-day-phase is-${phase}`} aria-label={`One World day phase: ${phase}`}><i aria-hidden />LA world · {phase}</div>;
}

