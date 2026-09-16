import assert from "node:assert/strict";
import test from "node:test";
import { GUMBALL_INBOX_DIR, inboxFilename } from "./core.js";

test("Gumball targets the canonical inbox subdirectory", () => {
  assert.equal(GUMBALL_INBOX_DIR, "Gumball Inbox");
  assert.equal(
    inboxFilename({
      storeId: "123",
      from: "2026-09-15",
      to: "2026-09-15",
      requestId: "123e4567-e89b-42d3-a456-426614174000",
    }),
    "gumball-orders_sales-store-123-2026-09-15-2026-09-15-123e4567-e89b-42d3-a456-426614174000.csv"
  );
});

test("Gumball never accepts a filename without durable source identity", () => {
  assert.throws(
    () =>
      inboxFilename({
        storeId: "0",
        from: "2026-09-15",
        to: "2026-09-15",
        requestId: "123e4567-e89b-42d3-a456-426614174000",
      }),
    /store id/i
  );
});
