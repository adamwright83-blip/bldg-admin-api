import { useState } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { CockpitView, type CockpitData } from "@/pages/TruePnlCockpitPage";

// Mock data mirroring the model image (Today: +$72 on $920 revenue).
const MOCK: CockpitData = {
  month: "2026-06",
  monthLabel: "June 2026",
  tabName: "June 2026",
  trusted: true,
  grossRevenueCents: 92000,
  totalExpenseCents: 84800,
  trueNetCents: 7200,
  marginPct: 7.8,
  expensePressurePct: 42,
  cliffDistanceCents: 7200,
  cloudLevel: "hover",
  cloudLabel: "Hover",
  fuel: { status: "ready", runwayDays: 18, label: "You're fueled up!" },
  lines: [
    { key: "grossRevenue", label: "CleanCloud / Gross Revenue", amountCents: 92000, matchedLabels: [], missing: false, core: true },
    { key: "storeLabor", label: "Store Labor", amountCents: 12000, matchedLabels: [], missing: false, core: false },
    { key: "driverOperatorPay", label: "Driver / Operator Pay", amountCents: 42000, matchedLabels: [], missing: false, core: false },
    { key: "gasFuel", label: "Gas / Fuel", amountCents: 5200, matchedLabels: [], missing: false, core: false },
    { key: "vehicleInsurance", label: "Vehicle Insurance", amountCents: 1800, matchedLabels: [], missing: false, core: false },
    { key: "mileageVehicleExpenses", label: "Mileage / Vehicle Expenses", amountCents: 2600, matchedLabels: [], missing: false, core: false },
    { key: "dryCleaningPartnerCost", label: "Dry Cleaning Partner Cost", amountCents: 21200, matchedLabels: [], missing: false, core: false },
  ],
  warnings: [
    { severity: "warning", code: "missing_optional", message: "1 optional row missing", labels: ["Tips"] },
  ],
  dateColumnCount: 30,
  previousMonth: {
    monthLabel: "May 2026",
    tabName: "May 2026",
    grossRevenueCents: 74000,
    trueNetCents: -2200,
    marginPct: -3.0,
    cloudLevel: "cliff",
  },
};

const LEVELS = ["cliff", "hover", "cloud1", "cloud2", "cloud3"] as const;

function PreviewHarness() {
  const [month, setMonth] = useState(MOCK.month);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("hover");
  const data: CockpitData = {
    ...MOCK,
    cloudLevel: level,
    // make the numbers feel right per tier so gauges/colors read correctly
    trueNetCents: level === "cliff" ? -4200 : MOCK.trueNetCents,
    marginPct: level === "cliff" ? -4.6 : MOCK.marginPct,
  };
  return (
    <div style={{ width: "100%", maxWidth: 1536, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: 8, padding: 8 }}>
        {LEVELS.map(l => (
          <button
            key={l}
            onClick={() => setLevel(l)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              fontWeight: 700,
              background: l === level ? "#0ea5e9" : "#1e293b",
              color: "white",
            }}
          >
            {l}
          </button>
        ))}
      </div>
      <CockpitView
        data={data}
        month={month}
        onMonthChange={setMonth}
        onRefresh={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("preview-root")!).render(<PreviewHarness />);
