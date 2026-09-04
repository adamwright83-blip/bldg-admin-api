import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  normalizeCleanCloudPaidOrderRow,
  parseCleanCloudMoneyCents,
} from "../cleancloudPaidOrders";
import {
  parseCsv,
  validateExportUrl,
  validateRange,
} from "../../extensions/gumballpals/core.js";
import { normalizePropertyTower } from "../../shared/propertyTowers";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";

export function invalid(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

export function sourceDate(raw: string): Date | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  const named =
    /^(\d{1,2}) ([A-Za-z]+) (\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      value
    );
  const slash =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([AP]M))?)?$/i.exec(
      value
    );
  const iso =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(
      value
    );
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  let y: number, m: number, d: number, h: number, min: number, s: number;
  if (named) {
    d = +named[1];
    m = months.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    y = +named[3];
    h = +(named[4] || 0);
    min = +(named[5] || 0);
    s = +(named[6] || 0);
  } else if (slash) {
    m = +slash[1];
    d = +slash[2];
    y = +slash[3];
    h = +(slash[4] || 0);
    min = +(slash[5] || 0);
    s = +(slash[6] || 0);
    if (slash[7]) {
      if (h < 1 || h > 12) return null;
      h = (h % 12) + (slash[7].toUpperCase() === "PM" ? 12 : 0);
    }
  } else if (iso) {
    y = +iso[1];
    m = +iso[2];
    d = +iso[3];
    h = +(iso[4] || 0);
    min = +(iso[5] || 0);
    s = +(iso[6] || 0);
  } else return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const calendar = `${y}-${pad(m)}-${pad(d)}`;
  const utc = new Date(`${calendar}T00:00:00Z`);
  if (
    !Number.isFinite(utc.getTime()) ||
    utc.toISOString().slice(0, 10) !== calendar ||
    h > 23 ||
    min > 59 ||
    s > 59
  )
    return null;
  const local = `${calendar}T${pad(h)}:${pad(min)}:${pad(s)}`;
  const result = fromZonedTime(local, "America/Los_Angeles");
  return Number.isFinite(result.getTime()) &&
    formatInTimeZone(result, "America/Los_Angeles", "yyyy-MM-dd'T'HH:mm:ss") ===
      local
    ? result
    : null;
}

export function validatePayload(
  input: {
    csv: string;
    exportUrl: string;
    from: string;
    to: string;
    storeId: string;
  },
  tenantId: string
) {
  let rows: Record<string, string>[];
  try {
    const range = validateRange(input.from, input.to);
    if (validateExportUrl(input.exportUrl, range).storeId !== input.storeId)
      invalid("Export store does not match the paired store.");
    rows = parseCsv(input.csv);
  } catch (error) {
    invalid(error instanceof Error ? error.message : "Invalid report.");
  }
  const normalized = rows!.map((row, index) => {
    const prefix = `Row ${index + 2}: `;
    const paid = row.Paid.trim().toLowerCase();
    if (
      !["1", "0", "true", "false", "yes", "no", "paid", "unpaid"].includes(paid)
    )
      invalid(prefix + "unrecognized paid status.");
    const amount = row["Total after Credit Used"]?.trim() || row.Total;
    if (!/^\(?-?\$?\d[\d,]*(?:\.\d{1,2})?\)?$/.test(amount.trim()))
      invalid(prefix + "invalid amount.");
    const cents = parseCleanCloudMoneyCents(amount);
    if (
      cents === null ||
      !Number.isSafeInteger(cents) ||
      Math.abs(cents) > 2147483647
    )
      invalid(prefix + "amount outside supported range.");
    const result = normalizeCleanCloudPaidOrderRow(row, {
      sourceReportType: "orders_sales",
      sourceFileName: "browser-sync.csv",
      importBatchId: 0,
      tenantId,
    });
    const order = result.normalized;
    if (order) {
      order.placedAtUtc = sourceDate(row.Placed);
      order.paymentDateUtc = sourceDate(row["Payment Date"]);
    }
    if (
      !order ||
      !order.placedAtUtc ||
      !Number.isFinite(order.placedAtUtc.getTime())
    )
      invalid(prefix + "missing customer or invalid placed date.");
    if (
      order.paid &&
      (!order.paymentDateUtc ||
        !Number.isFinite(order.paymentDateUtc.getTime()))
    )
      invalid(prefix + "paid order has no valid payment date.");
    // Never manufacture a source timestamp, infer a payment, or map by customer name.
    return order;
  });
  return {
    normalized,
    digest: createHash("sha256")
      .update(
        JSON.stringify({
          storeId: input.storeId,
          from: input.from,
          to: input.to,
          csv: input.csv,
        })
      )
      .digest("hex"),
  };
}

export function summarizeOrders(
  orders: ReturnType<typeof validatePayload>["normalized"]
) {
  const byBuildingAndPaymentDate: Record<
    string,
    { building: string; paymentDate: string; orders: number; cents: number }
  > = {};
  let unpaid = 0,
    unresolved = 0,
    paidCents = 0;
  for (const order of orders) {
    const building = normalizePropertyTower(order.address).propertyGroup;
    if (building === "unknown") unresolved++;
    if (!order.paid) {
      unpaid++;
      continue;
    }
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(order.paymentDateUtc!);
    const paymentDate = ["year", "month", "day"]
      .map(type => parts.find(p => p.type === type)!.value)
      .join("-");
    const key = `${building}:${paymentDate}`;
    const aggregate = (byBuildingAndPaymentDate[key] ??= {
      building,
      paymentDate,
      orders: 0,
      cents: 0,
    });
    aggregate.orders++;
    aggregate.cents += order.totalCents!;
    paidCents += order.totalCents!;
  }
  return {
    paidCents,
    unpaid,
    unresolved,
    byBuildingAndPaymentDate: Object.values(byBuildingAndPaymentDate).sort(
      (a, b) =>
        a.paymentDate.localeCompare(b.paymentDate) ||
        a.building.localeCompare(b.building)
    ),
  };
}
