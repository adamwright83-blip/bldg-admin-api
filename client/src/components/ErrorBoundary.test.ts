import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const boundary = readFileSync(
  path.resolve(import.meta.dirname, "ErrorBoundary.tsx"),
  "utf8"
);

describe("ErrorBoundary customer visibility", () => {
  it("does not render stacks, messages, or raw error objects", () => {
    expect(boundary).not.toContain("error?.stack");
    expect(boundary).not.toContain("error.stack");
    expect(boundary).not.toContain("error.message");
    expect(boundary).not.toContain("this.state.error");
    expect(boundary).toContain("customerFatalNotice");
    expect(boundary).toContain("reportClientFatal");
    expect(boundary).toContain("Reload Page");
    expect(boundary).toContain("notice.correlationId");
  });
});
