import { describe, expect, it, vi } from "vitest";
import { acceptClientFatalReport } from "./clientFatalRoute";

const ID = "6f1e2d3c-4b5a-4698-8abc-def012345678";

describe("acceptClientFatalReport", () => {
  it("logs only the sanitized record", () => {
    const log = vi.fn();
    const status = acceptClientFatalReport(
      {
        correlationId: ID,
        name: "TypeError",
        message: "failed for +1 310 555 0199 ada@example.com",
        stack: "Bearer abc.def.ghi at /opt/app/secret.ts:1:1 smsBody: hello there",
        extra: "should be rejected",
      },
      log
    );
    expect(status).toEqual({ status: 400 });
    expect(log).not.toHaveBeenCalled();
  });

  it("accepts a strict report and redacts before logging", () => {
    const log = vi.fn();
    const status = acceptClientFatalReport(
      {
        correlationId: ID,
        name: "TypeError",
        message: "failed for +1 310 555 0199 ada@example.com",
        stack: "Bearer abc.def.ghi\n at /opt/app/index.js:1:1",
      },
      log
    );
    expect(status).toEqual({ status: 204 });
    const record = log.mock.calls[0][0] as {
      message: string;
      stack: string;
      correlationId: string;
    };
    expect(record.correlationId).toBe(ID);
    expect(record.message).not.toContain("310");
    expect(record.message).not.toContain("ada@example.com");
    expect(record.stack).not.toContain("abc.def.ghi");
    expect(JSON.stringify(record)).not.toMatch(/phone|token|body/i);
  });

  it("rejects oversized or unexpected fields", () => {
    expect(
      acceptClientFatalReport({ correlationId: ID, name: "E", message: "m", note: "x" }, () => {})
    ).toEqual({ status: 400 });
    expect(acceptClientFatalReport(null, () => {})).toEqual({ status: 400 });
  });
});
