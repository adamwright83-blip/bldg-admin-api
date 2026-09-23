import type {
  CommunicationLinkEntityKind,
  CommunicationLinkSource,
  CommunicationPartyClass,
} from "@shared/communicationsAnalytics";
import type { TwilioCommunicationReceipt } from "@shared/twilioPlatform";

export type ClaireSessionLinkRecord = {
  tenantId: string;
  providerCallSid: string | null;
  claireConversationId: string;
  missionId: number | null;
  relatedActionIds: readonly string[];
  operatorUserId: string;
  startedAt: string;
};

export type CommunicationContextLinkRecord = {
  tenantId: string;
  providerResourceSid: string;
  resourceKind: "call" | "message";
  partyClass: CommunicationPartyClass | null;
  goldlineEntityKind: CommunicationLinkEntityKind | null;
  goldlineEntityId: string | null;
  source: CommunicationLinkSource;
  proof: string;
};

export type CommercialAcquisitionRecord = {
  tenantId: string;
  orderId: number;
  missionId: number;
  campaignLinkId: string | null;
  firstTouchSourceId: string | null;
  reviewState: string;
  conversionAt: string;
  createdAt: string;
};

export type CommercialOrderAttributionRecord = {
  tenantId: string;
  orderId: number;
  missionId: number;
  status: "active" | "reversed" | "financial_review";
  netPaidCents: number | null;
};

export type OrderPaymentProjectionRecord = {
  tenantId: string;
  orderId: number;
  state:
    | "unpaid"
    | "paid"
    | "partially_refunded"
    | "refunded"
    | "cancelled"
    | "review_required";
  netPaidCents: number | null;
};

export type OrderMoneyRecord = {
  tenantId: string;
  orderId: number;
  status: string;
  paid: boolean;
  totalCents: number | null;
  createdAt: string;
  paidAt: string | null;
};

export type CommunicationsProjectionFacts = {
  tenantId: string;
  receipts: readonly TwilioCommunicationReceipt[];
  claireSessions: readonly ClaireSessionLinkRecord[];
  contextLinks: readonly CommunicationContextLinkRecord[];
  acquisitions: readonly CommercialAcquisitionRecord[];
  orderAttributions: readonly CommercialOrderAttributionRecord[];
  paymentProjections: readonly OrderPaymentProjectionRecord[];
  orders: readonly OrderMoneyRecord[];
};
