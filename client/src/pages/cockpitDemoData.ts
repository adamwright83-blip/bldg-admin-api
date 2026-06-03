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
  gas: number,
  insurance: number,
  mileage: number,
  dryClean: number
): CockpitData["lines"] {
  return [
    { key: "grossRevenue", label: "CleanCloud / Gross Revenue", amountCents: rev, matchedLabels: [], missing: false, core: true },
    { key: "storeLabor", label: "Store Labor", amountCents: storeLabor, matchedLabels: [], missing: false, core: false },
    { key: "driverOperatorPay", label: "Driver / Operator Pay", amountCents: driver, matchedLabels: [], missing: false, core: false },
    { key: "gasFuel", label: "Gas / Fuel", amountCents: gas, matchedLabels: [], missing: false, core: false },
    { key: "vehicleInsurance", label: "Vehicle Insurance", amountCents: insurance, matchedLabels: [], missing: false, core: false },
    { key: "mileageVehicleExpenses", label: "Mileage / Vehicle Expenses", amountCents: mileage, matchedLabels: [], missing: false, core: false },
    { key: "dryCleaningPartnerCost", label: "Dry Cleaning Partner Cost", amountCents: dryClean, matchedLabels: [], missing: false, core: false },
  ];
}

// Day: $920 sold, only +$72 survived → fragile Hover
const DAY: CockpitData = {
  month: "2026-06",
  monthLabel: "Mon, Jun 1",
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
  lines: lines(92000, 12000, 42000, 5200, 1800, 2600, 21200),
  warnings: [],
  dateColumnCount: 1,
  previousMonth: {
    monthLabel: "Sun, May 31",
    tabName: "May",
    grossRevenueCents: 74000,
    trueNetCents: -2200,
    marginPct: -3.0,
    cloudLevel: "cliff",
  },
};

// Week: slow stretch, driver/gas/partner bleed → -$121, CLIFF
const WEEK: CockpitData = {
  month: "2026-06",
  monthLabel: "This Week",
  tabName: "June 2026",
  trusted: true,
  grossRevenueCents: 410000,
  totalExpenseCents: 422100,
  trueNetCents: -12100,
  marginPct: -3.0,
  expensePressurePct: 103,
  cliffDistanceCents: -12100,
  cloudLevel: "cliff",
  cloudLabel: "Cliff",
  fuel: { status: "ready", runwayDays: 9, label: "Burning reserves" },
  lines: lines(410000, 60000, 210000, 28000, 9000, 14000, 101100),
  warnings: [],
  dateColumnCount: 7,
  previousMonth: {
    monthLabel: "Last Week",
    tabName: "May wk4",
    grossRevenueCents: 530000,
    trueNetCents: 41000,
    marginPct: 7.7,
    cloudLevel: "hover",
  },
};

// Month: after the hustle compounds → +$2,760 on $18,400, Cloud 2
const MONTH: CockpitData = {
  month: "2026-06",
  monthLabel: "June 2026",
  tabName: "June 2026",
  trusted: true,
  grossRevenueCents: 1840000,
  totalExpenseCents: 1564000,
  trueNetCents: 276000,
  marginPct: 15.0,
  expensePressurePct: 85,
  cliffDistanceCents: 276000,
  cloudLevel: "cloud2",
  cloudLabel: "Cloud 2",
  fuel: { status: "ready", runwayDays: 34, label: "Strong reserves" },
  lines: lines(1840000, 280000, 760000, 120000, 38000, 66000, 300000),
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

// Cliff-week missions: the moves that give the plane lift. Each carries a real
// dollar lift so tapping them visibly pulls the cockpit off the cliff.
//  -$121 + $90 + $120 + $160 + $55 = +$304  →  Cliff → Hover, live on stage.
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
      "CleanCloud made me feel like I won the day. BLDG.chat showed me I only survived it.",
    data: DAY,
    view: "Today",
    interactive: false,
    missions: CLIFF_MISSIONS,
  },
  {
    id: "cliff",
    step: "Dangerous week",
    caption:
      "Driver pay ran long, gas hit, the partner's cut came through — and the week went underwater before I noticed.",
    data: WEEK,
    view: "Week",
    interactive: false,
    missions: CLIFF_MISSIONS,
  },
  {
    id: "mission",
    step: "Mission response",
    caption:
      "The cockpit doesn't just tell me I'm losing — it hands me the controls. Tap a move; watch the plane climb.",
    data: WEEK,
    view: "Week",
    interactive: true,
    missions: CLIFF_MISSIONS,
  },
  {
    id: "climb",
    step: "Monthly climb",
    caption:
      "Every call, flyer, and spa visit gave the business lift. The month climbed into Cloud 2.",
    data: MONTH,
    view: "Month",
    interactive: false,
    missions: CLIFF_MISSIONS,
  },
];

// Single curated snapshot for any non-stepper use.
export const COCKPIT_DEMO_DATA = DAY;
