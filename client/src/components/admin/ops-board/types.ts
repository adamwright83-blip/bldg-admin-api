export type ButlerBand = "WEAK" | "WATCH" | "STABLE" | "STRONG" | "ELITE";

export type AdminHomeData = {
  businessDay: string;
  businessTime: string;
  businessLocation: string;
  butlerRating: {
    level: number;
    score: number;
    band: ButlerBand;
  };
  runRate: {
    monthly: number;
    target: number;
    percentToTarget: number;
  };
  kpis: {
    collectedToday: { value: number; deltaPct?: number; isLive: boolean };
    awaitingPayment: { value: number; invoiceCount: number; isLive: boolean };
    activeRoutes: { value: number; completingToday?: number; isLive: boolean };
    atRisk: { count: number; exposure: number; isLive: boolean };
  };
  oneThingRightNow: {
    type: "building_intro";
    contactName: string;
    contactContext: string;
    buildingTarget: string;
    daysSinceLastAsk: number;
    lastAskLabel: string;
    suggestedText: string;
  };
  collectionPriority: {
    type: "collected_unpaid";
    customerName: string;
    firstName: string;
    orderId?: number;
    orderNumber: string;
    phone?: string;
    amount: number;
    daysOverdue: number;
    priorAttempts: number;
    suggestedSms: string;
    isLive: boolean;
  };
  territory: {
    liveCount: number;
    targetCount: number;
    seedPitchPercent: number;
    sectorLabel: string;
    buildings: Array<{
      position: number;
      name: string;
      status: "live" | "pursuing" | "prospect";
    }>;
  };
  revenueAtRisk: {
    total: number;
    accountCount: number;
    sparkline: Array<{ date: string; value: number }>;
    accounts: AtRiskAccount[];
    isLive: boolean;
  };
  gauges: {
    routeEfficiency: { value: number; deltaPct?: number };
    queue: { value: number };
    leadVelocity: { value: number };
    conversion: { value: number; deltaPct?: number };
  };
};

export type AtRiskAccount = {
  customerId: string;
  orderId?: number;
  name: string;
  amount: number;
  daysOverdue: number;
  phone?: string;
  suggestedSms: string;
  isLive: boolean;
};

export type OpsBoardModal =
  | { kind: "christopher_text" }
  | { kind: "log_outreach" }
  | { kind: "collect_daniel" }
  | { kind: "pipeline_action" }
  | { kind: "pursue_all" };

export type LogOutreachPayload = {
  channel: string;
  notes: string;
  occurredAt: string;
};
