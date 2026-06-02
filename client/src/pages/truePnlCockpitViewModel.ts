export type CockpitLevel =
  | "setup_needed"
  | "cliff"
  | "hover"
  | "cloud1"
  | "cloud2"
  | "cloud3";

export type CockpitScene = "cliff" | "hover" | "cloud1" | "cloud2" | "cloud3";

export type CockpitMission = {
  title: string;
  detail: string;
  impactLabel: string;
  tone: "danger" | "warning" | "growth" | "steady";
};

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
  sentence: string;
} {
  switch (level) {
    case "setup_needed":
      return {
        label: "Setup Needed",
        subtitle: "Revenue rows are missing",
        tone: "amber",
        sentence: "Connect revenue rows before trusting the cockpit.",
      };
    case "cliff":
      return {
        label: "Cliff",
        subtitle: "Loss zone",
        tone: "red",
        sentence: "Losing money. Pull up now.",
      };
    case "hover":
      return {
        label: "Hover",
        subtitle: "Barely profitable / fragile",
        tone: "yellow",
        sentence: "Barely profitable. Protect the margin.",
      };
    case "cloud1":
      return {
        label: "Cloud 1",
        subtitle: "Profitable",
        tone: "green",
        sentence: "Profitable. Keep climbing.",
      };
    case "cloud2":
      return {
        label: "Cloud 2",
        subtitle: "Strong",
        tone: "blue",
        sentence: "Strong altitude. Scale carefully.",
      };
    case "cloud3":
      return {
        label: "Cloud 3",
        subtitle: "Elite",
        tone: "violet",
        sentence: "Elite profit zone.",
      };
  }
}

export function sceneFromCloudLevel(level: CockpitLevel): CockpitScene {
  if (level === "setup_needed") return "hover";
  return level;
}

export function sceneAccentClass(scene: CockpitScene): string {
  switch (scene) {
    case "cliff":
      return "text-red-500";
    case "hover":
      return "text-amber-500";
    case "cloud1":
      return "text-emerald-500";
    case "cloud2":
      return "text-sky-500";
    case "cloud3":
      return "text-indigo-500";
  }
}

export function generateCockpitMissions(input: {
  cloudLevel: CockpitLevel;
  trueNetCents: number;
  grossRevenueCents: number;
  expensePressurePct: number | null;
}): CockpitMission[] {
  if (input.cloudLevel === "setup_needed" || input.grossRevenueCents <= 0) {
    return [
      {
        title: "Connect revenue truth",
        detail:
          "Add revenue rows so the cockpit can calculate survival profit.",
        impactLabel: "Impact estimate unavailable",
        tone: "warning",
      },
    ];
  }

  const missions: CockpitMission[] = [];
  if (input.trueNetCents < 0) {
    missions.push({
      title: "Recover the period",
      detail:
        "Get true net back above zero before scaling pickup and delivery.",
      impactLabel: "Impact estimate unavailable",
      tone: "danger",
    });
  }
  if ((input.expensePressurePct ?? 0) >= 75) {
    missions.push({
      title: "Reduce biggest drag",
      detail:
        "Expense pressure is high. Attack labor, driver pay, gas, or partner cost first.",
      impactLabel: "Impact estimate unavailable",
      tone: "warning",
    });
  }
  if (input.grossRevenueCents < 100_000) {
    missions.push({
      title: "Add profitable orders",
      detail:
        "Revenue is still light. Add orders only where the delivery math survives.",
      impactLabel: "Impact estimate unavailable",
      tone: "growth",
    });
  }
  if (input.cloudLevel === "hover") {
    missions.push({
      title: "Protect margin",
      detail:
        "You are above the cliff, but small cost spikes can erase profit.",
      impactLabel: "Impact estimate unavailable",
      tone: "warning",
    });
  }
  if (
    input.cloudLevel === "cloud1" ||
    input.cloudLevel === "cloud2" ||
    input.cloudLevel === "cloud3"
  ) {
    missions.push({
      title: "Scale carefully",
      detail:
        "Profit exists. Add volume without letting hidden costs outrun revenue.",
      impactLabel: "Impact estimate unavailable",
      tone: "steady",
    });
  }

  return missions.slice(0, 4);
}

export function addTenOrdersWhatIf(input: {
  averageOrderValueCents?: number | null;
  trueNetCents: number;
}):
  | {
      available: true;
      projectedRevenueCents: number;
      projectedTrueNetCents: number;
    }
  | { available: false; reason: string } {
  const averageOrderValueCents = input.averageOrderValueCents ?? null;
  if (!averageOrderValueCents || averageOrderValueCents <= 0) {
    return {
      available: false,
      reason: "Average order value is not available from the Sheet model yet.",
    };
  }
  const projectedRevenueCents = averageOrderValueCents * 10;
  return {
    available: true,
    projectedRevenueCents,
    projectedTrueNetCents: input.trueNetCents + projectedRevenueCents,
  };
}

export function warningBorderClass(
  severity: "info" | "warning" | "critical"
): string {
  if (severity === "critical") return "border-red-300 bg-red-50 text-red-950";
  if (severity === "warning")
    return "border-amber-300 bg-amber-50 text-amber-950";
  return "border-sky-200 bg-sky-50 text-sky-950";
}
