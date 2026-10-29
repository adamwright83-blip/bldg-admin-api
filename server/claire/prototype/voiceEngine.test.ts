import { describe, expect, it } from "vitest";
import { appliedRowIds, nativeToolClaireEnabledFor, newNativeToolCallState, toolEventSummary } from "./voiceEngine";

const adam = { tenantId: "default", operatorUserId: "adam-open-id" };
const teammate = { tenantId: "default", operatorUserId: "driver-primary" };

describe("nativeToolClaireEnabledFor", () => {
  it("nobody is on the new Claire until the switch names them", () => {
    expect(nativeToolClaireEnabledFor(adam, {}, "adam-open-id")).toBe(false);
    expect(nativeToolClaireEnabledFor(adam, { CLAIRE_NATIVE_TOOL_OPERATOR_IDS: "" }, "adam-open-id")).toBe(false);
  });

  it("'owner' means OWNER_OPEN_ID and only that operator", () => {
    const env = { CLAIRE_NATIVE_TOOL_OPERATOR_IDS: "owner" };
    expect(nativeToolClaireEnabledFor(adam, env, "adam-open-id")).toBe(true);
    expect(nativeToolClaireEnabledFor(teammate, env, "adam-open-id")).toBe(false);
    // No owner configured: 'owner' names nobody.
    expect(nativeToolClaireEnabledFor(adam, env, "")).toBe(false);
  });

  it("a tenant-scoped entry matches that tenant only; a bare id matches the operator anywhere", () => {
    expect(nativeToolClaireEnabledFor(adam, { CLAIRE_NATIVE_TOOL_OPERATOR_IDS: "default:adam-open-id" }, "")).toBe(true);
    expect(nativeToolClaireEnabledFor({ ...adam, tenantId: "other" }, { CLAIRE_NATIVE_TOOL_OPERATOR_IDS: "default:adam-open-id" }, "")).toBe(false);
    expect(nativeToolClaireEnabledFor({ ...adam, tenantId: "other" }, { CLAIRE_NATIVE_TOOL_OPERATOR_IDS: " adam-open-id , someone-else" }, "")).toBe(true);
    expect(nativeToolClaireEnabledFor(teammate, { CLAIRE_NATIVE_TOOL_OPERATOR_IDS: "adam-open-id" }, "")).toBe(false);
  });

  it("the kill switch puts every new call back on Brain V2 whatever the list says", () => {
    const env = { CLAIRE_NATIVE_TOOL_OPERATOR_IDS: "owner,driver-primary", CLAIRE_NATIVE_TOOL_KILL_SWITCH: "1" };
    expect(nativeToolClaireEnabledFor(adam, env, "adam-open-id")).toBe(false);
    expect(nativeToolClaireEnabledFor(teammate, env, "adam-open-id")).toBe(false);
    expect(nativeToolClaireEnabledFor(adam, { ...env, CLAIRE_NATIVE_TOOL_KILL_SWITCH: "0" }, "adam-open-id")).toBe(true);
  });
});

describe("call state and log summaries", () => {
  it("a new call state is plain JSON with nothing prepared yet", () => {
    const state = newNativeToolCallState("claude-sonnet-5-5");
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    expect(state.prepared).toBeNull();
    expect(state.messages).toEqual([]);
  });

  it("applied receipts give the related-action ids; refusals and reads do not", () => {
    const events = [
      { name: "find_day_line_item", input: {}, output: { status: "ok", candidates: [{ id: "x" }] }, wrote: false, latencyMs: 3 },
      { name: "apply_day_line_changes", input: {}, output: { receipts: [{ op: "add", status: "applied", id: "row-1" }, { op: "remove", status: "refused", id: "row-9" }, { op: "add", status: "applied", id: "row-1" }] }, wrote: true, latencyMs: 40 },
    ];
    expect(appliedRowIds(events)).toEqual(["row-1"]);
    const summary = toolEventSummary(events);
    expect(summary[0]).toMatchObject({ name: "find_day_line_item", candidates: 1, wrote: false });
    expect(summary[1]).toMatchObject({ name: "apply_day_line_changes", wrote: true, receipts: [{ op: "add", status: "applied", id: "row-1" }, { op: "remove", status: "refused", id: "row-9" }, { op: "add", status: "applied", id: "row-1" }] });
    // Operator words never reach the runtime log through this summary.
    expect(JSON.stringify(summary)).not.toContain("operator_words");
  });
});
