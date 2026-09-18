import { loadPaidOrderLedger, type PaidOrderEvent } from "../analytics/paidOrderLedger";
import { listAdminCustomerAggregates } from "../db";
import { strategyCustomerSnapshotId } from "../strategy/snapshotDormantCustomers";
import { canCompleteRescue, type SpiritHumanRescueMission } from "../../shared/spiritHumanRescue";
import { recordRescueConsequence } from "./rescueMissionService";
import { requireDurableRescueStore, type RescueMissionStore } from "./rescueMissionStore";
import type { AdminCustomerAggregateDbRow } from "../adminCustomerAggregate";

const LOOKBACK_FLOOR = new Date("2020-01-01T00:00:00.000Z");

function phoneDigits(value: string | null | undefined): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

export function findPaidReorderEvidence(input: {
  tenantId: string;
  mission: SpiritHumanRescueMission;
  aggregates: readonly AdminCustomerAggregateDbRow[];
  paidEvents: readonly PaidOrderEvent[];
}): PaidOrderEvent | null {
  if (!canCompleteRescue(input.mission.send) || !input.mission.send.acceptedAt) return null;
  if (input.mission.consequences.some(item => item.kind === "customer_ordered")) return null;

  const customer = input.aggregates.find(
    row => strategyCustomerSnapshotId(input.tenantId, row) === input.mission.spiritHuman.snapshotCustomerId
  );
  const customerPhone = phoneDigits(customer?.phone);
  if (!customerPhone) return null;

  const acceptedAt = Date.parse(input.mission.send.acceptedAt);
  if (!Number.isFinite(acceptedAt)) return null;

  return (
    input.paidEvents
      .filter(event => {
        const eventPhone = phoneDigits(event.identity.phone);
        return eventPhone === customerPhone && event.occurredAt.getTime() > acceptedAt;
      })
      .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())[0] ?? null
  );
}

export async function reconcilePaidOrderConsequencesForOperator(
  input: { tenantId: string; operatorUserId: string; now?: Date },
  deps: {
    store?: RescueMissionStore;
    loadAggregates?: (tenantId: string) => Promise<AdminCustomerAggregateDbRow[]>;
    loadLedger?: typeof loadPaidOrderLedger;
  } = {}
): Promise<SpiritHumanRescueMission[]> {
  const store = deps.store ?? (await requireDurableRescueStore());
  const rows = await store.listForOperator(input.tenantId, input.operatorUserId);
  const pending = rows.filter(
    mission =>
      canCompleteRescue(mission.send) &&
      mission.send.acceptedAt &&
      !mission.consequences.some(item => item.kind === "customer_ordered")
  );
  if (!pending.length) return rows;

  const acceptedTimes = pending
    .map(mission => Date.parse(mission.send.acceptedAt!))
    .filter(Number.isFinite);
  const startUtc = acceptedTimes.length ? new Date(Math.min(...acceptedTimes)) : LOOKBACK_FLOOR;
  const endExclusiveUtc = new Date((input.now ?? new Date()).getTime() + 1);
  const [aggregates, ledger] = await Promise.all([
    (deps.loadAggregates ?? listAdminCustomerAggregates)(input.tenantId),
    (deps.loadLedger ?? loadPaidOrderLedger)({
      tenantId: input.tenantId,
      startUtc,
      endExclusiveUtc,
      timeZone: "America/Los_Angeles",
    }),
  ]);

  for (const mission of pending) {
    const evidence = findPaidReorderEvidence({
      tenantId: input.tenantId,
      mission,
      aggregates,
      paidEvents: ledger.events,
    });
    if (!evidence) continue;
    await recordRescueConsequence(
      {
        tenantId: input.tenantId,
        missionId: mission.missionId,
        kind: "customer_ordered",
        evidenceId: `paid-order:${evidence.eventKey}`,
        observedAt: evidence.occurredAt,
      },
      { store }
    );
  }

  return store.listForOperator(input.tenantId, input.operatorUserId);
}
