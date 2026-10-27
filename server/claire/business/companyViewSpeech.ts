import {
  LAUNDRY_BUTLER_TENANT_ID,
  LAUNDRY_FARM_TENANT_ID,
  type CompanyBuildingSlice,
  type CompanyQuestionAspect,
  type LaundryFarmCompanyView,
} from "../../analytics/laundryFarmCompanyView";
import { capitalize, joinList, Speech } from "./businessSpeech";

function tenantBook(tenantId: string): string {
  if (tenantId === LAUNDRY_FARM_TENANT_ID) return "the CleanCloud / Clearant book";
  if (tenantId === LAUNDRY_BUTLER_TENANT_ID) return "the Laundry Butler Stripe book";
  return tenantId;
}

function overlapSentences(view: LaundryFarmCompanyView, speech: Speech): void {
  if (view.overlap.unresolvedPairCount > 0) {
    speech.say(
      `${speech.count(view.overlap.unresolvedPairCount)} ${view.overlap.unresolvedPairCount === 1 ? "pair matches" : "pairs match"} a customer, a day, and an amount on both Stripe and CleanCloud. ${speech.money(view.overlap.unresolvedIncludedCents, true)} of that may be the same sale. The overlap is unresolved, so there is no deduplicated company total. The recorded sales above still include both records.`
    );
  }
  if (view.overlap.withheldCount > 0) {
    speech.say(
      `The canonical revenue read withheld ${speech.money(view.overlap.withheldCents, true)} across ${speech.count(view.overlap.withheldCount)} suspected same-sale ${view.overlap.withheldCount === 1 ? "match" : "matches"}. That amount is not in the recorded sales, and I am not adding it back.`
    );
  }
}

function scopeSentence(view: LaundryFarmCompanyView, speech: Speech): void {
  if (view.mayStateCompanyTotal) return;
  if (view.scope === "unauthorized" || !view.tenantsRead.length) {
    speech.say(
      "I can read the Laundry Farm company view only for an operator authorized on both the Laundry Farm and Laundry Butler books. I won't guess a combined total."
    );
    return;
  }
  const unread = view.tenantsUnread.map(tenantBook);
  const unreadSentence = unread.length
    ? `${capitalize(joinList(unread))} is not included, so those customers, orders, and money stay out.`
    : "One of the books is incomplete, so this is only the verified portion.";
  speech.say(
    `This is not a combined Laundry Farm total. I can read ${joinList(view.tenantsRead.map(tenantBook))}. ${unreadSentence}`
  );
}

function moneySentences(view: LaundryFarmCompanyView, speech: Speech): void {
  const totals = view.totals;
  const when = view.period.label;
  speech.say(
    `Recorded sales ${when} are ${speech.money(totals.recordedSalesCents, true)} across ${speech.count(totals.orderCount)} ${totals.orderCount === 1 ? "order" : "orders"}.`
  );
  if (totals.capturedPaymentsCents == null) {
    speech.say(
      `Verified captured payments are ${speech.money(totals.capturedPaymentsKnownCents, true)}. A combined captured-payment total is not stated, because capture evidence does not cover every sale.`
    );
  } else {
    speech.say(`Captured payments are ${speech.money(totals.capturedPaymentsCents, true)}.`);
  }
  speech.say(`Refunds are ${speech.money(totals.refundCents, true)}.`);
  speech.say(`Net revenue on the admitted records is ${speech.money(totals.netRevenueCents, true)}.`);
  if (totals.unpaidBalanceCents == null) {
    speech.say("Unpaid balances are not in this read.");
  } else {
    speech.say(`Unpaid balances recorded on open orders are ${speech.money(totals.unpaidBalanceCents, true)}.`);
  }
}

function buildingSentence(building: CompanyBuildingSlice, speech: Speech, rails: boolean): void {
  speech.say(
    `${building.label} recorded ${speech.money(building.figures.recordedSalesCents, true)} across ${speech.count(building.figures.orderCount)} ${building.figures.orderCount === 1 ? "order" : "orders"}.`
  );
  if (!rails || building.rails.length < 2) return;
  const parts = building.rails.map(rail => `${rail.label} ${speech.money(rail.figures.recordedSalesCents, true)}`);
  speech.say(`At ${building.label}, ${joinList(parts)}.`);
}

function namedBuilding(view: LaundryFarmCompanyView, bucket: string, label: string, speech: Speech): void {
  const building = view.buildings.find(row => row.bucket === bucket);
  if (!building) {
    speech.say(`${label} has no recorded sales in this window.`);
    return;
  }
  buildingSentence(building, speech, true);
}

/** Sentences for the company view. Numbers enter only through Speech. */
export function speakLaundryFarmCompanyView(
  view: LaundryFarmCompanyView,
  aspect: CompanyQuestionAspect,
  speech: Speech
): void {
  scopeSentence(view, speech);
  if (view.scope === "unauthorized" || !view.tenantsRead.length) return;
  if (aspect === "breakdown") {
    const farm = view.businessRevenue.find(item => item.tenantId === LAUNDRY_FARM_TENANT_ID);
    const butler = view.businessRevenue.find(item => item.tenantId === LAUNDRY_BUTLER_TENANT_ID);
    if (farm) speech.say(`Laundry Farm recorded sales ${view.period.label}: ${speech.money(farm.figures.recordedSalesCents, true)}.`);
    else speech.say("Laundry Farm's book is unavailable for this breakdown.");
    if (butler) speech.say(`Laundry Butler recorded sales ${view.period.label}: ${speech.money(butler.figures.recordedSalesCents, true)}.`);
    else speech.say("Laundry Butler's book is unavailable for this breakdown.");
    if (view.mayStateCompanyTotal && farm && butler) {
      speech.say(`Together, recorded sales ${view.period.label} are ${speech.money(view.totals.recordedSalesCents, true)}.`);
    }
    overlapSentences(view, speech);
    return;
  }
  if (aspect === "orders") {
    speech.say(
      `There ${view.totals.orderCount === 1 ? "is" : "are"} ${speech.count(view.totals.orderCount)} paid ${view.totals.orderCount === 1 ? "order" : "orders"} ${view.period.label}.`
    );
    for (const building of view.buildings) {
      speech.say(`${building.label}: ${speech.count(building.figures.orderCount)}.`);
    }
    overlapSentences(view, speech);
    return;
  }
  if (aspect === "buildings") {
    namedBuilding(view, "opus_la", "OPUS LA", speech);
    namedBuilding(view, "century_park_east", "Century Park East", speech);
    for (const building of view.buildings) {
      if (building.bucket === "opus_la" || building.bucket === "century_park_east") continue;
      buildingSentence(building, speech, false);
    }
    speech.say(
      `Those buildings roll into recorded sales of ${speech.money(view.totals.recordedSalesCents, true)}.`
    );
    overlapSentences(view, speech);
    return;
  }
  moneySentences(view, speech);
  const primary = view.buildings.filter(building => building.kind === "building" || building.kind === "unassigned_building");
  for (const building of (aspect === "health" ? view.buildings : primary.length ? primary : view.buildings)) {
    buildingSentence(building, speech, aspect === "health" || building.rails.length > 1);
  }
  overlapSentences(view, speech);
}
