import type {
  CockpitData,
  CockpitMissionView,
  PeriodView,
} from "./TruePnlCockpitPage";

// ─────────────────────────────────────────────────────────────────────────────
// Live-pitch script for admin.bldg.chat/pnl?demo=1
//
// The arc rides the product's real Today / Week / Month toggle:
//   1. The lie      — Today looks fine (+$72) but it's only HOVER (fragile)
//   2. The cliff    — Week is underwater (-$121), sky turns red, DANGER
//   3. The mission  — operator taps real moves; the plane climbs off the cliff
//   4. The climb    — Month is healthy (Cloud 2); the hustle compounded
//
// Every number forms a closed, defensible loop: the cliff-week missions add up
// to a recovery the room can verify in Q&A.
// ─────────────────────────────────────────────────────────────────────────────

function lines(
  rev: number,
  storeLabor: number,
  driver: number,
  ownerPay: number,
  gas: number,
  insurance: number,
  mileage: number,
  dryClean: number
): CockpitData["lines"] {
  return [
    { key: "grossRevenue", label: "CleanCloud / Gross Revenue", amountCents: rev, matchedLabels: [], missing: false, core: true },
    { key: "storeLabor", label: "Store Labor", amountCents: storeLabor, matchedLabels: [], missing: false, core: false },
    { key: "driverOperatorPay", label: "Driver / Operator Pay", amountCents: driver, matchedLabels: [], missing: false, core: false },
    { key: "ownerPay", label: "Owner Pay (Adam Labor)", amountCents: ownerPay, matchedLabels: ["Adam Labor"], missing: false, core: false },
    { key: "gasFuel", label: "Gas / Fuel", amountCents: gas, matchedLabels: [], missing: false, core: false },
    { key: "vehicleInsurance", label: "Vehicle Insurance", amountCents: insurance, matchedLabels: [], missing: false, core: false },
    { key: "mileageVehicleExpenses", label: "Mileage / Vehicle Expenses", amountCents: mileage, matchedLabels: [], missing: false, core: false },
    { key: "dryCleaningPartnerCost", label: "Dry Cleaning Partner Cost", amountCents: dryClean, matchedLabels: [], missing: false, core: false },
  ];
}

// Day: $920 sold, only +$72 survived (after $114 owner pay) → CLIFF.
// The whole point of period-aware thresholds: a tiny positive day is danger.
const DAY: CockpitData = {
  month: "2026-06",
  monthLabel: "Mon, Jun 1",
  tabName: "June 2026",
  trusted: true,
  grossRevenueCents: 92000,
  totalExpenseCents: 84800,
  trueNetCents: 7200,
  marginPct: 7.8,
  expensePressurePct: 92,
  cliffDistanceCents: 7200,
  cloudLevel: "cliff",
  cloudLabel: "Cliff",
  fuel: { status: "ready", runwayDays: 12, label: "Thin reserves" },
  // owner pay $114.29/day included as a real expense
  lines: lines(92000, 12000, 30000, 11429, 5200, 1800, 2600, 21771),
  warnings: [],
  dateColumnCount: 1,
  previousMonth: {
    monthLabel: "Yesterday",
    tabName: "June 2026",
    grossRevenueCents: 74000,
    trueNetCents: -2200,
    marginPct: -3.0,
    cloudLevel: "cliff",
  },
};

// Week: a full week at that pace is still only fragile Hover (+$650).
const WEEK: CockpitData = {
  month: "2026-06",
  monthLabel: "This Week",
  tabName: "June 2026",
  trusted: true,
  grossRevenueCents: 410000,
  totalExpenseCents: 345000,
  trueNetCents: 65000,
  marginPct: 15.9,
  expensePressurePct: 84,
  cliffDistanceCents: 65000,
  cloudLevel: "hover",
  cloudLabel: "Hover",
  fuel: { status: "ready", runwayDays: 16, label: "Holding steady" },
  // owner pay $800/week included
  lines: lines(410000, 60000, 70000, 80000, 28000, 9000, 14000, 84000),
  warnings: [],
  dateColumnCount: 7,
  previousMonth: {
    monthLabel: "Last Week",
    tabName: "June 2026",
    grossRevenueCents: 360000,
    trueNetCents: 21000,
    marginPct: 5.8,
    cloudLevel: "cliff",
  },
};

