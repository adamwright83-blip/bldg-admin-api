import { z } from "zod";
import { SALES_INTEL_TEACHING_CATEGORIES } from "./salesIntelTeaching";

/**
 * The complete Sales Intel surface permitted to cross the driver boundary.
 *
 * Stronghold needs only an accepted-teaching total and category distribution.
 * Source identities, teaching copy, model metadata, review metadata, raw
 * transcripts, and every other canonical field remain server-side.
 */
export const driverSafeSalesIntelSchema = z
  .object({
    acceptedTeachingCount: z.number().int().nonnegative(),
    byCategory: z.array(
      z
        .object({
          category: z.enum(SALES_INTEL_TEACHING_CATEGORIES),
          count: z.number().int().positive(),
        })
        .strict()
    ),
  })
  .strict();

export type DriverSafeSalesIntel = z.infer<typeof driverSafeSalesIntelSchema>;
