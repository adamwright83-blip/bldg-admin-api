const CLEANCLOUD_ORIGIN = "https://cleancloudapp.com";
export const MAX_ORDERS_SALES_BYTES = 4_000_000;

export type OrdersSalesRange = { from: string; to: string };

export function pacificToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map(type => parts.find(part => part.type === type)?.value ?? "")
    .join("-");
}

function dateNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use a valid calendar date.");
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    throw new Error("Use a valid calendar date.");
  }
  return parsed;
}

export function validateOrdersSalesRange(
  from: string,
  to: string,
  today = pacificToday()
): OrdersSalesRange {
  const start = dateNumber(from);
  const end = dateNumber(to);
  if (start > end || to > today || end - start > 31 * 86_400_000) {
    throw new Error("Choose up to 32 calendar days ending no later than today in Los Angeles.");
  }
  return { from, to };
}

/**
 * Validate the normal CleanCloud Orders (Sales) export URL. This is transport
 * evidence used by Gumball's legacy direct-browser path. Jawbreaker does not
 * need the URL because its durable artifact is already bound to the paired
 * store and range before server ingestion.
 */
export function validateOrdersSalesExportUrl(raw: string, range: OrdersSalesRange) {
  const url = new URL(raw);
  if (
    url.origin !== CLEANCLOUD_ORIGIN ||
    url.pathname !== "/include/data-export-endpoint.php" ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error("Unexpected report destination.");
  }
  const allowed = ["type", "d1", "m1", "y1", "d2", "m2", "y2", "stores", "group"];
  if (
    [...url.searchParams.keys()].some(key => !allowed.includes(key)) ||
    allowed.some(key => url.searchParams.getAll(key).length !== 1)
  ) {
    throw new Error("Report parameters changed.");
  }
  if (url.searchParams.get("type") !== "1" || url.searchParams.get("group") !== "") {
    throw new Error("Only single-store Orders (Sales) reports are supported.");
  }
  let stores: unknown;
  try {
    stores = JSON.parse(url.searchParams.get("stores") ?? "null");
  } catch {
    throw new Error("Select exactly one gumball store.");
  }
  if (
    !Array.isArray(stores) ||
    stores.length !== 1 ||
    !Number.isSafeInteger(stores[0]) ||
    stores[0] <= 0
  ) {
    throw new Error("Select exactly one gumball store.");
  }
  const date = (index: 1 | 2) =>
    `${url.searchParams.get(`y${index}`)}-${String(url.searchParams.get(`m${index}`)).padStart(2, "0")}-${String(url.searchParams.get(`d${index}`)).padStart(2, "0")}`;
  if (date(1) !== range.from || date(2) !== range.to) {
    throw new Error("Export dates do not match the requested dates.");
  }
  return { url: url.href, storeId: String(stores[0]), ...range };
}

export function parseOrdersSalesCsv(text: string): Record<string, string>[] {
  if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_ORDERS_SALES_BYTES) {
    throw new Error("Report exceeds the 4 MB limit. Use a shorter period.");
  }
  if (/^\s*</.test(text)) {
    throw new Error("gumball returned a page instead of CSV. Check your login.");
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell === "" && !closed) {
      quoted = true;
    } else if (char === "," || char === "\n" || char === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (char !== ",") {
        if (row.some(value => value !== "")) rows.push(row);
        row = [];
        if (char === "\r" && source[index + 1] === "\n") index += 1;
      }
    } else {
      if (closed || char === '"') throw new Error("Malformed CSV quoting.");
      cell += char;
    }
  }

  if (quoted) throw new Error("Incomplete CSV download.");
  if (cell !== "" || row.length || closed) {
    row.push(cell);
    rows.push(row);
  }

  const headers = rows.shift();
  const required = [
    "Order ID",
    "Placed",
    "Customer",
    "Customer ID",
    "Address",
    "Paid",
    "Payment Date",
    "Total",
  ];
  if (!headers || new Set(headers).size !== headers.length || required.some(header => !headers.includes(header))) {
    throw new Error("Orders (Sales) columns changed or the wrong report was returned.");
  }
  if (rows.length > 15_000) throw new Error("Report has too many rows. Use a shorter period.");

  const ids = new Set<string>();
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2}: column count mismatch.`);
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    const orderId = record["Order ID"] ?? "";
    if (!/^\d+$/.test(orderId) || ids.has(orderId)) {
      throw new Error(`Row ${index + 2}: missing or duplicate order ID.`);
    }
    ids.add(orderId);
    return record;
  });
}
