import { z } from "zod";

export const pickupCountsSchema = z
  .object({
    bagCount: z.number().int().min(0).max(999),
    garmentCount: z.number().int().min(0).max(9999),
  })
  .strict()
  .refine(
    v => v.bagCount + v.garmentCount > 0,
    "Enter at least one bag or garment."
  );
export type PickupCounts = z.infer<typeof pickupCountsSchema>;
export const cleancloudPickupRowSchema = z
  .object({
    externalOrderId: z.string().regex(/^[1-9]\d{0,15}$/),
    customerName: z.string().trim().min(1).max(191),
    address: z.string().trim().min(1).max(512),
    scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    windowStart: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    windowEnd: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    notes: z.string().trim().max(2000).nullable(),
  })
  .strict();
export type CleancloudPickupRow = z.infer<typeof cleancloudPickupRowSchema>;
export type PickupSyncState =
  | "ready"
  | "pending"
  | "working"
  | "synced"
  | "attention"
  | "held";
export type PickupBridgeView = {
  state: PickupSyncState;
  bagCount: number | null;
  garmentCount: number | null;
  observedAt: string;
  verifiedAt: string | null;
  error: string | null;
};
export function pickupDirectionsUrl(
  address: string | null | undefined
): string | null {
  if (!address?.trim()) return null;
  const params = new URLSearchParams({
    api: "1",
    destination: address.trim(),
    travelmode: "driving",
    dir_action: "navigate",
  });
  return `https://www.google.com/maps/dir/?${params}`;
}
export function pickupSyncLabel(pickup: PickupBridgeView): string {
  if (pickup.state === "synced") return "CleanCloud synced · ready for intake";
  if (pickup.state === "attention")
    return "Pickup saved · CleanCloud needs attention";
  if (pickup.state === "pending" || pickup.state === "working")
    return "Pickup saved · CleanCloud sync pending";
  if (pickup.state === "held") return "Pickup on hold";
  return "Ready for pickup";
}
