export type CockpitLevel =
  | "setup_needed"
  | "cliff"
  | "hover"
  | "cloud1"
  | "cloud2"
  | "cloud3";

export function moneyFromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents) / 100;
  return `${sign}${new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)}`;
}

export function percentLabel(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Setup needed";
  return `${value.toFixed(1)}%`;
}

export function cockpitLevelCopy(level: CockpitLevel): {
  label: string;
  subtitle: string;
  tone: string;
} {
  switch (level) {
    case "setup_needed":
      return {
        label: "Setup Needed",
        subtitle: "Revenue rows are missing",
        tone: "amber",
      };
    case "cliff":
      return {
        label: "Cliff",
        subtitle: "Loss zone",
        tone: "red",
      };
    case "hover":
      return {
        label: "Hover",
        subtitle: "Barely profitable / fragile",
        tone: "yellow",
      };
    case "cloud1":
      return {
        label: "Cloud 1",
        subtitle: "Profitable",
        tone: "green",
      };
    case "cloud2":
      return {
        label: "Cloud 2",
        subtitle: "Strong",
        tone: "blue",
      };
    case "cloud3":
      return {
        label: "Cloud 3",
        subtitle: "Elite",
        tone: "violet",
      };
  }
}

export function warningBorderClass(
  severity: "info" | "warning" | "critical"
): string {
  if (severity === "critical") return "border-red-300 bg-red-50 text-red-950";
  if (severity === "warning")
    return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-sky-200 bg-sky-50 text-sky-950";
}
