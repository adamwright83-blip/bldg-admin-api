import type { BusinessEvent, DataQuality } from "../../shared/businessGame";

export type DayResolution = {
  id: string;
  tenantId: string;
  businessDate: string;
  sourceThrough: string;
  completedWork: Array<{ id: string; title: string; sourceReference: string }>;
  moneyEvents: Array<{ id: string; title: string; amountCents: number | null; verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED"; sourceReference: string }>;
  relationshipEvents: BusinessEvent[];
  commercialEvents: BusinessEvent[];
  recoveryEvents: Array<{ id: string; title: string; sourceReference: string }>;
  journal: { status: "saved" | "not_saved"; journalPoints: number; sourceReference: string | null };
  worldDeltas: Array<{ id: string; title: string; verificationClass: "VERIFIED" | "ATTESTED" | "CLAIMED"; sourceReference: string }>;
  tomorrowState: { itemCount: number; blockerCount: number };
  motivationalAwards: Array<{ type: string; points: number; sourceReference: string }>;
  dataQuality: DataQuality;
};
