export const GOLDLINE = "https://admin.bldg.chat";
export const CLEANCLOUD = "https://cleancloudapp.com";
export const MAX_BYTES = 4_000_000;
export const HOSTS = [`${GOLDLINE}/*`, `${CLEANCLOUD}/*`];

export function pacificToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map(type => parts.find(p => p.type === type).value)
    .join("-");
}
export function dateNumber(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new Error("Use a valid calendar date.");
  const n = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value)
    throw new Error("Use a valid calendar date.");
  return n;
}
export function validateRange(from, to, today = pacificToday()) {
  const start = dateNumber(from),
    end = dateNumber(to);
  if (start > end || to > today || end - start > 31 * 86400000)
    throw new Error(
      "Choose up to 32 calendar days ending no later than today in Los Angeles."
    );
  return { from, to };
}
export function initialRange(now = new Date()) {
  const to = pacificToday(now);
  return {
    from: new Date(dateNumber(to) - 29 * 86400000).toISOString().slice(0, 10),
    to,
  };
}
// This is the normal Orders (Sales) export URL observed in Chrome, NOT the paid API.
// Never accept arbitrary URLs received from a web page or a download event.
export function validateExportUrl(raw, range) {
  const u = new URL(raw);
  if (
    u.origin !== CLEANCLOUD ||
    u.pathname !== "/include/data-export-endpoint.php" ||
    u.username ||
    u.password ||
    u.hash
  )
    throw new Error("Unexpected report destination.");
  const allowed = [
    "type",
    "d1",
    "m1",
    "y1",
    "d2",
    "m2",
    "y2",
    "stores",
    "group",
  ];
  if (
    [...u.searchParams.keys()].some(k => !allowed.includes(k)) ||
    allowed.some(k => u.searchParams.getAll(k).length !== 1)
  )
    throw new Error("Report parameters changed.");
  if (u.searchParams.get("type") !== "1" || u.searchParams.get("group") !== "")
    throw new Error("Only single-store Orders (Sales) reports are supported.");
  const stores = JSON.parse(u.searchParams.get("stores"));
  if (
    !Array.isArray(stores) ||
    stores.length !== 1 ||
    !Number.isSafeInteger(stores[0]) ||
    stores[0] <= 0
  )
    throw new Error("Select exactly one gumball store.");
  const date = i =>
    `${u.searchParams.get(`y${i}`)}-${u.searchParams.get(`m${i}`).padStart(2, "0")}-${u.searchParams.get(`d${i}`).padStart(2, "0")}`;
  if (date(1) !== range.from || date(2) !== range.to)
    throw new Error("Export dates do not match the requested dates.");
  return { url: u.href, storeId: String(stores[0]), ...range };
}

export function parseCsv(text) {
  if (
    typeof text !== "string" ||
    new TextEncoder().encode(text).length > MAX_BYTES
  )
    throw new Error("Report exceeds the 4 MB limit. Use a shorter period.");
  if (/^\s*</.test(text))
    throw new Error(
      "gumball returned a page instead of CSV. Check your login."
    );
  const rows = [];
  let row = [],
    cell = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else cell += c;
    } else if (c === '"' && cell === "" && !closed) quoted = true;
    else if (c === "," || c === "\n" || c === "\r") {
      row.push(cell);
      cell = "";
      closed = false;
      if (c !== ",") {
        if (row.some(v => v !== "")) rows.push(row);
        row = [];
        if (c === "\r" && text[i + 1] === "\n") i++;
      }
    } else {
      if (closed || c === '"') throw new Error("Malformed CSV quoting.");
      cell += c;
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
  if (
    !headers ||
    new Set(headers).size !== headers.length ||
    required.some(h => !headers.includes(h))
  )
    throw new Error(
      "Orders (Sales) columns changed or the wrong report was returned."
    );
  if (rows.length > 15000)
    throw new Error("Report has too many rows. Use a shorter period.");
  const ids = new Set();
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(`Row ${index + 2}: column count mismatch.`);
    const record = Object.fromEntries(headers.map((h, i) => [h, values[i]]));
    if (!/^\d+$/.test(record["Order ID"]) || ids.has(record["Order ID"]))
      throw new Error(`Row ${index + 2}: missing or duplicate order ID.`);
    ids.add(record["Order ID"]);
    return record;
  });
}

export function assertPairing(binding, observed) {
  if (
    !binding ||
    binding.tenantId !== observed.tenantId ||
    binding.actorId !== observed.actorId ||
    binding.storeId !== observed.storeId ||
    binding.storeLabel !== observed.storeLabel
  )
    throw new Error("Account or store changed. Reconnect before importing.");
}
export function recoveryState(saved) {
  if (
    !saved ||
    !["preparing", "downloading", "validating", "importing"].includes(
      saved.phase
    )
  )
    return saved;
  return {
    ...saved,
    phase: saved.phase === "importing" ? "outcome_unknown" : "interrupted",
    message:
      saved.phase === "importing"
        ? "Import response was interrupted. Check the server receipt before retrying."
        : "Sync interrupted before import. It is safe to start again.",
  };
}
