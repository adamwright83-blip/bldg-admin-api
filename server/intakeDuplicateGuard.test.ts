import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("resident intake duplicate guard", () => {
  it("routes resident intake through the canonical idempotent create helper", () => {
    const source = readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8");

    expect(source).toContain("createOrReuseResidentLaundryOrder(orderValues");
    expect(source).not.toContain("const orderId = await createOrder(orderValues)");
    expect(source).toContain("duplicate: true");
  });

  it("keeps exact-once resident safeguards inside the shared helper", () => {
    const source = readFileSync(new URL("./db.ts", import.meta.url), "utf8");

    expect(source).toContain("OPEN_ORDER_STATUSES");
    expect(source).toContain("findLikelyDuplicateOpenResidentOrder");
    expect(source).toContain("findOpenResidentLaundryOrderLoose");
    expect(source).toContain("findResidentOrderByClientRequestId");
    expect(source).toContain("isDuplicateKeyError");
    expect(source).toContain("eq(orders.serviceType, order.serviceType)");
    expect(source).toContain("eq(orders.pickupDate, order.pickupDate)");
    expect(source).toContain("duplicateRequestSignal");
    expect(source).toContain("sameDuplicateResident");
  });

  it("gives the admin POS create path an exact idempotency key without fuzzy blocking repeat orders", () => {
    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

    expect(source).toContain("clientRequestId: z.string().max(160).optional()");
    expect(source).toContain("adminOrderIdempotencyKey(input.clientRequestId)");
    expect(source).toContain("findResidentOrderByClientRequestId(idempotencyKey)");
    expect(source).toContain("residentClientRequestId: idempotencyKey");
    expect(source).toContain("return { orderId, reused: false }");
    expect(source).not.toContain("findLikelyDuplicateOpenResidentOrder(input)");
  });

  it("blocks unpaid delivery status updates at the shared backend mutation", () => {
    const source = readFileSync(new URL("./routers.ts", import.meta.url), "utf8");

    expect(source).toContain('input.status === "delivered" && !order.paid');
    expect(source).toContain("Charge the order before marking it delivered.");
    expect(source.indexOf('input.status === "delivered" && !order.paid')).toBeLessThan(
      source.indexOf("await updateOrderStatus(input.orderId, input.status")
    );
  });
});
