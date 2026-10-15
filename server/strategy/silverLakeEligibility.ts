/**
 * Disposable Silver Lake outreach eligibility.
 *
 * This predicate refuses to run when NODE_ENV is production. It evaluates
 * caller-supplied facts only. It does not read or write a database, and it
 * does not accept a customer display name. A phone number is not consent.
 * Consent is channel `sms` and purpose `win_back_marketing` on
 * `customer_contact_permissions`, the same gate `evaluateDormantOutreach`
 * enforces after that table is read.
 */
import { LA_NEIGHBORHOODS } from "../analytics/laNeighborhoods";
import type { CustomerTruthDisposition } from "../analytics/sourceCoverage";
import {
  evaluateDormantOutreach,
  WIN_BACK_COOLDOWN_DAYS,
  type DormantOutreachDecision,
  type SmsPermissionState,
} from "./dormantOutreachGate";

const silverLake = LA_NEIGHBORHOODS["silver lake"]!;

/** Label plus the recorded Silver Lake ZIP filter. Not a customer list. */
export const SILVER_LAKE_AREA_TERMS = [silverLake.label, ...silverLake.zips] as const;

export class SilverLakeEligibilityProductionRefusal extends Error {
  readonly code = "production_refused" as const;

  constructor() {
    super("Silver Lake eligibility predicate refuses to run when NODE_ENV is production.");
    this.name = "SilverLakeEligibilityProductionRefusal";
  }
}

export type SilverLakeEligibilityInput = {
  tenantId: string;
  freshness: CustomerTruthDisposition;
  matched: boolean;
  paidOrders: number;
  capturedCents: number;
  lastOrderDate: string | null;
  dormant: boolean;
  contradictingRecentOrder: boolean;
  /** Digits only. Identity, not consent. */
  phoneDigits: string | null;
  permission: {
    channel: string;
    purpose: string;
    state: SmsPermissionState;
    readable: boolean;
  };
  lastOutreachOn: string | null;
  today: string;
  /** Address text for the Silver Lake area filter. Not a display name. */
  addressText: string;
};

function addressMatchesSilverLake(address: string): boolean {
  const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return SILVER_LAKE_AREA_TERMS.some(term =>
    new RegExp(`\\b${escape(term)}\\b`, "i").test(address)
  );
}

export function evaluateSilverLakeEligibility(
  input: SilverLakeEligibilityInput
): DormantOutreachDecision {
  if (process.env.NODE_ENV === "production") {
    throw new SilverLakeEligibilityProductionRefusal();
  }
  const winBackSms =
    input.permission.channel === "sms" && input.permission.purpose === "win_back_marketing";
  return evaluateDormantOutreach({
    tenantId: input.tenantId,
    freshness: input.freshness,
    matched: input.matched,
    inTerritory: addressMatchesSilverLake(input.addressText),
    paidOrders: input.paidOrders,
    capturedCents: input.capturedCents,
    lastOrderDate: input.lastOrderDate,
    dormant: input.dormant,
    contradictingRecentOrder: input.contradictingRecentOrder,
    phoneDigits: input.phoneDigits,
    permission: winBackSms ? input.permission.state : "unknown",
    permissionReadable: input.permission.readable,
    lastOutreachOn: input.lastOutreachOn,
    today: input.today,
    cooldownDays: WIN_BACK_COOLDOWN_DAYS,
  });
}