// Month: zoom out and the month is genuinely strong → +$6,800, Cloud 2.
const MONTH: CockpitData = {
  month: "2026-06",
  monthLabel: "June 2026",
  tabName: "June 2026",
  trusted: true,
  grossRevenueCents: 1840000,
  totalExpenseCents: 1160000,
  trueNetCents: 680000,
  marginPct: 37.0,
  expensePressurePct: 63,
  cliffDistanceCents: 680000,
  cloudLevel: "cloud2",
  cloudLabel: "Cloud 2",
  fuel: { status: "ready", runwayDays: 34, label: "Strong reserves" },
  // owner pay ~$3,466/month included
  lines: lines(1840000, 240000, 200000, 346600, 100000, 38000, 62000, 173400),
  warnings: [],
  dateColumnCount: 30,
  previousMonth: {
    monthLabel: "May 2026",
    tabName: "May",
    grossRevenueCents: 1610000,
    trueNetCents: 96000,
    marginPct: 6.0,
    cloudLevel: "hover",
  },
};

// Rescue missions: the moves that give the plane lift. Each carries a real
// dollar lift so committing them projects a flight path up the cloud ladder
// (labeled "projected" — the actual booked number does not move).
// Ordered to the mission icons (flyers, people, basket, star).
export const CLIFF_MISSIONS: CockpitMissionView[] = [
  {
    title: "Post 40 flyers",
    detail: "Los Feliz / Silver Lake",
    impactLabel: "+$120 true net",
    tone: "growth",
    liftCents: 12000,
  },
  {
    title: "Call 10 past customers",
    detail: "Recover 3 orders",
    impactLabel: "+$90 true net",
    tone: "growth",
    liftCents: 9000,
  },
  {
    title: "Push 5 orders over $45",
    detail: "Protect the margin",
    impactLabel: "+$55 true net",
    tone: "steady",
    liftCents: 5500,
  },
  {
    title: "Visit 3 spas in person",
    detail: "1 weekly towel account",
    impactLabel: "+$160 / wk",
    tone: "growth",
    liftCents: 16000,
  },
];

export type DemoBeat = {
  id: string;
  step: string; // stepper button label
  caption: string; // narrator line
  data: CockpitData;
  view: PeriodView;
  interactive: boolean;
  missions: CockpitMissionView[];
};

export const COCKPIT_DEMO_BEATS: DemoBeat[] = [
  {
    id: "lie",
    step: "Good-looking day",
    caption:
      "CleanCloud says I sold $920 and kept $72. The cockpit says +$72 is the cliff for a day — one gas fill and it's gone.",
    data: DAY,
    view: "Today",
    interactive: false,
    missions: CLIFF_MISSIONS,
  },
  {
    id: "week",
    step: "Fragile week",
    caption:
      "A whole week at that pace is still just fragile Hover. After I pay myself, there's almost nothing protecting the business.",
    data: WEEK,
    view: "Week",
    interactive: false,
    missions: CLIFF_MISSIONS,
  },
  {
    id: "mission",
    step: "Mission response",
    caption:
      "The cockpit hands me the controls. Tap a move to see the flight path out — projected, not pretend. The actual number stays put until I do the work.",
    data: WEEK,
    view: "Week",
    interactive: true,
    missions: CLIFF_MISSIONS,
  },
  {
    id: "climb",
    step: "Monthly climb",
    caption:
      "Zoom out: the month is genuinely strong — +$6,800, Cloud 2. Same business, three honest lenses.",
    data: MONTH,
    view: "Month",
    interactive: false,
    missions: CLIFF_MISSIONS,
  },
];

// Single curated snapshot for any non-stepper use.
export const COCKPIT_DEMO_DATA = DAY;
