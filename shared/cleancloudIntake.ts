import { z } from "zod";
const sourceId = z.string().regex(/^[1-9]\d{0,15}$/);
export const intakeProductSchema = z
  .object({
    id: sourceId,
    label: z.string().trim().min(1).max(191),
    unit: z.enum(["lb", "piece"]),
    section: z.string().max(191),
  })
  .strict();
export const intakeOrderSchema = z
  .object({
    externalOrderId: sourceId,
    customerName: z.string().trim().min(1).max(191),
    readyBy: z.string().max(191),
  })
  .strict();
export const intakePlanSchema = z
  .object({
    lines: z
      .array(
        z
          .object({
            productId: sourceId,
            quantity: z.number().positive().max(10000),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict()
  .refine(
    v => new Set(v.lines.map(x => x.productId)).size === v.lines.length,
    "Select each product once."
  );
export const intakePreparedSchema = z
  .object({
    externalOrderId: sourceId,
    customerName: z.string().min(1).max(191),
    readyBy: z.string().max(191),
    priceListId: z.string().max(64),
    totalCents: z.number().int().min(0).max(100000000),
    bags: z.number().int().min(0).max(1000),
    notes: z.string().max(2000),
    tableText: z.string().max(20000),
    quantities: z
      .array(
        z
          .object({
            productId: sourceId,
            quantity: z.number().min(0).max(10000),
          })
          .strict()
      )
      .max(1000),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    observedAt: z.string().datetime(),
  })
  .strict();
export type IntakeProduct = z.infer<typeof intakeProductSchema>;
export type IntakeOrder = z.infer<typeof intakeOrderSchema>;
export type IntakePlan = z.infer<typeof intakePlanSchema>;
export type IntakePrepared = z.infer<typeof intakePreparedSchema>;
export type IntakeState =
  | "detail"
  | "prepare_pending"
  | "preparing"
  | "review"
  | "submit_pending"
  | "submitting"
  | "verify_pending"
  | "verifying"
  | "saved"
  | "attention";
export function intakeFingerprintText(
  v: Omit<IntakePrepared, "fingerprint" | "observedAt">
) {
  return JSON.stringify([
    v.externalOrderId,
    v.customerName,
    v.readyBy,
    v.priceListId,
    v.totalCents,
    v.bags,
    v.notes,
    v.tableText,
    [...v.quantities]
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .map(x => [x.productId, x.quantity]),
  ]);
}
export function validateIntakePlan(plan: IntakePlan, catalog: IntakeProduct[]) {
  intakePlanSchema.parse(plan);
  for (const line of plan.lines) {
    const product = catalog.find(p => p.id === line.productId);
    if (!product)
      throw new Error("The CleanCloud product changed. Refresh the catalog.");
    if (product.unit === "piece" && !Number.isInteger(line.quantity))
      throw new Error("Garment quantities must be whole numbers.");
    if (
      product.unit === "lb" &&
      Math.abs(line.quantity * 100 - Math.round(line.quantity * 100)) > 0.00001
    )
      throw new Error("Enter pounds to at most two decimal places.");
  }
  return plan;
}
