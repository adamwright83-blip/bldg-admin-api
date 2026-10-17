import { describe, expect, it } from "vitest";
import { paidModelReplayAuthorized } from "./paidReplayGate";

describe("paid model replays need explicit authorization and the testing key", () => {
  const key = { ANTHROPIC_API_KEY: "sk-test" };
  it("skips unless the suite flag and the authorization are both set", () => {
    expect(paidModelReplayAuthorized(undefined, { ...key, CLAIRE_PAID_REPLAY_AUTHORIZED: "1" })).toBe(false);
    expect(paidModelReplayAuthorized("1", { ...key })).toBe(false);
  });
  it("refuses the production environment that `railway run` injects", () => {
    expect(() => paidModelReplayAuthorized("1", { ...key, CLAIRE_PAID_REPLAY_AUTHORIZED: "1", CLAIRE_REPLAY_KEY_IS_TESTING: "1", RAILWAY_ENVIRONMENT_NAME: "production" })).toThrow(/Railway production environment/);
  });
  it("refuses unless the key is declared to be the capped testing key", () => {
    expect(() => paidModelReplayAuthorized("1", { ...key, CLAIRE_PAID_REPLAY_AUTHORIZED: "1" })).toThrow(/testing workspace key/);
  });
  it("runs only with all three", () => {
    expect(paidModelReplayAuthorized("1", { ...key, CLAIRE_PAID_REPLAY_AUTHORIZED: "1", CLAIRE_REPLAY_KEY_IS_TESTING: "1" })).toBe(true);
  });
});
