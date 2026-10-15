import {
  APPROVED_VIEWS,
  type ApprovedDataset,
  type Row,
} from "./approvedViews";
/** Isolated synthetic source shape. Never describes the real Laundry Farm population. */
export function syntheticAnalysisDataset(): ApprovedDataset {
  const tables: Record<string, Row[]> = Object.fromEntries(
    APPROVED_VIEWS.map(v => [v.name, []])
  );
  const refs: ApprovedDataset["customerRefs"] = {};
  for (let i = 0; i < 16; i++) {
    const id = `cust_fixture${i}`,
      name = `Fixture Customer ${String.fromCharCode(65 + i)}`;
    const gaps = i < 10 ? [0, 7, 14, 21, 28] : [0, 3, 22, 38, 52];
    const days = gaps.map(day =>
      new Date(Date.UTC(2026, 5, 1 + day)).toISOString().slice(0, 10)
    );
    if (i >= 14) days.push("2026-10-12");
    for (let j = 0; j < days.length; j++)
      tables.orders!.push([
        `ord_${i}_${j}`,
        id,
        days[j]!,
        days[j]!.slice(0, 7),
        "Mon",
        (i + 1) * 1000,
        null,
        null,
        "wash_fold",
        "laundry_farm",
        "cleancloud",
        "cleancloud_paid_record",
        i === 9 ? "90012" : "90026",
        i === 9 ? "Downtown" : "Silver Lake;Echo Park",
        "Wash and fold, medium bag",
      ]);
    tables.customers!.push([
      id,
      name,
      1,
      days[0]!,
      days.at(-1)!,
      days.length,
      days.length * (i + 1) * 1000,
      1,
      i === 9 ? "Downtown" : "Silver Lake;Echo Park",
    ]);
    refs[id] = { displayName: name, identityKeys: [`cleancloud:fixture${i}`] };
  }
  tables.open_orders!.push([
    "open_fixture",
    "cust_fixture8",
    "processing",
    "2026-10-13",
    0,
  ]);
  tables.coverage!.push(
    ["costs", "Unavailable"],
    ["open_orders", "Native only; CleanCloud open orders unavailable"],
    ["geography", "ZIP-based approximate mapping"],
    ["completeness", "partial; source window coverage unknown"]
  );
  return {
    tenantId: "analysis-certification-fixture",
    generatedAt: "2026-10-14T19:00:00Z",
    window: {
      start: "2023-10-15",
      end: "2026-10-14",
      timeZone: "America/Los_Angeles",
    },
    completeness: "partial",
    tables,
    customerRefs: refs,
    limitations: [
      "Native open-order coverage only; CleanCloud outstanding orders are not synchronized.",
      "ZIP geography is approximate and cannot confirm Silver Lake residence.",
      "Costs are unavailable; revenue is not profit.",
      "Coverage is partial; inactivity is a candidate signal, not confirmed churn or a verified zero.",
    ],
  };
}
