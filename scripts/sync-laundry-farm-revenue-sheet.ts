if (process.env.NODE_ENV !== "production") {
  await import("dotenv/config");
}

import { syncLaundryFarmRevenueSheet } from "../server/laundryFarmSheetSync";

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

const date = argValue("date");
const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--dryRun");

const result = await syncLaundryFarmRevenueSheet({ date, dryRun });
console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exitCode = 1;
}
