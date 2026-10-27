import { isCenturyParkEastTower, streetIdentity } from "../../shared/lanternTerritoryAttribution";
import {
  buildTowerDesk,
  LEDGER_LOOKBACK_DAYS,
  unitOf,
  type DeskLedgerInput,
  type DeskReferralInput,
  type DeskResidentInput,
  type TowerDesk,
  type TowerDeskBuildingId,
} from "../../shared/towerDesk";
import { identityKeysFor } from "./customerIdentityResolution";
import { loadPaidOrderLedger } from "./paidOrderLedger";
import { getDashboardTimeZone } from "../dashboardZoned";
import { getReferralActivity } from "../domains/referral/referralService";
import { loadCustomerGroups } from "../geography/customerOrderTruth";

/**
 * Reads the front desk under a tower (shared/towerDesk.ts says what each monitor means).
 * Residents come from the same customer order truth the atlas lights windows from, so the keys match;
 * money comes only from the canonical paid-order ledger. Each source fails on its own: a ledger or
 * referral outage turns its monitors to "not wired", never the whole desk.
 */
export async function readTowerDesk(input: { tenantId: string; buildingId: TowerDeskBuildingId; now?: Date }): Promise<TowerDesk> {
  const now = input.now ?? new Date();
  const groups = await loadCustomerGroups(input.tenantId);

  const residents: DeskResidentInput[] = [];
  for (const [key, records] of groups) {
    const live = records.filter(r => !r.cancelled);
    const latest = [...live].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).at(-1);
    if (!latest || !isCenturyParkEastTower(streetIdentity(latest.address))) continue;
    const identityKeys = new Set<string>();
    for (const r of live) {
      for (const k of identityKeysFor({ phone: r.phone, email: r.email, bldgUserId: r.bldgUserId, cleancloudCustomerId: r.cleancloudCustomerId })) identityKeys.add(k);
    }
    residents.push({
      key,
      name: `${latest.firstName} ${latest.lastName}`.trim() || "Customer name unavailable",
      unit: unitOf(latest.unit, latest.address),
      orderedAt: live.map(r => r.createdAt),
      identityKeys: [...identityKeys],
    });
  }

  const startUtc = new Date(now.getTime() - LEDGER_LOOKBACK_DAYS * 86_400_000);
  const [ledger, referrals] = await Promise.all([
    loadPaidOrderLedger({ tenantId: input.tenantId, startUtc, endExclusiveUtc: new Date(now.getTime() + 60_000), timeZone: getDashboardTimeZone() })
      .then<DeskLedgerInput>(l =>
        l.completeness === "unavailable"
          ? { status: "unavailable" }
          : {
              status: l.completeness === "complete" ? "ok" : "partial",
              startUtc,
              events: l.events.map(e => ({ occurredAt: e.occurredAt, cents: e.cents, identityKeys: identityKeysFor(e.identity) })),
            }
      )
      .catch((error): DeskLedgerInput => {
        console.warn("[towerDesk] paid-order ledger unavailable", error);
        return { status: "unavailable" };
      }),
    getReferralActivity(input.tenantId, now)
      .then<DeskReferralInput>(a => ({ status: "ok", source: a.program.source, rows: a.activity, freshness: a.freshness }))
      .catch((error): DeskReferralInput => {
        console.warn("[towerDesk] referral activity unavailable", error);
        return { status: "unavailable" };
      }),
  ]);

  return buildTowerDesk({ buildingId: input.buildingId, now, residents, ledger, referrals });
}
