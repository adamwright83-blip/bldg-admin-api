import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildDayforgeEventRows,
  dayforgeEventScope,
} from "./dayforgeEventStore";

describe("DayForge event writer", () => {
  it("derives a non-null idempotency scope from server context", () => {
    expect(dayforgeEventScope({ tenantId: "tenant_a" })).toBe(
      "tenant:tenant_a"
    );
    expect(dayforgeEventScope({ anonymousSessionId: "preview_a" })).toBe(
      "public:preview_a"
    );
    expect(dayforgeEventScope({ systemScopeId: "cleanup" })).toBe(
      "system:cleanup"
    );
    expect(() => dayforgeEventScope({})).toThrow(/requires a tenant/i);
  });

  it("creates immutable audit before/after state and a redacted product row", () => {
    const rows = buildDayforgeEventRows({
      tenantId: "tenant_a",
      actor: { type: "field", id: "field-user" },
      entityType: "commercial_mission",
      entityId: "42",
      eventName: "arrived",
      before: { status: "en_route", version: 8 },
      after: { status: "arrived", version: 9 },
      source: "commercial_mission",
      correlationId: "field-arrived:request-42",
      idempotencyKey: "field-arrived:request-42",
      occurredAt: new Date("2026-07-13T12:00:00.000Z"),
      productEvent: {
        name: "field_arrived",
        missionId: 42,
        accountId: 7,
        properties: {
          checkInMethod: "manual",
          address: "123 Private Street",
          notes: "Never send this to analytics",
          email: "private@example.com",
        },
      },
    });

    expect(rows.audit).toMatchObject({
      scopeKey: "tenant:tenant_a",
      tenantId: "tenant_a",
      entityType: "commercial_mission",
      entityId: "42",
      beforeJson: { status: "en_route", version: 8 },
      afterJson: { status: "arrived", version: 9 },
      correlationId: "field-arrived:request-42",
    });
    expect(rows.product).toMatchObject({
      eventName: "field_arrived",
      missionId: 42,
      accountId: 7,
      eventVersion: 1,
    });
    expect(rows.product?.purgeAfter?.toISOString()).toBe(
      "2027-08-17T12:00:00.000Z"
    );
    expect(JSON.stringify(rows.product?.propertiesJson)).not.toContain(
      "123 Private Street"
    );
    expect(JSON.stringify(rows.product?.propertiesJson)).not.toContain(
      "private@example.com"
    );
    expect(JSON.stringify(rows.product?.propertiesJson)).not.toContain(
      "Never send this"
    );
  });

  it("rejects unbounded identifiers before writing", () => {
    expect(() =>
      buildDayforgeEventRows({
        tenantId: "tenant_a",
        actor: { type: "system", id: null },
        entityType: "commercial_mission",
        entityId: "42",
        eventName: "x".repeat(97),
        source: "commercial_mission",
        correlationId: "correlation",
        idempotencyKey: "idempotency",
      })
    ).toThrow(/eventName/);
    expect(() =>
      dayforgeEventScope({ anonymousSessionId: "x".repeat(65) })
    ).toThrow(/anonymousSessionId/);
  });

  it("uses immutable no-op upserts for concurrent idempotent writes", () => {
    const source = readFileSync(
      new URL("./dayforgeEventStore.ts", import.meta.url),
      "utf8"
    );
    expect(source.match(/onDuplicateKeyUpdate/g)).toHaveLength(2);
    expect(source).toContain(
      "set: { idempotencyKey: rows.audit.idempotencyKey }"
    );
    expect(source).toContain(
      "set: { idempotencyKey: rows.product.idempotencyKey }"
    );
    expect(source).toContain(
      "DayForge event idempotency key is bound to a different event"
    );
    expect(source).toContain(
      "DayForge product-event idempotency key is bound to a different event"
    );
  });
});
