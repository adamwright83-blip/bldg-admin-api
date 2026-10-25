import { z } from "zod";

export const CPE_SHOTGUN_TERRITORY = "century-park-east";
export const CPE_SHOTGUN_APPROVAL =
  "Approve this customer, message, offer and scheduled time";
export const CPE_SHOTGUN_POLICY = "cpe-shotgun-v1";
export const shotgunSubmission = z
  .object({
    requestId: z.string().uuid(),
    customerId: z.string().trim().min(1).max(128),
    openingId: z.enum(["last", "regular", "date", "value", "plain"]),
    hypothesis: z.enum([
      "moved",
      "seasonal",
      "price",
      "bad_experience",
      "forgot",
    ]),
    shell: z.enum(["none", "free_pickup", "credit_10"]),
    messageBody: z.string().trim().min(1).max(500),
    scheduledFor: z.string().datetime({ offset: true }),
    confirmation: z.literal(CPE_SHOTGUN_APPROVAL),
  })
  .strict();
export type ShotgunSubmission = z.infer<typeof shotgunSubmission>;

export type ShotgunObservation = {
  kind: "verified_reply" | "order_recorded" | "payment_observed";
  sourceRef: string;
  occurredAt: string;
  relation: "exact_message" | "customer_timeline";
  authorityReceiptId?: string;
  reply?: { source: string; classification: string; text: string };
  orderStatus?: string;
  payment?: {
    source: "laundry_butler" | "cleancloud";
    observedCents: number;
    orderNumber: string | null;
  };
};

/** No causal or hypothesis-correctness score is inferred from customer activity. */
export const SHOTGUN_RESULT_RULE =
  "Subsequent activity is observational. It does not verify the hypothesis or prove the outreach caused a sale.";
