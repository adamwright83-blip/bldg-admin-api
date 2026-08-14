import {
  driverSafeSalesIntelSchema,
  type DriverSafeSalesIntel,
} from "../../shared/driverSafeSalesIntel";
import { SALES_INTEL_TEACHING_CATEGORIES } from "../../shared/salesIntelTeaching";
import {
  listDriverSafeAcceptedTeachingCounts,
  type DriverSafeTeachingCategoryCount,
} from "./salesIntelTeachingStore";

/** Explicit allowlist projection; never spread a canonical Sales Intel row. */
export function projectDriverSafeSalesIntel(
  rows: readonly DriverSafeTeachingCategoryCount[]
): DriverSafeSalesIntel | null {
  const counts = new Map(rows.map(row => [row.category, row.count]));
  const byCategory = SALES_INTEL_TEACHING_CATEGORIES.flatMap(category => {
    const count = counts.get(category) ?? 0;
    return count > 0 ? [{ category, count }] : [];
  });
  const acceptedTeachingCount = byCategory.reduce(
    (total, entry) => total + entry.count,
    0
  );
  if (acceptedTeachingCount === 0) return null;

  return driverSafeSalesIntelSchema.parse({
    acceptedTeachingCount,
    byCategory,
  });
}

export async function getDriverSafeSalesIntel(): Promise<DriverSafeSalesIntel | null> {
  return projectDriverSafeSalesIntel(
    await listDriverSafeAcceptedTeachingCounts()
  );
}
