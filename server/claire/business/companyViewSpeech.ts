import {
  businessDisplayName,
  LAUNDRY_BUTLER_TENANT_ID,
  LAUNDRY_FARM_TENANT_ID,
  type CompanyBuildingFocus,
  type CompanyBusinessSlice,
  type LaundryFarmCompanyQuestion,
  type LaundryFarmCompanyView,
} from "../../analytics/laundryFarmCompanyView";
import { Speech } from "./businessSpeech";

function overlapSentences(view: LaundryFarmCompanyView, speech: Speech): void {
  if (view.overlap.unresolvedPairCount > 0) {
    speech.say(
      `${speech.count(view.overlap.unresolvedPairCount)} ${view.overlap.unresolvedPairCount === 1 ? "pair matches" : "pairs match"} a customer, a day, and an amount on both Stripe and CleanCloud. ${speech.money(view.overlap.unresolvedIncludedCents, true)} of that may be the same sale. The overlap is unresolved, so there is no deduplicated total. The recorded sales above still include both records.`
    );
  }
  if (view.overlap.withheldCount > 0) {
    speech.say(
      `The canonical revenue read withheld ${speech.money(view.overlap.withheldCents, true)} across ${speech.count(view.overlap.withheldCount)} suspected same-sale ${view.overlap.withheldCount === 1 ? "match" : "matches"}. That amount is not in the recorded sales, and I am not adding it back.`
    );
  }
}

function scopeSentence(view: LaundryFarmCompanyView, question: Pick<LaundryFarmCompanyQuestion, "scope">, speech: Speech): void {
  if (question.scope === "clarify") {
    speech.say(
      "Do you mean Laundry Farm, Laundry Butler, or both businesses combined? I won't guess a total across them."
    );
    return;
  }
  if (view.scope === "unauthorized" || !view.tenantsRead.length) {
    if (question.scope === "both") {
      speech.say(
        "I can state a cross-business total only when you're authorized for both Laundry Farm and Laundry Butler. I won't guess."
      );
      return;
    }
    const name = question.scope === "laundry_farm" || question.scope === "default" ? businessDisplayName(question.scope) : "that business";
    speech.say(`I can't read ${name}. This login isn't authorized for that business.`);
  }
}

function focusedBuildings(slice: CompanyBusinessSlice, focus: CompanyBuildingFocus | null) {
  if (!focus) return slice.buildings;
  if (focus === "shared") return slice.buildings.filter(building => building.bucket === "opus_la" || building.bucket === "century_park_east");
  return slice.buildings.filter(building => building.bucket === focus);
}

function focusLabel(focus: CompanyBuildingFocus): string {
  if (focus === "opus_la") return "OPUS LA";
  if (focus === "century_park_east") return "Century Park East";
  return "OPUS LA and Century Park East";
}

function speakBusinessMoney(name: string, figures: LaundryFarmCompanyView["totals"], when: string, speech: Speech): void {
  speech.say(
    `${name} recorded sales ${when} are ${speech.money(figures.recordedSalesCents, true)} across ${speech.count(figures.orderCount)} ${figures.orderCount === 1 ? "order" : "orders"}.`
  );
  if (figures.capturedPaymentsCents == null) {
    speech.say(
      `Verified captured payments are ${speech.money(figures.capturedPaymentsKnownCents, true)}. A captured-payment total is not stated, because capture evidence does not cover every sale.`
    );
  } else {
    speech.say(`Captured payments are ${speech.money(figures.capturedPaymentsCents, true)}.`);
  }
  speech.say(`Refunds are ${speech.money(figures.refundCents, true)}.`);
  speech.say(`Net revenue on the admitted records is ${speech.money(figures.netRevenueCents, true)}.`);
}

function speakOneBusiness(
  view: LaundryFarmCompanyView,
  slice: CompanyBusinessSlice,
  question: Pick<LaundryFarmCompanyQuestion, "aspect" | "building">,
  speech: Speech
): void {
  const when = view.period.label;
  if (question.building) {
    const rows = focusedBuildings(slice, question.building);
    if (!rows.length) {
      speech.say(`${slice.label} has no recorded sales at ${focusLabel(question.building)} ${when}.`);
      return;
    }
    for (const row of rows) {
      speech.say(
        `${slice.label} at ${row.label} recorded ${speech.money(row.figures.recordedSalesCents, true)} across ${speech.count(row.figures.orderCount)} ${row.figures.orderCount === 1 ? "order" : "orders"}.`
      );
    }
    return;
  }
  if (question.aspect === "orders") {
    speech.say(
      `${slice.label} has ${speech.count(slice.figures.orderCount)} paid ${slice.figures.orderCount === 1 ? "order" : "orders"} ${when}.`
    );
    return;
  }
  speakBusinessMoney(slice.label, slice.figures, when, speech);
  if (question.aspect === "health") {
    for (const building of slice.buildings) {
      speech.say(
        `${building.label}: ${speech.money(building.figures.recordedSalesCents, true)} across ${speech.count(building.figures.orderCount)} ${building.figures.orderCount === 1 ? "order" : "orders"}.`
      );
    }
  }
}

