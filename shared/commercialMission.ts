export const COMMERCIAL_MISSION_STATUSES = [
  "candidate",
  "selected",
  "game_ready",
  "game_active",
  "game_completed",
  "phone_ready",
  "preparing",
  "en_route",
  "arrived",
  "visit_completed",
  "follow_up",
  "won",
  "lost",
] as const;

export const COMMERCIAL_MISSION_DEMO_STORAGE_KEY =
  "dayforge:commercial-sales-mission:demo";

export type CommercialMissionStatus =
  (typeof COMMERCIAL_MISSION_STATUSES)[number];

export type CommercialMissionConfidence = "low" | "medium" | "high";

export type CommercialMissionDecisionMaker = {
  name: string | null;
  title: string | null;
};

export type CommercialMissionStep = {
  id: string;
  label: string;
  detail: string;
  status: "locked" | "ready" | "active" | "completed" | "skipped";
};

export type CommercialMission = {
  id: number;
  code: string;
  tenantId: string;
  accountId: number;
  accountName: string;
  accountType: string;
  accountAddress: string;
  accountLat: number;
  accountLng: number;
  accountLocationCount: number;
  estimatedAnnualValueCents: number;
  estimateConfidence: CommercialMissionConfidence;
  decisionMaker: CommercialMissionDecisionMaker;
  primarySignal: string;
  laundryOpportunity: string;
  salesAngle: string;
  openingLine: string;
  discoveryQuestions: string[];
  objections: string[];
  reasons: string[];
  risks: string[];
  status: CommercialMissionStatus;
  expiresAt: string | null;
  steps: CommercialMissionStep[];
};

export type CommercialOpportunity = {
  id: number;
  accountName: string;
  accountType: string;
  locationCount: number;
  distanceMiles: number;
  estimatedAnnualValueCents: number;
  score: number;
  grade: CommercialMissionConfidence;
  primarySignal: string;
  reasons: string[];
};

export type CommercialMissionSurface = {
  code: string;
  accountName: string;
  estimatedAnnualValueCents: number;
  decisionMakerName: string | null;
  decisionMakerTitle: string | null;
};

export const DEMO_MISSION: CommercialMission = {
  id: 42,
  code: "MISSION 042",
  tenantId: "dayforge-demo",
  accountId: 10042,
  accountName: "Westview Property Management",
  accountType: "Property management",
  accountAddress: "Los Angeles, CA",
  accountLat: 34.0522,
  accountLng: -118.2437,
  accountLocationCount: 15,
  estimatedAnnualValueCents: 2_480_000,
  estimateConfidence: "high",
  decisionMaker: {
    name: "Dana R.",
    title: "Operations Manager",
  },
  primarySignal: "Expanded to 15 buildings",
  laundryOpportunity:
    "Centralized fluff-and-fold service for towels, mats, staff items, and tenant laundry.",
  salesAngle:
    "One dependable local laundry partner, scheduled pickup and delivery, and one invoice across all 15 buildings.",
  openingLine:
    "I noticed your team recently expanded to 15 buildings. Who handles laundry service across the portfolio?",
  discoveryQuestions: [
    "How are towels, mats, staff items, and tenant laundry handled today?",
    "Which locations create the most laundry work for your team?",
    "Would one pickup schedule and one invoice simplify the operation?",
  ],
  objections: [
    "Current provider",
    "In-house staff handling laundry",
    "Pickup schedule",
    "Pricing",
    "Turnaround time",
    "Lost or damaged-item concerns",
  ],
  reasons: [
    "Tuesday and Thursday capacity can absorb the estimated volume",
    "The account sits near an existing route",
    "The portfolio contains 15 buildings",
    "The operations manager is identified",
  ],
  risks: ["Current laundry provider is unknown"],
  status: "game_ready",
  expiresAt: null,
  steps: [
    {
      id: "scout",
      label: "Scout",
      detail: "Learn the account and why it fits your laundry.",
      status: "completed",
    },
    {
      id: "prepare",
      label: "Prepare",
      detail: "Build the pitch, quote, and leave-behind.",
      status: "ready",
    },
    {
      id: "battle",
      label: "Battle",
      detail: "Beat the hesitation standing between you and the visit.",
      status: "locked",
    },
    {
      id: "field",
      label: "Field",
      detail: "Send the same mission to your phone and walk in ready.",
      status: "locked",
    },
  ],
};

export const DEMO_OPPORTUNITIES: CommercialOpportunity[] = [
  {
    id: DEMO_MISSION.accountId,
    accountName: DEMO_MISSION.accountName,
    accountType: DEMO_MISSION.accountType,
    locationCount: DEMO_MISSION.accountLocationCount,
    distanceMiles: 0.2,
    estimatedAnnualValueCents: DEMO_MISSION.estimatedAnnualValueCents,
    score: 87,
    grade: "high",
    primarySignal: DEMO_MISSION.primarySignal,
    reasons: DEMO_MISSION.reasons,
  },
  {
    id: 10043,
    accountName: "Harbor Inn & Suites",
    accountType: "Hotel",
    locationCount: 1,
    distanceMiles: 0.8,
    estimatedAnnualValueCents: 1_820_000,
    score: 82,
    grade: "high",
    primarySignal: "Housekeeping team hiring",
    reasons: [
      "Forty-room hotel",
      "Recurring linen and towel demand",
      "Inside the current service radius",
    ],
  },
  {
    id: 10044,
    accountName: "Glow Salon Group",
    accountType: "Salon and spa",
    locationCount: 3,
    distanceMiles: 1.1,
    estimatedAnnualValueCents: 690_000,
    score: 71,
    grade: "medium",
    primarySignal: "Opened a third location",
    reasons: [
      "Three nearby locations",
      "Recurring towel service",
      "Fits Tuesday production capacity",
    ],
  },
  {
    id: 10045,
    accountName: "Iron Tide Gym",
    accountType: "Gym",
    locationCount: 1,
    distanceMiles: 1.4,
    estimatedAnnualValueCents: 430_000,
    score: 66,
    grade: "medium",
    primarySignal: "Membership growth announcement",
    reasons: [
      "Daily member-towel demand",
      "Near an existing pickup route",
      "Operations contact listed publicly",
    ],
  },
];

export function formatMissionCode(id: number): string {
  return `MISSION ${String(id).padStart(3, "0")}`;
}

export function formatCurrencyFromCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function toCommercialMissionSurface(
  mission: CommercialMission
): CommercialMissionSurface {
  return {
    code: mission.code,
    accountName: mission.accountName,
    estimatedAnnualValueCents: mission.estimatedAnnualValueCents,
    decisionMakerName: mission.decisionMaker.name,
    decisionMakerTitle: mission.decisionMaker.title,
  };
}

export function assertMissionSurfaceContinuity(
  mission: CommercialMission,
  surfaces: CommercialMissionSurface[]
): void {
  const expected = toCommercialMissionSurface(mission);
  for (const surface of surfaces) {
    if (
      surface.code !== expected.code ||
      surface.accountName !== expected.accountName ||
      surface.estimatedAnnualValueCents !==
        expected.estimatedAnnualValueCents ||
      surface.decisionMakerName !== expected.decisionMakerName ||
      surface.decisionMakerTitle !== expected.decisionMakerTitle
    ) {
      throw new Error(
        `Commercial mission continuity failed for ${mission.code}. Every surface must render the same mission snapshot.`
      );
    }
  }
}