function speakCustomers(view: LaundryFarmCompanyView, speech: Speech): void {
  const places = "OPUS LA and Century Park East";
  const lines = [LAUNDRY_FARM_TENANT_ID, LAUNDRY_BUTLER_TENANT_ID].map(tenantId => {
    const slice = view.businesses.find(business => business.tenantId === tenantId);
    const rows = slice ? focusedBuildings(slice, "shared") : [];
    const customers = slice?.sharedBuildingCustomerCount ?? 0;
    const orders = rows.reduce((sum, row) => sum + row.figures.orderCount, 0);
    return { name: businessDisplayName(tenantId), customers, orders, known: Boolean(slice) && (orders === 0 || customers > 0) };
  });
  if (lines.some(line => !line.known)) {
    speech.say(`I can't compare customers at ${places}, because one of the businesses doesn't have a customer identity on those orders.`);
    return;
  }
  speech.say(
    `At ${places}, ${lines.map(line => `${line.name} has ${speech.count(line.customers)} ${line.customers === 1 ? "customer" : "customers"}`).join(" and ")}.`
  );
  const [farm, butler] = lines;
  if (!farm || !butler || farm.customers === butler.customers) {
    speech.say(`Neither business has more customers from these buildings.`);
    return;
  }
  const ahead = farm.customers > butler.customers ? farm.name : butler.name;
  speech.say(`${ahead} is getting more customers from these buildings.`);
}

function speakCrossBusiness(
  view: LaundryFarmCompanyView,
  question: Pick<LaundryFarmCompanyQuestion, "aspect" | "building">,
  speech: Speech
): void {
  const slices = view.businesses;
  if (question.aspect === "customers") {
    speech.say("Laundry Farm and Laundry Butler stay separate. Customers are counted inside each business.");
    speakCustomers(view, speech);
    return;
  }
  speech.say("This is a cross-business total. Laundry Farm and Laundry Butler stay separate ledgers.");
  if (question.building) {
    let sum = 0;
    for (const slice of slices) speakOneBusiness(view, slice, question, speech);
    for (const slice of slices) {
      sum += focusedBuildings(slice, question.building).reduce((total, row) => total + row.figures.recordedSalesCents, 0);
    }
    speech.say(
      `Across both businesses, recorded sales at ${focusLabel(question.building)} are ${speech.money(sum, true)}. That is not a deduplicated total.`
    );
    overlapSentences(view, speech);
    return;
  }
  for (const slice of slices) {
    speech.say(
      `${slice.label} recorded ${speech.money(slice.figures.recordedSalesCents, true)} across ${speech.count(slice.figures.orderCount)} ${slice.figures.orderCount === 1 ? "order" : "orders"}.`
    );
  }
  speech.say(
    `Across both businesses, recorded sales ${view.period.label} are ${speech.money(view.totals.recordedSalesCents, true)}. That is not a deduplicated total.`
  );
  overlapSentences(view, speech);
}

/** Sentences for one business, or for an intentional cross-business read. Numbers enter only through Speech. */
export function speakLaundryFarmCompanyView(
  view: LaundryFarmCompanyView,
  question: Pick<LaundryFarmCompanyQuestion, "aspect" | "scope" | "building">,
  speech: Speech
): void {
  scopeSentence(view, question, speech);
  if (question.scope === "clarify" || view.scope === "unauthorized" || !view.tenantsRead.length) return;
  if (question.scope === "both" || view.tenantsRead.length > 1) {
    speakCrossBusiness(view, question, speech);
    return;
  }
  const tenantId =
    question.scope === "laundry_farm" || question.scope === "default"
      ? question.scope
      : view.tenantsRead[0] ?? "";
  const slice =
    view.businesses.find(business => business.tenantId === question.scope) ??
    view.businesses.find(business => view.tenantsRead.includes(business.tenantId)) ??
    (tenantId
      ? {
          tenantId,
          label: businessDisplayName(tenantId),
          figures: {
            recordedSalesCents: 0,
            capturedPaymentsCents: 0,
            capturedPaymentsKnownCents: 0,
            refundCents: 0,
            netRevenueCents: 0,
            unpaidBalanceCents: null,
            orderCount: 0,
          },
          customerCount: 0,
          sharedBuildingCustomerCount: 0,
          buildings: [],
        }
      : null);
  if (!slice) {
    speech.say("I can't read that business.");
    return;
  }
  speakOneBusiness(view, slice, question, speech);
  if (view.overlap.unresolvedPairCount > 0 || view.overlap.withheldCount > 0) overlapSentences(view, speech);
}
